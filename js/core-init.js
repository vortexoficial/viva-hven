// Viva Haven — Core init (sem framework)
// Objetivo: ativar handlers globais (erros/UX) em todas as páginas.

import './ui.js';
import './active-context.js';

function bindOnce() {
  try {
    const root = document.documentElement;
    if (root && root.getAttribute('data-vh-core-init') === '1') return;
    if (root) root.setAttribute('data-vh-core-init', '1');
  } catch (e) {}
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', bindOnce, { once: true });
} else {
  bindOnce();
}
