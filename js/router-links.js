// Viva Haven — Helpers de navegação/bind de botões/links

import { toast } from './ui.js';

export function navigate(href) {
  const url = String(href || '').trim();
  if (!url) return;
  window.location.href = url;
}

export function bindRouterLinks(opts) {
  opts = opts || {};
  const root = opts.root || document;
  const placeholderMessage = String(opts.placeholderMessage || 'Funcionalidade em desenvolvimento.').trim();
  const handleHashLinks = opts.handleHashLinks === true;

  root.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!t) return;

    const el = t.closest ? t.closest('a,button') : null;
    if (!el) return;

    const href = el.tagName === 'A' ? String(el.getAttribute('href') || '') : '';
    const dataHref = String(el.getAttribute('data-href') || '').trim();
    const isDev = el.getAttribute('data-dev') === '1' || el.getAttribute('data-dev') === 'true';

    // Navegação declarativa
    if (dataHref) {
      ev.preventDefault();
      navigate(dataHref);
      return;
    }

    // Placeholders explícitos
    if (isDev) {
      ev.preventDefault();
      toast(placeholderMessage, { type: 'warning' });
      return;
    }

    // href="#" é comum ser usado como botão; só tratar como placeholder se explicitamente habilitado.
    if (handleHashLinks && href === '#') {
      ev.preventDefault();
      toast(placeholderMessage, { type: 'warning' });
    }
  });
}
