(() => {
  const scriptUrl = document.currentScript?.src;
  if (!scriptUrl || document.querySelector('[data-pursuk-widget]')) return;
  const base = new URL(scriptUrl);
  const host = document.createElement('div');
  host.setAttribute('data-pursuk-widget', '');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const styles = document.createElement('link');
  styles.rel = 'stylesheet';
  styles.href = new URL('/widget.css', base).href;
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'pursuk-launcher';
  launcher.setAttribute('aria-label', 'Pursuk ile sohbet et');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.setAttribute('aria-controls', 'pursuk-panel');
  const image = document.createElement('img');
  image.src = new URL('/porsuk.png', base).href;
  image.alt = '';
  launcher.append(image);
  const panel = document.createElement('section');
  panel.id = 'pursuk-panel';
  panel.className = 'pursuk-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Pursuk sohbeti');
  panel.hidden = true;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'pursuk-close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Sohbeti kapat');
  panel.append(close);
  let frame;
  function setOpen(open) {
    if (open && !frame) {
      frame = document.createElement('iframe');
      frame.src = new URL('/chat', base).href;
      frame.title = 'Pursuk sohbeti';
      panel.append(frame);
    }
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    launcher.setAttribute('aria-label', open ? 'Pursuk sohbetini kapat' : 'Pursuk ile sohbet et');
    if (open) close.focus(); else launcher.focus();
  }
  launcher.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => setOpen(false));
  shadow.addEventListener('keydown', event => { if (event.key === 'Escape') setOpen(false); });
  window.addEventListener('message', event => {
    if (frame && event.source === frame.contentWindow && event.origin === base.origin && event.data?.type === 'pursuk:close') setOpen(false);
  });
  shadow.append(styles, panel, launcher);
})();
