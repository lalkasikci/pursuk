import { readEvents } from './sse.mjs';
import { limits, storageKey, restoreConversation } from './conversation.mjs';
const log = document.querySelector('#messages');
const form = document.querySelector('#chat-form');
const input = document.querySelector('#message');
const errorBox = document.querySelector('#error');
const send = document.querySelector('#send');
const reset = document.querySelector('#reset');
const suggestions = document.querySelector('#suggestions');
let storage;
try {
  storage = sessionStorage;
  storage.removeItem('porsuk-token-usage-v1');
  storage.removeItem('pursuk-routing-v1');
} catch { /* Chat works when storage is disabled. */ }
let messages = restoreConversation(storage);
let busy = false;
function saveConversation() {
  try { storage?.setItem(storageKey, JSON.stringify(messages)); } catch { /* Optional storage. */ }
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
    avatar.width = avatar.height = 34;
    box.append(avatar);
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.append(speaker, text);
  box.append(bubble);
  log.append(box);
  log.scrollTop = log.scrollHeight;
  return box;
}
function welcome() {
  addMessage('assistant', 'Merhaba, ben Pursuk! 👋 Madset ve reklam sorularında yanındayım. Bugün neyi çözelim?');
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
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && window.parent !== window) window.parent.postMessage({ type: 'pursuk:close' }, location.origin);
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
    errorBox.textContent = 'Bu sohbet uzadı. Devam etmek için yeni sohbet başlatabilirsin.';
    errorBox.hidden = false;
    return;
  }
  errorBox.hidden = true;
  busy = true;
  send.disabled = reset.disabled = input.disabled = true;
  for (const button of suggestions.querySelectorAll('button')) button.disabled = true;
  send.textContent = 'Bekleniyor…';
  const userBox = addMessage('user', content);
  const pending = addMessage('assistant', 'Pursuk yazıyor…');
  pending.classList.add('pending');
  try {
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stream: true, messages: nextMessages }),
      signal: AbortSignal.timeout(limits.responseTimeoutMs + 10000)
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Yanıt alınamadı. Tekrar deneyebilirsin.');
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
        log.scrollTop = log.scrollHeight;
      }
      if (event.type === 'done') { finished = true; truncated = event.truncated; }
    }
    if (!finished || !answer) throw new Error('Yanıt tamamlanamadı. Tekrar deneyebilirsin.');
    messages.push({ role: 'user', content }, { role: 'assistant', content: answer });
    saveConversation();
    if (truncated) text.textContent += '\n\nDevamını isteyebilirsin.';
    input.value = '';
    suggestions.hidden = true;
  } catch (error) {
    pending.remove();
    userBox.remove();
    errorBox.textContent = ['TimeoutError', 'AbortError'].includes(error.name) ? 'Yanıt biraz gecikti. Mesajın korunuyor, tekrar deneyebilirsin.' : error.message;
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
