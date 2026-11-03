import { createTestStore } from './postgres-test-helper.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './server.mjs';
import { hashPassword } from './admin-auth.mjs';
import { readEvents } from './sse.mjs';
const password = 'sample-password-12345';
const credentials = await hashPassword(password);
async function run(options, callback) {
  const server = createApp({ quotaStore: await createTestStore(), resolveUser: async () => ({ id: 'test-user', name: 'Test' }), apiKey: '', adminCredentialLoader: async () => credentials, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const login = (base, value = password) => fetch(`${base}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: value }) });
const ask = (base, stream = false) => fetch(`${base}/api/chat?admin=true`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin': 'true' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Merhaba, Madste nedir?' }], stream }) });

test('ziyaretçi ve yetkisiz istekler model, maliyet ve yönlendirme verisi alamaz', async () => {
  await run({}, async base => {
    assert.equal((await fetch(`${base}/api/admin/metrics`)).status, 401);
    assert.equal((await fetch(`${base}/api/admin/metrics?password=${password}`)).status, 401);
    assert.equal((await fetch(`${base}/.admin-auth.json`)).status, 404);
    const response = await (await ask(base)).json();
    assert.deepEqual(Object.keys(response).sort(), ['answer', 'choices', 'truncated']);
    const streamed = await ask(base, true);
    const events = [];
    for await (const event of readEvents(streamed.body)) events.push(event);
    assert.deepEqual(events.map(event => event.type), ['text', 'done']);
    assert.equal(events[1].type, 'done');
    assert.equal(events[1].truncated, false);
    assert.deepEqual(Object.keys(events[1]).sort(), ['choices', 'truncated', 'type']);
    const page = await (await fetch(`${base}/chat`)).text();
    assert.equal(/Token kullanımı|Hazır cevap mı|claude-sonnet|usage-panel/.test(page), false);
    const script = await (await fetch(`${base}/app.js`)).text();
    assert.equal(/\/api\/admin|recordUsage|recordRoute/.test(script), false);
    assert.match(await (await fetch(base)).text(), /widget.js/);
  });
});

test('şifreli yönetici oturumu verilere erişir; çıkış ve şifre değişimi erişimi kapatır', async () => {
  let current = credentials;
  await run({ adminCredentialLoader: async () => current }, async base => {
    assert.equal((await login(base, 'wrong-password-123')).status, 401);
    const response = await login(base);
    assert.equal(response.status, 200);
    const header = response.headers.get('set-cookie');
    assert.match(header, /HttpOnly/);
    assert.match(header, /SameSite=Strict/);
    const cookie = header.split(';')[0];
    await ask(base);
    const metrics = await (await fetch(`${base}/api/admin/metrics`, { headers: { Cookie: cookie } })).json();
    assert.equal(metrics.faq, 1);
    assert.equal(metrics.records[0].method, 'spelling');
    assert.equal(metrics.records[0].measurement.totalTokens, 0);
    assert.equal(metrics.model, 'claude-sonnet-4-6');
    assert.equal(JSON.stringify(metrics).includes(credentials.hash), false);
    await fetch(`${base}/api/admin/logout`, { method: 'POST', headers: { Cookie: cookie } });
    assert.equal((await fetch(`${base}/api/admin/metrics`, { headers: { Cookie: cookie } })).status, 401);
    const second = await login(base);
    const secondCookie = second.headers.get('set-cookie').split(';')[0];
    current = await hashPassword('different-test-password-123');
    assert.equal((await fetch(`${base}/api/admin/metrics`, { headers: { Cookie: secondCookie } })).status, 401);
  });
});

test('kurulmamış yönetim ve tekrarlanan yanlış şifreler erişim sağlamaz', async () => {
  await run({ adminCredentialLoader: async () => null }, async base => assert.equal((await login(base)).status, 503));
  await run({}, async base => {
    for (let i = 0; i < 5; i++) assert.equal((await login(base, 'wrong-password-123')).status, 401);
    assert.equal((await login(base)).status, 429);
  });
});
