import { redactQuestion } from './routing.mjs';
import { usageTotals, validMeasurement } from './usage.mjs';

// Bounded, server-only memory. No visitor-facing endpoint returns these records.
export function createTelemetry() {
  const records = new Map();
  const startedAt = new Date().toISOString();
  return {
    record(id, question, route, measurement, complete = false) {
      const previous = records.get(id);
      records.set(id, { id, time: previous?.time || new Date().toISOString(), question: redactQuestion(question),
        source: route.source, topic: route.topic || null, method: route.method || null,
        context: route.context || previous?.context || null,
        complete, measurement: validMeasurement(measurement) ? measurement : previous?.measurement || null });
      if (records.size > 500) records.delete(records.keys().next().value);
    },
    snapshot() {
      const list = [...records.values()];
      const measured = list.filter(item => item.measurement).map(item => item.measurement);
      return { startedAt, retained: list.length, capacity: 500,
        faq: list.filter(item => item.source === 'faq').length,
        llm: list.filter(item => item.source === 'llm').length,
        summaries: list.filter(item => item.source === 'summary').length,
        unmeasured: list.filter(item => !item.measurement).length,
        totals: usageTotals(measured), records: list.slice(-100).reverse() };
    }
  };
}
