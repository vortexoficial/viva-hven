// Viva Haven — Active Context (condomínio ativo)
// Multi-page, sem framework.
// Responsabilidades:
// - Descobrir condomínios acessíveis (via query em `condos`, filtrada pelas rules)
// - Selecionar/persistir contexto ativo (condoId + orgId)
// - Expor helpers: getActiveContext(), setActiveContext(condoId), watchAuthAndContext()
// - Renderizar seletor global (topbar/modal) em páginas pós-login

import { initFirebase } from './firebase.js';
import { setLoading, showError, toast } from './ui.js';
import { getUserRole } from './rbac.js';

import {
  collection,
  doc,
  getDoc,
  getDocs,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

const LS_ACTIVE_CONDO = 'vh_active_condo'; // compat legado
const LS_ACTIVE_ORG = 'vh_active_org';

let cachedCondos = [];
let cachedUser = null;
let bootstrapped = false;
let modalEl = null;

function cleanString(value) {
  return String(value || '').trim();
}

function safeGetLS(key) {
  try {
    return cleanString(localStorage.getItem(key));
  } catch (e) {
    return '';
  }
}

function safeSetLS(key, value) {
  try {
    const v = cleanString(value);
    if (!v) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch (e) {}
}

function safeRemoveLS(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) {}
}

function currentPathname() {
  try {
    return new URL(window.location.href).pathname || '/';
  } catch (e) {
    return window.location.pathname || '/';
  }
}

function isPostLoginPage() {
  const p = currentPathname().toLowerCase();
  if (p.endsWith('/login.html')) return false;
  if (p.endsWith('/register.html')) return false;
  if (p.endsWith('/index.html') || p === '/' || p === '') return false;
  if (p.endsWith('/offline.html')) return false;
  return p.includes('/app/') || p.includes('/admin/') || p.endsWith('/perfil.html');
}

function sortByName(items) {
  return (items || []).slice().sort((a, b) => cleanString(a.name).localeCompare(cleanString(b.name)));
}

async function listAccessibleCondos(db) {
  const qs = await getDocs(collection(db, 'condos'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  return sortByName(items);
}

function findCondoById(condoId) {
  const id = cleanString(condoId);
  if (!id) return null;
  return cachedCondos.find((c) => c && c.id === id) || null;
}

export function getAvailableCondos() {
  return cachedCondos.slice();
}

export async function refreshAvailableCondos() {
  try {
    const { auth, db } = await initFirebase();
    if (!auth || !auth.currentUser) {
      cachedUser = null;
      cachedCondos = [];
      setOnboardingVisible(false);
      closeSelector();
      dispatchContextEvent({ reason: 'signed_out' });
      return getAvailableCondos();
    }

    cachedUser = auth.currentUser;
    cachedCondos = await listAccessibleCondos(db);

    // garante que o contexto salvo ainda é válido
    ensureValidActiveContext();

    if (isPostLoginPage()) {
      renderSelectorButton();
      updateSelectorButtonLabel();
    }

    dispatchContextEvent({ reason: 'condos_refreshed' });
    return getAvailableCondos();
  } catch (e) {
    // evita quebrar páginas por falhas de rede/permissão
    return getAvailableCondos();
  }
}

export function getActiveContext() {
  return {
    condoId: safeGetLS(LS_ACTIVE_CONDO),
    orgId: safeGetLS(LS_ACTIVE_ORG),
  };
}

function setActiveContextSync(condoId, orgId) {
  const cId = cleanString(condoId);
  const oId = cleanString(orgId);

  safeSetLS(LS_ACTIVE_CONDO, cId);
  safeSetLS(LS_ACTIVE_ORG, oId);

  return { condoId: cId, orgId: oId };
}

export async function setActiveContext(condoId) {
  const cId = cleanString(condoId);
  if (!cId) {
    setActiveContextSync('', '');
    dispatchContextEvent();
    return getActiveContext();
  }

  const condo = findCondoById(cId);
  const orgId = condo && condo.orgId ? cleanString(condo.orgId) : '';
  setActiveContextSync(cId, orgId);
  dispatchContextEvent();
  return getActiveContext();
}

function ensureValidActiveContext() {
  const ctx = getActiveContext();
  const has = !!findCondoById(ctx.condoId);
  if (has) {
    // garante orgId consistente com o condo atual
    const condo = findCondoById(ctx.condoId);
    const orgId = condo && condo.orgId ? cleanString(condo.orgId) : '';
    if (orgId && orgId !== ctx.orgId) setActiveContextSync(ctx.condoId, orgId);
    return getActiveContext();
  }

  // contexto salvo não é mais válido
  safeRemoveLS(LS_ACTIVE_CONDO);
  safeRemoveLS(LS_ACTIVE_ORG);
  return { condoId: '', orgId: '' };
}

function dispatchContextEvent(extra) {
  try {
    const detail = {
      user: cachedUser,
      context: getActiveContext(),
      condos: getAvailableCondos(),
      ...(extra && typeof extra === 'object' ? extra : {}),
    };
    window.dispatchEvent(new CustomEvent('vh:context', { detail }));
  } catch (e) {}
}

function ensureGlobalStyles() {
  if (document.getElementById('vh_ctx_style')) return;

  const style = document.createElement('style');
  style.id = 'vh_ctx_style';
  style.textContent =
    '.vhCtxBtn{height:40px;padding:0 12px;border-radius:14px;border:1px solid var(--border);background:var(--surface);' +
    'color:var(--text);font-weight:800;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;}' +
    '.vhCtxBtn:active{transform:scale(0.98);}' +
    '.vhCtxBtn__sub{font-weight:700;color:var(--text-2);}' +
    '.vhCtxOverlay{position:fixed;inset:0;z-index:9997;display:none;align-items:flex-end;justify-content:center;' +
    'background:rgba(0,0,0,0.35);padding:18px;}' +
    '.vhCtxSheet{width:100%;max-width:430px;background:var(--surface);border:1px solid var(--border);border-radius:22px;' +
    'box-shadow:var(--shadow-soft);padding:14px;}' +
    '.vhCtxSheet__title{margin:0 0 8px;font-size:14px;font-weight:900;color:var(--text);}' +
    '.vhCtxSheet__sub{margin:0 0 12px;font-size:12px;color:var(--muted);}' +
    '.vhCtxList{display:grid;gap:8px;max-height:52vh;overflow:auto;padding-right:4px;}' +
    '.vhCtxItem{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;border:1px solid var(--border);' +
    'background:var(--bg);border-radius:16px;cursor:pointer;}' +
    '.vhCtxItem:active{transform:scale(0.99);}' +
    '.vhCtxItem__name{font-weight:900;color:var(--text);font-size:13px;}' +
    '.vhCtxItem__meta{font-size:12px;color:var(--muted);}' +
    '.vhCtxItem__badge{font-size:11px;font-weight:900;color:var(--brand-b);}' +
    '.vhCtxSheet__actions{display:flex;gap:10px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;}' +
    '.vhCtxOnboarding{position:fixed;inset:0;z-index:9996;display:none;align-items:center;justify-content:center;padding:18px;' +
    'background:rgba(0,0,0,0.35);}' +
    '.vhCtxOnboarding__card{width:100%;max-width:430px;}' +
    '.vhCtxOnboarding__card .card{padding:16px;}' +
    '.vhCtxOnboarding__title{margin:0 0 8px;font-size:16px;font-weight:950;letter-spacing:-0.2px;}' +
    '.vhCtxOnboarding__sub{margin:0 0 14px;font-size:12px;color:var(--muted);}' +
    '.vhCtxOnboarding__actions{display:flex;gap:10px;flex-wrap:wrap;}' +
    '.vhCtxLinkBtn{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;border-radius:14px;' +
    'background:var(--surface-2);color:var(--text);font-weight:900;border:1px solid var(--border-2);text-decoration:none;}' +
    '.vhCtxLinkBtn--primary{background:var(--brand);color:#fff;border:none;}'
  ;

  document.head.appendChild(style);
}

function ensureModal() {
  ensureGlobalStyles();

  if (modalEl) return modalEl;

  const overlay = document.createElement('div');
  overlay.className = 'vhCtxOverlay';
  overlay.id = 'vh_ctx_overlay';
  overlay.innerHTML =
    '<div class="vhCtxSheet" role="dialog" aria-modal="true" aria-label="Selecionar condomínio">' +
    '  <h2 class="vhCtxSheet__title">Condomínio ativo</h2>' +
    '  <p class="vhCtxSheet__sub">Escolha o condomínio para navegar e consultar dados.</p>' +
    '  <div class="vhCtxList" id="vh_ctx_list"></div>' +
    '  <div class="vhCtxSheet__actions">' +
    '    <button type="button" class="btn btn--ghost" id="vh_ctx_close">Fechar</button>' +
    '  </div>' +
    '</div>';

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeSelector();
  });

  const mount = () => {
    if (modalEl) return;
    document.body.appendChild(overlay);
    modalEl = overlay;

    const closeBtn = overlay.querySelector('#vh_ctx_close');
    if (closeBtn) closeBtn.addEventListener('click', closeSelector);
  };

  if (document.body) mount();
  else window.addEventListener('DOMContentLoaded', mount, { once: true });

  return overlay;
}

function ensureOnboarding() {
  ensureGlobalStyles();

  if (document.getElementById('vh_ctx_onboarding')) return;

  const el = document.createElement('div');
  el.className = 'vhCtxOnboarding';
  el.id = 'vh_ctx_onboarding';
  el.innerHTML =
    '<div class="vhCtxOnboarding__card">' +
    '  <div class="card">' +
    '    <div class="vhCtxOnboarding__title">Você ainda não tem condomínio vinculado</div>' +
    '    <div class="vhCtxOnboarding__sub">Para continuar, solicite acesso ao seu condomínio ou, se você for gestor/admin, crie um novo condomínio.</div>' +
    '    <div class="vhCtxOnboarding__actions">' +
    '      <a class="vhCtxLinkBtn vhCtxLinkBtn--primary" href="/perfil.html#solicitar-acesso">Solicitar acesso</a>' +
    '      <a class="vhCtxLinkBtn" id="vh_ctx_create_condo" href="/admin/dashboard.html">Criar condomínio</a>' +
    '    </div>' +
    '  </div>' +
    '</div>';

  const mount = () => {
    document.body.appendChild(el);
  };

  if (document.body) mount();
  else window.addEventListener('DOMContentLoaded', mount, { once: true });
}

function setOnboardingVisible(isVisible, opts) {
  ensureOnboarding();
  const el = document.getElementById('vh_ctx_onboarding');
  if (!el) return;

  const v = !!isVisible;
  el.style.display = v ? 'flex' : 'none';

  // Exibe/oculta CTA de criar condomínio com base no role compat do usuário.
  try {
    const createBtn = el.querySelector('#vh_ctx_create_condo');
    if (!createBtn) return;

    const role = opts && opts.userRole ? String(opts.userRole) : '';
    const allowCreate = ['ADMIN', 'GESTOR', 'CARTEIRA', 'ADMINISTRADORA', 'GESTOR_CARTEIRA'].includes(role);
    createBtn.style.display = allowCreate ? 'inline-flex' : 'none';
  } catch (e) {}
}

function renderSelectorButton() {
  ensureGlobalStyles();

  const anchors = Array.from(document.querySelectorAll('[data-vh-context-anchor]'));
  if (anchors.length === 0) {
    // fallback: tenta ações do app-shell ou topbar legacy
    const shellActions = document.querySelector('.vhTopBar__actions');
    if (shellActions) anchors.push(shellActions);
    const legacyRight = document.querySelector('.topbar__right');
    if (legacyRight) anchors.push(legacyRight);
  }

  const ctx = getActiveContext();
  const condo = findCondoById(ctx.condoId);
  const label = condo ? cleanString(condo.name) : (ctx.condoId ? ctx.condoId : 'Selecionar');

  anchors.forEach((a) => {
    try {
      if (!a) return;

      // Evita duplicar
      if (a.querySelector && a.querySelector('[data-vh-context-btn]')) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vhCtxBtn';
      btn.setAttribute('data-vh-context-btn', '1');
      btn.innerHTML = '<span>Condomínio</span><span class="vhCtxBtn__sub">' + label + '</span>';
      btn.addEventListener('click', () => openSelector());

      a.prepend(btn);
    } catch (e) {}
  });
}

function updateSelectorButtonLabel() {
  const ctx = getActiveContext();
  const condo = findCondoById(ctx.condoId);
  const label = condo ? cleanString(condo.name) : (ctx.condoId ? ctx.condoId : 'Selecionar');

  document.querySelectorAll('[data-vh-context-btn]').forEach((btn) => {
    try {
      const sub = btn.querySelector('.vhCtxBtn__sub');
      if (sub) sub.textContent = label;
    } catch (e) {}
  });
}

function renderModalList() {
  const overlay = ensureModal();
  const list = overlay.querySelector('#vh_ctx_list');
  if (!list) return;

  const ctx = getActiveContext();
  const items = getAvailableCondos();

  if (!items.length) {
    list.innerHTML = '<div class="muted" style="font-size:12px;">Nenhum condomínio disponível.</div>';
    return;
  }

  list.innerHTML = '';
  items.forEach((c) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'vhCtxItem';
    const active = ctx.condoId && c.id === ctx.condoId;

    const name = cleanString(c.name) || c.id;
    const meta = [c.orgId ? ('Org: ' + cleanString(c.orgId)) : null, c.status ? ('Status: ' + cleanString(c.status)) : null]
      .filter(Boolean)
      .join(' • ');

    row.innerHTML =
      '<div>' +
      '  <div class="vhCtxItem__name">' + name + '</div>' +
      '  <div class="vhCtxItem__meta">' + meta + '</div>' +
      '</div>' +
      '<div class="vhCtxItem__badge">' + (active ? 'ATIVO' : '') + '</div>';

    row.addEventListener('click', async () => {
      try {
        await setActiveContext(c.id);
        toast('Condomínio ativo atualizado.', { type: 'success' });
        closeSelector();
      } catch (e) {
        showError(e, 'Não foi possível trocar o condomínio.');
      }
    });

    list.appendChild(row);
  });
}

export function openSelector() {
  renderModalList();
  const overlay = ensureModal();
  overlay.style.display = 'flex';
}

export function closeSelector() {
  const overlay = document.getElementById('vh_ctx_overlay');
  if (overlay) overlay.style.display = 'none';
}

async function bootstrapAuthAndContext() {
  if (bootstrapped) return;
  bootstrapped = true;

  // API global opcional (útil para páginas sem import)
  try {
    window.VHActiveContext = {
      getActiveContext,
      setActiveContext,
      openSelector,
      closeSelector,
      getAvailableCondos,
      refreshAvailableCondos,
    };
  } catch (e) {}

  if (!isPostLoginPage()) return;

  try {
    const { auth, db } = await initFirebase();

    onAuthStateChanged(auth, async (user) => {
      cachedUser = user || null;

      if (!user) {
        cachedCondos = [];
        setOnboardingVisible(false);
        closeSelector();
        dispatchContextEvent({ reason: 'signed_out' });
        return;
      }

      setLoading(true, 'Carregando seus condomínios…');

      try {
        cachedCondos = await listAccessibleCondos(db);

        // 0 condomínios acessíveis
        if (!cachedCondos.length) {
          const userRole = await getUserRole(user.uid);
          setActiveContextSync('', '');
          renderSelectorButton();
          updateSelectorButtonLabel();
          setOnboardingVisible(true, { userRole });
          dispatchContextEvent({ reason: 'no_memberships' });
          return;
        }

        setOnboardingVisible(false);

        // valida contexto salvo
        let ctx = ensureValidActiveContext();

        // 1 condomínio: auto-seleciona
        if (cachedCondos.length === 1) {
          const only = cachedCondos[0];
          if (!ctx.condoId || ctx.condoId !== only.id) {
            setActiveContextSync(only.id, only.orgId || '');
          }
          ctx = getActiveContext();
        }

        // >1 condomínios: se não tem ativo válido, pede escolha
        if (cachedCondos.length > 1) {
          ctx = ensureValidActiveContext();
          if (!ctx.condoId) {
            renderSelectorButton();
            updateSelectorButtonLabel();
            openSelector();
            dispatchContextEvent({ reason: 'needs_choice' });
            return;
          }
        }

        renderSelectorButton();
        updateSelectorButtonLabel();
        dispatchContextEvent({ reason: 'ready' });
      } catch (e) {
        showError(e, 'Falha ao carregar seu contexto.');
      } finally {
        setLoading(false);
      }
    });
  } catch (e) {
    // Não quebra páginas públicas/offline
  }
}

export function watchAuthAndContext(callback, opts) {
  opts = opts || {};

  // garante bootstrap (inclui UI)
  bootstrapAuthAndContext();

  const handler = typeof callback === 'function' ? callback : null;

  const listener = (ev) => {
    try {
      if (!handler) return;
      const detail = ev && ev.detail ? ev.detail : {};
      handler(detail);
    } catch (e) {}
  };

  window.addEventListener('vh:context', listener);

  // dispara uma vez com o que já temos (melhor UX)
  try {
    handler && handler({ user: cachedUser, context: getActiveContext(), condos: getAvailableCondos(), reason: 'init' });
  } catch (e) {}

  return () => {
    window.removeEventListener('vh:context', listener);
  };
}

// auto-bootstrap (caso a página apenas importe core-init)
bootstrapAuthAndContext();
