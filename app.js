import { refreshAccount } from './account.js';
import { readEvents } from './sse.mjs';
import { limits } from './conversation.mjs';
import { initialChoices, safeChoices } from './chat-flow.mjs';
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
let messages = [];
let conversationId;
try { conversationId = storage?.getItem('pursuk-context-id-v1'); } catch { /* Optional storage. */ }
if (!/^[a-f0-9-]{36}$/i.test(conversationId || '')) conversationId = crypto.randomUUID();
function saveContextId() {
  try { storage?.setItem('pursuk-context-id-v1', conversationId); } catch { /* Optional storage. */ }
}
let busy = false;
let historyReady = false;
let selectedAction = null;
let activeChoices = [];
function showChoices(choices) {
  activeChoices = safeChoices(choices);
  suggestions.replaceChildren();
  for (const choice of activeChoices) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = choice.label;
    button.dataset.action = choice.id;
    button.disabled = busy;
    suggestions.append(button);
  }
  suggestions.hidden = activeChoices.length === 0;
  log.scrollTop = log.scrollHeight;
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
  if (busy || !historyReady) return;
  messages = [];
  conversationId = crypto.randomUUID();
  saveContextId();
  log.replaceChildren();
  showChoices(initialChoices);
  errorBox.hidden = true;
  input.value = '';
  welcome();
  input.focus();
});
suggestions.addEventListener('click', event => {
  if (event.target.tagName !== 'BUTTON' || busy) return;
  input.value = event.target.textContent;
  selectedAction = event.target.dataset.action;
  form.requestSubmit();
  selectedAction = null;
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
  const action = selectedAction;
  if (!content || busy || !historyReady) return;
  const nextMessages = [...messages, { role: 'user', content }];
  if (nextMessages.length > limits.messages || nextMessages.reduce((n, m) => n + m.content.length, 0) > limits.totalCharacters) {
    errorBox.textContent = 'Bu sohbet çok uzadı. Yeni sohbet açarak devam edebilirsin; kalan mesaj hakkın korunur.';
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
      body: JSON.stringify({ stream: true, messages: nextMessages, conversationId, ...(action ? { action } : {}) }),
      signal: AbortSignal.timeout(limits.responseTimeoutMs + 10000)
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Yanıt alınamadı. Tekrar deneyebilirsin.');
    }
    let answer = '';
    let finished = false;
    let truncated = false;
    let nextChoices = [];
    const text = pending.querySelector('p');
    for await (const event of readEvents(response.body)) {
      if (event.type === 'error') throw new Error(event.error);
      if (event.type === 'text') {
        answer += event.text;
        text.textContent = answer;
        pending.classList.remove('pending');
        log.scrollTop = log.scrollHeight;
      }
      if (event.type === 'done') { finished = true; truncated = event.truncated; nextChoices = safeChoices(event.choices); }
    }
    if (!finished || !answer) throw new Error('Yanıt tamamlanamadı. Tekrar deneyebilirsin.');
    messages.push({ role: 'user', content }, { role: 'assistant', content: answer });
    if (truncated) text.textContent += '\n\nDevamını isteyebilirsin.';
    input.value = '';
    showChoices(nextChoices);
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
    await refreshAccount();
  }
});
const rawStorage = storage;
let accountId;
window.addEventListener('pursuk:account', async event => {
  if (accountId === event.detail) return;
  accountId = event.detail;
  storage = rawStorage ? {
    getItem: key => rawStorage.getItem(accountId + ':' + key),
    setItem: (key, value) => rawStorage.setItem(accountId + ':' + key, value)
  } : undefined;
  historyReady=false;
  try {
    let storedId;
    try { storedId=storage?.getItem('pursuk-context-id-v1'); } catch { /* Optional. */ }
    const validId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storedId || '');
    const result=await fetch('/api/conversations/'+(validId?storedId:'latest'));
    if (!result.ok && result.status!==404) throw new Error('Sohbet geçmişine şu anda ulaşılamıyor. Sayfayı yenileyip tekrar deneyebilirsin.');
    const saved=result.ok?await result.json():null;
    conversationId=saved?.id || (validId?storedId:crypto.randomUUID());
    messages=saved?.messages || [];
    saveContextId();
    log.replaceChildren();
    if(messages.length) {
      for(const message of messages) addMessage(message.role,message.content);
      showChoices(saved.choices || []);
    } else { welcome();showChoices(initialChoices); }
    historyReady=true;
  } catch(error) {
    errorBox.textContent=error.message;
    errorBox.hidden=false;
    accountId=null;
  }
});
await refreshAccount();
