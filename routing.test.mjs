import test from 'node:test';
import assert from 'node:assert/strict';
import { redactQuestion, addRouteRecord, restoreRoutes } from './routing.mjs';

test('görünen iletişim ve anahtar biçimleri günlükten ayıklanır', () => {
  const raw = 'Mailim test@example.com, telefon +90 (505) 123-4567. https://example.com/private?secret=123 sk-ant-fake-1234567890';
  const result = redactQuestion(raw);
  for (const secret of ['test@example.com', '505', 'example.com', 'sk-ant-fake']) assert.equal(result.includes(secret), false);
  assert.match(result, /\[e-posta\]/);
  assert.match(result, /\[numara\]/);
  assert.match(result, /\[anahtar\]/);
});

test('yönlendirme listesi tekrar saymaz ve sekme verisini geri yükler', () => {
  const record = { id: 'test', question: 'Madste nedir?', route: { source: 'faq', topic: 'madset', method: 'spelling' } };
  const list = addRouteRecord(addRouteRecord([], record), record);
  assert.equal(list.length, 1);
  assert.equal(list[0].method, 'spelling');
  assert.deepEqual(restoreRoutes({ getItem: () => JSON.stringify(list) }), list);
  assert.deepEqual(restoreRoutes({ getItem: () => 'broken' }), []);
  assert.deepEqual(addRouteRecord([], { ...record, route: { source: 'unknown' } }), []);
});
