// Viva Haven — Auth Guard (multi-page)
// Mantém compatibilidade com /js/route-guard.js (protect)

import { initFirebase } from './firebase.js';
import { setLoading, showError } from './ui.js';
import { getUserRole, getMembershipForCondo, getMembershipForOrg, normalizeMembershipRoleUpper } from './rbac.js';

import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

function normalizePath(value) {
  return String(value || '').trim();
}

function normalizeRole(value) {
  return String(value || '').trim().toUpperCase();
}

function isDemoModeEnabled() {
  try {
    const host = String(window.location && window.location.hostname ? window.location.hostname : '').toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (!isLocal) return false;
    return localStorage.getItem('vh_demo_mode') === '1';
  } catch (e) {
    return false;
  }
}

function getDemoSession() {
  try {
    if (!isDemoModeEnabled()) return null;
    if (!window.AuthMock || typeof window.AuthMock.getSession !== 'function') return null;
    const s = window.AuthMock.getSession();
    if (!s || typeof s !== 'object') return null;
    if (!s.role) return null;
    s.role = normalizeRole(s.role);
    return s;
  } catch (e) {
    return null;
  }
}

function currentPathname() {
  try {
    return new URL(window.location.href).pathname || '/';
  } catch (e) {
    return window.location.pathname || '/';
  }
}

function safeGetLS(key) {
  try {
    return String(localStorage.getItem(key) || '').trim();
  } catch (e) {
    return '';
  }
}

async function resolveRoleForGuard(user) {
  // Preferência: role vinda de memberships (alinhado com rules).
  // Fallback: users/{uid}.role (compat/legado).
  try {
    const uid = user && user.uid ? String(user.uid) : '';
    if (!uid) return '';

    const activeCondoId = safeGetLS('vh_active_condo');
    if (activeCondoId) {
      const m = await getMembershipForCondo(uid, activeCondoId);
      if (m && m.role) return normalizeMembershipRoleUpper(m.role);
    }

    const activeOrgId = safeGetLS('vh_active_org');
    if (activeOrgId) {
      const m = await getMembershipForOrg(uid, activeOrgId);
      if (m && m.role) return normalizeMembershipRoleUpper(m.role);
    }
  } catch (e) {
    // ignora e cai no fallback
  }

  try {
    const role = await getUserRole(user.uid);
    return normalizeRole(role);
  } catch (e) {
    return '';
  }
}

function isProtectedPath(pathname, paths) {
  if (!Array.isArray(paths) || paths.length === 0) return true;

  for (let i = 0; i < paths.length; i++) {
    const p = normalizePath(paths[i]);
    if (!p) continue;

    if (p.slice(-5).toLowerCase() === '.html') {
      if (pathname.toLowerCase().endsWith(p.toLowerCase())) return true;
    } else {
      if (pathname.toLowerCase().includes(p.toLowerCase())) return true;
    }
  }

  return false;
}

export function redirectToLogin() {
  try {
    if (window.location.pathname.toLowerCase().endsWith('/login.html')) return;
    window.location.href = '/login.html';
  } catch (e) {
    window.location.href = '/login.html';
  }
}

async function waitForUser(auth) {
  if (auth.currentUser) return auth.currentUser;
  return await new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      try {
        unsub();
      } catch (e) {}
      resolve(user || null);
    });
  });
}

/**
 * protect(paths, rolesAllowed)
 * - paths: array de prefixos/arquivos; se vazio, protege sempre
 * - rolesAllowed: array de roles (users/{uid}.role) em UPPERCASE
 */
export async function protect(paths, rolesAllowed, opts) {
  opts = opts || {};
  const pathname = currentPathname();
  if (!isProtectedPath(pathname, paths)) return { ok: true, skipped: true };

  const showLoading = opts.loading !== false;
  if (showLoading) setLoading(true, 'Verificando sessão…');

  try {
    // DEMO: não usa Firebase, apenas AuthMock (somente quando explicitamente habilitado)
    const demoSession = getDemoSession();
    if (demoSession) {
      if (Array.isArray(rolesAllowed) && rolesAllowed.length > 0) {
        const allowed = rolesAllowed.map(normalizeRole).includes(demoSession.role);
        if (!allowed) {
          redirectToLogin();
          return { ok: false, reason: 'demo_role_not_allowed', role: demoSession.role, demo: true };
        }
        return { ok: true, role: demoSession.role, demo: true };
      }
      return { ok: true, role: demoSession.role, demo: true };
    }

    const { auth } = await initFirebase();
    const user = await waitForUser(auth);
    if (!user) {
      redirectToLogin();
      return { ok: false, reason: 'not_logged_in' };
    }

    if (Array.isArray(rolesAllowed) && rolesAllowed.length > 0) {
      const role = await resolveRoleForGuard(user);
      if (!role) {
        redirectToLogin();
        return { ok: false, reason: 'missing_role' };
      }

      const allowed = rolesAllowed.map(normalizeRole).includes(normalizeRole(role));
      if (!allowed) {
        redirectToLogin();
        return { ok: false, reason: 'role_not_allowed', role };
      }

      return { ok: true, role };
    }

    return { ok: true };
  } catch (e) {
    // MVP: evita página "branca" em caso de erro de guard
    showError(e, 'Falha ao validar sua sessão.');
    throw e;
  } finally {
    if (showLoading) setLoading(false);
  }
}
