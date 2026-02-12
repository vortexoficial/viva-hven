// Viva Haven — Admin Shell (menu padronizado)
// Multi-page, sem framework.
// Objetivo: padronizar navegação do painel /admin sem reescrever layouts existentes.

const LINKS = [
  { href: '/admin/dashboard.html', label: 'Dashboard' },
  { href: '/admin/condominio.html', label: 'Condomínio' },
  { href: '/admin/pessoas.html', label: 'Pessoas' },
  { href: '/admin/manutencao.html', label: 'Manutenção' },
  { href: '/admin/obras.html', label: 'Obras' },
  { href: '/admin/seguranca.html', label: 'Segurança' },
  { href: '/admin/financeiro.html', label: 'Financeiro' },
  { href: '/admin/memberships.html', label: 'Memberships' },
  { href: '/admin/logs.html', label: 'Logs' },
];

function ensureStyles() {
  if (document.getElementById('vh_admin_shell_style')) return;

  const style = document.createElement('style');
  style.id = 'vh_admin_shell_style';
  style.textContent =
    '.vhAdminNav{position:sticky;top:0;z-index:20;background:var(--bg);border-bottom:1px solid var(--border);}' +
    '.vhAdminNav__inner{max-width:1100px;margin:0 auto;padding:10px 18px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;}' +
    '.vhAdminNav__link{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 12px;border-radius:12px;' +
    'border:1px solid var(--border);background:var(--surface);color:var(--text);text-decoration:none;font-weight:900;font-size:12px;}' +
    '.vhAdminNav__link[aria-current="page"]{border-color:var(--brand);}' +
    '.vhAdminNav__spacer{flex:1;min-width:12px;}' +
    '.vhAdminNav__hint{font-size:12px;color:var(--muted);font-weight:700;}'
  ;
  document.head.appendChild(style);
}

function currentPath() {
  try {
    return new URL(window.location.href).pathname || '';
  } catch (e) {
    return window.location.pathname || '';
  }
}

function isActive(href, pathname) {
  const a = String(href || '').toLowerCase();
  const p = String(pathname || '').toLowerCase();
  return a && p && p.endsWith(a);
}

function mountAdminNav() {
  ensureStyles();

  // evita duplicar
  if (document.getElementById('vh_admin_nav')) return;

  const pathname = currentPath();

  const nav = document.createElement('nav');
  nav.className = 'vhAdminNav';
  nav.id = 'vh_admin_nav';

  const inner = document.createElement('div');
  inner.className = 'vhAdminNav__inner';

  LINKS.forEach((l) => {
    const a = document.createElement('a');
    a.className = 'vhAdminNav__link';
    a.href = l.href;
    a.textContent = l.label;
    if (isActive(l.href, pathname)) a.setAttribute('aria-current', 'page');
    inner.appendChild(a);
  });

  const spacer = document.createElement('div');
  spacer.className = 'vhAdminNav__spacer';
  inner.appendChild(spacer);

  const hint = document.createElement('div');
  hint.className = 'vhAdminNav__hint';
  hint.textContent = 'Painel administrativo';
  inner.appendChild(hint);

  nav.appendChild(inner);

  // tenta inserir depois do header/topbar se existir, senão no topo do body
  const header = document.querySelector('header.topbar');
  if (header && header.parentNode) {
    header.insertAdjacentElement('afterend', nav);
  } else {
    document.body.insertAdjacentElement('afterbegin', nav);
  }
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', mountAdminNav, { once: true });
} else {
  mountAdminNav();
}
