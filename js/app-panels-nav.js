// Viva Haven — App Panels Nav
// Injeta uma barra de navegação unificada em todas as páginas /app.

const LINKS = [
  { href: '/app/home.html', label: 'Home', icon: 'home' },
  { href: '/app/chamados.html', label: 'Chamados', icon: 'tool' },
  { href: '/app/notificacoes.html', label: 'Notificações', icon: 'bell' },
  { href: '/app/avisos.html', label: 'Avisos', icon: 'chat' },
  { href: '/app/boletos.html', label: 'Boletos', icon: 'doc' },
  { href: '/app/reservas.html', label: 'Reservas', icon: 'calendar' },
  { href: '/app/reformas.html', label: 'Reformas', icon: 'build' },
  { href: '/app/assembleias.html', label: 'Assembleias', icon: 'users' },
  { href: '/app/minhas-multas.html', label: 'Multas', icon: 'alert' },
];

function iconSvg(name) {
  switch (name) {
    case 'home':
      return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    case 'tool':
      return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.7 6.3a5 5 0 0 0-6.4 6.4l-4.3 4.3a2 2 0 0 0 2.8 2.8l4.3-4.3a5 5 0 0 0 6.4-6.4l-2.1 2.1-2.8-2.8 2.1-2.1Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    case 'bell':
      return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M13.7 21a2 2 0 0 1-3.4 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    case 'chat':
      return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    case 'doc':
      return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 3h6l4 4v14H6V3h2Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h4" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    case 'calendar':
      return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    case 'build':
      return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 7 7 13l4 4 6-6M14 6l4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    case 'users':
      return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="9" r="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M3 19c0-2.8 2.7-5 6-5s6 2.2 6 5M14.5 19c0-1.8 1.7-3.3 3.8-3.3 1.1 0 2.1.4 2.7 1.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    case 'alert':
      return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4 3 20h18L12 4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4M12 17h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    default:
      return '';
  }
}

function currentPath() {
  try {
    return new URL(window.location.href).pathname || '';
  } catch (e) {
    return window.location.pathname || '';
  }
}

function isAppPath(pathname) {
  return String(pathname || '').toLowerCase().includes('/app/');
}

function isActive(href, pathname) {
  const a = String(href || '').toLowerCase();
  const p = String(pathname || '').toLowerCase();
  return a && p && p.endsWith(a);
}

function mountAppPanelsNav() {
  if (document.getElementById('vh_app_nav')) return;

  const pathname = currentPath();
  if (!isAppPath(pathname)) return;

  const nav = document.createElement('nav');
  nav.className = 'vhAppNav';
  nav.id = 'vh_app_nav';

  const inner = document.createElement('div');
  inner.className = 'vhAppNav__inner';

  LINKS.forEach((item) => {
    const a = document.createElement('a');
    a.className = 'vhAppNav__link';
    a.href = item.href;
    a.setAttribute('aria-label', item.label);
    a.innerHTML =
      '<span class="vhAppNav__linkIcon" aria-hidden="true">' + iconSvg(item.icon) + '</span>' +
      '<span class="vhAppNav__linkText">' + item.label + '</span>';
    if (isActive(item.href, pathname)) a.setAttribute('aria-current', 'page');
    inner.appendChild(a);
  });

  const spacer = document.createElement('div');
  spacer.className = 'vhAppNav__spacer';
  inner.appendChild(spacer);

  const hint = document.createElement('div');
  hint.className = 'vhAppNav__hint';
  hint.textContent = 'Painéis do morador';
  inner.appendChild(hint);

  nav.appendChild(inner);

  const topbar = document.querySelector('header.topbar');
  if (topbar && topbar.parentNode) {
    topbar.insertAdjacentElement('afterend', nav);
    return;
  }

  const firstMain = document.querySelector('main');
  if (firstMain && firstMain.parentNode) {
    firstMain.insertAdjacentElement('beforebegin', nav);
    return;
  }

  document.body.insertAdjacentElement('afterbegin', nav);
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', mountAppPanelsNav, { once: true });
} else {
  mountAppPanelsNav();
}
