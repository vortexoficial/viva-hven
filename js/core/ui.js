// Viva Haven — Core UI (sem framework)
// Objetivo: toasts, modais acessíveis, loading overlay e helpers sem CSS inline.

let toastHost = null;
let loadingEl = null;
let globalBound = false;

function onDomReady(fn) {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', fn, { once: true });
  } else {
    fn();
  }
}

function ensureToastHost() {
  if (toastHost && toastHost.isConnected) return toastHost;

  const host = document.createElement('div');
  host.id = 'vh_toasts';
  host.className = 'vhToastHost';
  host.setAttribute('aria-live', 'polite');
  host.setAttribute('aria-relevant', 'additions');

  onDomReady(() => {
    if (toastHost && toastHost.isConnected) return;
    document.body.appendChild(host);
    toastHost = host;
  });

  toastHost = host;
  return host;
}

function normalizeToastType(type) {
  const t = String(type || 'info').trim().toLowerCase();
  if (t === 'success') return 'success';
  if (t === 'warning') return 'warning';
  if (t === 'error' || t === 'danger') return 'danger';
  return 'info';
}

export function toast(message, opts) {
  opts = opts || {};
  const msg = String(message || '').trim();
  if (!msg) return;

  const type = normalizeToastType(opts.type);
  const title = typeof opts.title === 'string' ? opts.title.trim() : '';
  const timeout = typeof opts.timeout === 'number' ? opts.timeout : 3500;

  const host = ensureToastHost();

  const node = document.createElement('div');
  node.className = `vhToast vhToast--${type}`;
  node.setAttribute('role', 'status');

  if (title) {
    const h = document.createElement('p');
    h.className = 'vhToast__title';
    h.textContent = title;

    const p = document.createElement('p');
    p.className = 'vhToast__msg';
    p.textContent = msg;

    node.appendChild(h);
    node.appendChild(p);
  } else {
    const p = document.createElement('p');
    p.className = 'vhToast__msg';
    p.textContent = msg;
    node.appendChild(p);
  }

  onDomReady(() => {
    if (!host.isConnected) return;
    host.appendChild(node);
  });

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

function ensureLoadingEl() {
  if (loadingEl && loadingEl.isConnected) return loadingEl;

  const el = document.createElement('div');
  el.id = 'vh_loading';
  el.className = 'vhLoadingOverlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Carregando');

  const card = document.createElement('div');
  card.className = 'vhLoadingCard card';

  const title = document.createElement('div');
  title.className = 'vhLoadingTitle';
  title.textContent = 'Carregando…';

  const subtitle = document.createElement('div');
  subtitle.id = 'vh_loading_text';
  subtitle.className = 'vhLoadingText';
  subtitle.textContent = 'Aguarde um instante.';

  card.appendChild(title);
  card.appendChild(subtitle);
  el.appendChild(card);

  onDomReady(() => {
    if (loadingEl && loadingEl.isConnected) return;
    document.body.appendChild(el);
    loadingEl = el;
  });

  loadingEl = el;
  return el;
}

export function setLoading(isVisible, text) {
  const el = ensureLoadingEl();
  const bodyText = el.querySelector('#vh_loading_text');

  if (bodyText && typeof text === 'string' && text.trim()) bodyText.textContent = text.trim();
  if (bodyText && (!text || !String(text).trim())) bodyText.textContent = 'Aguarde um instante.';

  const v = !!isVisible;
  onDomReady(() => {
    el.classList.toggle('is-open', v);
  });
}

function getFocusableElements(root) {
  if (!root) return [];
  const list = root.querySelectorAll(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  return Array.from(list).filter((el) => {
    try {
      if (!(el instanceof HTMLElement)) return false;
      if (el.hasAttribute('disabled')) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    } catch (e) {
      return false;
    }
  });
}

function trapFocus(modalEl, onClose) {
  function onKeyDown(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      onClose();
      return;
    }

    if (ev.key !== 'Tab') return;

    const focusables = getFocusableElements(modalEl);
    if (focusables.length === 0) {
      ev.preventDefault();
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (ev.shiftKey) {
      if (active === first || !modalEl.contains(active)) {
        ev.preventDefault();
        last.focus();
      }
      return;
    }

    if (active === last) {
      ev.preventDefault();
      first.focus();
    }
  }

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

export function openModal(opts) {
  opts = opts || {};

  const title = String(opts.title || '').trim();
  const message = String(opts.message || '').trim();
  const primaryText = String(opts.primaryText || 'OK').trim();
  const secondaryText = String(opts.secondaryText || '').trim();
  const variant = String(opts.variant || 'default').trim().toLowerCase();

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'vhModalOverlay is-open';

    const modal = document.createElement('div');
    modal.className = 'vhModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const head = document.createElement('div');
    head.className = 'vhModal__head';

    const h = document.createElement('h2');
    h.className = 'vhModal__title';
    h.textContent = title || 'Atenção';

    head.appendChild(h);

    const body = document.createElement('div');
    body.className = 'vhModal__body';
    body.textContent = message || '';

    const foot = document.createElement('div');
    foot.className = 'vhModal__foot';

    const btnPrimary = document.createElement('button');
    btnPrimary.type = 'button';
    btnPrimary.className = variant === 'danger' ? 'btn btn--danger' : 'btn btn--primary';
    btnPrimary.textContent = primaryText;

    let btnSecondary = null;
    if (secondaryText) {
      btnSecondary = document.createElement('button');
      btnSecondary.type = 'button';
      btnSecondary.className = 'btn';
      btnSecondary.textContent = secondaryText;
      foot.appendChild(btnSecondary);
    }

    foot.appendChild(btnPrimary);

    modal.appendChild(head);
    modal.appendChild(body);
    modal.appendChild(foot);
    overlay.appendChild(modal);

    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const close = (value) => {
      try {
        cleanupFocusTrap();
      } catch (e) {}

      try {
        overlay.remove();
      } catch (e) {}

      try {
        if (prev && prev.isConnected) prev.focus();
      } catch (e) {}

      resolve(value);
    };

    const cleanupFocusTrap = trapFocus(modal, () => close(false));

    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) close(false);
    });

    btnPrimary.addEventListener('click', () => close(true));
    if (btnSecondary) btnSecondary.addEventListener('click', () => close(false));

    onDomReady(() => {
      document.body.appendChild(overlay);
      const focusables = getFocusableElements(modal);
      const preferred = focusables.find((el) => el === btnPrimary) || focusables[0];
      if (preferred) preferred.focus();
    });
  });
}

export async function confirmDialog(message) {
  const msg = String(message || 'Confirmar?').trim();
  if (!msg) return false;

  try {
    return await openModal({
      title: 'Confirmar',
      message: msg,
      primaryText: 'Confirmar',
      secondaryText: 'Cancelar',
    });
  } catch (e) {
    return window.confirm(msg);
  }
}

export function setButtonLoading(button, isLoading, opts) {
  opts = opts || {};
  const el = button instanceof HTMLElement ? button : null;
  if (!el) return;

  const v = !!isLoading;

  if (!el.dataset.vhBtnLabel) {
    el.dataset.vhBtnLabel = el.textContent || '';
  }

  const labelLoading = typeof opts.loadingLabel === 'string' && opts.loadingLabel.trim() ? opts.loadingLabel.trim() : 'Carregando…';

  el.setAttribute('aria-busy', v ? 'true' : 'false');
  if (v) {
    el.setAttribute('disabled', '');
    el.textContent = labelLoading;
  } else {
    el.removeAttribute('disabled');
    el.textContent = el.dataset.vhBtnLabel || '';
  }
}

export function bindGlobalErrorHandlers() {
  if (globalBound) return;
  globalBound = true;

  let lastMsg = '';
  let lastAt = 0;
  let inHandler = false;

  function shouldIgnore(message) {
    const now = Date.now();
    const msg = String(message || '').trim();
    if (!msg) return true;

    // Evita cascata (ex.: erro disparando erro)
    if (inHandler) return true;

    // Dedup curto: mesma mensagem em sequência
    if (msg === lastMsg && now - lastAt < 1200) return true;

    lastMsg = msg;
    lastAt = now;
    return false;
  }

  function report(errLike) {
    let msg = '';
    try {
      msg = formatError(errLike);
    } catch (e) {
      msg = 'Erro inesperado.';
    }

    if (shouldIgnore(msg)) return;

    // Desacopla do stack atual para evitar loops síncronos.
    try {
      inHandler = true;
      window.setTimeout(() => {
        try {
          showError(msg);
        } catch (e) {}
        inHandler = false;
      }, 0);
    } catch (e) {
      inHandler = false;
    }
  }

  window.addEventListener('unhandledrejection', (ev) => {
    try {
      report(ev && ev.reason ? ev.reason : ev);
    } catch (e) {}
  });

  window.addEventListener('error', (ev) => {
    try {
      const msg = ev && ev.error ? ev.error : (ev && ev.message ? ev.message : ev);
      report(msg);
    } catch (e) {}
  });
}

bindGlobalErrorHandlers();
