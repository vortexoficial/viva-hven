/* Viva Haven — App Shell (reutilizável)
   Objetivo: padronizar top bar + bottom nav e montar páginas internas.
   Mantém compatibilidade com o tema via localStorage "condoflow-theme".
*/

(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ensureShellStyles() {
    if (document.getElementById('vh-app-shell-style')) return;

    var style = document.createElement('style');
    style.id = 'vh-app-shell-style';
    style.textContent =
      '.vhShell{min-height:100vh;}' +
      '.vhShell__content{min-height:100vh;padding-bottom:110px;}' +
      '.vhTopBar{position:sticky;top:0;z-index:50;background:color-mix(in srgb, var(--bg) 85%, transparent);' +
      'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--border);}' +
      '.vhTopBar__inner{max-width:430px;margin:0 auto;padding:14px 18px;display:flex;align-items:center;gap:12px;}' +
      '.vhTopBar__title{margin:0;font-size:14px;font-weight:800;letter-spacing:-0.2px;color:var(--text);}' +
      '.vhTopBar__spacer{flex:1;}' +
      '.vhTopBar__actions{display:flex;align-items:center;gap:10px;}' +
      '.vhIconBtn{width:40px;height:40px;border-radius:14px;border:1px solid var(--border);background:var(--surface);' +
      'display:grid;place-items:center;cursor:pointer;}' +
      '.vhIconBtn svg{width:18px;height:18px;stroke:var(--text-2);}' +
      '.vhIconBtn:active{transform:scale(0.96);}' +
      '.vhShell .bottomNav{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);width:calc(100% - 48px);max-width:382px;' +
      'background:rgba(var(--surface-rgb, 255,255,255), 0.10);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);' +
      'border:1px solid var(--border);border-radius:24px;display:flex;justify-content:space-between;padding:12px 24px;box-shadow:0 12px 40px rgba(0,0,0,0.12);z-index:1000;}' +
      '.vhShell .navItem{display:flex;flex-direction:column;align-items:center;justify-content:center;text-decoration:none;width:44px;height:44px;border-radius:14px;' +
      'transition:all 0.2s ease;position:relative;}' +
      '.vhShell .navItem__icon{color:var(--text-2);display:flex;}' +
      '.vhShell .navItem__icon svg{width:24px;height:24px;stroke-width:2;}' +
      '.vhShell .navItem--active{background:color-mix(in srgb, var(--brand-b) 12%, transparent);}' +
      '.vhShell .navItem--active .navItem__icon{color:var(--brand-b);transform:scale(1.08);}' +
      '.vhShell .navIndicator{position:absolute;bottom:-8px;width:4px;height:4px;background:var(--brand-b);border-radius:50%;opacity:0;transform:translateY(4px);transition:all 0.2s ease;}' +
      '.vhShell .navItem--active .navIndicator{opacity:1;transform:translateY(0);}' +
      '.vhShell .notifDot{position:absolute;top:10px;right:10px;width:8px;height:8px;background:#FF5252;border-radius:50%;border:2px solid var(--surface);}' +
      '@media (max-width:430px){.vhTopBar__inner{padding-left:16px;padding-right:16px;}}';

    document.head.appendChild(style);
  }

  function iconSvg(name) {
    // Ícones inline (sem dependências externas)
    switch (name) {
      case 'home':
        return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
      case 'tool':
        return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14.7 6.3a5 5 0 0 0-6.4 6.4l-4.3 4.3a2 2 0 0 0 2.8 2.8l4.3-4.3a5 5 0 0 0 6.4-6.4l-2.1 2.1-2.8-2.8 2.1-2.1Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      case 'bell':
        return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 7h18s-3 0-3-7Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13.7 21a2 2 0 0 1-3.4 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      case 'chat':
        return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
      case 'menu':
        return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      default:
        return '';
    }
  }

  function createTopBar(opts) {
    opts = opts || {};
    var title = typeof opts.title === 'string' ? opts.title : '';
    var rightActionsHtml = typeof opts.rightActionsHtml === 'string' ? opts.rightActionsHtml : '';

    if (!title && !rightActionsHtml) return '';

    return (
      '<header class="vhTopBar" role="banner">' +
      '  <div class="vhTopBar__inner">' +
      '    <h1 class="vhTopBar__title">' + escapeHtml(title) + '</h1>' +
      '    <div class="vhTopBar__spacer"></div>' +
      '    <div class="vhTopBar__actions">' + rightActionsHtml + '</div>' +
      '  </div>' +
      '</header>'
    );
  }

  function createBottomNav(opts) {
    opts = opts || {};
    var active = String(opts.active || 'home');

    function item(tab, href, iconName, hasDot) {
      var cls = 'navItem' + (active === tab ? ' navItem--active' : '');
      return (
        '<a href="' + href + '" class="' + cls + '" aria-label="' + escapeHtml(tab) + '">' +
        '  <div class="navItem__icon">' + iconSvg(iconName) + '</div>' +
        (hasDot ? '<div class="notifDot" aria-hidden="true"></div>' : '') +
        '  <div class="navIndicator" aria-hidden="true"></div>' +
        '</a>'
      );
    }

    // Rotas atuais do projeto (sem backend)
    var homeHref = '/app/home.html';
    var perfilHref = '/perfil.html';

    return (
      '<nav class="bottomNav" aria-label="Navegação">' +
      item('home', homeHref, 'home', false) +
      item('chamados', '#', 'tool', false) +
      item('avisos', '#', 'bell', true) +
      item('chat', '#', 'chat', false) +
      item('menu', perfilHref, 'menu', false) +
      '</nav>'
    );
  }

  function mountShell(opts) {
    opts = opts || {};
    ensureShellStyles();

    var rootSelector = opts.rootSelector || 'body';
    var root = document.querySelector(rootSelector);
    if (!root) return;

    var topBarHtml = createTopBar({ title: opts.title || '', rightActionsHtml: opts.rightActionsHtml || '' });
    var bottomNavHtml = createBottomNav({ active: opts.activeTab || 'home' });
    var contentHtml = typeof opts.contentHtml === 'string' ? opts.contentHtml : '';

    root.innerHTML =
      '<div class="vhShell">' +
      topBarHtml +
      '<div class="vhShell__content">' + contentHtml + '</div>' +
      bottomNavHtml +
      '</div>';

    // Mantém o comportamento de tema existente; não altera a chave.
    try {
      var saved = localStorage.getItem('condoflow-theme');
      if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else if (saved === 'light') document.documentElement.removeAttribute('data-theme');
    } catch (e) {}
  }

  window.createTopBar = createTopBar;
  window.createBottomNav = createBottomNav;
  window.mountShell = mountShell;
})();
