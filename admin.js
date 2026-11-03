import { methodLabels } from './routing.mjs';
const form = document.querySelector('#login-form');
const dashboard = document.querySelector('#dashboard');
const error = document.querySelector('#admin-error');
const format = number => number.toLocaleString('tr-TR');
let timer;
function showLogin() { form.hidden = false; dashboard.hidden = true; clearInterval(timer); timer = undefined; }
async function load() {
  try {
    const response = await fetch('/api/admin/metrics', { cache: 'no-store' });
    if (response.status === 401) { showLogin(); return; }
    if (!response.ok) throw new Error('Yönetim verilerine ulaşılamadı.');
    const data = await response.json();
    form.hidden = true;
    dashboard.hidden = false;
    const responseCount = data.faq + data.llm;
    const percent = responseCount ? Math.round(data.faq / responseCount * 100) : 0;
    document.querySelector('#admin-info').textContent = `Model: ${data.model} · Sunucu başlangıcı: ${new Date(data.startedAt).toLocaleString('tr-TR')}`;
    document.querySelector('#admin-counts').textContent = `${responseCount} yanıt isteği · ${data.faq} hazır cevap · ${data.llm} model isteği · ${data.summaries || 0} özetleme isteği · Hazır cevap payı %${percent}. Token ve maliyet toplamına özetleme de dahildir.`;
    const lastContext = data.records.find(record => record.source === 'llm' && record.context)?.context;
    const contextStatus = document.querySelector('#admin-summary-status');
    if (contextStatus) {
      const rule = 'Özetleme: en erken 10. soru ve özetlenecek eski bölümde en az 4.000 karakter. Sabit talimatlar ve Madset bilgi metni bu eşiğe dahil değil.';
      let state = 'Henüz bağlam uzunluğu kaydedilen bir model isteği yok.';
      if (lastContext?.mode === 'summary') state = `Son istekte ${lastContext.coveredMessages} eski mesaj özetlendi. Gönderilen konuşma ${format(lastContext.beforeCharacters)} karakterden ${format(lastContext.afterCharacters)} karaktere indi.`;
      else if (lastContext) {
        state = `Son isteğin tüm sohbet geçmişi: ${lastContext.recentMessages} mesaj (soru ve yanıtlar birlikte), ${format(lastContext.beforeCharacters)} karakter.`;
        if (lastContext.recentMessages < 19) state += ' İlk özetleme için gereken mesaj sayısına henüz ulaşılmadı.';
        else if (lastContext.beforeCharacters < 4000) state += ' Tüm geçmiş bile 4.000 karakterden kısa; özetlenecek eski bölüm bu eşiğe ulaşmadı.';
        else state += ' Tam geçmiş kullanıldı. Toplam uzunluk tek başına yeterli değil: eski bölümün uzunluğu, sohbet kimliği ve özetin başarıyla tamamlanması da kontrol edilir.';
      }
      contextStatus.textContent = `${state} ${rule}`;
    }
    document.querySelector('#admin-tokens').textContent = `Giriş ${format(data.totals.inputTokens)} · Çıkış ${format(data.totals.outputTokens)} · Toplam ${format(data.totals.totalTokens)} API tokenı. ${data.totals.partial} kısmi ölçüm, ${data.unmeasured} kullanım verisi alınamayan istek.`;
    document.querySelector('#admin-cost').textContent = data.totals.estimatedUsd === null ? 'Bazı modeller için fiyat bilinmediğinden toplam ücret hesaplanmadı.' : `Yaklaşık toplam: ${new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', minimumFractionDigits: 5, maximumFractionDigits: 5 }).format(data.totals.estimatedUsd)}`;
    const table = document.querySelector('#admin-records');
    table.replaceChildren();
    for (const record of data.records) {
      const row = document.createElement('tr');
      const route = record.source === 'faq' ? `Hazır cevap · ${methodLabels[record.method] || 'Onaylı eşleşme'}` : record.source === 'summary' ? 'Konuşma özeti çıkarma' : record.context?.mode === 'summary' ? `Claude · ${record.context.coveredMessages} eski mesaj özetlendi, ${record.context.recentMessages} yakın mesaj korundu` : record.context ? `Claude · Tam geçmiş · ${record.context.recentMessages} mesaj · ${format(record.context.beforeCharacters)} karakter` : 'Claude · Tam geçmiş';
      const values = [record.question, route, record.measurement ? format(record.measurement.totalTokens) : 'Alınamadı', record.complete ? 'Tamamlandı' : 'Sürüyor / tamamlanmadı'];
      for (const value of values) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
      table.append(row);
    }
    error.hidden = true;
    if (!timer) timer = setInterval(load, 5000);
  } catch (problem) { error.textContent = problem.message; error.hidden = false; }
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button');
  const input = document.querySelector('#password');
  button.disabled = true;
  try {
    const response = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: input.value }) });
    input.value = '';
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Giriş yapılamadı.');
    await load();
  } catch (problem) { error.textContent = problem.message; error.hidden = false; }
  finally { button.disabled = false; }
});
document.querySelector('#refresh').addEventListener('click', load);
document.querySelector('#logout').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  showLogin();
  timer = undefined;
});
load();
