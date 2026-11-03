export const routingStorageKey = 'pursuk-routing-v1';
export const methodLabels = { guided: 'Seçenekli akış', exact: 'Kayıtlı soru', polite: 'Selamlama/nezaket farkı', wording: 'E-posta yazım farkı', spelling: 'Küçük yazım hatası' };
export function redactQuestion(text) {
  return String(text)
    .replace(/\bsk-(?:ant|proj)-[A-Za-z0-9_.-]+/gi, '[anahtar]')
    .replace(/https?:\/\/\S+/gi, '[bağlantı]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[e-posta]')
    .replace(/\+?\d[\d ()-]{5,}\d/g, '[numara]')
    .slice(0, 300);
}
export function addRouteRecord(records, { id, question, route }) {
  if (!route || !['faq', 'llm'].includes(route.source) || typeof id !== 'string') return records;
  const item = { id, question: redactQuestion(question), source: route.source,
    topic: typeof route.topic === 'string' ? route.topic.slice(0, 80) : null,
    method: Object.hasOwn(methodLabels, route.method) ? route.method : null };
  return [...records.filter(record => record.id !== id), item].slice(-200);
}
export function restoreRoutes(storage) {
  try {
    const data = JSON.parse(storage.getItem(routingStorageKey));
    if (!Array.isArray(data) || data.length > 200) return [];
    return data.reduce((records, item) => addRouteRecord(records, {
      id: item?.id, question: item?.question || '', route: { source: item?.source, topic: item?.topic, method: item?.method }
    }), []);
  } catch { return []; }
}
