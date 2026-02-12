// Viva Haven — RBAC helpers (memberships + condo ativo)

import { initFirebase } from './firebase.js';

import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const ACTIVE_CONDO_KEY = 'vh_active_condo';

function cleanString(value) {
  return String(value || '').trim();
}

function normalizeRoleUpper(value) {
  return cleanString(value).toUpperCase();
}

function normalizeRoleLower(value) {
  return cleanString(value).toLowerCase();
}

export function membershipIdForCondo(uid, condoId) {
  return `${cleanString(uid)}_${cleanString(condoId)}`;
}

export function membershipIdForOrg(uid, orgId) {
  return `${cleanString(uid)}_org_${cleanString(orgId)}`;
}

export function getActiveCondoId() {
  try {
    return cleanString(localStorage.getItem(ACTIVE_CONDO_KEY));
  } catch (e) {
    return '';
  }
}

export function setActiveCondoId(condoId) {
  const id = cleanString(condoId);
  try {
    if (!id) localStorage.removeItem(ACTIVE_CONDO_KEY);
    else localStorage.setItem(ACTIVE_CONDO_KEY, id);
  } catch (e) {}
  return id;
}

export async function getUserProfile(uid) {
  const userId = cleanString(uid);
  if (!userId) return null;
  const { db } = await initFirebase();

  const snap = await getDoc(doc(db, 'users', userId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() || {}) };
}

export async function getUserRole(uid) {
  const p = await getUserProfile(uid);
  return p && p.role ? normalizeRoleUpper(p.role) : '';
}

export async function getMembershipForCondo(uid, condoId) {
  const userId = cleanString(uid);
  const cId = cleanString(condoId);
  if (!userId || !cId) return null;

  const { db } = await initFirebase();
  const snap = await getDoc(doc(db, 'memberships', membershipIdForCondo(userId, cId)));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() || {}) };
}

export async function getMembershipForOrg(uid, orgId) {
  const userId = cleanString(uid);
  const oId = cleanString(orgId);
  if (!userId || !oId) return null;

  const { db } = await initFirebase();
  const snap = await getDoc(doc(db, 'memberships', membershipIdForOrg(userId, oId)));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() || {}) };
}

export function normalizeMembershipRoleUpper(role) {
  return normalizeRoleUpper(role);
}

export async function getActiveCondo() {
  const condoId = getActiveCondoId();
  if (!condoId) return null;

  const { db } = await initFirebase();
  const snap = await getDoc(doc(db, 'condos', condoId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() || {}) };
}

export async function getMemberships(uid) {
  // Observação: rules bloqueiam list() em memberships.
  // Então este helper trabalha com a convenção de IDs determinísticos e o condo ativo.
  const userId = cleanString(uid);
  if (!userId) return { condo: null, org: null };

  const condo = await getMembershipForCondo(userId, getActiveCondoId());

  // Se existir condo ativo, tentamos descobrir orgId via condo doc e então buscar org membership.
  let org = null;
  try {
    const activeCondo = await getActiveCondo();
    const orgId = activeCondo && activeCondo.orgId ? cleanString(activeCondo.orgId) : '';
    if (orgId) {
      const { db } = await initFirebase();
      const snap = await getDoc(doc(db, 'memberships', membershipIdForOrg(userId, orgId)));
      if (snap.exists()) org = { id: snap.id, ...(snap.data() || {}) };
    }
  } catch (e) {
    org = null;
  }

  return { condo, org };
}

export async function requireRole(roles, ctx) {
  const allowed = Array.isArray(roles) ? roles.map(normalizeRoleLower) : [];
  if (allowed.length === 0) return true;

  ctx = ctx || {};
  const userId = cleanString(ctx.uid);
  const condoId = cleanString(ctx.condoId || getActiveCondoId());

  if (!userId) throw new Error('Sessão inválida (uid ausente).');
  if (!condoId) throw new Error('Selecione um condomínio.');

  const membership = await getMembershipForCondo(userId, condoId);
  const role = membership && membership.role ? normalizeRoleLower(membership.role) : '';
  const status = membership && membership.status ? cleanString(membership.status) : '';

  if (!role || status !== 'active') throw new Error('Acesso negado.');
  if (!allowed.includes(role)) throw new Error('Acesso negado.');

  return true;
}

const PERMISSIONS_BY_ROLE = {
  morador: ['app:read', 'tickets:create', 'tickets:read', 'reservations:read'],
  gestor: ['app:read', 'tickets:read', 'tickets:write', 'reservations:write', 'finance:read'],
  sindico: ['app:read', 'tickets:read', 'tickets:write', 'reservations:write', 'finance:read', 'finance:write'],
  admin: ['*'],
  carteira: ['finance:read', 'finance:write', 'audit:read'],
  administradora: ['finance:read', 'finance:write', 'audit:read'],
};

export async function requirePermission(perms, ctx) {
  const required = Array.isArray(perms) ? perms.map(cleanString).filter(Boolean) : [];
  if (required.length === 0) return true;

  ctx = ctx || {};
  const userId = cleanString(ctx.uid);
  const condoId = cleanString(ctx.condoId || getActiveCondoId());
  if (!userId) throw new Error('Sessão inválida (uid ausente).');
  if (!condoId) throw new Error('Selecione um condomínio.');

  const membership = await getMembershipForCondo(userId, condoId);
  const role = membership && membership.role ? normalizeRoleLower(membership.role) : '';
  const status = membership && membership.status ? cleanString(membership.status) : '';

  if (!role || status !== 'active') throw new Error('Acesso negado.');

  const allowed = PERMISSIONS_BY_ROLE[role] || [];
  if (allowed.includes('*')) return true;

  for (const p of required) {
    if (!allowed.includes(p)) throw new Error('Acesso negado.');
  }

  return true;
}
