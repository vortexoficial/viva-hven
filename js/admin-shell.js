// Viva Haven — Admin Shell (menu padronizado)
// Multi-page, sem framework.
// Objetivo: padronizar navegação do painel /admin sem reescrever layouts existentes.

const LINKS = [
  { href: '/admin/dashboard.html', label: 'Dashboard' },
  { href: '/admin/assembleias.html', label: 'Assembleias' },
  { href: '/admin/condominio.html', label: 'Condomínio' },
  { href: '/admin/governanca.html', label: 'Governança' },
  { href: '/admin/pessoas.html', label: 'Pessoas' },
  { href: '/admin/moradores.html', label: 'Moradores' },
  { href: '/admin/funcionarios.html', label: 'Funcionários' },
  { href: '/admin/comunicacao.html', label: 'Comunicação' },
  { href: '/admin/manutencao.html', label: 'Manutenção' },
  { href: '/admin/fornecedores.html', label: 'Fornecedores' },
  { href: '/admin/obras.html', label: 'Obras' },
  { href: '/admin/seguranca.html', label: 'Segurança' },
  { href: '/admin/seguros.html', label: 'Seguros' },
  { href: '/admin/financeiro.html', label: 'Financeiro' },
  { href: '/admin/carteira.html', label: 'Carteira' },
  { href: '/admin/insights.html', label: 'Insights' },
  { href: '/admin/memberships.html', label: 'Memberships' },
  { href: '/admin/logs.html', label: 'Logs' },
];

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
  hint.textContent = 'Admin completo • v2';
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
