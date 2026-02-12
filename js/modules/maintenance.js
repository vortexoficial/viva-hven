// Viva Haven — Módulo de Manutenção
// Firestore (condo-scoped):
// - condos/{condoId}/assets/{assetId}
// - condos/{condoId}/maintenancePlans/{planId}
// - condos/{condoId}/maintenanceExecutions/{executionId}
// - condos/{condoId}/tickets/{ticketId}
// - condos/{condoId}/workOrders/{workOrderId}
// Auditoria:
// - condos/{condoId}/auditLogs/{logId}
// Anexos/Fotos (MVP sem Storage):
// - Salvar apenas URL pública em arrays `photos*[]`

import { initFirebase } from '../firebase-init.js';

import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
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

function cleanMoneyToCents(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);

  const raw = cleanString(value);
  if (!raw) return null;

  // Aceita "1234", "1234.56", "1.234,56" e "1234,56"
  const normalized = raw
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const num = Number(normalized);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 100);
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

function isFileLike(value) {
  try {
    return typeof File !== 'undefined' && value instanceof File;
  } catch (e) {
    return false;
  }
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

function normalizePhotoInput(input) {
  if (!input) return null;

  if (isFileLike(input)) {
    throw new Error('Upload de fotos está indisponível no momento (Storage desativado). Informe uma URL.');
  }

  if (typeof input === 'string') {
    const url = normalizeUrl(input);
    if (!url) return null;
    return { url, name: 'foto', source: 'url', uploadedAt: new Date() };
  }

  if (typeof input === 'object') {
    const url = normalizeUrl(input.url);
    if (!url) return null;
    const name = cleanString(input.name) || 'foto';
    return { url, name, source: 'url', uploadedAt: new Date() };
  }

  return null;
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

async function getMembershipForCondo(db, uid, condoId) {
  const u = cleanString(uid);
  const cId = cleanString(condoId);
  if (!u || !cId) return null;
  const membershipId = `${u}_${cId}`;
  const snap = await getDoc(doc(db, 'memberships', membershipId));
  if (!snap.exists()) return null;
  return snap.data() || null;
}

function normalizeChecklist(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => cleanString(v))
      .filter(Boolean)
      .slice(0, 80);
  }
  if (typeof value === 'string') {
    return value
      .split(/\n|\r|;/g)
      .map((v) => cleanString(v))
      .filter(Boolean)
      .slice(0, 80);
  }
  return [];
}

export function computeDueInfo(dueAt, alertDaysBefore, asOfDate) {
  const now = asOfDate instanceof Date ? asOfDate : new Date();
  let dt = null;
  try {
    if (dueAt && typeof dueAt.toDate === 'function') dt = dueAt.toDate();
    else if (dueAt instanceof Date) dt = dueAt;
  } catch (e) {
    dt = null;
  }
  if (!dt) return { hasDue: false, overdue: false, dueSoon: false, dueInDays: null };

  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const diffDays = Math.round((b.getTime() - a.getTime()) / 86400000);
  const alert = Number.isFinite(Number(alertDaysBefore)) ? Number(alertDaysBefore) : 7;

  return {
    hasDue: true,
    overdue: diffDays < 0,
    dueSoon: diffDays >= 0 && diffDays <= alert,
    dueInDays: diffDays,
  };
}

function normalizePriority(value) {
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

function priorityDefaultSlaHours(priority) {
  const p = normalizePriority(priority);
  if (p === 'urgente') return 4;
  if (p === 'alta') return 24;
  if (p === 'media') return 72;
  return 120;
}

function normalizeStatus(value) {
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

function normalizeTicketCategory(value) {
  const v = cleanString(value).toLowerCase();
  if (!v) return 'geral';
  // MVP: categorias simples; mantém valores customizados, mas limita tamanho.
  if (v.length > 40) return v.slice(0, 40);
  return v;
}

// TODO: se futuramente habilitar Storage, implementar upload aqui.

// ===== Assets =====
export async function listAssets(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'assets'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => cleanString(a.name).localeCompare(cleanString(b.name)));
  return items;
}

export async function createAsset(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const name = cleanString(data.name);
  if (!name) throw new Error('Nome do ativo é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    orgId,
    condoId: cId,
    name,
    // Compat: category (legado) + type (novo)
    category: cleanString(data.category || data.type) || 'geral',
    type: cleanString(data.type || data.category) || 'geral',
    manufacturer: cleanString(data.manufacturer) || null,
    model: cleanString(data.model) || null,
    location: cleanString(data.location) || null,
    serial: cleanString(data.serial || data.serialNumber) || null,
    warrantyUntil: toDateOnly(data.warrantyUntil) || null,
    contractId: cleanString(data.contractId) || null,
    status: cleanString(data.status) || 'ativo',
    notes: cleanString(data.notes) || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'assets'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'asset.create',
    entityType: 'asset',
    entityId: ref.id,
    targetPath: `condos/${cId}/assets/${ref.id}`,
    metadata: { name, type: docData.type, category: docData.category },
  });

  return { id: ref.id, ...docData };
}

export async function updateAsset(condoId, assetId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const aId = cleanString(assetId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!aId) throw new Error('assetId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };
  if (Object.prototype.hasOwnProperty.call(data, 'name')) patch.name = cleanString(data.name);
  if (Object.prototype.hasOwnProperty.call(data, 'category')) patch.category = cleanString(data.category) || 'geral';
  if (Object.prototype.hasOwnProperty.call(data, 'type')) patch.type = cleanString(data.type) || 'geral';
  if (Object.prototype.hasOwnProperty.call(data, 'manufacturer')) patch.manufacturer = cleanString(data.manufacturer) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'model')) patch.model = cleanString(data.model) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'location')) patch.location = cleanString(data.location) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'serial')) patch.serial = cleanString(data.serial) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'serialNumber')) patch.serial = cleanString(data.serialNumber) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'warrantyUntil')) patch.warrantyUntil = toDateOnly(data.warrantyUntil) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'contractId')) patch.contractId = cleanString(data.contractId) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = cleanString(data.status) || 'ativo';
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes) || null;

  await updateDoc(doc(db, 'condos', cId, 'assets', aId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'asset.update',
    entityType: 'asset',
    entityId: aId,
    targetPath: `condos/${cId}/assets/${aId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteAsset(condoId, assetId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const aId = cleanString(assetId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!aId) throw new Error('assetId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'assets', aId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'asset.delete',
    entityType: 'asset',
    entityId: aId,
    targetPath: `condos/${cId}/assets/${aId}`,
    metadata: {},
  });
}

// ===== Planos preventivos =====
export async function listMaintenancePlans(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'maintenancePlans'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  items.sort((a, b) => {
    const ad = a.nextDueAt && typeof a.nextDueAt.toDate === 'function' ? a.nextDueAt.toDate().getTime() : 0;
    const bd = b.nextDueAt && typeof b.nextDueAt.toDate === 'function' ? b.nextDueAt.toDate().getTime() : 0;
    return ad - bd;
  });

  return items;
}

export async function createMaintenancePlan(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const title = cleanString(data.title);
  if (!title) throw new Error('Título do plano é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const frequencyDays = cleanNumber(data.frequencyDays);
  if (frequencyDays == null || frequencyDays <= 0) throw new Error('Frequência (dias) inválida.');

  const nextDueAt = toDateOnly(data.nextDueDate);
  if (!nextDueAt) throw new Error('Próxima data é obrigatória.');

  const year = cleanNumber(data.year);
  const planYear = year && year >= 2000 ? Math.trunc(year) : (nextDueAt.getFullYear ? nextDueAt.getFullYear() : new Date().getFullYear());
  const checklist = normalizeChecklist(data.checklist || data.checklistItems || data.checklistText);
  const alertDaysBefore = cleanNumber(data.alertDaysBefore);

  const docData = {
    orgId,
    condoId: cId,
    title,
    assetId: cleanString(data.assetId) || null,
    assetType: cleanString(data.assetType) || null,
    year: planYear,
    checklist,
    frequencyDays,
    nextDueAt,
    alertDaysBefore: alertDaysBefore != null && alertDaysBefore >= 0 ? alertDaysBefore : 7,
    status: cleanString(data.status) || 'ativo',
    notes: cleanString(data.notes) || null,
    lastDoneAt: null,
    lastDoneBy: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'maintenancePlans'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'plan.create',
    entityType: 'maintenancePlan',
    entityId: ref.id,
    targetPath: `condos/${cId}/maintenancePlans/${ref.id}`,
    metadata: { title, frequencyDays, year: planYear, checklistCount: checklist.length },
  });

  return { id: ref.id, ...docData };
}

export async function updateMaintenancePlan(condoId, planId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(planId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('planId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'assetId')) patch.assetId = cleanString(data.assetId) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'assetType')) patch.assetType = cleanString(data.assetType) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'year')) {
    const y = cleanNumber(data.year);
    patch.year = y && y >= 2000 ? Math.trunc(y) : null;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'checklist') || Object.prototype.hasOwnProperty.call(data, 'checklistItems') || Object.prototype.hasOwnProperty.call(data, 'checklistText')) {
    patch.checklist = normalizeChecklist(data.checklist || data.checklistItems || data.checklistText);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'frequencyDays')) patch.frequencyDays = cleanNumber(data.frequencyDays);
  if (Object.prototype.hasOwnProperty.call(data, 'nextDueDate')) patch.nextDueAt = toDateOnly(data.nextDueDate);
  if (Object.prototype.hasOwnProperty.call(data, 'alertDaysBefore')) {
    const a = cleanNumber(data.alertDaysBefore);
    patch.alertDaysBefore = a != null && a >= 0 ? a : 7;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = cleanString(data.status) || 'ativo';
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes) || null;

  await updateDoc(doc(db, 'condos', cId, 'maintenancePlans', pId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'plan.update',
    entityType: 'maintenancePlan',
    entityId: pId,
    targetPath: `condos/${cId}/maintenancePlans/${pId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteMaintenancePlan(condoId, planId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(planId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('planId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'maintenancePlans', pId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'plan.delete',
    entityType: 'maintenancePlan',
    entityId: pId,
    targetPath: `condos/${cId}/maintenancePlans/${pId}`,
    metadata: {},
  });
}

// ===== Execuções de preventiva (histórico) =====
export async function listMaintenanceExecutions(condoId, opts) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const planId = cleanString(opts.planId);
  const assetId = cleanString(opts.assetId);

  if (!planId && !assetId) throw new Error('Informe planId ou assetId.');

  let qs;
  const col = collection(db, 'condos', cId, 'maintenanceExecutions');
  if (planId) {
    qs = await getDocs(query(col, where('planId', '==', planId)));
  } else {
    qs = await getDocs(query(col, where('assetId', '==', assetId)));
  }

  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => {
    const at = a.executedAt && typeof a.executedAt.toDate === 'function' ? a.executedAt.toDate().getTime() : 0;
    const bt = b.executedAt && typeof b.executedAt.toDate === 'function' ? b.executedAt.toDate().getTime() : 0;
    return bt - at;
  });
  return items;
}

export async function completeMaintenancePlan(condoId, planId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(planId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('planId inválido.');

  const snap = await getDoc(doc(db, 'condos', cId, 'maintenancePlans', pId));
  if (!snap.exists()) throw new Error('Plano não encontrado.');
  const plan = snap.data() || {};

  data = data || {};
  const executedAt = toDateTimeMaybe(data.executedAt) || new Date();
  const notes = cleanString(data.notes) || null;
  const checklistDone = normalizeChecklist(data.checklistDone || data.checklist || data.checklistItems);

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const executionDoc = {
    orgId,
    condoId: cId,
    planId: pId,
    assetId: plan.assetId ? cleanString(plan.assetId) : null,
    assetType: plan.assetType ? cleanString(plan.assetType) : null,
    title: plan.title ? cleanString(plan.title) : null,
    executedAt,
    executedBy: user.uid,
    checklistDone,
    notes,
    createdAt: serverTimestamp(),
  };

  const execRef = await addDoc(collection(db, 'condos', cId, 'maintenanceExecutions'), executionDoc);

  // Avança agenda (se houver frequência)
  const freq = plan.frequencyDays != null ? cleanNumber(plan.frequencyDays) : null;
  const nextDueAt = data.nextDueDate ? (toDateOnly(data.nextDueDate) || null) : (
    freq && freq > 0 ? new Date(executedAt.getTime() + freq * 86400000) : null
  );

  const patch = {
    lastDoneAt: executedAt,
    lastDoneBy: user.uid,
    updatedAt: serverTimestamp(),
  };
  if (nextDueAt) patch.nextDueAt = nextDueAt;

  await updateDoc(doc(db, 'condos', cId, 'maintenancePlans', pId), patch);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'plan.complete',
    entityType: 'maintenanceExecution',
    entityId: execRef.id,
    targetPath: `condos/${cId}/maintenanceExecutions/${execRef.id}`,
    metadata: { planId: pId, assetId: executionDoc.assetId || null },
  });

  return { id: execRef.id, ...executionDoc };
}

// ===== Chamados corretivos =====
export async function listTickets(condoId, opts) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const mineOnly = !!opts.mineOnly;
  const status = cleanString(opts.status);

  let qRef = collection(db, 'condos', cId, 'tickets');
  const filters = [];
  if (mineOnly) filters.push(where('createdBy', '==', user.uid));
  if (status) filters.push(where('status', '==', normalizeStatus(status)));

  const qs = filters.length ? await getDocs(query(qRef, ...filters)) : await getDocs(qRef);
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  items.sort((a, b) => {
    const au = a.updatedAt && typeof a.updatedAt.toDate === 'function' ? a.updatedAt.toDate().getTime() : 0;
    const bu = b.updatedAt && typeof b.updatedAt.toDate === 'function' ? b.updatedAt.toDate().getTime() : 0;
    return bu - au;
  });

  return items;
}

export async function createTicket(condoId, data) {
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

  const priority = normalizePriority(data.priority);
  const slaHours = cleanNumber(data.slaHours) || priorityDefaultSlaHours(priority);
  const status = 'aberto';
  const category = normalizeTicketCategory(data.category);

  const membership = await getMembershipForCondo(db, user.uid, cId);
  const unitId = membership && membership.unitId ? cleanString(membership.unitId) : null;
  const unitLabel = membership && membership.unitLabel ? cleanString(membership.unitLabel) : null;

  const rawPhotos = Array.isArray(data.photos) ? data.photos : [];
  const photos = [];
  for (let i = 0; i < rawPhotos.length; i++) {
    const p = normalizePhotoInput(rawPhotos[i]);
    if (p) photos.push(p);
  }

  const now = new Date();
  const slaDueAt = new Date(now.getTime() + slaHours * 60 * 60 * 1000);

  const docData = {
    orgId,
    condoId: cId,
    title,
    description,
    category,
    assetId: cleanString(data.assetId) || null,
    unitId,
    unitLabel,
    location: cleanString(data.location) || null,
    priority,
    slaHours,
    slaDueAt,
    status,
    assignedTo: cleanString(data.assignedTo) || null,
    convertedToWorkOrderId: null,
    convertedAt: null,
    convertedBy: null,
    closedAt: null,
    closedBy: null,
    photos,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'tickets'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'ticket.create',
    entityType: 'ticket',
    entityId: ref.id,
    targetPath: `condos/${cId}/tickets/${ref.id}`,
    metadata: { priority, slaHours, category, photoCount: photos.length },
  });

  return { id: ref.id, ...docData, photos };
}

// ===== Comentários (timeline) =====
export async function listTicketComments(condoId, ticketId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const tId = cleanString(ticketId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!tId) throw new Error('ticketId inválido.');

  const qs = await getDocs(query(
    collection(db, 'condos', cId, 'tickets', tId, 'comments'),
    orderBy('createdAt', 'asc')
  ));

  // Leitura é autorizada pelas rules (owner ou gestão). Não filtra no client.
  return qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

export async function addTicketComment(condoId, ticketId, text) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const tId = cleanString(ticketId);
  const body = cleanString(text);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!tId) throw new Error('ticketId inválido.');
  if (!body) throw new Error('Informe um comentário.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const commentDoc = {
    orgId,
    condoId: cId,
    ticketId: tId,
    createdBy: user.uid,
    text: body,
    createdAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'tickets', tId, 'comments'), commentDoc);

  // Atualiza "updatedAt" do ticket para refletir atividade
  try {
    await updateDoc(doc(db, 'condos', cId, 'tickets', tId), { updatedAt: serverTimestamp() });
  } catch (e) {}

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'ticket.comment.create',
    entityType: 'ticketComment',
    entityId: ref.id,
    targetPath: `condos/${cId}/tickets/${tId}/comments/${ref.id}`,
    metadata: { length: body.length },
  });

  return { id: ref.id, ...commentDoc };
}

export async function closeTicketAsResident(condoId, ticketId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const tId = cleanString(ticketId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!tId) throw new Error('ticketId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  // Rules garantem que apenas owner pode fazer essa transição.
  await updateDoc(doc(db, 'condos', cId, 'tickets', tId), {
    status: 'fechado',
    closedBy: user.uid,
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'ticket.close.resident',
    entityType: 'ticket',
    entityId: tId,
    targetPath: `condos/${cId}/tickets/${tId}`,
    metadata: {},
  });

  return { ok: true };
}

export async function addTicketPhoto(condoId, ticketId, file) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const tId = cleanString(ticketId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!tId) throw new Error('ticketId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const p = normalizePhotoInput(file);
  if (!p) return null;

  const snap = await getDoc(doc(db, 'condos', cId, 'tickets', tId));
  if (!snap.exists()) throw new Error('Chamado não encontrado.');
  const data = snap.data() || {};
  const photos = Array.isArray(data.photos) ? data.photos.slice(0) : [];
  photos.push(p);

  await updateDoc(doc(db, 'condos', cId, 'tickets', tId), {
    photos,
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'ticket.photo.add',
    entityType: 'ticket',
    entityId: tId,
    targetPath: `condos/${cId}/tickets/${tId}`,
    metadata: { name: p.name || null, url: p.url || null },
  });

  return p;
}

export async function updateTicket(condoId, ticketId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const tId = cleanString(ticketId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!tId) throw new Error('ticketId inválido.');

  data = data || {};

  const patch = { updatedAt: serverTimestamp() };
  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'description')) patch.description = cleanString(data.description);
  if (Object.prototype.hasOwnProperty.call(data, 'location')) patch.location = cleanString(data.location) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'assetId')) patch.assetId = cleanString(data.assetId) || null;

  if (Object.prototype.hasOwnProperty.call(data, 'priority')) patch.priority = normalizePriority(data.priority);
  if (Object.prototype.hasOwnProperty.call(data, 'slaHours')) patch.slaHours = cleanNumber(data.slaHours);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizeStatus(data.status);
  if (Object.prototype.hasOwnProperty.call(data, 'assignedTo')) patch.assignedTo = cleanString(data.assignedTo) || null;

  await updateDoc(doc(db, 'condos', cId, 'tickets', tId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'ticket.update',
    entityType: 'ticket',
    entityId: tId,
    targetPath: `condos/${cId}/tickets/${tId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteTicket(condoId, ticketId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const tId = cleanString(ticketId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!tId) throw new Error('ticketId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'tickets', tId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'ticket.delete',
    entityType: 'ticket',
    entityId: tId,
    targetPath: `condos/${cId}/tickets/${tId}`,
    metadata: {},
  });
}

// ===== Work orders (ordens de serviço) =====
function normalizeWorkOrderStatus(value) {
  const v = cleanString(value).toLowerCase();
  const allowed = ['aberto', 'triagem', 'aprovado', 'em_andamento', 'aguardando_fornecedor', 'resolvido', 'fechado', 'cancelado'];
  if (allowed.includes(v)) return v;
  return normalizeStatus(v);
}

function normalizePhotoArray(value) {
  const raw = Array.isArray(value) ? value : (value ? [value] : []);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const p = normalizePhotoInput(raw[i]);
    if (p) out.push(p);
  }
  return out;
}

export async function listWorkOrders(condoId, opts) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const status = cleanString(opts.status);
  const assetId = cleanString(opts.assetId);
  const unitId = cleanString(opts.unitId);

  let col = collection(db, 'condos', cId, 'workOrders');
  let qs;

  // Evita queries com múltiplos where para reduzir necessidade de índices.
  if (unitId) {
    qs = await getDocs(query(col, where('unitId', '==', unitId)));
  } else if (assetId) {
    qs = await getDocs(query(col, where('assetId', '==', assetId)));
  } else if (status) {
    qs = await getDocs(query(col, where('status', '==', normalizeWorkOrderStatus(status))));
  } else {
    qs = await getDocs(col);
  }

  let items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  const priority = cleanString(opts.priority);
  if (priority) items = items.filter((w) => normalizePriority(w.priority) === normalizePriority(priority));

  const dueFilter = cleanString(opts.due);
  if (dueFilter) {
    items = items.filter((w) => {
      const due = computeDueInfo(w.slaDueAt, 0);
      if (dueFilter === 'overdue') return !!due.overdue;
      if (dueFilter === 'dueSoon') return !!due.dueSoon;
      return true;
    });
  }

  items.sort((a, b) => {
    const au = a.updatedAt && typeof a.updatedAt.toDate === 'function' ? a.updatedAt.toDate().getTime() : 0;
    const bu = b.updatedAt && typeof b.updatedAt.toDate === 'function' ? b.updatedAt.toDate().getTime() : 0;
    return bu - au;
  });
  return items;
}

export async function listMyUnitWorkOrders(condoId, opts) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const membership = await getMembershipForCondo(db, user.uid, cId);
  const unitId = membership && membership.unitId ? cleanString(membership.unitId) : '';
  if (!unitId) throw new Error('Sua unidade não está vinculada ao seu acesso (membership.unitId).');
  return await listWorkOrders(cId, { ...(opts || {}), unitId });
}

export async function createWorkOrder(condoId, data) {
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

  const priority = normalizePriority(data.priority);
  const slaHours = cleanNumber(data.slaHours) || priorityDefaultSlaHours(priority);
  const now = new Date();
  const slaDueAt = new Date(now.getTime() + slaHours * 60 * 60 * 1000);
  const status = normalizeWorkOrderStatus(data.status || 'aberto');

  const docData = {
    orgId,
    condoId: cId,
    ticketId: cleanString(data.ticketId) || null,
    title,
    description,
    assetId: cleanString(data.assetId) || null,
    unitId: cleanString(data.unitId) || null,
    location: cleanString(data.location) || null,
    supplierId: cleanString(data.supplierId) || null,
    contractId: cleanString(data.contractId) || null,
    priority,
    slaHours,
    slaDueAt,
    status,
    assignedTo: cleanString(data.assignedTo) || null,
    photosBefore: normalizePhotoArray(data.photosBefore),
    photosAfter: normalizePhotoArray(data.photosAfter),
    costCents: data.costCents != null ? cleanNumber(data.costCents) : cleanMoneyToCents(data.cost),
    closedAt: null,
    closedBy: null,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'workOrders'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'workOrder.create',
    entityType: 'workOrder',
    entityId: ref.id,
    targetPath: `condos/${cId}/workOrders/${ref.id}`,
    metadata: { priority, slaHours, hasTicket: !!docData.ticketId },
  });

  return { id: ref.id, ...docData };
}

export async function updateWorkOrder(condoId, workOrderId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const wId = cleanString(workOrderId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!wId) throw new Error('workOrderId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'description')) patch.description = cleanString(data.description);
  if (Object.prototype.hasOwnProperty.call(data, 'assetId')) patch.assetId = cleanString(data.assetId) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'unitId')) patch.unitId = cleanString(data.unitId) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'location')) patch.location = cleanString(data.location) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'supplierId')) patch.supplierId = cleanString(data.supplierId) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'contractId')) patch.contractId = cleanString(data.contractId) || null;

  if (Object.prototype.hasOwnProperty.call(data, 'priority')) patch.priority = normalizePriority(data.priority);
  if (Object.prototype.hasOwnProperty.call(data, 'slaHours')) patch.slaHours = cleanNumber(data.slaHours);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizeWorkOrderStatus(data.status);
  if (Object.prototype.hasOwnProperty.call(data, 'assignedTo')) patch.assignedTo = cleanString(data.assignedTo) || null;

  if (Object.prototype.hasOwnProperty.call(data, 'photosBefore')) patch.photosBefore = normalizePhotoArray(data.photosBefore);
  if (Object.prototype.hasOwnProperty.call(data, 'photosAfter')) patch.photosAfter = normalizePhotoArray(data.photosAfter);

  if (Object.prototype.hasOwnProperty.call(data, 'costCents')) patch.costCents = cleanNumber(data.costCents);
  if (Object.prototype.hasOwnProperty.call(data, 'cost')) patch.costCents = cleanMoneyToCents(data.cost);

  // Fechamento
  if (patch.status === 'fechado' || patch.status === 'cancelado') {
    patch.closedAt = serverTimestamp();
    patch.closedBy = user.uid;
  }

  await updateDoc(doc(db, 'condos', cId, 'workOrders', wId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'workOrder.update',
    entityType: 'workOrder',
    entityId: wId,
    targetPath: `condos/${cId}/workOrders/${wId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteWorkOrder(condoId, workOrderId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const wId = cleanString(workOrderId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!wId) throw new Error('workOrderId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'workOrders', wId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'workOrder.delete',
    entityType: 'workOrder',
    entityId: wId,
    targetPath: `condos/${cId}/workOrders/${wId}`,
    metadata: {},
  });
}

export async function convertTicketToWorkOrder(condoId, ticketId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const tId = cleanString(ticketId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!tId) throw new Error('ticketId inválido.');

  const snap = await getDoc(doc(db, 'condos', cId, 'tickets', tId));
  if (!snap.exists()) throw new Error('Chamado não encontrado.');
  const t = snap.data() || {};

  data = data || {};
  const wo = await createWorkOrder(cId, {
    ticketId: tId,
    title: cleanString(data.title || t.title),
    description: cleanString(data.description || t.description),
    assetId: cleanString(data.assetId || t.assetId) || null,
    unitId: cleanString(data.unitId || t.unitId) || null,
    location: cleanString(data.location || t.location) || null,
    priority: normalizePriority(data.priority || t.priority),
    slaHours: cleanNumber(data.slaHours || t.slaHours) || null,
    supplierId: cleanString(data.supplierId) || null,
    contractId: cleanString(data.contractId) || null,
    photosBefore: Array.isArray(t.photos) ? t.photos : [],
  });

  const orgId = await getOrgIdForCondo(db, cId);

  await updateDoc(doc(db, 'condos', cId, 'tickets', tId), {
    convertedToWorkOrderId: wo.id,
    convertedAt: serverTimestamp(),
    convertedBy: user.uid,
    status: 'em_andamento',
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'ticket.convert_to_workOrder',
    entityType: 'ticket',
    entityId: tId,
    targetPath: `condos/${cId}/tickets/${tId}`,
    metadata: { workOrderId: wo.id },
  });

  return wo;
}

export async function listAssetHistory(condoId, assetId) {
  const cId = cleanString(condoId);
  const aId = cleanString(assetId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!aId) throw new Error('assetId inválido.');

  const [workOrders, executions] = await Promise.all([
    listWorkOrders(cId, { assetId: aId }),
    listMaintenanceExecutions(cId, { assetId: aId }),
  ]);

  const items = [];
  (workOrders || []).forEach((w) => {
    items.push({ kind: 'workOrder', at: w.updatedAt || w.createdAt || null, title: w.title || 'OS', ref: w });
  });
  (executions || []).forEach((e) => {
    items.push({ kind: 'execution', at: e.executedAt || e.createdAt || null, title: e.title || 'Preventiva', ref: e });
  });

  items.sort((a, b) => {
    const at = a.at && typeof a.at.toDate === 'function' ? a.at.toDate().getTime() : (a.at instanceof Date ? a.at.getTime() : 0);
    const bt = b.at && typeof b.at.toDate === 'function' ? b.at.toDate().getTime() : (b.at instanceof Date ? b.at.getTime() : 0);
    return bt - at;
  });

  return { workOrders, executions, items };
}
