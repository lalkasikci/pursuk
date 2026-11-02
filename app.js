import { readEvents } from './sse.mjs';
import { limits, storageKey, restoreConversation } from './conversation.mjs';
import { usageStorageKey, validMeasurement, upsertUsage, usageTotals } from './usage.mjs';
const log = document.querySelector('#messages');
const form = document.querySelector('#chat-form');
const input = document.querySelector('#message');
const errorBox = document.querySelector('#error');
const send = document.querySelector('#send');
const reset = document.querySelector('#reset');
const suggestions = document.querySelector('#suggestions');
let messages = restoreConversation(sessionStorage);
let busy = false;
let usageRecords = [];
try {
  const stored = JSON.parse(sessionStorage.getItem(usageStorageKey));
  if (Array.isArray(stored) && stored.length <= 1000) {
    for (const item of stored.filter(validMeasurement)) usageRecords = upsertUsage(usageRecords, item);
  }
} catch { /* Storage is optional; measurement still works in memory. */ }
const formatTokens = number => number.toLocaleString('tr-TR');
const formatCost = amount => amount === null ? 'bu model için hesaplanmadı' : new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', minimumFractionDigits: 5, maximumFractionDigits: 5 }).format(amount);
function renderUsage() {
  const last = usageRecords.at(-1);
  document.querySelector('#usage-last').textContent = last?.source === 'faq' ? 'Son yanıt: hazır cevap · Claude API kullanılmadı · 0 API tokenı · 0 USD.' : last ? `Son istek${last.complete ? '' : ' (kısmi)'}: giriş ${formatTokens(last.inputTokens)} · çıkış ${formatTokens(last.outputTokens)} · toplam ${formatTokens(last.totalTokens)} token · yaklaşık ${formatCost(last.estimatedUsd)}. Önbellek okuma/yazma: ${formatTokens(last.cacheReadTokens)}/${formatTokens(last.cacheWriteTokens)}.` : 'Henüz ölçülen istek yok. Bir mesaj gönderince burada görünecek.';
  const sum = usageTotals(usageRecords);
  const faqCount = usageRecords.filter(record => record.source === 'faq').length;
  document.querySelector('#usage-total').textContent = last ? `Ölçülen yanıtlar: ${faqCount} hazır cevap, ${usageRecords.length - faqCount} Claude isteği. Giriş ${formatTokens(sum.inputTokens)} · çıkış ${formatTokens(sum.outputTokens)} · toplam ${formatTokens(sum.totalTokens)} token · yaklaşık ${formatCost(sum.estimatedUsd)}${sum.partial ? ` (${sum.partial} kısmi ölçüm dahil)` : ''}.` : '';
}
function recordUsage(measurement) {
  if (!validMeasurement(measurement)) return;
  usageRecords = upsertUsage(usageRecords, measurement);
  try { sessionStorage.setItem(usageStorageKey, JSON.stringify(usageRecords)); } catch { /* Keep in-memory totals. */ }
  renderUsage();
}
renderUsage();

function saveConversation() {
  try { sessionStorage.setItem(storageKey, JSON.stringify(messages)); }
  catch { document.querySelector('#status').textContent = 'Sekme depolaması kullanılamıyor; sayfayı yenilersen sohbet kaybolabilir.'; }
}

function addMessage(role, content) {
  const box = document.createElement('article');
  box.className = `message ${role}`;
  const speaker = document.createElement('span');
  speaker.className = 'speaker';
  speaker.textContent = role === 'user' ? 'Sen' : 'Pursuk';
  const text = document.createElement('p');
  text.textContent = content;
  if (role === 'assistant') {
    const avatar = document.createElement('img');
    avatar.src = '/porsuk.png';
    avatar.alt = '';
    avatar.className = 'avatar';
    avatar.width = avatar.height = 40;
    box.append(avatar);
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.append(speaker, text);
  box.append(bubble);
  log.append(box);
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return box;
}
function welcome() {
  addMessage('assistant', 'Merhaba, ben Pursuk! 👋 Madset ve reklam sorularında yanındayım. Bugün neyi çözelim?');
}
reset.addEventListener('click', () => {
  if (busy) return;
  messages = [];
  usageRecords = [];
  try { sessionStorage.removeItem(usageStorageKey); } catch { /* Optional storage. */ }
  renderUsage();
  saveConversation();
  log.replaceChildren();
  suggestions.hidden = false;
  errorBox.hidden = true;
  input.value = '';
  welcome();
  input.focus();
});
suggestions.addEventListener('click', event => {
  if (event.target.tagName !== 'BUTTON' || busy) return;
  input.value = event.target.textContent;
  form.requestSubmit();
});
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!busy) form.requestSubmit();
  }
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const content = input.value.trim();
  if (!content || busy) return;
  const nextMessages = [...messages, { role: 'user', content }];
  if (nextMessages.length > limits.messages || nextMessages.reduce((n, m) => n + m.content.length, 0) > limits.totalCharacters) {
    errorBox.textContent = '30 soru-cevap turu veya 120.000 karakter sınırına ulaştın. Mesajların burada kalıyor; devam etmek için yeni sohbet açabilirsin.';
    errorBox.hidden = false;
    return;
  }
  errorBox.hidden = true;
  busy = true;
  send.disabled = reset.disabled = input.disabled = true;
  for (const button of suggestions.querySelectorAll('button')) button.disabled = true;
  send.textContent = 'Bekleniyor…';
  const userBox = addMessage('user', content);
  const pending = addMessage('assistant', 'Yanıt hazırlanıyor…');
  pending.classList.add('pending');
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream: true, messages: nextMessages }),
      signal: AbortSignal.timeout(limits.responseTimeoutMs + 10000)
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Yanıt alınamadı.');
    }
    let answer = '';
    let finished = false;
    let truncated = false;
    let measurement = null;
    const text = pending.querySelector('p');
    for await (const event of readEvents(response.body)) {
      if (event.type === 'error') throw new Error(event.error);
      if (event.type === 'usage') recordUsage(event.measurement);
      if (event.type === 'text') {
        answer += event.text;
        text.textContent = answer;
        pending.classList.remove('pending');
      }
      if (event.type === 'done') {
        finished = true;
        truncated = event.truncated;
        measurement = event.measurement;
        recordUsage(measurement);
      }
    }
    if (!finished || !answer) throw new Error('Yanıt tamamlanamadı. Tekrar deneyebilirsin.');
    messages.push({ role: 'user', content }, { role: 'assistant', content: answer });
    saveConversation();
    if (truncated) text.textContent += '\n\n[Devamını isteyebilirsin.]';
    const tokenNote = document.createElement('small');
    tokenNote.className = 'token-note';
    tokenNote.textContent = measurement?.source === 'faq' ? 'Hazır cevap · Claude API kullanılmadı · 0 API tokenı' : measurement ? `Giriş ${formatTokens(measurement.inputTokens)} · Çıkış ${formatTokens(measurement.outputTokens)} token · ≈ ${formatCost(measurement.estimatedUsd)}` : 'Bu yanıt için kullanım verisi alınamadı.';
    pending.querySelector('.bubble').append(tokenNote);
    input.value = '';
    suggestions.hidden = true;
  } catch (error) {
    pending.remove();
    userBox.remove();
    errorBox.textContent = ['TimeoutError', 'AbortError'].includes(error.name) ? 'Bekleme süresi doldu. Mesajın korunuyor, tekrar deneyebilirsin.' : error.message;
    errorBox.hidden = false;
  } finally {
    busy = false;
    send.disabled = reset.disabled = input.disabled = false;
    for (const button of suggestions.querySelectorAll('button')) button.disabled = false;
    send.textContent = 'Gönder';
    input.focus();
  }
});
if (messages.length) {
  for (const message of messages) addMessage(message.role, message.content);
  suggestions.hidden = true;
} else welcome();
fetch('/api/status').then(r => r.json()).then(data => {
  document.querySelector('#status').textContent = data.configured ? `Pursuk · ${data.model} · En fazla 30 soru-cevap turu · Sohbet bu sekmede korunur` : 'Kurulum gerekli: Claude anahtarı henüz eklenmedi. anahtar-ekle.ps1 ile ekleyip sunucuyu yeniden başlat.';
}).catch(() => { document.querySelector('#status').textContent = 'Sunucuya ulaşılamadı. Sayfayı yenilemeyi dene.'; });
