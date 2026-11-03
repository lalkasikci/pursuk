import { createTestStore } from './postgres-test-helper.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistoryContext, summaryInstructions } from './history-context.mjs';
import { createApp } from './server.mjs';
import { hashPassword } from './admin-auth.mjs';
const conversationId = 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12);
const history = count => Array.from({ length: count }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `Mesaj ${i}: ` + 'Reklam değerlendirmesi hakkında açıklama. '.repeat(18) }));
const summary = 'Kullanıcı: İzmir Bornova’da güzellik salonu. Son belirttiği günlük bütçe 600 TL; hedef WhatsApp mesajı. TikTok istemiyor. Asistan önerisi: görsel ve mesajı test et.';

test('kısa konuşma için özetleme isteği yapılmaz', async () => {
  const context = createHistoryContext();
  let calls = 0;
  const messages = history(7);
  const result = await context.prepare(messages, { conversationId, generate: () => { calls++; } });
  assert.deepEqual(result.messages, messages);
  assert.equal(calls, 0);
});

test('eski mesajlar özetlenir; son altı mesaj ve orijinal geçmiş aynen kalır', async () => {
  const context = createHistoryContext();
  const messages = history(19);
  const original = structuredClone(messages);
  let received;
  const result = await context.prepare(messages, { conversationId, generate: async prefix => { received = prefix; return summary; } });
  assert.deepEqual(received, original.slice(0, 12));
  assert.deepEqual(result.messages.slice(-6), original.slice(-6));
  assert.deepEqual(messages, original);
  assert.equal(result.messages[0].role, 'user');
  assert.match(result.messages[0].content, /600 TL/);
  assert.equal(result.info.coveredMessages, 12);
  assert.ok(result.info.afterCharacters < result.info.beforeCharacters);
});

test('özet her mesajda üretilmez; farklı sohbetler ve değişen geçmiş karışmaz', async () => {
  const context = createHistoryContext();
  let calls = 0;
  const generate = async () => { calls++; return summary; };
  await context.prepare(history(19), { conversationId, generate });
  await context.prepare(history(21), { conversationId, generate });
  assert.equal(calls, 1);
  await context.prepare(history(31), { conversationId, generate });
  assert.equal(calls, 2);
  await context.prepare(history(19), { conversationId: conversationId.replace(/^a/, 'b'), generate });
  assert.equal(calls, 3);
  const changed = history(19);
  changed[0].content = 'Düzeltilmiş eski mesaj. '.repeat(40);
  await context.prepare(changed, { conversationId, generate });
  assert.equal(calls, 4);
});

test('başarısız veya aşırı uzun özet geçmişi silmez; aynı hata her mesajda tekrarlanmaz', async () => {
  const context = createHistoryContext();
  let calls = 0;
  const generate = async () => { calls++; throw new Error('Unavailable'); };
  for (const count of [19, 21]) {
    const messages = history(count);
    assert.deepEqual((await context.prepare(messages, { conversationId, generate })).messages, messages);
  }
  assert.equal(calls, 1);
  const long = createHistoryContext();
  assert.deepEqual((await long.prepare(history(19), { conversationId, generate: async () => 'x'.repeat(1900) })).messages, history(19));
});

test('özet maliyeti yönetim toplamına dahil edilir, ziyaretçiye gönderilmez', async () => {
  const password = 'test-summary-password-123';
  const credentials = await hashPassword(password);
  let calls = 0;
  const app = createApp({ quotaStore: await createTestStore(), resolveUser: async () => ({ id: 'test-user', name: 'Test' }), apiKey: 'fake', adminCredentialLoader: async () => credentials, fetchImpl: async (url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    if (body.system === summaryInstructions) return new Response(JSON.stringify({ model: 'claude-sonnet-4-6', content: [{ type: 'text', text: summary }], stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 100 } }));
    assert.equal(body.messages.length, 7);
    assert.match(body.messages[0].content, /600 TL/);
    return new Response(JSON.stringify({ model: 'claude-sonnet-4-6', content: [{ type: 'text', text: 'Bütçen günlük 600 TL.' }], stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 20 } }));
  } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history(19), conversationId }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { answer: 'Bütçen günlük 600 TL.', truncated: false });
    const login = await fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const stats = await (await fetch(`${base}/api/admin/metrics`, { headers: { Cookie: cookie } })).json();
    assert.equal(stats.summaries, 1);
    assert.equal(stats.llm, 1);
    assert.equal(stats.totals.totalTokens, 5120);
    assert.equal(stats.records.find(record => record.source === 'llm').context.mode, 'summary');
    assert.equal(calls, 2);
  } finally { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); }
});
