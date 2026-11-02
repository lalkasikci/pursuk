import { readEvents } from './sse.mjs';
import { limits, storageKey, restoreConversation } from './conversation.mjs';
const log = document.querySelector('#messages');
const form = document.querySelector('#chat-form');
const input = document.querySelector('#message');
const errorBox = document.querySelector('#error');
const send = document.querySelector('#send');
const reset = document.querySelector('#reset');
const suggestions = document.querySelector('#suggestions');
let messages = restoreConversation(sessionStorage);
let busy = false;

function saveConversation() {
  try { sessionStorage.setItem(storageKey, JSON.stringify(messages)); }
  catch { document.querySelector('#status').textContent = 'Sekme depolaması kullanılamıyor; sayfayı yenilersen sohbet kaybolabilir.'; }
}

function addMessage(role, content) {
  const box = document.createElement('article');
  box.className = `message ${role}`;
  const speaker = document.createElement('span');
  speaker.className = 'speaker';
  speaker.textContent = role === 'user' ? 'Sen' : 'Porsuk';
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
  addMessage('assistant', 'Merhaba, ben Porsuk! 👋 Madset ve reklam sorularında yanındayım. Bugün neyi çözelim?');
}
reset.addEventListener('click', () => {
  if (busy) return;
  messages = [];
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
    const text = pending.querySelector('p');
    for await (const event of readEvents(response.body)) {
      if (event.type === 'error') throw new Error(event.error);
      if (event.type === 'text') {
        answer += event.text;
        text.textContent = answer;
        pending.classList.remove('pending');
      }
      if (event.type === 'done') { finished = true; truncated = event.truncated; }
    }
    if (!finished || !answer) throw new Error('Yanıt tamamlanamadı. Tekrar deneyebilirsin.');
    messages.push({ role: 'user', content }, { role: 'assistant', content: answer });
    saveConversation();
    if (truncated) text.textContent += '\n\n[Devamını isteyebilirsin.]';
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
  document.querySelector('#status').textContent = data.configured ? `Porsuk · ${data.model} · En fazla 30 soru-cevap turu · Sohbet bu sekmede korunur` : 'Kurulum gerekli: Claude anahtarı henüz eklenmedi. anahtar-ekle.ps1 ile ekleyip sunucuyu yeniden başlat.';
}).catch(() => { document.querySelector('#status').textContent = 'Sunucuya ulaşılamadı. Sayfayı yenilemeyi dene.'; });
