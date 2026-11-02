export const usageStorageKey = 'porsuk-token-usage-v1';
const tokenCount = value => Number.isSafeInteger(value) && value >= 0;

// Standard Sonnet 4.6 USD / million tokens, verified 2026-11-02.
// Source: https://platform.claude.com/docs/en/about-claude/pricing
export function measureUsage(raw, { id, model, complete = false }) {
  if (!raw || !tokenCount(raw.input_tokens) || !tokenCount(raw.output_tokens)) return null;
  const read = raw.cache_read_input_tokens ?? 0;
  const write = raw.cache_creation_input_tokens ?? 0;
  if (!tokenCount(read) || !tokenCount(write)) return null;
  const hourWrite = raw.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const costKnown = /^claude-sonnet-4-6(?:-\d{8})?$/.test(model) && tokenCount(hourWrite) && hourWrite <= write;
  return {
    id, model, complete,
    inputTokens: raw.input_tokens + read + write,
    outputTokens: raw.output_tokens,
    cacheReadTokens: read,
    cacheWriteTokens: write,
    totalTokens: raw.input_tokens + read + write + raw.output_tokens,
    estimatedUsd: costKnown ? (raw.input_tokens * 3 + raw.output_tokens * 15 + read * 0.3 + (write - hourWrite) * 3.75 + hourWrite * 6) / 1000000 : null,
    priceDate: costKnown ? '2026-11-02' : null
  };
}

export function validMeasurement(item) {
  return item && typeof item.id === 'string' && typeof item.model === 'string' && typeof item.complete === 'boolean' &&
    ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens'].every(key => tokenCount(item[key])) &&
    item.totalTokens === item.inputTokens + item.outputTokens &&
    (item.estimatedUsd === null || (Number.isFinite(item.estimatedUsd) && item.estimatedUsd >= 0));
}

export function upsertUsage(records, item) {
  if (!validMeasurement(item)) return records;
  const index = records.findIndex(record => record.id === item.id);
  if (index < 0) return [...records, item];
  return records.map((record, i) => i === index ? item : record);
}

export function usageTotals(records) {
  return records.reduce((sum, item) => ({
    inputTokens: sum.inputTokens + item.inputTokens,
    outputTokens: sum.outputTokens + item.outputTokens,
    totalTokens: sum.totalTokens + item.totalTokens,
    estimatedUsd: sum.estimatedUsd === null || item.estimatedUsd === null ? null : sum.estimatedUsd + item.estimatedUsd,
    partial: sum.partial + (item.complete ? 0 : 1)
  }), { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedUsd: 0, partial: 0 });
}
