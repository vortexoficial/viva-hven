// Viva Haven — Route Guard (Firebase)
// Protege rotas por login + role via Firestore (/users/{uid}).
// API:
//   - protect(paths, rolesAllowed)

import { initFirebase } from './firebase-init.js';

import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

function normalizePath(value) {
  return String(value || '').trim();
}

function normalizeRole(value) {
  return String(value || '').trim().toUpperCase();
}

function isDemoModeEnabled() {
  try {
    var host = String(window.location && window.location.hostname ? window.location.hostname : '').toLowerCase();
    var isLocal = host === 'localhost' || host === '127.0.0.1';
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
    var s = window.AuthMock.getSession();
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

function isProtectedPath(pathname, paths) {
  if (!Array.isArray(paths) || paths.length === 0) return true;

  for (var i = 0; i < paths.length; i++) {
    var p = normalizePath(paths[i]);
    if (!p) continue;

    if (p.slice(-5).toLowerCase() === '.html') {
      if (pathname.toLowerCase().endsWith(p.toLowerCase())) return true;
    } else {
      if (pathname.toLowerCase().indexOf(p.toLowerCase()) !== -1) return true;
    }
  }

  return false;
}

function redirectToLogin() {
  try {
    if (window.location.pathname.toLowerCase().endsWith('/login.html')) return;
    window.location.href = '/login.html';
  } catch (e) {
    window.location.href = '/login.html';
  }
}

async function getRoleForUid(db, uid) {
  var ref = doc(db, 'users', uid);
  var snap = await getDoc(ref);
  if (!snap.exists()) return null;
  var data = snap.data() || {};
  return data.role ? normalizeRole(data.role) : null;
}

async function waitForUser(auth) {
  return await new Promise(function (resolve) {
    var unsub = onAuthStateChanged(auth, function (user) {
      try {
        unsub();
      } catch (e) {}
      resolve(user || null);
    });
  });
}

export async function protect(paths, rolesAllowed) {
  var pathname = currentPathname();
  if (!isProtectedPath(pathname, paths)) return { ok: true, skipped: true };

  // DEMO: não usa Firebase, apenas AuthMock (somente quando explicitamente habilitado)
  var demoSession = getDemoSession();
  if (demoSession) {
    if (Array.isArray(rolesAllowed) && rolesAllowed.length > 0) {
      var allowed = false;
      for (var i = 0; i < rolesAllowed.length; i++) {
        if (demoSession.role === normalizeRole(rolesAllowed[i])) {
          allowed = true;
          break;
        }
      }

      if (!allowed) {
        redirectToLogin();
        return { ok: false, reason: 'demo_role_not_allowed', role: demoSession.role, demo: true };
      }

      return { ok: true, role: demoSession.role, demo: true };
    }

    return { ok: true, role: demoSession.role, demo: true };
  }

  var firebase = await initFirebase();
  var auth = firebase.auth;
  var db = firebase.db;

  var user = await waitForUser(auth);
  if (!user) {
    redirectToLogin();
    return { ok: false, reason: 'not_logged_in' };
  }

  if (Array.isArray(rolesAllowed) && rolesAllowed.length > 0) {
    var role = await getRoleForUid(db, user.uid);
    if (!role) {
      redirectToLogin();
      return { ok: false, reason: 'missing_role' };
    }

    var allowed = false;
    for (var i = 0; i < rolesAllowed.length; i++) {
      if (role === normalizeRole(rolesAllowed[i])) {
        allowed = true;
        break;
      }
    }

    if (!allowed) {
      redirectToLogin();
      return { ok: false, reason: 'role_not_allowed', role: role };
    }

    return { ok: true, role: role };
  }

  return { ok: true };
}

// Compatibilidade com chamadas antigas (window.RouteGuard.protect)
window.RouteGuard = { protect };
