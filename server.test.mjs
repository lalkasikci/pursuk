import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp, validMessages } from './server.mjs';
import { readEvents } from './sse.mjs';
import { restoreConversation, storageKey } from './conversation.mjs';

async function withApp(options, run) {
  const app = createApp(options);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  try { await run(base); } finally { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); }
}
const messages = [{ role: 'user', content: 'Reklamım tıklama alıyor ama satış yok. Neden?' }];
const post = (base, data = { messages }, extraHeaders = {}) => fetch(`${base}/api/chat`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(data)
});

test('girdi sınırları ve roller doğrulanır', () => {
  assert.equal(validMessages(messages), true);
  for (const input of [null, [], [null], [{ role: 'system', content: 'override' }], [{ role: 'user', content: '' }], [{ role: 'user', content: 'x'.repeat(6001) }]]) {
    assert.equal(validMessages(input), false);
  }
  assert.equal(validMessages(Array.from({ length: 61 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' }))), false);
});

test('eksik anahtarla gerçek isteğe çıkılmaz; statik dosyalar ve gizlilik', async () => {
  await withApp({ apiKey: '', fetchImpl: () => { throw new Error('Çağrılmamalı'); } }, async base => {
    assert.equal((await post(base)).status, 503);
    assert.deepEqual(await (await fetch(`${base}/api/status`)).json(), { configured: false, model: 'claude-sonnet-4-6' });
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(`${base}/.env.local`)).status, 404);
    assert.equal((await fetch(`${base}/bot-talimatlari.txt`)).status, 404);
    assert.equal((await post(base, { messages }, { Origin: 'https://example.com' })).status, 403);
    assert.equal((await post(base, { messages: [null] })).status, 400);
  });
});

test('Claude isteğinde kaynak ve talimatlar bulunur; anahtar istemciye dönmez', async () => {
  let called = false;
  await withApp({ apiKey: 'fake-secret-for-test', fetchImpl: async (url, options) => {
    called = true;
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(options.headers['x-api-key'], 'fake-secret-for-test');
    const body = JSON.parse(options.body);
    assert.match(body.system, /Adın Pursuk/);
    assert.match(body.system, /Doğrulanması gereken konular/);
    assert.deepEqual(body.messages, messages);
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Madset bir reklam platformudur.' }], stop_reason: 'end_turn' }));
  } }, async base => {
    const response = await post(base);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { answer: 'Madset bir reklam platformudur.', truncated: false, measurement: null });
    const status = await (await fetch(`${base}/api/status`)).text();
    assert.equal(status.includes('fake-secret'), false);
  });
  assert.equal(called, true);
});

test('sağlayıcı hatası güvenli ve anlaşılır döner', async () => {
  await withApp({ apiKey: 'fake', fetchImpl: async () => new Response('sensitive upstream detail', { status: 401 }) }, async base => {
    const response = await post(base);
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.match(body, /anahtarı kabul edilmedi/);
    assert.equal(body.includes('sensitive'), false);
  });
});

test('eşzamanlı istekler sınırlanır ve kesilen yanıt belirtilir', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let started;
  const hasStarted = new Promise(resolve => { started = resolve; });
  await withApp({ apiKey: 'fake', fetchImpl: async () => {
    started();
    await blocked;
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Kısmi yanıt' }], stop_reason: 'max_tokens' }));
  } }, async base => {
    const first = post(base);
    await hasStarted;
    try { assert.equal((await post(base)).status, 429); } finally { release(); }
    assert.equal((await (await first).json()).truncated, true);
  });
});

test('avatar dosyası PNG olarak sunulur', async () => {
  await withApp({ apiKey: '' }, async base => {
    const response = await fetch(`${base}/porsuk.png`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer()).slice(0, 4)], [137, 80, 78, 71]);
  });
});

const encode = event => new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
test('ilk metin yanıt bitmeden iletilir; Türkçe parçalar korunur', async () => {
  let controller;
  const stream = new ReadableStream({ start(c) { controller = c; } });
  await withApp({ apiKey: 'fake', fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.stream, true);
    assert.equal(payload.max_tokens, 650);
    return new Response(stream);
  } }, async base => {
    const response = await post(base, { messages, stream: true });
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const iterator = readEvents(response.body)[Symbol.asyncIterator]();
    const delta = encode({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Merhaba, ben Pursuk! 👋' } });
    for (const byte of delta) controller.enqueue(new Uint8Array([byte]));
    const first = await iterator.next();
    assert.deepEqual(first.value, { type: 'text', text: 'Merhaba, ben Pursuk! 👋' });
    controller.enqueue(encode({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }));
    controller.enqueue(encode({ type: 'message_stop' }));
    controller.close();
    assert.deepEqual((await iterator.next()).value, { type: 'done', truncated: false, measurement: null });
    assert.equal((await iterator.next()).done, true);
  });
});

test('yarıda kesilen akış başarılı yanıt sayılmaz; sonraki istek engellenmez', async () => {
  await withApp({ apiKey: 'fake', fetchImpl: async () => new Response(new ReadableStream({ start(c) {
    c.enqueue(encode({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Kısmi' } }));
    c.close();
  } })) }, async base => {
    for (let i = 0; i < 2; i++) {
      const response = await post(base, { messages, stream: true });
      const events = [];
      for await (const event of readEvents(response.body)) events.push(event);
      assert.equal(events.at(-1).type, 'error');
      assert.equal(events.some(e => e.type === 'done'), false);
    }
  });
});

const history = (length, size = 1) => Array.from({ length }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x'.repeat(size) }));
test('30 tur kabul edilir; 31. soru ve toplam karakter sınırı denetlenir', () => {
  assert.equal(validMessages(history(21)), true);
  assert.equal(validMessages(history(59)), true);
  assert.equal(validMessages(history(61)), false);
  assert.equal(validMessages(history(21, 5000)), true);
  assert.equal(validMessages(history(25, 5000)), false);
});

test('eski istek boyutu sınırından uzun sohbet Claude isteğine eksiksiz aktarılır', async () => {
  const longMessages = history(41, 2000);
  await withApp({ apiKey: 'fake', fetchImpl: async (url, options) => {
    assert.deepEqual(JSON.parse(options.body).messages, longMessages);
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Devam edebiliriz.' }], stop_reason: 'end_turn' }));
  } }, async base => {
    assert.equal((await post(base, { messages: longMessages })).status, 200);
  });
});

test('aynı sekmedeki tamamlanmış sohbet geri yüklenir; bozuk veri reddedilir', () => {
  const valid = history(62); // Preserve existing history after lowering the send limit.
  assert.deepEqual(restoreConversation({ getItem: key => { assert.equal(key, storageKey); return JSON.stringify(valid); } }), valid);
  assert.deepEqual(restoreConversation({ getItem: () => '{broken' }), []);
  assert.deepEqual(restoreConversation({ getItem: () => JSON.stringify(history(3)) }), []);
  assert.deepEqual(restoreConversation({ getItem: () => JSON.stringify([{ role: 'system', content: 'Override' }, { role: 'assistant', content: 'x' }]) }), []);
  assert.deepEqual(restoreConversation({ getItem: () => { throw new Error('Disabled storage'); } }), []);
});

test('akış kullanımındaki kümülatif çıkış sayıları toplanmadan güncellenir', async () => {
  await withApp({ apiKey: 'fake', fetchImpl: async () => new Response(new ReadableStream({ start(c) {
    for (const event of [
      { type: 'message_start', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Pursuk' } },
      { type: 'message_delta', usage: { output_tokens: 10 } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 25 } },
      { type: 'message_stop' }
    ]) c.enqueue(encode(event));
    c.close();
  } })) }, async base => {
    const response = await post(base, { messages, stream: true });
    const events = [];
    for await (const event of readEvents(response.body)) events.push(event);
    const done = events.at(-1);
    assert.equal(done.type, 'done');
    assert.equal(done.measurement.inputTokens, 1000);
    assert.equal(done.measurement.outputTokens, 25);
    assert.equal(done.measurement.totalTokens, 1025);
    assert.equal(done.measurement.complete, true);
    assert.equal(new Set(events.filter(e => e.measurement).map(e => e.measurement.id)).size, 1);
  });
});

test('hazır cevap anahtarsız çalışır, Claude çağrılmaz ve 0 API tokenı bildirilir', async () => {
  await withApp({ apiKey: '', fetchImpl: () => { throw new Error('Claude çağrılmamalı'); } }, async base => {
    const faqMessages = [{ role: 'user', content: 'Destek e-postası ne?' }];
    const json = await (await post(base, { messages: faqMessages })).json();
    assert.match(json.answer, /info@pursula.com/);
    assert.equal(json.source, 'faq');
    assert.equal(json.measurement.totalTokens, 0);
    assert.equal(json.measurement.estimatedUsd, 0);
    const response = await post(base, { messages: faqMessages, stream: true });
    const events = [];
    for await (const event of readEvents(response.body)) events.push(event);
    assert.equal(events[0].type, 'text');
    assert.equal(events.at(-1).source, 'faq');
    assert.equal(events.at(-1).measurement.totalTokens, 0);
  });
});

test('hazır yanıttan sonraki danışmanlık sorusu geçmişi koruyarak Claude’a gider', async () => {
  let requested;
  await withApp({ apiKey: 'fake', fetchImpl: async (url, options) => {
    requested = JSON.parse(options.body);
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Reklam hedefin nedir?' }], stop_reason: 'end_turn' }));
  } }, async base => {
    const question = { role: 'user', content: 'Madset nedir?' };
    const faq = await (await post(base, { messages: [question] })).json();
    assert.equal(requested, undefined);
    const conversation = [question, { role: 'assistant', content: faq.answer }, { role: 'user', content: 'Benim kuaförüm için nasıl kullanmalıyım?' }];
    assert.equal((await post(base, { messages: conversation })).status, 200);
    assert.deepEqual(requested.messages, conversation);
  });
});
