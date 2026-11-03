const panel = document.querySelector('#account-panel');
const form = document.querySelector('#chat-form');
const suggestions = document.querySelector('#suggestions');
let lastUserId;
let requestNumber = 0;
export async function refreshAccount() {
  const request = ++requestNumber;
  try {
    const response = await fetch('/api/me');
    const data = await response.json();
    if (request !== requestNumber) return;
    panel.replaceChildren();
    if (response.ok) {
      if (lastUserId && lastUserId !== data.user.id) { location.reload(); return; }
      lastUserId = data.user.id;
      window.dispatchEvent(new CustomEvent('pursuk:account', { detail: data.user.id }));
      const text = document.createElement('span');
      text.textContent = `${data.mock ? 'Test hesabı · ' : ''}${data.user.name} · Bugün ${data.quota.dailyRemaining}, bu ay ${data.quota.monthlyRemaining} yapay zekâ mesaj hakkın var. Hazır cevaplar hakkından düşmez.`;
      panel.append(text);
      if (data.mock) {
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Hesap değiştir';
        button.onclick = async () => { await fetch('/api/mock/logout', { method: 'POST' }); location.reload(); };
        panel.append(button);
      }
      form.hidden = false;
      return;
    }
    form.hidden = true;
    suggestions.hidden = true;
    const info = document.createElement('p');
    info.textContent = data.mock ? 'Test ortamı: denemek için bir örnek Madset hesabı seç.' : 'Pursuk ile konuşmak için Madset hesabına giriş yapmalısın.';
    panel.append(info);
    if (!data.mock) return;
    const accountsResponse = await fetch('/api/mock/accounts');
    if (!accountsResponse.ok) throw new Error('Hesaplar yüklenemedi.');
    const { accounts } = await accountsResponse.json();
    for (const account of accounts) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = account.name;
      button.onclick = async () => {
        button.disabled = true;
        try {
          const login = await fetch('/api/mock/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: account.id }) });
          if (!login.ok) throw new Error('Giriş yapılamadı.');
          location.reload();
        } catch { button.disabled = false; info.textContent = 'Giriş yapılamadı. Tekrar deneyebilirsin.'; }
      };
      panel.append(button);
    }
  } catch {
    panel.textContent = 'Hesap bilgisi alınamadı. Sayfayı yenileyip tekrar deneyebilirsin.';
    form.hidden = true;
    suggestions.hidden = true;
  }
}
window.addEventListener('focus', refreshAccount);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAccount(); });
