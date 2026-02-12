// Viva Haven — Admin Access (requireRole/requirePermission)
// Client-side guard adicional (UX). Segurança real fica nas Firestore Rules.

import { protect } from './route-guard.js';
import { logoutUser } from './auth.js';
import { initFirebase } from './firebase.js';
import { showError, setLoading, toast } from './ui.js';
import { watchAuthAndContext, getActiveContext, openSelector } from './active-context.js';
import { getMembershipForCondo, getMembershipForOrg, normalizeMembershipRoleUpper } from './rbac.js';

function cleanString(v) {
  return String(v || '').trim();
}

function normalizeRoleLower(v) {
  return cleanString(v).toLowerCase();
}

function uniq(list) {
  const out = [];
  const seen = new Set();
  (list || []).forEach((x) => {
    const v = cleanString(x);
    if (!v) return;
    if (seen.has(v)) return;
    seen.add(v);
    out.push(v);
  });
  return out;
}

function rolePermsCondo(roleLower) {
  // espelhar o baseline das rules (dot-notation)
  if (roleLower === 'morador') {
    return ['condo.read', 'comms.read', 'assemblies.read', 'tickets.create', 'tickets.read', 'reservations.create', 'reservations.read'];
  }
  if (roleLower === 'porteiro') {
    return ['condo.read', 'security.read', 'security.write', 'occurrences.manage'];
  }
  if (roleLower === 'conselho') {
    return ['condo.read', 'finance.read', 'governance.read', 'assemblies.read', 'docs.read', 'audit.read'];
  }
  if (roleLower === 'subsindico') {
    return ['condo.read', 'maintenance.manage', 'tickets.manage', 'comms.manage', 'assemblies.read'];
  }
  if (roleLower === 'sindico') {
    return [
      'condo.read',
      'condo.manage',
      'people.manage',
      'finance.read',
      'finance.write',
      'maintenance.manage',
      'tickets.manage',
      'comms.manage',
      'assemblies.manage',
      'security.manage',
      'docs.manage',
      'audit.read',
    ];
  }
  if (roleLower === 'gestor') {
    return [
      'condo.read',
      'condo.manage',
      'people.manage',
      'maintenance.manage',
      'tickets.manage',
      'comms.manage',
      'assemblies.manage',
      'security.manage',
      'docs.manage',
      'finance.read',
      'audit.read',
    ];
  }
  if (roleLower === 'admin') return ['*'];
  return [];
}

function rolePermsOrg(roleLower) {
  if (roleLower === 'administradora') {
    return ['portfolio.view', 'portfolio.manage', 'people.manage', 'finance.manage', 'docs.manage', 'audit.read', 'condo.manage'];
  }
  if (roleLower === 'gestor_carteira') {
    return ['portfolio.view', 'portfolio.manage', 'finance.manage', 'audit.read', 'condo.manage'];
  }
  // compat legado
  if (roleLower === 'carteira') {
    return ['portfolio.view', 'finance.manage', 'audit.read', 'condo.manage'];
  }
  if (roleLower === 'admin') return ['*'];
  return [];
}

function permsFromMembership(m) {
  if (!m || typeof m !== 'object') return [];
  const roleLower = normalizeRoleLower(m.role);
  const explicit = Array.isArray(m.permissions) ? m.permissions : [];

  const base = m.scope === 'org' ? rolePermsOrg(roleLower) : rolePermsCondo(roleLower);
  return uniq([...(base || []), ...(explicit || [])]);
}

function hasAnyPerm(perms, wanted) {
  const p = Array.isArray(perms) ? perms : [];
  if (p.includes('*')) return true;
  const w = Array.isArray(wanted) ? wanted : [];
  return w.some((x) => p.includes(cleanString(x)));
}

function isDemo() {
  try {
    const host = String(window.location.hostname || '').toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (!isLocal) return false;
    return localStorage.getItem('vh_demo_mode') === '1' && window.AuthMock && window.AuthMock.getSession();
  } catch (e) {
    return false;
  }
}

function bindLogout(logoutBtnId) {
  const btn = logoutBtnId ? document.getElementById(logoutBtnId) : null;
  if (!btn) return;

  btn.addEventListener('click', async () => {
    try {
      btn.disabled = true;
      if (isDemo()) {
        try {
          window.AuthMock.logout();
        } catch (e) {}
        try {
          localStorage.removeItem('vh_demo_mode');
        } catch (e) {}
      } else {
        await logoutUser();
      }
    } finally {
      window.location.href = '/login.html';
    }
  });
}

function setUserBadge(userBadgeId, text) {
  const el = userBadgeId ? document.getElementById(userBadgeId) : null;
  if (el) el.textContent = cleanString(text);
}

async function waitForAuthAndContext(opts) {
  opts = opts || {};

  // `active-context` já é auto-bootstrapped por core-init; aqui só esperamos evento.
  const condoRequired = opts.condoRequired !== false;

  return await new Promise((resolve) => {
    let resolved = false;

    const stop = watchAuthAndContext((detail) => {
      try {
        if (resolved) return;

        const user = detail && detail.user ? detail.user : null;
        const ctx = detail && detail.context ? detail.context : getActiveContext();

        if (!user) {
          resolved = true;
          stop();
          resolve({ user: null, context: ctx, reason: 'signed_out' });
          return;
        }

        if (!condoRequired) {
          resolved = true;
          stop();
          resolve({ user, context: ctx, reason: detail && detail.reason ? detail.reason : 'ready' });
          return;
        }

        if (ctx && ctx.condoId) {
          resolved = true;
          stop();
          resolve({ user, context: ctx, reason: detail && detail.reason ? detail.reason : 'ready' });
          return;
        }

        // sem condo ativo: abre seletor, mas continua esperando
        try {
          openSelector();
        } catch (e) {}
      } catch (e) {}
    });
  });
}

/**
 * setupAdminPage({ permsAny, condoRequired, rolesAny, userBadgeId, logoutBtnId })
 * - `permsAny`: lista de permissões (dot) onde basta uma.
 * - `rolesAny`: lista de roles (ex.: ['SINDICO','GESTOR','ADMINISTRADORA']). Checagem UX.
 */
export async function setupAdminPage(opts) {
  opts = opts || {};

  const permsAny = Array.isArray(opts.permsAny) ? opts.permsAny : [];
  const rolesAny = Array.isArray(opts.rolesAny) ? opts.rolesAny : [];
  const condoRequired = opts.condoRequired !== false;

  bindLogout(opts.logoutBtnId || 'logoutBtn');

  // 1) Login (Firebase ou DEMO)
  const guard = await protect(['/admin/']);
  if (!guard || guard.ok !== true) return { ok: false, reason: 'guard_failed' };

  if (isDemo()) {
    const s = window.AuthMock.getSession();
    setUserBadge(opts.userBadgeId || 'userBadge', `DEMO • ${s.role || '—'}`);
    return {
      ok: true,
      demo: true,
      user: { uid: 'demo', email: 'demo@local' },
      context: getActiveContext(),
      condoId: getActiveContext().condoId,
      orgId: getActiveContext().orgId,
      perms: [],
      role: cleanString(s.role || ''),
    };
  }

  // 2) Espera user + contexto (condo ativo)
  setLoading(true, 'Carregando contexto…');
  try {
    const { auth, db } = await initFirebase();
    const ready = await waitForAuthAndContext({ condoRequired });

    if (!ready.user) {
      window.location.href = '/login.html';
      return { ok: false, reason: 'signed_out' };
    }

    const user = ready.user;
    const condoId = ready.context && ready.context.condoId ? cleanString(ready.context.condoId) : '';
    const orgId = ready.context && ready.context.orgId ? cleanString(ready.context.orgId) : '';

    setUserBadge(opts.userBadgeId || 'userBadge', user.email || user.uid);

    // 3) Role/Perms
    let condoMembership = null;
    let orgMembership = null;

    if (condoId) {
      condoMembership = await getMembershipForCondo(user.uid, condoId);
      // se orgId não veio do contexto, tenta derivar do doc do condo
      if (!orgId) {
        try {
          // best-effort: não falha página
          // (o active-context já tenta manter orgId coerente)
        } catch (e) {}
      }
    }

    if (orgId) {
      orgMembership = await getMembershipForOrg(user.uid, orgId);
    }

    const condoPerms = permsFromMembership(condoMembership);
    const orgPerms = permsFromMembership(orgMembership);
    const perms = uniq([...(condoPerms || []), ...(orgPerms || [])]);

    const roleUpper = condoMembership && condoMembership.role
      ? normalizeMembershipRoleUpper(condoMembership.role)
      : (orgMembership && orgMembership.role ? normalizeMembershipRoleUpper(orgMembership.role) : '');

    if (rolesAny.length > 0) {
      const allowed = rolesAny.map((r) => cleanString(r).toUpperCase()).includes(cleanString(roleUpper).toUpperCase());
      if (!allowed) {
        toast('Acesso negado para este perfil.', { type: 'error' });
        window.location.href = '/login.html';
        return { ok: false, reason: 'role_not_allowed', role: roleUpper };
      }
    }

    if (permsAny.length > 0 && !hasAnyPerm(perms, permsAny)) {
      toast('Acesso negado (permissão insuficiente).', { type: 'error' });
      window.location.href = '/login.html';
      return { ok: false, reason: 'missing_permission', role: roleUpper };
    }

    return {
      ok: true,
      demo: false,
      auth,
      db,
      user,
      context: ready.context,
      condoId,
      orgId,
      role: roleUpper,
      perms,
      condoMembership,
      orgMembership,
    };
  } catch (e) {
    showError(e, 'Falha ao preparar a página admin.');
    throw e;
  } finally {
    setLoading(false);
  }
}
