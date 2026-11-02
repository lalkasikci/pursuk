import test from 'node:test';
import assert from 'node:assert/strict';
import { measureUsage, upsertUsage, usageTotals } from './usage.mjs';
const meta = { id: 'sample', model: 'claude-sonnet-4-6', complete: true };

test('giriş, önbellek ve çıkış ayrı tarifeyle hesaplanır', () => {
  const measured = measureUsage({ input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 400, cache_creation: { ephemeral_1h_input_tokens: 100, ephemeral_5m_input_tokens: 300 } }, meta);
  assert.equal(measured.inputTokens, 1900);
  assert.equal(measured.outputTokens, 200);
  assert.equal(measured.totalTokens, 2100);
  assert.ok(Math.abs(measured.estimatedUsd - 0.007875) < 1e-10);
});

test('eksik kullanım sıfır sayılmaz; bilinmeyen modelin fiyatı uydurulmaz', () => {
  assert.equal(measureUsage(undefined, meta), null);
  assert.equal(measureUsage({ input_tokens: 10 }, meta), null);
  assert.equal(measureUsage({ input_tokens: -1, output_tokens: 2 }, meta), null);
  const unknown = measureUsage({ input_tokens: 20, output_tokens: 5 }, { ...meta, model: 'unknown-model' });
  assert.equal(unknown.totalTokens, 25);
  assert.equal(unknown.estimatedUsd, null);
});

test('ara ölçümler ve tamamlanmış ölçüm iki kere toplanmaz', () => {
  const first = measureUsage({ input_tokens: 1000, output_tokens: 1 }, { ...meta, complete: false });
  const last = measureUsage({ input_tokens: 1000, output_tokens: 100 }, meta);
  let records = upsertUsage([], first);
  records = upsertUsage(records, last);
  records = upsertUsage(records, last);
  assert.equal(records.length, 1);
  assert.equal(usageTotals(records).totalTokens, 1100);
  assert.equal(usageTotals(records).partial, 0);
  records = upsertUsage(records, { ...first, id: 'second' });
  assert.equal(usageTotals(records).partial, 1);
  assert.equal(usageTotals(records).totalTokens, 2101);
});
