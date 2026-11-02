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
    const percent = data.retained ? Math.round(data.faq / data.retained * 100) : 0;
    document.querySelector('#admin-info').textContent = `Model: ${data.model} · Sunucu başlangıcı: ${new Date(data.startedAt).toLocaleString('tr-TR')}`;
    document.querySelector('#admin-counts').textContent = `${data.retained} kayıt · ${data.faq} hazır cevap · ${data.llm} model isteği · Hazır cevap payı %${percent}`;
    document.querySelector('#admin-tokens').textContent = `Giriş ${format(data.totals.inputTokens)} · Çıkış ${format(data.totals.outputTokens)} · Toplam ${format(data.totals.totalTokens)} API tokenı. ${data.totals.partial} kısmi ölçüm, ${data.unmeasured} kullanım verisi alınamayan istek.`;
    document.querySelector('#admin-cost').textContent = data.totals.estimatedUsd === null ? 'Bazı modeller için fiyat bilinmediğinden toplam ücret hesaplanmadı.' : `Yaklaşık toplam: ${new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', minimumFractionDigits: 5, maximumFractionDigits: 5 }).format(data.totals.estimatedUsd)}`;
    const table = document.querySelector('#admin-records');
    table.replaceChildren();
    for (const record of data.records) {
      const row = document.createElement('tr');
      const values = [record.question, record.source === 'faq' ? `Hazır cevap · ${methodLabels[record.method] || 'Onaylı eşleşme'}` : 'Claude · Güvenli hazır cevap eşleşmesi yok', record.measurement ? format(record.measurement.totalTokens) : 'Alınamadı', record.complete ? 'Tamamlandı' : 'Sürüyor / tamamlanmadı'];
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
