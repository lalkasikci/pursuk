export const flowStorageKey = 'pursuk-guided-choices-v1';
export const flowActions = Object.freeze({
  'madset-intro': { topic: 'madset', label: 'Madset’i tanımak istiyorum' },
  'madset-features': { topic: 'ozellikler', label: 'Özellikler' },
  'madset-start': { topic: 'baslangic', label: 'Nasıl başlarım?' },
  'help-intro': { topic: 'kullanim-yardimi', label: 'Kullanırken yardıma ihtiyacım var' },
  'help-account': { topic: 'hesap-baglantisi', label: 'Hesap bağlantısı kurmak' },
  'help-content': { topic: 'icerik-hazirlama', label: 'İçerik hazırlama' },
  'help-support': { topic: 'iletisim', label: 'Destek ekibi' }
});
export const initialChoices = ['madset-intro', 'help-intro'].map(id => ({ id, label: flowActions[id].label }));
const backLabels = { 'madset-intro': 'Madset’e dön', 'help-intro': 'Yardıma dön' };
export function choicesForTopic(topic) {
  const ids = {
    madset: ['madset-features', 'madset-start'],
    ozellikler: ['madset-start', 'madset-intro'],
    baslangic: ['madset-features', 'madset-intro'],
    'kullanim-yardimi': ['help-account', 'help-content', 'help-support'],
    'hesap-baglantisi': ['help-content', 'help-support', 'help-intro'],
    'icerik-hazirlama': ['help-account', 'help-support', 'help-intro'],
    iletisim: ['help-intro', 'madset-intro']
  }[topic] || [];
  return ids.map(id => ({ id, label: backLabels[id] || flowActions[id].label }));
}
export function safeChoices(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && Object.hasOwn(flowActions, item.id)).slice(0, 3).map(item => ({ id: item.id,
    label: Object.hasOwn(backLabels, item.id) && item.label === backLabels[item.id] ? backLabels[item.id] : flowActions[item.id].label }));
}
