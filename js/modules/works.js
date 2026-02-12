// Viva Haven — Módulo Obras e Reformas (MVP)
// Firestore:
// - condos/{condoId}/projects/{id} (áreas comuns)
// - condos/{condoId}/unitReforms/{id} (solicitação morador)
// Storage (anexos):
// - condos/{condoId}/projects/{projectId}/attachments/{fileName}
// - condos/{condoId}/unitReforms/{reformId}/attachments/{fileName}

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
  const n = cleanString(name) || 'anexo';
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

function normalizeProjectStatus(value) {
  const v = cleanString(value).toLowerCase();
  if (['planejado', 'em_execucao', 'concluido', 'cancelado'].includes(v)) return v;
  if (['planned', 'in_progress', 'done', 'canceled'].includes(v)) {
    if (v === 'planned') return 'planejado';
    if (v === 'in_progress') return 'em_execucao';
    if (v === 'done') return 'concluido';
    if (v === 'canceled') return 'cancelado';
  }
  return 'planejado';
}

function normalizeReformStatus(value) {
  const v = cleanString(value).toLowerCase();
  if (['solicitado', 'aprovado', 'reprovado', 'em_execucao', 'concluido', 'cancelado'].includes(v)) return v;
  if (['requested', 'approved', 'rejected', 'in_progress', 'done', 'canceled'].includes(v)) {
    if (v === 'requested') return 'solicitado';
    if (v === 'approved') return 'aprovado';
    if (v === 'rejected') return 'reprovado';
    if (v === 'in_progress') return 'em_execucao';
    if (v === 'done') return 'concluido';
    if (v === 'canceled') return 'cancelado';
  }
  return 'solicitado';
}

async function uploadAttachment(storage, path, file) {
  if (!file) return null;
  if (!storage) {
    throw new Error('Upload de anexos está indisponível no momento (Storage desativado).');
  }
  const fileName = Date.now() + '_' + safeFileName(file.name);
  const fullPath = path.replace(/\/+$/, '') + '/' + fileName;

  const r = storageRef(storage, fullPath);
  const result = await uploadBytes(r, file, { contentType: file.type || undefined });
  const url = await getDownloadURL(result.ref);

  return {
    path: fullPath,
    url,
    name: cleanString(file.name) || 'anexo',
    contentType: cleanString(file.type) || null,
    size: typeof file.size === 'number' ? file.size : null,
    uploadedAt: new Date(),
  };
}

// ===== Projects (Admin) =====
export async function listProjects(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'projects'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  items.sort((a, b) => {
    const au = a.updatedAt && typeof a.updatedAt.toDate === 'function' ? a.updatedAt.toDate().getTime() : 0;
    const bu = b.updatedAt && typeof b.updatedAt.toDate === 'function' ? b.updatedAt.toDate().getTime() : 0;
    return bu - au;
  });

  return items;
}

export async function createProject(condoId, data) {
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
    area: cleanString(data.area) || 'áreas comuns',
    status: normalizeProjectStatus(data.status),
    startAt: toDateOnly(data.startDate),
    endAt: toDateOnly(data.endDate),
    contractor: cleanString(data.contractor) || null,
    budgetCents: cleanNumber(data.budgetCents),
    attachments: [],
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'projects'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'project.create',
    targetPath: `condos/${cId}/projects/${ref.id}`,
    metadata: { status: docData.status, area: docData.area },
  });

  return { id: ref.id, ...docData };
}

export async function updateProject(condoId, projectId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(projectId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('projectId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'description')) patch.description = cleanString(data.description);
  if (Object.prototype.hasOwnProperty.call(data, 'area')) patch.area = cleanString(data.area) || 'áreas comuns';
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizeProjectStatus(data.status);
  if (Object.prototype.hasOwnProperty.call(data, 'startDate')) patch.startAt = toDateOnly(data.startDate);
  if (Object.prototype.hasOwnProperty.call(data, 'endDate')) patch.endAt = toDateOnly(data.endDate);
  if (Object.prototype.hasOwnProperty.call(data, 'contractor')) patch.contractor = cleanString(data.contractor) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'budgetCents')) patch.budgetCents = cleanNumber(data.budgetCents);

  await updateDoc(doc(db, 'condos', cId, 'projects', pId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'project.update',
    targetPath: `condos/${cId}/projects/${pId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteProject(condoId, projectId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(projectId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('projectId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'projects', pId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'project.delete',
    targetPath: `condos/${cId}/projects/${pId}`,
    metadata: {},
  });
}

export async function addProjectAttachment(condoId, projectId, file) {
  const { db, storage, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(projectId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('projectId inválido.');
  if (!file) throw new Error('Selecione um arquivo.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const attachment = await uploadAttachment(storage, `condos/${cId}/projects/${pId}/attachments`, file);
  if (!attachment) return null;

  const snap = await getDoc(doc(db, 'condos', cId, 'projects', pId));
  if (!snap.exists()) throw new Error('Obra não encontrada.');
  const cur = snap.data() || {};
  const attachments = Array.isArray(cur.attachments) ? cur.attachments.slice(0) : [];
  attachments.push(attachment);

  await updateDoc(doc(db, 'condos', cId, 'projects', pId), {
    attachments,
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'project.attachment.add',
    targetPath: `condos/${cId}/projects/${pId}`,
    metadata: { name: attachment.name, size: attachment.size || null },
  });

  return attachment;
}

// ===== Unit reforms (Morador + Admin) =====
export async function listUnitReforms(condoId, opts) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const mineOnly = !!opts.mineOnly;
  const status = cleanString(opts.status);

  let qRef = collection(db, 'condos', cId, 'unitReforms');
  const filters = [];
  if (mineOnly) filters.push(where('createdBy', '==', user.uid));
  if (status) filters.push(where('status', '==', normalizeReformStatus(status)));

  const qs = filters.length ? await getDocs(query(qRef, ...filters)) : await getDocs(qRef);
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  items.sort((a, b) => {
    const au = a.updatedAt && typeof a.updatedAt.toDate === 'function' ? a.updatedAt.toDate().getTime() : 0;
    const bu = b.updatedAt && typeof b.updatedAt.toDate === 'function' ? b.updatedAt.toDate().getTime() : 0;
    return bu - au;
  });

  return items;
}

export async function createUnitReform(condoId, data) {
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
    unitLabel: cleanString(data.unitLabel) || null,
    contractor: cleanString(data.contractor) || null,
    contact: cleanString(data.contact) || null,
    startAt: toDateOnly(data.startDate),
    endAt: toDateOnly(data.endDate),
    status: 'solicitado',
    decisionNote: null,
    decisionBy: null,
    decisionAt: null,
    attachments: [],
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'unitReforms'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'unitReform.create',
    targetPath: `condos/${cId}/unitReforms/${ref.id}`,
    metadata: { status: docData.status },
  });

  return { id: ref.id, ...docData };
}

export async function addUnitReformAttachment(condoId, reformId, file) {
  const { db, storage, user } = await requireAuth();
  const cId = cleanString(condoId);
  const rId = cleanString(reformId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!rId) throw new Error('reformId inválido.');
  if (!file) throw new Error('Selecione um arquivo.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const attachment = await uploadAttachment(storage, `condos/${cId}/unitReforms/${rId}/attachments`, file);
  if (!attachment) return null;

  const snap = await getDoc(doc(db, 'condos', cId, 'unitReforms', rId));
  if (!snap.exists()) throw new Error('Solicitação não encontrada.');
  const cur = snap.data() || {};
  const attachments = Array.isArray(cur.attachments) ? cur.attachments.slice(0) : [];
  attachments.push(attachment);

  await updateDoc(doc(db, 'condos', cId, 'unitReforms', rId), {
    attachments,
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'unitReform.attachment.add',
    targetPath: `condos/${cId}/unitReforms/${rId}`,
    metadata: { name: attachment.name, size: attachment.size || null },
  });

  return attachment;
}

export async function updateUnitReformAsAdmin(condoId, reformId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const rId = cleanString(reformId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!rId) throw new Error('reformId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizeReformStatus(data.status);
  if (Object.prototype.hasOwnProperty.call(data, 'decisionNote')) patch.decisionNote = cleanString(data.decisionNote) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'contractor')) patch.contractor = cleanString(data.contractor) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'contact')) patch.contact = cleanString(data.contact) || null;

  if (Object.prototype.hasOwnProperty.call(data, 'decision')) {
    const decision = cleanString(data.decision).toLowerCase();
    if (decision === 'aprovar') patch.status = 'aprovado';
    if (decision === 'reprovar') patch.status = 'reprovado';
    patch.decisionBy = user.uid;
    patch.decisionAt = serverTimestamp();
    if (!Object.prototype.hasOwnProperty.call(data, 'decisionNote')) {
      patch.decisionNote = cleanString(data.note) || null;
    }
  }

  await updateDoc(doc(db, 'condos', cId, 'unitReforms', rId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'unitReform.update.admin',
    targetPath: `condos/${cId}/unitReforms/${rId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteUnitReform(condoId, reformId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const rId = cleanString(reformId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!rId) throw new Error('reformId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'unitReforms', rId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'unitReform.delete',
    targetPath: `condos/${cId}/unitReforms/${rId}`,
    metadata: {},
  });
}

export const WorksTypes = {
  normalizeProjectStatus,
  normalizeReformStatus,
};
