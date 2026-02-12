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
    // CSS movido para /css/layout.css
    return;
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

    // Âncora para o seletor de contexto ativo (injetado por /js/active-context.js)
    // Mantém compatibilidade: páginas que não conhecem o contexto continuam funcionando.
    if (rightActionsHtml.indexOf('data-vh-context-anchor') === -1) {
      rightActionsHtml = '<span data-vh-context-anchor="1"></span>' + rightActionsHtml;
    }

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

    // Rotas atuais do projeto (multi-page)
    var homeHref = '/app/home.html';
    var perfilHref = '/perfil.html';
    var chamadosHref = '/app/chamados.html';
    var avisosHref = '/app/avisos.html';
    var boletosHref = '/app/boletos.html';

    return (
      '<nav class="bottomNav" aria-label="Navegação">' +
      item('home', homeHref, 'home', false) +
      item('chamados', chamadosHref, 'tool', false) +
      item('avisos', avisosHref, 'bell', true) +
      item('boletos', boletosHref, 'chat', false) +
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

    // Sem placeholders no shell: rotas devem existir.

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
