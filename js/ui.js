// Viva Haven — UI helpers (sem framework)

let toastHost = null;
let loadingEl = null;
let globalBound = false;

function ensureToastHost() {
  if (toastHost) return toastHost;

  const host = document.createElement('div');
  host.id = 'vh_toasts';
  host.style.position = 'fixed';
  host.style.zIndex = '9999';
  host.style.left = '12px';
  host.style.right = '12px';
  host.style.bottom = '12px';
  host.style.display = 'grid';
  host.style.gap = '8px';

  const mount = () => {
    if (toastHost) return;
    document.body.appendChild(host);
    toastHost = host;
  };

  if (document.body) mount();
  else window.addEventListener('DOMContentLoaded', mount, { once: true });

  return host;
}

function ensureLoadingEl() {
  if (loadingEl) return loadingEl;

  const el = document.createElement('div');
  el.id = 'vh_loading';
  el.style.position = 'fixed';
  el.style.inset = '0';
  el.style.zIndex = '9998';
  el.style.display = 'none';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.padding = '24px';
  el.style.background = 'rgba(0,0,0,0.35)';

  const card = document.createElement('div');
  card.className = 'card';
  card.style.padding = '14px 16px';
  card.style.maxWidth = '420px';
  card.style.width = '100%';

  const title = document.createElement('div');
  title.style.fontWeight = '800';
  title.style.marginBottom = '6px';
  title.textContent = 'Carregando…';

  const subtitle = document.createElement('div');
  subtitle.id = 'vh_loading_text';
  subtitle.style.fontSize = '12px';
  subtitle.style.color = 'var(--muted)';
  subtitle.textContent = 'Aguarde um instante.';

  card.appendChild(title);
  card.appendChild(subtitle);
  el.appendChild(card);

  const mount = () => {
    if (loadingEl) return;
    document.body.appendChild(el);
    loadingEl = el;
  };

  if (document.body) mount();
  else window.addEventListener('DOMContentLoaded', mount, { once: true });

  return el;
}

export function toast(message, opts) {
  opts = opts || {};
  const msg = String(message || '').trim();
  if (!msg) return;

  ensureToastHost();

  const node = document.createElement('div');
  node.className = 'card';
  node.style.padding = '10px 12px';
  node.style.borderLeft = '4px solid var(--accent)';

  const type = String(opts.type || 'info');
  if (type === 'error') node.style.borderLeftColor = 'var(--danger)';
  if (type === 'success') node.style.borderLeftColor = 'var(--success)';
  if (type === 'warning') node.style.borderLeftColor = 'var(--warning)';

  node.textContent = msg;

  const mount = () => {
    if (!toastHost) return;
    toastHost.appendChild(node);
  };

  if (toastHost) mount();
  else window.addEventListener('DOMContentLoaded', mount, { once: true });

  const timeout = typeof opts.timeout === 'number' ? opts.timeout : 3500;
  window.setTimeout(() => {
    try {
      node.remove();
    } catch (e) {}
  }, Math.max(800, timeout));
}

export function formatError(err) {
  if (!err) return 'Erro inesperado.';
  if (typeof err === 'string') return err;
  if (err && typeof err.message === 'string' && err.message.trim()) return err.message.trim();

  const code = err && typeof err.code === 'string' ? err.code : '';
  if (code) return code;

  try {
    return JSON.stringify(err);
  } catch (e) {
    return 'Erro inesperado.';
  }
}

export function showError(err, fallbackMessage) {
  toast(fallbackMessage || formatError(err), { type: 'error' });
}

export function setLoading(isVisible, text) {
  const el = ensureLoadingEl();
  const bodyText = el.querySelector('#vh_loading_text');

  const v = !!isVisible;
  if (bodyText && typeof text === 'string' && text.trim()) bodyText.textContent = text.trim();
  if (bodyText && (!text || !String(text).trim())) bodyText.textContent = 'Aguarde um instante.';

  const apply = () => {
    el.style.display = v ? 'flex' : 'none';
  };

  if (document.body) apply();
  else window.addEventListener('DOMContentLoaded', apply, { once: true });
}

export async function confirmDialog(message) {
  // MVP: usa confirm nativo (consistente, simples).
  return window.confirm(String(message || 'Confirmar?'));
}

export function bindGlobalErrorHandlers() {
  if (globalBound) return;
  globalBound = true;

  window.addEventListener('unhandledrejection', (ev) => {
    try {
      showError(ev && ev.reason ? ev.reason : ev);
    } catch (e) {}
  });

  window.addEventListener('error', (ev) => {
    try {
      const msg = ev && ev.error ? ev.error : (ev && ev.message ? ev.message : ev);
      showError(msg);
    } catch (e) {}
  });
}

bindGlobalErrorHandlers();
