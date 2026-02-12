// Viva Haven — Módulo de Manutenção (MVP)
// Firestore:
// - condos/{condoId}/assets/{assetId}
// - condos/{condoId}/maintenancePlans/{planId}
// - condos/{condoId}/tickets/{ticketId}
// Storage (fotos):
// - condos/{condoId}/tickets/{ticketId}/photos/{fileName}

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
  setDoc,
  updateDoc,
  where,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

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
  const { auth, db, storage } = await initFirebase();
  const user = await waitForUser(auth);
  if (!user) throw new Error('Você precisa estar logado.');
  return { auth, db, storage, user };
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

function safeFileName(name) {
  const n = cleanString(name) || 'foto';
  return n
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .slice(0, 120);
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

async function uploadTicketPhoto(storage, condoId, ticketId, file) {
  if (!file) return null;
  if (!storage) {
    throw new Error('Upload de fotos está indisponível no momento (Storage desativado).');
  }
  const cId = cleanString(condoId);
  const tId = cleanString(ticketId);
  if (!cId) throw new Error('condoId inválido.');
  if (!tId) throw new Error('ticketId inválido.');

  const fileName = Date.now() + '_' + safeFileName(file.name);
  const path = `condos/${cId}/tickets/${tId}/photos/${fileName}`;
  const r = storageRef(storage, path);

  const result = await uploadBytes(r, file, { contentType: file.type || undefined });
  const url = await getDownloadURL(result.ref);

  return {
    path,
    url,
    name: cleanString(file.name) || 'foto',
    contentType: cleanString(file.type) || null,
    size: typeof file.size === 'number' ? file.size : null,
    uploadedAt: new Date(),
  };
}

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
    category: cleanString(data.category) || 'geral',
    location: cleanString(data.location) || null,
    serial: cleanString(data.serial) || null,
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
    targetPath: `condos/${cId}/assets/${ref.id}`,
    metadata: { name, category: docData.category },
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
  if (Object.prototype.hasOwnProperty.call(data, 'location')) patch.location = cleanString(data.location) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'serial')) patch.serial = cleanString(data.serial) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = cleanString(data.status) || 'ativo';
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes) || null;

  await updateDoc(doc(db, 'condos', cId, 'assets', aId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'asset.update',
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

  const docData = {
    orgId,
    condoId: cId,
    title,
    assetId: cleanString(data.assetId) || null,
    frequencyDays,
    nextDueAt,
    status: cleanString(data.status) || 'ativo',
    notes: cleanString(data.notes) || null,
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
    targetPath: `condos/${cId}/maintenancePlans/${ref.id}`,
    metadata: { title, frequencyDays },
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
  if (Object.prototype.hasOwnProperty.call(data, 'frequencyDays')) patch.frequencyDays = cleanNumber(data.frequencyDays);
  if (Object.prototype.hasOwnProperty.call(data, 'nextDueDate')) patch.nextDueAt = toDateOnly(data.nextDueDate);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = cleanString(data.status) || 'ativo';
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes) || null;

  await updateDoc(doc(db, 'condos', cId, 'maintenancePlans', pId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'plan.update',
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
    targetPath: `condos/${cId}/maintenancePlans/${pId}`,
    metadata: {},
  });
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
  const { db, storage, user } = await requireAuth();
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

  const now = new Date();
  const slaDueAt = new Date(now.getTime() + slaHours * 60 * 60 * 1000);

  const docData = {
    orgId,
    condoId: cId,
    title,
    description,
    assetId: cleanString(data.assetId) || null,
    location: cleanString(data.location) || null,
    priority,
    slaHours,
    slaDueAt,
    status,
    assignedTo: cleanString(data.assignedTo) || null,
    photos: [],
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'tickets'), docData);

  const photoFiles = Array.isArray(data.photos) ? data.photos : [];
  const photos = [];
  for (let i = 0; i < photoFiles.length; i++) {
    const p = await uploadTicketPhoto(storage, cId, ref.id, photoFiles[i]);
    if (p) photos.push(p);
  }

  if (photos.length) {
    await updateDoc(doc(db, 'condos', cId, 'tickets', ref.id), {
      photos,
      updatedAt: serverTimestamp(),
    });
  }

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'ticket.create',
    targetPath: `condos/${cId}/tickets/${ref.id}`,
    metadata: { priority, slaHours, photoCount: photos.length },
  });

  return { id: ref.id, ...docData, photos };
}

export async function addTicketPhoto(condoId, ticketId, file) {
  const { db, storage, user } = await requireAuth();
  const cId = cleanString(condoId);
  const tId = cleanString(ticketId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!tId) throw new Error('ticketId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const p = await uploadTicketPhoto(storage, cId, tId, file);
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
    targetPath: `condos/${cId}/tickets/${tId}`,
    metadata: { name: p.name, size: p.size || null },
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
    targetPath: `condos/${cId}/tickets/${tId}`,
    metadata: {},
  });
}
