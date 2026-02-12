// Viva Haven — Módulo de Segurança e Ocorrências (MVP)
// Firestore (condo-scoped):
// - condos/{condoId}/occurrences/{id}
// - condos/{condoId}/gatebook/{id}
// - condos/{condoId}/visitors/{id}
// - condos/{condoId}/providers/{id}
// - condos/{condoId}/accessEvents/{id}
// Auditoria (imutável):
// - condos/{condoId}/auditLogs/{logId}
// Evidências: somente URL (sem Storage)

import { initFirebase } from '../firebase-init.js';

import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
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

function toDateTimeMaybe(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const v = cleanString(value);
  if (!v) return null;
  const dt = new Date(v);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function normalizeUrl(value) {
  const v = cleanString(value);
  if (!v) return '';
  try {
    const u = new URL(v);
    return u.href;
  } catch (e) {
    return v;
  }
}

function normalizeUrlList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((x) => normalizeUrl(x)).filter(Boolean).slice(0, 30);
  }
  if (typeof value === 'string') {
    return value
      .split(/\n|\r|;|,/g)
      .map((x) => normalizeUrl(x))
      .filter(Boolean)
      .slice(0, 30);
  }
  return [];
}

function normalizeInvolved(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((x) => (typeof x === 'string' ? { name: cleanString(x) } : x))
      .map((x) => ({ name: cleanString(x && x.name), note: cleanString(x && x.note) || null }))
      .filter((x) => x.name)
      .slice(0, 30);
  }
  if (typeof value === 'string') {
    return value
      .split(/\n|\r|;/g)
      .map((x) => cleanString(x))
      .filter(Boolean)
      .slice(0, 30)
      .map((name) => ({ name, note: null }));
  }
  return [];
}

function normalizeOccurrenceType(value) {
  const v = cleanString(value).toUpperCase();
  if (!v) return 'OCORRENCIA';
  // remove acentos comuns (MVP)
  const plain = v
    .replace(/Á|À|Â|Ã/g, 'A')
    .replace(/É|Ê/g, 'E')
    .replace(/Í/g, 'I')
    .replace(/Ó|Ô|Õ/g, 'O')
    .replace(/Ú/g, 'U')
    .replace(/Ç/g, 'C');
  return plain;
}

async function writeAuditLog(db, payload) {
  payload = payload || {};

  const condoId = cleanString(payload.condoId);
  if (!condoId) throw new Error('condoId é obrigatório para auditLogs.');

  const actorUid = cleanString(payload.actorUid);
  const action = cleanString(payload.action);
  const entityType = cleanString(payload.entityType);
  const entityId = cleanString(payload.entityId);
  if (!actorUid) throw new Error('actorUid é obrigatório para auditLogs.');
  if (!action) throw new Error('action é obrigatório para auditLogs.');
  if (!entityType) throw new Error('entityType é obrigatório para auditLogs.');
  if (!entityId) throw new Error('entityId é obrigatório para auditLogs.');

  const docData = {
    orgId: payload.orgId ? cleanString(payload.orgId) : null,
    condoId,
    actorUid,
    action,
    entityType,
    entityId,
    targetPath: payload.targetPath ? cleanString(payload.targetPath) : null,
    createdAt: serverTimestamp(),
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };

  await addDoc(collection(db, 'condos', condoId, 'auditLogs'), docData);
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
  if (['autorizado', 'chegou', 'saiu', 'cancelado', 'negado', 'expirado'].includes(v)) return v;
  // compat legado
  if (['ativo', 'usado'].includes(v)) return 'autorizado';
  return 'autorizado';
}

function normalizeProviderStatus(value) {
  const v = cleanString(value).toLowerCase();
  if (['ativo', 'inativo'].includes(v)) return v;
  return 'ativo';
}

function normalizeAccessEventType(value) {
  const v = cleanString(value).toLowerCase();
  if (['check_in', 'check_out'].includes(v)) return v;
  if (['entrada', 'saida'].includes(v)) return v === 'entrada' ? 'check_in' : 'check_out';
  return 'check_in';
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

  const qy = query(qRef, ...filters, orderBy('createdAt', 'desc'), limit(opts.limit || 80));
  const qs = await getDocs(qy);
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  return items;
}

export async function createOccurrence(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const type = normalizeOccurrenceType(data.type || data.title);
  const description = cleanString(data.description);
  if (!description) throw new Error('Descrição é obrigatória.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    orgId,
    condoId: cId,
    description,
    type,
    involved: normalizeInvolved(data.involved),
    evidenceUrls: normalizeUrlList(data.evidenceUrls),
    status: normalizeOccurrenceStatus(data.status || 'aberto'),
    conclusionText: cleanString(data.conclusionText) || null,
    concludedAt: null,
    concludedBy: null,
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
    entityType: 'occurrence',
    entityId: ref.id,
    targetPath: `condos/${cId}/occurrences/${ref.id}`,
    metadata: { type: docData.type, status: docData.status },
  });

  return { id: ref.id, ...docData };
}

export async function triggerEmergency(condoId, data) {
  data = data || {};
  const description = cleanString(data.description) || 'Botão de emergência acionado.';
  return await createOccurrence(condoId, {
    type: 'EMERGENCIA',
    description,
    involved: data.involved || [],
    evidenceUrls: data.evidenceUrls || [],
    status: 'aberto',
  });
}

export async function updateOccurrence(condoId, occurrenceId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const oId = cleanString(occurrenceId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!oId) throw new Error('occurrenceId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'description')) patch.description = cleanString(data.description);
  if (Object.prototype.hasOwnProperty.call(data, 'type')) patch.type = normalizeOccurrenceType(data.type);
  if (Object.prototype.hasOwnProperty.call(data, 'involved')) patch.involved = normalizeInvolved(data.involved);
  if (Object.prototype.hasOwnProperty.call(data, 'evidenceUrls')) patch.evidenceUrls = normalizeUrlList(data.evidenceUrls);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizeOccurrenceStatus(data.status);
  if (Object.prototype.hasOwnProperty.call(data, 'conclusionText')) patch.conclusionText = cleanString(data.conclusionText) || null;

  // Se marcou como fechado, registra conclusão (best-effort)
  if (patch.status === 'fechado') {
    patch.concludedAt = serverTimestamp();
    patch.concludedBy = user.uid;
  }

  await updateDoc(doc(db, 'condos', cId, 'occurrences', oId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'occurrence.update',
    entityType: 'occurrence',
    entityId: oId,
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
    entityType: 'occurrence',
    entityId: oId,
    targetPath: `condos/${cId}/occurrences/${oId}`,
    metadata: {},
  });
}

// ===== Gatebook (Livro da portaria) =====
export async function listGatebookEntries(condoId, opts) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const qs = await getDocs(
    query(collection(db, 'condos', cId, 'gatebook'), orderBy('createdAt', 'desc'), limit(opts.limit || 80))
  );

  return qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

export async function createGatebookEntry(condoId, text) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');
  const t = cleanString(text);
  if (!t) throw new Error('Texto é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    orgId,
    condoId: cId,
    text: t,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'gatebook'), docData);
  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'gatebook.create',
    entityType: 'gatebookEntry',
    entityId: ref.id,
    targetPath: `condos/${cId}/gatebook/${ref.id}`,
    metadata: {},
  });

  return { id: ref.id, ...docData };
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

  const expectedAt = toDateTimeMaybe(data.expectedAt);
  const validFrom = toDateOnly(data.validFrom);
  const validTo = toDateOnly(data.validTo);

  const docData = {
    orgId,
    condoId: cId,
    name,
    document: cleanString(data.document) || null,
    phone: cleanString(data.phone) || null,
    unitId: cleanString(data.unitId) || null,
    unitLabel: cleanString(data.unitLabel) || null,
    note: cleanString(data.note) || null,
    expectedAt: expectedAt || null,
    validFrom,
    validTo,
    status: normalizeVisitorStatus(data.status || 'autorizado'),
    checkInAt: null,
    checkOutAt: null,
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
    entityType: 'visitor',
    entityId: ref.id,
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
  if (Object.prototype.hasOwnProperty.call(data, 'unitId')) patch.unitId = cleanString(data.unitId) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'unitLabel')) patch.unitLabel = cleanString(data.unitLabel) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'note')) patch.note = cleanString(data.note) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'expectedAt')) patch.expectedAt = toDateTimeMaybe(data.expectedAt);
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
    entityType: 'visitor',
    entityId: vId,
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
    entityType: 'visitor',
    entityId: vId,
    targetPath: `condos/${cId}/visitors/${vId}`,
    metadata: {},
  });
}

export async function checkInVisitor(condoId, visitorId, note) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const vId = cleanString(visitorId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!vId) throw new Error('visitorId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  await updateDoc(doc(db, 'condos', cId, 'visitors', vId), {
    status: 'chegou',
    checkInAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const ev = await addDoc(collection(db, 'condos', cId, 'accessEvents'), {
    orgId,
    condoId: cId,
    type: 'check_in',
    refKind: 'visitor',
    refId: vId,
    note: cleanString(note) || null,
    at: new Date(),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'visitor.checkin',
    entityType: 'visitor',
    entityId: vId,
    targetPath: `condos/${cId}/visitors/${vId}`,
    metadata: { accessEventId: ev.id },
  });

  return { ok: true, accessEventId: ev.id };
}

export async function checkOutVisitor(condoId, visitorId, note) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const vId = cleanString(visitorId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!vId) throw new Error('visitorId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  await updateDoc(doc(db, 'condos', cId, 'visitors', vId), {
    status: 'saiu',
    checkOutAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const ev = await addDoc(collection(db, 'condos', cId, 'accessEvents'), {
    orgId,
    condoId: cId,
    type: 'check_out',
    refKind: 'visitor',
    refId: vId,
    note: cleanString(note) || null,
    at: new Date(),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'visitor.checkout',
    entityType: 'visitor',
    entityId: vId,
    targetPath: `condos/${cId}/visitors/${vId}`,
    metadata: { accessEventId: ev.id },
  });

  return { ok: true, accessEventId: ev.id };
}

// ===== Providers =====
export async function listProviders(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(query(collection(db, 'condos', cId, 'providers'), orderBy('company', 'asc'), limit(200)));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  return items;
}

export async function createProvider(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const company = cleanString(data.company || data.name);
  if (!company) throw new Error('Empresa do prestador é obrigatória.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    orgId,
    condoId: cId,
    company,
    responsible: cleanString(data.responsible) || null,
    serviceType: cleanString(data.serviceType) || 'geral',
    document: cleanString(data.document) || null,
    phone: cleanString(data.phone) || null,
    authorizedDays: Array.isArray(data.authorizedDays) ? data.authorizedDays.slice(0, 14) : [],
    status: normalizeProviderStatus(data.status),
    notes: cleanString(data.notes) || null,
    checkInAt: null,
    checkOutAt: null,
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
    entityType: 'provider',
    entityId: ref.id,
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

  if (Object.prototype.hasOwnProperty.call(data, 'company')) patch.company = cleanString(data.company) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'responsible')) patch.responsible = cleanString(data.responsible) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'serviceType')) patch.serviceType = cleanString(data.serviceType) || 'geral';
  if (Object.prototype.hasOwnProperty.call(data, 'document')) patch.document = cleanString(data.document) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'phone')) patch.phone = cleanString(data.phone) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'authorizedDays')) patch.authorizedDays = Array.isArray(data.authorizedDays) ? data.authorizedDays.slice(0, 14) : [];
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizeProviderStatus(data.status);
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes) || null;

  await updateDoc(doc(db, 'condos', cId, 'providers', pId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'provider.update',
    entityType: 'provider',
    entityId: pId,
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
    entityType: 'provider',
    entityId: pId,
    targetPath: `condos/${cId}/providers/${pId}`,
    metadata: {},
  });
}

export async function checkInProvider(condoId, providerId, note) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(providerId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('providerId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  await updateDoc(doc(db, 'condos', cId, 'providers', pId), {
    checkInAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const ev = await addDoc(collection(db, 'condos', cId, 'accessEvents'), {
    orgId,
    condoId: cId,
    type: 'check_in',
    refKind: 'provider',
    refId: pId,
    note: cleanString(note) || null,
    at: new Date(),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'provider.checkin',
    entityType: 'provider',
    entityId: pId,
    targetPath: `condos/${cId}/providers/${pId}`,
    metadata: { accessEventId: ev.id },
  });

  return { ok: true, accessEventId: ev.id };
}

export async function checkOutProvider(condoId, providerId, note) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(providerId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('providerId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  await updateDoc(doc(db, 'condos', cId, 'providers', pId), {
    checkOutAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const ev = await addDoc(collection(db, 'condos', cId, 'accessEvents'), {
    orgId,
    condoId: cId,
    type: 'check_out',
    refKind: 'provider',
    refId: pId,
    note: cleanString(note) || null,
    at: new Date(),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'provider.checkout',
    entityType: 'provider',
    entityId: pId,
    targetPath: `condos/${cId}/providers/${pId}`,
    metadata: { accessEventId: ev.id },
  });

  return { ok: true, accessEventId: ev.id };
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
  if (type) filters.push(where('type', '==', normalizeAccessEventType(type)));

  const qs = await getDocs(query(qRef, ...filters, orderBy('createdAt', 'desc'), limit(opts.limit || 120)));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  return items;
}

export async function createAccessEvent(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const type = normalizeAccessEventType(data.type);
  if (!type) throw new Error('Tipo do evento é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const at = toDateTimeMaybe(data.at);

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
    entityType: 'accessEvent',
    entityId: ref.id,
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
    entityType: 'accessEvent',
    entityId: eId,
    targetPath: `condos/${cId}/accessEvents/${eId}`,
    metadata: {},
  });
}

export const SecurityTypes = {
  normalizeSeverity,
  normalizeOccurrenceStatus,
  normalizeVisitorStatus,
  normalizeProviderStatus,
  normalizeOccurrenceType,
  normalizeAccessEventType,
  toDateOnly,
  toDateTimeMaybe,
  cleanNumber,
};
