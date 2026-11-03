import { createTestStore } from './postgres-test-helper.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './server.mjs';
import { readEvents } from './sse.mjs';
import { choicesForTopic, initialChoices, safeChoices } from './chat-flow.mjs';

test('tanıtım akışının üç adımı API anahtarı olmadan ve Claude çağırmadan tamamlanır', async () => {
  let calls = 0;
  const server = createApp({ quotaStore: await createTestStore(), resolveUser: async () => ({ id: 'test-user', name: 'Test' }), apiKey: '', fetchImpl: () => { calls++; throw new Error('Claude çağrılmamalı'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const messages = [];
  try {
    for (const [action, label, pattern] of [
      ['madset-intro', 'Madset’i tanımak istiyorum', /platform/],
      ['madset-features', 'Özellikler', /Facebook ve Instagram/],
      ['madset-start', 'Nasıl başlarım?', /info@pursula.com/]
    ]) {
      messages.push({ role: 'user', content: label });
      const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, messages, stream: true }) });
      assert.equal(response.status, 200);
      const events = [];
      for await (const event of readEvents(response.body)) events.push(event);
      const answer = events.filter(e => e.type === 'text').map(e => e.text).join('');
      assert.match(answer, pattern);
      const done = events.at(-1);
      assert.equal(done.type, 'done');
      assert.equal(done.choices.length, 2);
      assert.equal(done.measurement, undefined);
      if (action === 'madset-intro') assert.deepEqual(done.choices.map(c => c.label), ['Özellikler', 'Nasıl başlarım?']);
      messages.push({ role: 'assistant', content: answer });
    }
    const invalid = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: '__proto__', messages: [{ role: 'user', content: 'test' }] }) });
    assert.equal(invalid.status, 400);
    assert.equal(calls, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('seçenekler güvenilir etiketlerle sınırlandırılır', () => {
  assert.equal(initialChoices[0].label, 'Madset’i tanımak istiyorum');
  assert.deepEqual(choicesForTopic('unknown'), []);
  assert.deepEqual(safeChoices(null), []);
  assert.deepEqual(safeChoices([{ id: 'unknown', label: 'x' }]), []);
  assert.equal(safeChoices([{ id: 'madset-start', label: '<script>override</script>' }])[0].label, 'Nasıl başlarım?');
  assert.equal(safeChoices([{ id: 'help-account' }])[0].label, 'Hesap bağlantısı kurmak');
  assert.deepEqual(initialChoices.map(choice => choice.id), ['madset-intro', 'help-intro']);
});

test('kullanım yardımı ve üç alt konu Claude kullanmadan, özel veriler sızmadan yanıtlanır', async () => {
  let calls = 0;
  const server = createApp({ quotaStore: await createTestStore(), resolveUser: async () => ({ id: 'test-user', name: 'Test' }), apiKey: '', fetchImpl: () => { calls++; throw new Error('Claude çağrılmamalı'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const messages = [];
  try {
    for (const [action, label, expected] of [
      ['help-intro', 'Kullanırken yardıma ihtiyacım var', /hangi konuda/],
      ['help-account', 'Hesap bağlantısı kurmak', /Facebook Sayfan ve Instagram/],
      ['help-content', 'İçerik hazırlama', /marka profiline göre/],
      ['help-support', 'Destek ekibi', /info@pursula.com/]
    ]) {
      messages.push({ role: 'user', content: label });
      const response = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, messages, stream: true }) });
      assert.equal(response.status, 200);
      const events = [];
      for await (const event of readEvents(response.body)) events.push(event);
      const answer = events.filter(event => event.type === 'text').map(event => event.text).join('');
      assert.match(answer, expected);
      const done = events.at(-1);
      assert.equal(done.type, 'done');
      assert.equal(done.measurement, undefined);
      assert.equal(done.route, undefined);
      if (action === 'help-intro') assert.deepEqual(done.choices.map(choice => choice.label), ['Hesap bağlantısı kurmak', 'İçerik hazırlama', 'Destek ekibi']);
      else assert.ok(done.choices.some(choice => choice.id === 'help-intro'));
      messages.push({ role: 'assistant', content: answer });
    }
    assert.equal(calls, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
