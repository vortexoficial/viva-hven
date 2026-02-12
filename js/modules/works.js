// Viva Haven — Módulo Obras e Reformas (MVP)
// Firestore:
// - condos/{condoId}/projects/{id} (áreas comuns)
// - condos/{condoId}/unitReforms/{id} (solicitação morador)
// Anexos (MVP sem Storage):
// - Salvar apenas URL (campo string) em `attachments[]`

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

function toDateOnly(value) {
  const v = cleanString(value);
  if (!v) return null;
  const dt = new Date(v + 'T00:00:00');
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

function normalizeAttachmentInput(input) {
  if (!input) return null;
  if (isFileLike(input)) {
    throw new Error('Upload de anexos está indisponível no momento (Storage desativado). Informe uma URL.');
  }

  if (typeof input === 'string') {
    const url = normalizeUrl(input);
    if (!url) return null;
    return { url, name: 'anexo', source: 'url', uploadedAt: new Date() };
  }

  if (typeof input === 'object') {
    const url = normalizeUrl(input.url);
    if (!url) return null;
    const name = cleanString(input.name) || 'anexo';
    return { url, name, source: 'url', uploadedAt: new Date() };
  }

  return null;
}

async function writeAuditLog(db, payload) {
  payload = payload || {};

  const condoId = cleanString(payload.condoId);
  if (!condoId) throw new Error('condoId é obrigatório para auditLogs.');

  const orgId = cleanString(payload.orgId) || (await getOrgIdForCondo(db, condoId));
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const actorUid = cleanString(payload.actorUid);
  const action = cleanString(payload.action);
  const entityType = cleanString(payload.entityType);
  const entityId = cleanString(payload.entityId);
  if (!actorUid) throw new Error('actorUid é obrigatório para auditLogs.');
  if (!action) throw new Error('action é obrigatório para auditLogs.');
  if (!entityType) throw new Error('entityType é obrigatório para auditLogs.');
  if (!entityId) throw new Error('entityId é obrigatório para auditLogs.');

  const docData = {
    orgId,
    condoId,
    actorUid,
    action,
    entityType,
    entityId,
    targetPath: cleanString(payload.targetPath),
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

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

function normalizeStageStatus(value) {
  const v = cleanString(value).toLowerCase();
  if (['rascunho', 'pendente_aprovacao', 'aprovado', 'reprovado', 'em_execucao', 'concluido', 'cancelado'].includes(v)) return v;
  if (['draft', 'pending', 'approved', 'rejected', 'in_progress', 'done', 'canceled'].includes(v)) {
    if (v === 'draft') return 'rascunho';
    if (v === 'pending') return 'pendente_aprovacao';
    if (v === 'approved') return 'aprovado';
    if (v === 'rejected') return 'reprovado';
    if (v === 'in_progress') return 'em_execucao';
    if (v === 'done') return 'concluido';
    if (v === 'canceled') return 'cancelado';
  }
  return 'rascunho';
}

async function recomputeProjectRollups(db, condoId, projectId) {
  const cId = cleanString(condoId);
  const pId = cleanString(projectId);
  if (!cId || !pId) return;

  const stagesSnap = await getDocs(query(collection(db, 'condos', cId, 'projects', pId, 'stages'), orderBy('order', 'asc')));
  const stages = stagesSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  const msSnap = await getDocs(query(collection(db, 'condos', cId, 'projects', pId, 'measurements'), orderBy('createdAt', 'desc')));
  const measurements = msSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  const plannedCost = stages.reduce((acc, s) => acc + (typeof s.plannedCostCents === 'number' ? s.plannedCostCents : 0), 0);
  const actualCost = measurements.reduce((acc, m) => acc + (typeof m.amountCents === 'number' ? m.amountCents : 0), 0);

  const financialPercent = plannedCost > 0 ? Math.round((actualCost / plannedCost) * 100) : null;

  // progresso físico por etapa: usa o maior percentual medido para a etapa
  const maxByStageId = {};
  for (let i = 0; i < measurements.length; i++) {
    const m = measurements[i] || {};
    const stageId = cleanString(m.stageId);
    if (!stageId) continue;
    const p = clampPercent(m.physicalPercent);
    if (p === null) continue;
    const cur = typeof maxByStageId[stageId] === 'number' ? maxByStageId[stageId] : 0;
    if (p > cur) maxByStageId[stageId] = p;
  }

  let weightedSum = 0;
  let weightTotal = 0;
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i] || {};
    const stageId = cleanString(s.id);
    const progress = typeof maxByStageId[stageId] === 'number' ? maxByStageId[stageId] : 0;
    let weight = 0;
    const wPct = clampPercent(s.plannedWeightPercent);
    if (typeof wPct === 'number' && wPct > 0) weight = wPct; // peso relativo
    else if (typeof s.plannedCostCents === 'number' && s.plannedCostCents > 0) weight = s.plannedCostCents;
    else weight = 1;
    weightedSum += weight * progress;
    weightTotal += weight;
  }

  const physicalPercent = weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null;

  await updateDoc(doc(db, 'condos', cId, 'projects', pId), {
    plannedCostCents: plannedCost || null,
    actualCostCents: actualCost || null,
    financialPercent,
    physicalPercent,
    updatedAt: serverTimestamp(),
  });
}

// TODO: se futuramente habilitar Storage, implementar upload aqui.

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
    plannedCostCents: null,
    actualCostCents: null,
    physicalPercent: null,
    financialPercent: null,
    attachments: [],
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'projects'), docData);

  await writeAuditLog(db, {
    condoId: cId,
    orgId,
    actorUid: user.uid,
    action: 'project.create',
    entityType: 'project',
    entityId: ref.id,
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
    condoId: cId,
    orgId: orgId || '',
    actorUid: user.uid,
    action: 'project.update',
    entityType: 'project',
    entityId: pId,
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
    condoId: cId,
    orgId: orgId || '',
    actorUid: user.uid,
    action: 'project.delete',
    entityType: 'project',
    entityId: pId,
    targetPath: `condos/${cId}/projects/${pId}`,
    metadata: {},
  });
}

export async function addProjectAttachment(condoId, projectId, file) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(projectId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('projectId inválido.');
  if (!file) throw new Error('Selecione um arquivo.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const attachment = normalizeAttachmentInput(file);
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
    condoId: cId,
    orgId,
    actorUid: user.uid,
    action: 'project.attachment.add',
    entityType: 'project',
    entityId: pId,
    targetPath: `condos/${cId}/projects/${pId}`,
    metadata: { name: attachment.name, size: attachment.size || null },
  });

  return attachment;
}

// ===== Project stages (Admin) =====
export async function listProjectStages(condoId, projectId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(projectId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('projectId inválido.');

  const qs = await getDocs(query(collection(db, 'condos', cId, 'projects', pId, 'stages'), orderBy('order', 'asc')));
  return qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

export async function createProjectStage(condoId, projectId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(projectId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('projectId inválido.');

  data = data || {};
  const title = cleanString(data.title);
  if (!title) throw new Error('Título da etapa é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const rawAttachments = Array.isArray(data.attachments) ? data.attachments : [];
  const attachments = [];
  for (let i = 0; i < rawAttachments.length; i++) {
    const a = normalizeAttachmentInput(rawAttachments[i]);
    if (a) attachments.push(a);
  }

  let order = cleanNumber(data.order);
  if (order === null) {
    const cur = await listProjectStages(cId, pId);
    order = cur.length + 1;
  }

  const docData = {
    orgId,
    condoId: cId,
    projectId: pId,
    title,
    description: cleanString(data.description) || null,
    order,
    plannedStartAt: toDateOnly(data.plannedStartDate),
    plannedEndAt: toDateOnly(data.plannedEndDate),
    plannedCostCents: cleanNumber(data.plannedCostCents),
    plannedWeightPercent: clampPercent(data.plannedWeightPercent),
    status: normalizeStageStatus(data.status),
    decisionNote: null,
    decisionBy: null,
    decisionAt: null,
    attachments,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'projects', pId, 'stages'), docData);

  await writeAuditLog(db, {
    condoId: cId,
    orgId,
    actorUid: user.uid,
    action: 'projectStage.create',
    entityType: 'projectStage',
    entityId: ref.id,
    targetPath: `condos/${cId}/projects/${pId}/stages/${ref.id}`,
    metadata: { projectId: pId, status: docData.status, order: docData.order },
  });

  await recomputeProjectRollups(db, cId, pId);

  return { id: ref.id, ...docData };
}

export async function updateProjectStage(condoId, projectId, stageId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(projectId);
  const sId = cleanString(stageId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('projectId inválido.');
  if (!sId) throw new Error('stageId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'description')) patch.description = cleanString(data.description) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'order')) patch.order = cleanNumber(data.order);
  if (Object.prototype.hasOwnProperty.call(data, 'plannedStartDate')) patch.plannedStartAt = toDateOnly(data.plannedStartDate);
  if (Object.prototype.hasOwnProperty.call(data, 'plannedEndDate')) patch.plannedEndAt = toDateOnly(data.plannedEndDate);
  if (Object.prototype.hasOwnProperty.call(data, 'plannedCostCents')) patch.plannedCostCents = cleanNumber(data.plannedCostCents);
  if (Object.prototype.hasOwnProperty.call(data, 'plannedWeightPercent')) patch.plannedWeightPercent = clampPercent(data.plannedWeightPercent);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizeStageStatus(data.status);

  await updateDoc(doc(db, 'condos', cId, 'projects', pId, 'stages', sId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    condoId: cId,
    orgId: orgId || '',
    actorUid: user.uid,
    action: 'projectStage.update',
    entityType: 'projectStage',
    entityId: sId,
    targetPath: `condos/${cId}/projects/${pId}/stages/${sId}`,
    metadata: { projectId: pId, patch: data || {} },
  });

  await recomputeProjectRollups(db, cId, pId);
}

export async function decideProjectStage(condoId, projectId, stageId, decision, note) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(projectId);
  const sId = cleanString(stageId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('projectId inválido.');
  if (!sId) throw new Error('stageId inválido.');

  const d = cleanString(decision).toLowerCase();
  const patch = {
    updatedAt: serverTimestamp(),
    decisionNote: cleanString(note) || null,
    decisionBy: user.uid,
    decisionAt: serverTimestamp(),
  };
  if (d === 'aprovar' || d === 'approved') patch.status = 'aprovado';
  if (d === 'reprovar' || d === 'rejected') patch.status = 'reprovado';
  if (!patch.status) throw new Error('Decisão inválida. Use aprovar/reprovar.');

  await updateDoc(doc(db, 'condos', cId, 'projects', pId, 'stages', sId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    condoId: cId,
    orgId: orgId || '',
    actorUid: user.uid,
    action: 'projectStage.decide',
    entityType: 'projectStage',
    entityId: sId,
    targetPath: `condos/${cId}/projects/${pId}/stages/${sId}`,
    metadata: { projectId: pId, decision: patch.status, note: patch.decisionNote },
  });
}

export async function deleteProjectStage(condoId, projectId, stageId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(projectId);
  const sId = cleanString(stageId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('projectId inválido.');
  if (!sId) throw new Error('stageId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'projects', pId, 'stages', sId));

  await writeAuditLog(db, {
    condoId: cId,
    orgId: orgId || '',
    actorUid: user.uid,
    action: 'projectStage.delete',
    entityType: 'projectStage',
    entityId: sId,
    targetPath: `condos/${cId}/projects/${pId}/stages/${sId}`,
    metadata: { projectId: pId },
  });

  await recomputeProjectRollups(db, cId, pId);
}

export async function addProjectStageAttachment(condoId, projectId, stageId, file) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(projectId);
  const sId = cleanString(stageId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('projectId inválido.');
  if (!sId) throw new Error('stageId inválido.');
  if (!file) throw new Error('Informe uma URL.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const attachment = normalizeAttachmentInput(file);
  if (!attachment) return null;

  const snap = await getDoc(doc(db, 'condos', cId, 'projects', pId, 'stages', sId));
  if (!snap.exists()) throw new Error('Etapa não encontrada.');
  const cur = snap.data() || {};
  const attachments = Array.isArray(cur.attachments) ? cur.attachments.slice(0) : [];
  attachments.push(attachment);

  await updateDoc(doc(db, 'condos', cId, 'projects', pId, 'stages', sId), {
    attachments,
    updatedAt: serverTimestamp(),
  });

  await writeAuditLog(db, {
    condoId: cId,
    orgId,
    actorUid: user.uid,
    action: 'projectStage.attachment.add',
    entityType: 'projectStage',
    entityId: sId,
    targetPath: `condos/${cId}/projects/${pId}/stages/${sId}`,
    metadata: { projectId: pId, name: attachment.name || null, url: attachment.url || null },
  });

  return attachment;
}

// ===== Project measurements (Admin) =====
export async function listProjectMeasurements(condoId, projectId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(projectId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('projectId inválido.');

  const qs = await getDocs(query(collection(db, 'condos', cId, 'projects', pId, 'measurements'), orderBy('createdAt', 'desc')));
  return qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

export async function createProjectMeasurement(condoId, projectId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(projectId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('projectId inválido.');

  data = data || {};
  const stageId = cleanString(data.stageId);
  if (!stageId) throw new Error('Selecione uma etapa.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const rawAttachments = Array.isArray(data.attachments) ? data.attachments : [];
  const attachments = [];
  for (let i = 0; i < rawAttachments.length; i++) {
    const a = normalizeAttachmentInput(rawAttachments[i]);
    if (a) attachments.push(a);
  }

  const docData = {
    orgId,
    condoId: cId,
    projectId: pId,
    stageId,
    title: cleanString(data.title) || null,
    measuredAt: toDateOnly(data.measuredDate),
    physicalPercent: clampPercent(data.physicalPercent),
    amountCents: cleanNumber(data.amountCents),
    note: cleanString(data.note) || null,
    attachments,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'projects', pId, 'measurements'), docData);

  await writeAuditLog(db, {
    condoId: cId,
    orgId,
    actorUid: user.uid,
    action: 'projectMeasurement.create',
    entityType: 'projectMeasurement',
    entityId: ref.id,
    targetPath: `condos/${cId}/projects/${pId}/measurements/${ref.id}`,
    metadata: { projectId: pId, stageId, amountCents: docData.amountCents || null, physicalPercent: docData.physicalPercent },
  });

  await recomputeProjectRollups(db, cId, pId);

  return { id: ref.id, ...docData };
}

export async function deleteProjectMeasurement(condoId, projectId, measurementId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(projectId);
  const mId = cleanString(measurementId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('projectId inválido.');
  if (!mId) throw new Error('measurementId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'projects', pId, 'measurements', mId));

  await writeAuditLog(db, {
    condoId: cId,
    orgId: orgId || '',
    actorUid: user.uid,
    action: 'projectMeasurement.delete',
    entityType: 'projectMeasurement',
    entityId: mId,
    targetPath: `condos/${cId}/projects/${pId}/measurements/${mId}`,
    metadata: { projectId: pId },
  });

  await recomputeProjectRollups(db, cId, pId);
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

  const rawAttachments = Array.isArray(data.attachments) ? data.attachments : [];
  const attachments = [];
  for (let i = 0; i < rawAttachments.length; i++) {
    const a = normalizeAttachmentInput(rawAttachments[i]);
    if (a) attachments.push(a);
  }

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
    attachments,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'unitReforms'), docData);

  await writeAuditLog(db, {
    condoId: cId,
    orgId,
    actorUid: user.uid,
    action: 'unitReform.create',
    entityType: 'unitReform',
    entityId: ref.id,
    targetPath: `condos/${cId}/unitReforms/${ref.id}`,
    metadata: { status: docData.status, attachmentCount: attachments.length },
  });

  return { id: ref.id, ...docData };
}

export async function addUnitReformAttachment(condoId, reformId, file) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const rId = cleanString(reformId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!rId) throw new Error('reformId inválido.');
  if (!file) throw new Error('Informe uma URL.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const attachment = normalizeAttachmentInput(file);
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
    condoId: cId,
    orgId,
    actorUid: user.uid,
    action: 'unitReform.attachment.add',
    entityType: 'unitReform',
    entityId: rId,
    targetPath: `condos/${cId}/unitReforms/${rId}`,
    metadata: { name: attachment.name || null, url: attachment.url || null },
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
    condoId: cId,
    orgId: orgId || '',
    actorUid: user.uid,
    action: 'unitReform.update.admin',
    entityType: 'unitReform',
    entityId: rId,
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
    condoId: cId,
    orgId: orgId || '',
    actorUid: user.uid,
    action: 'unitReform.delete',
    entityType: 'unitReform',
    entityId: rId,
    targetPath: `condos/${cId}/unitReforms/${rId}`,
    metadata: {},
  });
}

export const WorksTypes = {
  normalizeProjectStatus,
  normalizeReformStatus,
  normalizeStageStatus,
};
