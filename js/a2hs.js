/* Viva Haven — Add to Home Screen helper (Android + iOS)
   - Android/Chromium: usa beforeinstallprompt
   - iOS: mostra instruções (Compartilhar > Adicionar à Tela de Início)
   - Exibe no máximo 1x por dia (localStorage)
*/

(function () {
  'use strict';

  // Troque a versão quando quiser reexibir o banner mesmo no mesmo dia
  // (ex.: após mudanças de PWA/ícones/service worker)
  var A2HS_VERSION = 'v3';
  var LS_KEY = 'vh_a2hs_lastShown_' + A2HS_VERSION;
  var deferredPrompt = null;
  var bannerState = { shown: false };

  function todayKey() {
    var d = new Date();
    var yyyy = d.getFullYear();
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    var dd = String(d.getDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }

  function canShowToday() {
    try {
      return localStorage.getItem(LS_KEY) !== todayKey();
    } catch (e) {
      return true;
    }
  }

  function markShown() {
    try {
      localStorage.setItem(LS_KEY, todayKey());
    } catch (e) {}
  }

  function isStandalone() {
    // Android/desktop
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    // iOS Safari
    // @ts-ignore
    if (window.navigator && window.navigator.standalone) return true;
    return false;
  }

  function isIOS() {
    var ua = String(navigator.userAgent || '');
    return /iphone|ipad|ipod/i.test(ua) && !window.MSStream;
  }

  function isAndroid() {
    var ua = String(navigator.userAgent || '');
    return /android/i.test(ua);
  }

  function isDesktop() {
    return !isIOS() && !isAndroid();
  }

  function installHint() {
    if (isIOS()) {
      return 'No iPhone/iPad: toque em “Compartilhar” e depois em “Adicionar à Tela de Início”.';
    }

    if (isDesktop()) {
      return 'No Windows: use o menu do navegador (⋮) e clique em “Instalar Viva Haven” (ou “Apps”). Se aparecer a opção de criar atalho, marque “Área de trabalho”.';
    }

    return 'Abra o menu do navegador (⋮) e toque em “Instalar app” / “Adicionar à tela inicial”.';
  }

  function postInstallHint() {
    if (isDesktop()) {
      return 'Instalado. Se o atalho não aparecer automaticamente, abra o menu (⋮) e procure “Apps” / “Instalar Viva Haven” e escolha criar atalho na Área de Trabalho.';
    }
    return 'Aplicativo instalado com sucesso. Procure o ícone na sua tela inicial/launcher.';
  }

  function setBannerState(state, message) {
    var root = document.getElementById('vh-a2hs');
    if (!root) return;

    var titleEl = root.querySelector('.vhA2HS__title');
    var textEl = root.querySelector('.vhA2HS__text');
    var btnInstall = document.getElementById('vh-a2hs-install');
    var btnClose = document.getElementById('vh-a2hs-close');
    var btnX = document.getElementById('vh-a2hs-x');

    if (textEl && typeof message === 'string') {
      textEl.textContent = message;
    }

    if (state === 'installing') {
      if (titleEl) titleEl.textContent = 'Instalando…';
      if (btnInstall) {
        btnInstall.disabled = true;
        btnInstall.innerHTML = '<span class="vhA2HS__spinner" aria-hidden="true"></span> Instalando';
      }
      if (btnClose) btnClose.disabled = true;
      if (btnX) btnX.disabled = true;
      return;
    }

    if (state === 'success') {
      if (titleEl) titleEl.textContent = 'Aplicativo instalado';
      if (btnInstall) btnInstall.style.display = 'none';
      if (btnClose) {
        btnClose.disabled = false;
        btnClose.textContent = 'Ok';
      }
      if (btnX) btnX.disabled = false;
      return;
    }

    if (state === 'instructions') {
      if (titleEl) titleEl.textContent = 'Como instalar';
      if (btnInstall) btnInstall.style.display = 'none';
      if (btnClose) {
        btnClose.disabled = false;
        btnClose.textContent = 'Entendi';
      }
      if (btnX) btnX.disabled = false;
      return;
    }

    // idle
    if (titleEl) titleEl.textContent = 'Baixar App';
    if (btnInstall) {
      btnInstall.disabled = false;
      btnInstall.textContent = 'Baixar App';
      btnInstall.style.display = '';
    }
    if (btnClose) {
      btnClose.disabled = false;
      btnClose.textContent = 'Agora não';
    }
    if (btnX) btnX.disabled = false;
  }

  function ensureStyles() {
    if (document.getElementById('vh-a2hs-style')) return;

    var style = document.createElement('style');
    style.id = 'vh-a2hs-style';
    style.textContent =
      '.vhA2HS{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;}' +
      '.vhA2HS__card{display:flex;gap:12px;align-items:flex-start;padding:14px 14px 12px;border-radius:16px;' +
      'border:1px solid var(--border);background:var(--surface);box-shadow:var(--shadow-soft);backdrop-filter:saturate(140%) blur(8px);}' +
      '.vhA2HS__icon{width:36px;height:36px;border-radius:12px;flex:none;background:color-mix(in srgb, var(--brand-b) 14%, transparent);display:grid;place-items:center;}' +
      '.vhA2HS__icon svg{width:18px;height:18px;stroke:var(--brand-b);}'+
      '.vhA2HS__title{margin:0;font-size:13px;font-weight:800;color:var(--text);}' +
      '.vhA2HS__text{margin:4px 0 0;font-size:12px;line-height:1.35;color:var(--muted);}' +
      '.vhA2HS__actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;}' +
      '.vhA2HS__btn{border-radius:12px;padding:8px 10px;font-size:12px;font-weight:800;cursor:pointer;border:1px solid var(--border-2);background:var(--surface-2);color:var(--text);}'+
      '.vhA2HS__btnPrimary{border:none;background:var(--brand);color:white;}' +
      '.vhA2HS__btn[disabled]{opacity:0.7;cursor:not-allowed;}' +
      '.vhA2HS__spinner{width:16px;height:16px;border-radius:50%;border:2px solid color-mix(in srgb, var(--text) 18%, transparent);border-top-color:var(--brand-b);display:inline-block;animation:vhSpin 0.8s linear infinite;margin-right:6px;vertical-align:-3px;}' +
      '@keyframes vhSpin{to{transform:rotate(360deg);}}' +
      '.vhA2HS__close{margin-left:auto;border:none;background:transparent;color:var(--faint);cursor:pointer;font-size:18px;line-height:1;padding:2px 6px;}' +
      '@media (min-width: 920px){.vhA2HS{left:auto;right:24px;max-width:420px;}}';

    document.head.appendChild(style);
  }

  function createIconSvg() {
    // Ícone simples (seta pra baixo em uma bandeja) sem dependências
    return (
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M12 3v10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M8 10l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '</svg>'
    );
  }

  function showBanner(opts) {
    if (!canShowToday()) return;
    if (isStandalone()) return;

    ensureStyles();

    // Evita duplicar
    if (document.getElementById('vh-a2hs')) return;

    var wrap = document.createElement('div');
    wrap.className = 'vhA2HS';
    wrap.id = 'vh-a2hs';

    var installBtn = '<button type="button" class="vhA2HS__btn vhA2HS__btnPrimary" id="vh-a2hs-install">Baixar App</button>';

    var html =
      '<div class="vhA2HS__card" role="dialog" aria-label="Instalar app">' +
      '  <div class="vhA2HS__icon">' + createIconSvg() + '</div>' +
      '  <div class="vhA2HS__body">' +
      '    <p class="vhA2HS__title">Baixar App</p>' +
      '    <p class="vhA2HS__text">' + opts.message + '</p>' +
      '    <div class="vhA2HS__actions">' +
      installBtn +
      '      <button type="button" class="vhA2HS__btn" id="vh-a2hs-close">Agora não</button>' +
      '    </div>' +
      '  </div>' +
      '  <button type="button" class="vhA2HS__close" aria-label="Fechar" id="vh-a2hs-x">×</button>' +
      '</div>';

    wrap.innerHTML = html;
    document.body.appendChild(wrap);
    bannerState.shown = true;

    function close() {
      markShown();
      if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }

    var closeBtn = document.getElementById('vh-a2hs-close');
    var closeX = document.getElementById('vh-a2hs-x');
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (closeX) closeX.addEventListener('click', close);

    var btn = document.getElementById('vh-a2hs-install');
    if (btn) {
      btn.addEventListener('click', function () {
        // Se o navegador liberou o prompt nativo
        if (deferredPrompt && opts.installable) {
          setBannerState('installing', 'Preparando a instalação do Viva Haven…');
          deferredPrompt.prompt();
          deferredPrompt.userChoice
            .then(function (choice) {
              var accepted = choice && choice.outcome === 'accepted';
              deferredPrompt = null;
              if (accepted) {
                setBannerState('success', postInstallHint());
                markShown();
                window.setTimeout(close, 1800);
                return;
              }

              // Cancelado pelo usuário: volta ao estado normal
              setBannerState('idle', opts.message);
            })
            .catch(function () {
              deferredPrompt = null;
              setBannerState('idle', opts.message);
            });
          return;
        }

        // Fallback: não há prompt nativo (ou não é suportado)
        // Não existe instalação automática nesses casos; mostramos o fluxo no próprio popup (sem alert do navegador).
        setBannerState('installing', 'Preparando a instalação do Viva Haven…');
        window.setTimeout(function () {
          setBannerState('instructions', installHint());
          markShown();
        }, 900);
      });
    }
  }

  function updateBanner(opts) {
    opts = opts || {};
    var root = document.getElementById('vh-a2hs');
    if (!root) return;

    var textEl = root.querySelector('.vhA2HS__text');
    if (textEl && typeof opts.message === 'string') {
      textEl.textContent = opts.message;
    }
  }

  // ANDROID / Chromium
  window.addEventListener('beforeinstallprompt', function (e) {
    // Para poder mostrar nosso próprio banner
    e.preventDefault();
    deferredPrompt = e;

    // Se o fallback já mostrou um banner sem botão, atualiza
    updateBanner({
      installable: true,
      message: 'Baixe o Viva Haven e veja como funciona o app: mais rápido, em tela cheia e com acesso pelo atalho.'
    });

    showBanner({
      installable: true,
      message: 'Baixe o Viva Haven e veja como funciona o app: mais rápido, em tela cheia e com acesso pelo atalho.'
    });
  });

  // iOS Safari (não dispara beforeinstallprompt)
  window.addEventListener('load', function () {
    if (!isIOS()) return;

    showBanner({
      installable: false,
      message: 'Baixe o Viva Haven e veja como funciona o app. No iPhone/iPad: toque em “Compartilhar” e depois em “Adicionar à Tela de Início”.'
    });
  });

  // Fallback (desktop / Android quando beforeinstallprompt não dispara)
  window.addEventListener('load', function () {
    if (isIOS()) return;
    if (isStandalone()) return;
    if (!canShowToday()) return;

    // Espera um pouco: se beforeinstallprompt vier, o banner será atualizado.
    window.setTimeout(function () {
      if (deferredPrompt) return;
      if (document.getElementById('vh-a2hs')) return;

      showBanner({
        installable: false,
        message:
          'Baixe o Viva Haven e veja como funciona o app. Abra o menu do navegador (⋮) e toque em “Instalar app” / “Adicionar à tela inicial”.'
      });
    }, 2500);
  });

  window.addEventListener('appinstalled', function () {
    markShown();
    deferredPrompt = null;
    setBannerState('success', postInstallHint());
    window.setTimeout(function () {
      var el = document.getElementById('vh-a2hs');
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }, 1800);
  });
})();
