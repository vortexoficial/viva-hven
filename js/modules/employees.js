// Viva Haven — Funcionários e Terceirizados (MVP)
// Firestore:
// - condos/{condoId}/employees/{employeeId}
// - condos/{condoId}/employees/{employeeId}/shifts/{shiftId}
// - condos/{condoId}/employees/{employeeId}/leaves/{leaveId}
// - condos/{condoId}/employees/{employeeId}/trainings/{trainingId}
// - condos/{condoId}/employees/{employeeId}/epiChecks/{checkId}
// - condos/{condoId}/employees/{employeeId}/occurrences/{occurrenceId}
// Sem Storage: anexos apenas por URL.

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

async function getOrgIdForCondo(db, condoId) {
  const cId = cleanString(condoId);
  if (!cId) return null;
  const snap = await getDoc(doc(db, 'condos', cId));
  if (!snap.exists()) return null;
  const data = snap.data() || {};
  return data.orgId ? cleanString(data.orgId) : null;
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

function normalizeEmployeeType(value) {
  const v = cleanString(value).toLowerCase();
  if (['funcionario', 'terceirizado'].includes(v)) return v;
  return 'funcionario';
}

function normalizeEmployeeStatus(value) {
  const v = cleanString(value).toLowerCase();
  if (['ativo', 'inativo'].includes(v)) return v;
  return 'ativo';
}

function normalizeSeverity(value) {
  const v = cleanString(value).toLowerCase();
  if (['baixa', 'media', 'alta', 'critica'].includes(v)) return v;
  return 'media';
}

function normalizeLeaveType(value) {
  const v = cleanString(value).toLowerCase();
  if (['ferias', 'afastamento', 'licenca'].includes(v)) return v;
  return 'ferias';
}

function splitLines(value) {
  const s = cleanString(value);
  if (!s) return [];
  return s
    .split('\n')
    .map((x) => cleanString(x).replace(/^[-*]\s+/, ''))
    .filter(Boolean);
}

// ===== Employees =====

export async function listEmployees(condoId, opts) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const status = cleanString(opts.status);
  const type = cleanString(opts.type);

  const col = collection(db, 'condos', cId, 'employees');

  let qs;
  if (status) qs = await getDocs(query(col, where('status', '==', normalizeEmployeeStatus(status))));
  else if (type) qs = await getDocs(query(col, where('type', '==', normalizeEmployeeType(type))));
  else qs = await getDocs(col);

  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => cleanString(a.name).localeCompare(cleanString(b.name)));
  return items;
}

export async function createEmployee(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const name = cleanString(data.name);
  if (!name) throw new Error('Nome é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const type = normalizeEmployeeType(data.type);
  const status = normalizeEmployeeStatus(data.status);

  const docData = {
    orgId,
    condoId: cId,
    name,
    type,
    position: cleanString(data.position),
    cpf: cleanString(data.cpf),
    phone: cleanString(data.phone),
    email: cleanString(data.email),
    supplierId: type === 'terceirizado' ? (cleanString(data.supplierId) || null) : null,
    startAt: data.startDate ? toDateOnly(data.startDate) : null,
    endAt: data.endDate ? toDateOnly(data.endDate) : null,
    status,
    notes: cleanString(data.notes),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'employees'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'employee.create',
    entityType: 'employee',
    entityId: ref.id,
    targetPath: `condos/${cId}/employees/${ref.id}`,
    metadata: { name, type, status },
  });

  return { id: ref.id, ...docData };
}

export async function updateEmployee(condoId, employeeId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const eId = cleanString(employeeId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!eId) throw new Error('employeeId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'name')) patch.name = cleanString(data.name);
  if (Object.prototype.hasOwnProperty.call(data, 'type')) patch.type = normalizeEmployeeType(data.type);
  if (Object.prototype.hasOwnProperty.call(data, 'position')) patch.position = cleanString(data.position);
  if (Object.prototype.hasOwnProperty.call(data, 'cpf')) patch.cpf = cleanString(data.cpf);
  if (Object.prototype.hasOwnProperty.call(data, 'phone')) patch.phone = cleanString(data.phone);
  if (Object.prototype.hasOwnProperty.call(data, 'email')) patch.email = cleanString(data.email);
  if (Object.prototype.hasOwnProperty.call(data, 'supplierId')) patch.supplierId = cleanString(data.supplierId) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'startDate')) patch.startAt = data.startDate ? toDateOnly(data.startDate) : null;
  if (Object.prototype.hasOwnProperty.call(data, 'endDate')) patch.endAt = data.endDate ? toDateOnly(data.endDate) : null;
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizeEmployeeStatus(data.status);
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes);

  // Se virar funcionário, remove supplierId.
  if (patch.type === 'funcionario') patch.supplierId = null;

  await updateDoc(doc(db, 'condos', cId, 'employees', eId), patch);

  await writeAuditLog(db, {
    condoId: cId,
    actorUid: user.uid,
    action: 'employee.update',
    entityType: 'employee',
    entityId: eId,
    targetPath: `condos/${cId}/employees/${eId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteEmployee(condoId, employeeId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const eId = cleanString(employeeId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!eId) throw new Error('employeeId inválido.');

  await deleteDoc(doc(db, 'condos', cId, 'employees', eId));

  await writeAuditLog(db, {
    condoId: cId,
    actorUid: user.uid,
    action: 'employee.delete',
    entityType: 'employee',
    entityId: eId,
    targetPath: `condos/${cId}/employees/${eId}`,
    metadata: {},
  });
}

function subcol(db, condoId, employeeId, sub) {
  const cId = cleanString(condoId);
  const eId = cleanString(employeeId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!eId) throw new Error('Selecione um funcionário/terceirizado.');
  return collection(db, 'condos', cId, 'employees', eId, sub);
}

async function listSub(db, condoId, employeeId, sub, orderField) {
  const q = orderField ? query(subcol(db, condoId, employeeId, sub), orderBy(orderField, 'desc')) : subcol(db, condoId, employeeId, sub);
  const qs = await getDocs(q);
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  return items;
}

async function createSub(db, user, condoId, employeeId, sub, docData, audit) {
  const cId = cleanString(condoId);
  const eId = cleanString(employeeId);
  const ref = await addDoc(subcol(db, cId, eId, sub), {
    ...(docData || {}),
    orgId: (docData && docData.orgId) || (await getOrgIdForCondo(db, cId)),
    condoId: cId,
    employeeId: eId,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (audit) {
    await writeAuditLog(db, {
      condoId: cId,
      actorUid: user.uid,
      action: audit.action,
      entityType: audit.entityType,
      entityId: ref.id,
      targetPath: `condos/${cId}/employees/${eId}/${sub}/${ref.id}`,
      metadata: audit.metadata || {},
    });
  }

  return ref.id;
}

async function updateSub(db, user, condoId, employeeId, sub, docId, patch, audit) {
  const cId = cleanString(condoId);
  const eId = cleanString(employeeId);
  const dId = cleanString(docId);
  if (!dId) throw new Error('ID inválido.');

  await updateDoc(doc(db, 'condos', cId, 'employees', eId, sub, dId), { ...(patch || {}), updatedAt: serverTimestamp() });

  if (audit) {
    await writeAuditLog(db, {
      condoId: cId,
      actorUid: user.uid,
      action: audit.action,
      entityType: audit.entityType,
      entityId: dId,
      targetPath: `condos/${cId}/employees/${eId}/${sub}/${dId}`,
      metadata: { patch: patch || {} },
    });
  }
}

async function deleteSub(db, user, condoId, employeeId, sub, docId, audit) {
  const cId = cleanString(condoId);
  const eId = cleanString(employeeId);
  const dId = cleanString(docId);
  if (!dId) throw new Error('ID inválido.');

  await deleteDoc(doc(db, 'condos', cId, 'employees', eId, sub, dId));

  if (audit) {
    await writeAuditLog(db, {
      condoId: cId,
      actorUid: user.uid,
      action: audit.action,
      entityType: audit.entityType,
      entityId: dId,
      targetPath: `condos/${cId}/employees/${eId}/${sub}/${dId}`,
      metadata: {},
    });
  }
}

// ===== Escala (shifts) =====
export async function listEmployeeShifts(condoId, employeeId) {
  const { db } = await requireAuth();
  return await listSub(db, condoId, employeeId, 'shifts', 'date');
}

export async function createEmployeeShift(condoId, employeeId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const date = toDateOnly(data.date);
  if (!date) throw new Error('Data é obrigatória.');

  const docData = {
    date,
    startTime: cleanString(data.startTime),
    endTime: cleanString(data.endTime),
    area: cleanString(data.area),
    notes: cleanString(data.notes),
  };

  return await createSub(db, user, condoId, employeeId, 'shifts', docData, {
    action: 'employee.shift.create',
    entityType: 'employeeShift',
    metadata: { date: cleanString(data.date) },
  });
}

export async function updateEmployeeShift(condoId, employeeId, shiftId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, 'date')) patch.date = data.date ? toDateOnly(data.date) : null;
  if (Object.prototype.hasOwnProperty.call(data, 'startTime')) patch.startTime = cleanString(data.startTime);
  if (Object.prototype.hasOwnProperty.call(data, 'endTime')) patch.endTime = cleanString(data.endTime);
  if (Object.prototype.hasOwnProperty.call(data, 'area')) patch.area = cleanString(data.area);
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes);

  await updateSub(db, user, condoId, employeeId, 'shifts', shiftId, patch, {
    action: 'employee.shift.update',
    entityType: 'employeeShift',
  });
}

export async function deleteEmployeeShift(condoId, employeeId, shiftId) {
  const { db, user } = await requireAuth();
  await deleteSub(db, user, condoId, employeeId, 'shifts', shiftId, {
    action: 'employee.shift.delete',
    entityType: 'employeeShift',
  });
}

// ===== Férias / afastamentos (leaves) =====
export async function listEmployeeLeaves(condoId, employeeId) {
  const { db } = await requireAuth();
  return await listSub(db, condoId, employeeId, 'leaves', 'startAt');
}

export async function createEmployeeLeave(condoId, employeeId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const startAt = toDateOnly(data.startDate);
  const endAt = toDateOnly(data.endDate);
  if (!startAt) throw new Error('Início é obrigatório.');
  if (!endAt) throw new Error('Fim é obrigatório.');

  const docData = {
    type: normalizeLeaveType(data.type),
    startAt,
    endAt,
    notes: cleanString(data.notes),
  };

  return await createSub(db, user, condoId, employeeId, 'leaves', docData, {
    action: 'employee.leave.create',
    entityType: 'employeeLeave',
  });
}

export async function updateEmployeeLeave(condoId, employeeId, leaveId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, 'type')) patch.type = normalizeLeaveType(data.type);
  if (Object.prototype.hasOwnProperty.call(data, 'startDate')) patch.startAt = data.startDate ? toDateOnly(data.startDate) : null;
  if (Object.prototype.hasOwnProperty.call(data, 'endDate')) patch.endAt = data.endDate ? toDateOnly(data.endDate) : null;
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes);

  await updateSub(db, user, condoId, employeeId, 'leaves', leaveId, patch, {
    action: 'employee.leave.update',
    entityType: 'employeeLeave',
  });
}

export async function deleteEmployeeLeave(condoId, employeeId, leaveId) {
  const { db, user } = await requireAuth();
  await deleteSub(db, user, condoId, employeeId, 'leaves', leaveId, {
    action: 'employee.leave.delete',
    entityType: 'employeeLeave',
  });
}

// ===== Treinamentos (trainings) =====
export async function listEmployeeTrainings(condoId, employeeId) {
  const { db } = await requireAuth();
  return await listSub(db, condoId, employeeId, 'trainings', 'date');
}

export async function createEmployeeTraining(condoId, employeeId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const title = cleanString(data.title);
  if (!title) throw new Error('Título é obrigatório.');

  const docData = {
    title,
    provider: cleanString(data.provider),
    date: data.date ? toDateOnly(data.date) : null,
    validUntil: data.validUntil ? toDateOnly(data.validUntil) : null,
    certificateUrl: normalizeUrl(data.certificateUrl),
    notes: cleanString(data.notes),
  };

  return await createSub(db, user, condoId, employeeId, 'trainings', docData, {
    action: 'employee.training.create',
    entityType: 'employeeTraining',
    metadata: { title },
  });
}

export async function updateEmployeeTraining(condoId, employeeId, trainingId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'provider')) patch.provider = cleanString(data.provider);
  if (Object.prototype.hasOwnProperty.call(data, 'date')) patch.date = data.date ? toDateOnly(data.date) : null;
  if (Object.prototype.hasOwnProperty.call(data, 'validUntil')) patch.validUntil = data.validUntil ? toDateOnly(data.validUntil) : null;
  if (Object.prototype.hasOwnProperty.call(data, 'certificateUrl')) patch.certificateUrl = normalizeUrl(data.certificateUrl);
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes);

  await updateSub(db, user, condoId, employeeId, 'trainings', trainingId, patch, {
    action: 'employee.training.update',
    entityType: 'employeeTraining',
  });
}

export async function deleteEmployeeTraining(condoId, employeeId, trainingId) {
  const { db, user } = await requireAuth();
  await deleteSub(db, user, condoId, employeeId, 'trainings', trainingId, {
    action: 'employee.training.delete',
    entityType: 'employeeTraining',
  });
}

// ===== EPIs (checklist) =====
export async function listEmployeeEpiChecks(condoId, employeeId) {
  const { db } = await requireAuth();
  return await listSub(db, condoId, employeeId, 'epiChecks', 'date');
}

export async function createEmployeeEpiCheck(condoId, employeeId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const date = toDateOnly(data.date);
  if (!date) throw new Error('Data é obrigatória.');

  const items = splitLines(data.itemsText || data.items);

  const docData = {
    date,
    ok: !!data.ok,
    items,
    notes: cleanString(data.notes),
  };

  return await createSub(db, user, condoId, employeeId, 'epiChecks', docData, {
    action: 'employee.epiCheck.create',
    entityType: 'employeeEpiCheck',
    metadata: { ok: !!data.ok, items: items.length },
  });
}

export async function updateEmployeeEpiCheck(condoId, employeeId, checkId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, 'date')) patch.date = data.date ? toDateOnly(data.date) : null;
  if (Object.prototype.hasOwnProperty.call(data, 'ok')) patch.ok = !!data.ok;
  if (Object.prototype.hasOwnProperty.call(data, 'itemsText') || Object.prototype.hasOwnProperty.call(data, 'items')) {
    patch.items = splitLines(data.itemsText || data.items);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes);

  await updateSub(db, user, condoId, employeeId, 'epiChecks', checkId, patch, {
    action: 'employee.epiCheck.update',
    entityType: 'employeeEpiCheck',
  });
}

export async function deleteEmployeeEpiCheck(condoId, employeeId, checkId) {
  const { db, user } = await requireAuth();
  await deleteSub(db, user, condoId, employeeId, 'epiChecks', checkId, {
    action: 'employee.epiCheck.delete',
    entityType: 'employeeEpiCheck',
  });
}

// ===== Ocorrências do colaborador =====
export async function listEmployeeOccurrences(condoId, employeeId) {
  const { db } = await requireAuth();
  return await listSub(db, condoId, employeeId, 'occurrences', 'date');
}

export async function createEmployeeOccurrence(condoId, employeeId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const title = cleanString(data.title);
  if (!title) throw new Error('Título é obrigatório.');

  const docData = {
    title,
    severity: normalizeSeverity(data.severity),
    date: data.date ? toDateOnly(data.date) : null,
    description: cleanString(data.description),
    attachmentUrl: normalizeUrl(data.attachmentUrl),
    status: cleanString(data.status) || 'aberto',
  };

  return await createSub(db, user, condoId, employeeId, 'occurrences', docData, {
    action: 'employee.occurrence.create',
    entityType: 'employeeOccurrence',
    metadata: { severity: docData.severity },
  });
}

export async function updateEmployeeOccurrence(condoId, employeeId, occurrenceId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'severity')) patch.severity = normalizeSeverity(data.severity);
  if (Object.prototype.hasOwnProperty.call(data, 'date')) patch.date = data.date ? toDateOnly(data.date) : null;
  if (Object.prototype.hasOwnProperty.call(data, 'description')) patch.description = cleanString(data.description);
  if (Object.prototype.hasOwnProperty.call(data, 'attachmentUrl')) patch.attachmentUrl = normalizeUrl(data.attachmentUrl);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = cleanString(data.status) || 'aberto';

  await updateSub(db, user, condoId, employeeId, 'occurrences', occurrenceId, patch, {
    action: 'employee.occurrence.update',
    entityType: 'employeeOccurrence',
  });
}

export async function deleteEmployeeOccurrence(condoId, employeeId, occurrenceId) {
  const { db, user } = await requireAuth();
  await deleteSub(db, user, condoId, employeeId, 'occurrences', occurrenceId, {
    action: 'employee.occurrence.delete',
    entityType: 'employeeOccurrence',
  });
}
