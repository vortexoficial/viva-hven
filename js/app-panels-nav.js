// Viva Haven — App Panels Nav
// Injeta uma barra de navegação unificada em todas as páginas /app.

const LINKS = [
  { href: '/app/home.html', label: 'Home' },
  { href: '/app/chamados.html', label: 'Chamados' },
  { href: '/app/avisos.html', label: 'Avisos' },
  { href: '/app/boletos.html', label: 'Boletos' },
  { href: '/app/reservas.html', label: 'Reservas' },
  { href: '/app/reformas.html', label: 'Reformas' },
  { href: '/app/assembleias.html', label: 'Assembleias' },
  { href: '/app/minhas-multas.html', label: 'Multas' },
];

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
    a.textContent = item.label;
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
