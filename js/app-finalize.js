// Viva Haven — Finalização global (UX/fluidez)
// Progressive enhancement para todas as páginas sem quebrar comportamento existente.

import { setButtonLoading, setLoading, toast } from './ui.js';

function isInternalNavigableLink(anchor) {
  if (!(anchor instanceof HTMLAnchorElement)) return false;
  const href = String(anchor.getAttribute('href') || '').trim();
  if (!href) return false;
  if (href.startsWith('#')) return false;
  if (anchor.target && anchor.target.toLowerCase() === '_blank') return false;
  if (anchor.hasAttribute('download')) return false;

  try {
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function ensureRouteProgress() {
  let host = document.getElementById('vh_route_progress');
  if (host) return host;

  host = document.createElement('div');
  host.id = 'vh_route_progress';
  host.className = 'scrollProgress';
  host.setAttribute('aria-hidden', 'true');

  const bar = document.createElement('div');
  bar.className = 'scrollProgress__bar';
  bar.id = 'vh_route_progress_bar';

  host.appendChild(bar);
  document.body.appendChild(host);
  return host;
}

function setRouteProgress(value) {
  const bar = document.getElementById('vh_route_progress_bar');
  if (!bar) return;

  const n = Math.max(0, Math.min(100, Number(value) || 0));
  bar.style.width = `${n}%`;
  bar.style.opacity = n <= 0 ? '0' : '1';
}

function bindNavigationProgress() {
  ensureRouteProgress();
  setRouteProgress(0);

  let progressTimer = null;
  let current = 0;

  function start() {
    if (progressTimer) return;
    current = 12;
    setRouteProgress(current);

    progressTimer = window.setInterval(() => {
      if (current >= 88) return;
      current += Math.max(1, Math.floor((90 - current) * 0.12));
      setRouteProgress(current);
    }, 120);
  }

  function done() {
    if (progressTimer) {
      window.clearInterval(progressTimer);
      progressTimer = null;
    }
    setRouteProgress(100);
    window.setTimeout(() => setRouteProgress(0), 220);
  }

  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[href]');
    if (!anchor) return;
    if (!isInternalNavigableLink(anchor)) return;
    start();
  }, { capture: true });

  window.addEventListener('pageshow', done);
  window.addEventListener('load', done);
}

function bindFormUX() {
  const activeForms = new WeakMap();

  document.addEventListener('submit', (ev) => {
    const form = ev.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.hasAttribute('data-vh-no-submit-ux')) return;

    if (activeForms.get(form)) {
      ev.preventDefault();
      return;
    }

    activeForms.set(form, true);

    const submitter = ev.submitter instanceof HTMLElement ? ev.submitter : null;
    if (submitter) {
      setButtonLoading(submitter, true, { loadingLabel: 'Enviando…' });
    }

    // fallback para fluxos que não navegam e não removem loading manualmente
    window.setTimeout(() => {
      activeForms.set(form, false);
      if (submitter) setButtonLoading(submitter, false);
    }, 10000);
  }, { capture: true });
}

function bindFetchLoading() {
  if (window.__vhFetchWrapped) return;
  if (typeof window.fetch !== 'function') return;

  window.__vhFetchWrapped = true;

  const nativeFetch = window.fetch.bind(window);
  let pending = 0;
  let showTimer = null;

  function syncLoading() {
    if (pending > 0) {
      if (showTimer) return;
      showTimer = window.setTimeout(() => {
        showTimer = null;
        if (pending > 0) setLoading(true, 'Sincronizando dados...');
      }, 260);
      return;
    }

    if (showTimer) {
      window.clearTimeout(showTimer);
      showTimer = null;
    }
    setLoading(false);
  }

  window.fetch = async (...args) => {
    pending += 1;
    syncLoading();
    try {
      return await nativeFetch(...args);
    } finally {
      pending = Math.max(0, pending - 1);
      syncLoading();
    }
  };
}

function bindConnectionToasts() {
  window.addEventListener('offline', () => {
    toast('Sem conexão com a internet.', { type: 'warning', title: 'Offline' });
  });

  window.addEventListener('online', () => {
    toast('Conexão restabelecida.', { type: 'success', title: 'Online' });
  });
}

function bootstrapFinalize() {
  bindNavigationProgress();
  bindFormUX();
  bindFetchLoading();
  bindConnectionToasts();
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bootstrapFinalize, { once: true });
} else {
  bootstrapFinalize();
}
