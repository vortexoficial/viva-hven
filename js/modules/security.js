// Viva Haven — Módulo de Segurança e Ocorrências (MVP)
// Firestore:
// - condos/{condoId}/occurrences/{id}
// - condos/{condoId}/visitors/{id}
// - condos/{condoId}/providers/{id}
// - condos/{condoId}/accessEvents/{id}

import { initFirebase } from '../firebase-init.js';

import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

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

async function requireAuth() {
  const { auth, db } = await initFirebase();
  const user = await waitForUser(auth);
  if (!user) throw new Error('Você precisa estar logado.');
  return { auth, db, user };
}

function cleanString(value) {
  return String(value || '').trim();
}

function cleanNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDateOnly(value) {
  const v = cleanString(value);
  if (!v) return null;
  const dt = new Date(v + 'T00:00:00');
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

async function writeAuditLog(db, payload) {
  payload = payload || {};

  const orgId = cleanString(payload.orgId);
  if (!orgId) throw new Error('orgId é obrigatório para auditLogs.');

  const docData = {
    orgId,
    condoId: payload.condoId ? cleanString(payload.condoId) : null,
    actorUid: cleanString(payload.actorUid),
    action: cleanString(payload.action),
    targetPath: cleanString(payload.targetPath),
    createdAt: serverTimestamp(),
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };

  await addDoc(collection(db, 'auditLogs'), docData);
}

async function getOrgIdForCondo(db, condoId) {
  const cId = cleanString(condoId);
  if (!cId) return null;
  const snap = await getDoc(doc(db, 'condos', cId));
  if (!snap.exists()) return null;
  const data = snap.data() || {};
  return data.orgId ? cleanString(data.orgId) : null;
}

function normalizeSeverity(value) {
  const v = cleanString(value).toLowerCase();
  if (['baixa', 'media', 'alta', 'urgente'].includes(v)) return v;
  if (['low', 'medium', 'high', 'urgent'].includes(v)) {
    if (v === 'low') return 'baixa';
    if (v === 'medium') return 'media';
    if (v === 'high') return 'alta';
    if (v === 'urgent') return 'urgente';
  }
  return 'media';
}

function normalizeOccurrenceStatus(value) {
  const v = cleanString(value).toLowerCase();
  if (['aberto', 'em_andamento', 'resolvido', 'fechado'].includes(v)) return v;
  if (['open', 'in_progress', 'resolved', 'closed'].includes(v)) {
    if (v === 'open') return 'aberto';
    if (v === 'in_progress') return 'em_andamento';
    if (v === 'resolved') return 'resolvido';
    if (v === 'closed') return 'fechado';
  }
  return 'aberto';
}

function normalizeVisitorStatus(value) {
  const v = cleanString(value).toLowerCase();
  if (['ativo', 'usado', 'cancelado', 'expirado'].includes(v)) return v;
  return 'ativo';
}

// ===== Occurrences =====
export async function listOccurrences(condoId, opts) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const mineOnly = !!opts.mineOnly;
  const status = cleanString(opts.status);

  let qRef = collection(db, 'condos', cId, 'occurrences');
  const filters = [];
  if (mineOnly) filters.push(where('createdBy', '==', user.uid));
  if (status) filters.push(where('status', '==', normalizeOccurrenceStatus(status)));

  const qs = filters.length ? await getDocs(query(qRef, ...filters)) : await getDocs(qRef);
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  items.sort((a, b) => {
    const au = a.updatedAt && typeof a.updatedAt.toDate === 'function' ? a.updatedAt.toDate().getTime() : 0;
    const bu = b.updatedAt && typeof b.updatedAt.toDate === 'function' ? b.updatedAt.toDate().getTime() : 0;
    return bu - au;
  });

  return items;
}

export async function createOccurrence(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const title = cleanString(data.title);
  const description = cleanString(data.description);
  if (!title) throw new Error('Título é obrigatório.');
  if (!description) throw new Error('Descrição é obrigatória.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    orgId,
    condoId: cId,
    title,
    description,
    category: cleanString(data.category) || 'geral',
    location: cleanString(data.location) || null,
    severity: normalizeSeverity(data.severity),
    status: 'aberto',
    assignedTo: cleanString(data.assignedTo) || null,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'occurrences'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'occurrence.create',
    targetPath: `condos/${cId}/occurrences/${ref.id}`,
    metadata: { category: docData.category, severity: docData.severity },
  });

  return { id: ref.id, ...docData };
}

export async function updateOccurrence(condoId, occurrenceId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const oId = cleanString(occurrenceId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!oId) throw new Error('occurrenceId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'description')) patch.description = cleanString(data.description);
  if (Object.prototype.hasOwnProperty.call(data, 'category')) patch.category = cleanString(data.category) || 'geral';
  if (Object.prototype.hasOwnProperty.call(data, 'location')) patch.location = cleanString(data.location) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'severity')) patch.severity = normalizeSeverity(data.severity);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizeOccurrenceStatus(data.status);
  if (Object.prototype.hasOwnProperty.call(data, 'assignedTo')) patch.assignedTo = cleanString(data.assignedTo) || null;

  await updateDoc(doc(db, 'condos', cId, 'occurrences', oId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'occurrence.update',
    targetPath: `condos/${cId}/occurrences/${oId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteOccurrence(condoId, occurrenceId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const oId = cleanString(occurrenceId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!oId) throw new Error('occurrenceId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'occurrences', oId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'occurrence.delete',
    targetPath: `condos/${cId}/occurrences/${oId}`,
    metadata: {},
  });
}

// ===== Visitors =====
export async function listVisitors(condoId, opts) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const mineOnly = !!opts.mineOnly;
  const status = cleanString(opts.status);

  let qRef = collection(db, 'condos', cId, 'visitors');
  const filters = [];
  if (mineOnly) filters.push(where('createdBy', '==', user.uid));
  if (status) filters.push(where('status', '==', normalizeVisitorStatus(status)));

  const qs = filters.length ? await getDocs(query(qRef, ...filters)) : await getDocs(qRef);
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  items.sort((a, b) => {
    const af = a.validFrom && typeof a.validFrom.toDate === 'function' ? a.validFrom.toDate().getTime() : 0;
    const bf = b.validFrom && typeof b.validFrom.toDate === 'function' ? b.validFrom.toDate().getTime() : 0;
    return bf - af;
  });

  return items;
}

export async function createVisitor(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const name = cleanString(data.name);
  if (!name) throw new Error('Nome do visitante é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const validFrom = toDateOnly(data.validFrom);
  const validTo = toDateOnly(data.validTo);

  const docData = {
    orgId,
    condoId: cId,
    name,
    document: cleanString(data.document) || null,
    phone: cleanString(data.phone) || null,
    unitLabel: cleanString(data.unitLabel) || null,
    note: cleanString(data.note) || null,
    validFrom,
    validTo,
    status: normalizeVisitorStatus(data.status || 'ativo'),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'visitors'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'visitor.create',
    targetPath: `condos/${cId}/visitors/${ref.id}`,
    metadata: { status: docData.status },
  });

  return { id: ref.id, ...docData };
}

export async function updateVisitor(condoId, visitorId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const vId = cleanString(visitorId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!vId) throw new Error('visitorId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'name')) patch.name = cleanString(data.name);
  if (Object.prototype.hasOwnProperty.call(data, 'document')) patch.document = cleanString(data.document) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'phone')) patch.phone = cleanString(data.phone) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'unitLabel')) patch.unitLabel = cleanString(data.unitLabel) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'note')) patch.note = cleanString(data.note) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'validFrom')) patch.validFrom = toDateOnly(data.validFrom);
  if (Object.prototype.hasOwnProperty.call(data, 'validTo')) patch.validTo = toDateOnly(data.validTo);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizeVisitorStatus(data.status);

  await updateDoc(doc(db, 'condos', cId, 'visitors', vId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'visitor.update',
    targetPath: `condos/${cId}/visitors/${vId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteVisitor(condoId, visitorId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const vId = cleanString(visitorId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!vId) throw new Error('visitorId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'visitors', vId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'visitor.delete',
    targetPath: `condos/${cId}/visitors/${vId}`,
    metadata: {},
  });
}

// ===== Providers =====
export async function listProviders(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'providers'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => cleanString(a.name).localeCompare(cleanString(b.name)));
  return items;
}

export async function createProvider(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const name = cleanString(data.name);
  if (!name) throw new Error('Nome do prestador é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    orgId,
    condoId: cId,
    name,
    serviceType: cleanString(data.serviceType) || 'geral',
    company: cleanString(data.company) || null,
    document: cleanString(data.document) || null,
    phone: cleanString(data.phone) || null,
    status: cleanString(data.status) || 'ativo',
    notes: cleanString(data.notes) || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'providers'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'provider.create',
    targetPath: `condos/${cId}/providers/${ref.id}`,
    metadata: { serviceType: docData.serviceType },
  });

  return { id: ref.id, ...docData };
}

export async function updateProvider(condoId, providerId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(providerId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('providerId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'name')) patch.name = cleanString(data.name);
  if (Object.prototype.hasOwnProperty.call(data, 'serviceType')) patch.serviceType = cleanString(data.serviceType) || 'geral';
  if (Object.prototype.hasOwnProperty.call(data, 'company')) patch.company = cleanString(data.company) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'document')) patch.document = cleanString(data.document) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'phone')) patch.phone = cleanString(data.phone) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = cleanString(data.status) || 'ativo';
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes) || null;

  await updateDoc(doc(db, 'condos', cId, 'providers', pId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'provider.update',
    targetPath: `condos/${cId}/providers/${pId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteProvider(condoId, providerId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(providerId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('providerId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'providers', pId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'provider.delete',
    targetPath: `condos/${cId}/providers/${pId}`,
    metadata: {},
  });
}

// ===== Access events =====
export async function listAccessEvents(condoId, opts) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const type = cleanString(opts.type);

  let qRef = collection(db, 'condos', cId, 'accessEvents');
  const filters = [];
  if (type) filters.push(where('type', '==', type));

  const qs = filters.length ? await getDocs(query(qRef, ...filters)) : await getDocs(qRef);
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  items.sort((a, b) => {
    const at = a.at && typeof a.at.toDate === 'function' ? a.at.toDate().getTime() : 0;
    const bt = b.at && typeof b.at.toDate === 'function' ? b.at.toDate().getTime() : 0;
    return bt - at;
  });

  return items;
}

export async function createAccessEvent(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const type = cleanString(data.type);
  if (!type) throw new Error('Tipo do evento é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const at = data.at ? toDateOnly(data.at) : null;

  const docData = {
    orgId,
    condoId: cId,
    type,
    refKind: cleanString(data.refKind) || null,
    refId: cleanString(data.refId) || null,
    personName: cleanString(data.personName) || null,
    document: cleanString(data.document) || null,
    note: cleanString(data.note) || null,
    at: at || new Date(),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'accessEvents'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'accessEvent.create',
    targetPath: `condos/${cId}/accessEvents/${ref.id}`,
    metadata: { type, refKind: docData.refKind },
  });

  return { id: ref.id, ...docData };
}

export async function deleteAccessEvent(condoId, accessEventId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const eId = cleanString(accessEventId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!eId) throw new Error('accessEventId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'accessEvents', eId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'accessEvent.delete',
    targetPath: `condos/${cId}/accessEvents/${eId}`,
    metadata: {},
  });
}

export const SecurityTypes = {
  normalizeSeverity,
  normalizeOccurrenceStatus,
  normalizeVisitorStatus,
  toDateOnly,
  cleanNumber,
};
