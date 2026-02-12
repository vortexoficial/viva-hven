// Viva Haven — Contratos, Fornecedores, Seguros e Riscos (MVP)
// Firestore:
// - condos/{condoId}/suppliers/{id}
// - condos/{condoId}/contracts/{id}
//   - contracts/{contractId}/adjustments/{id}
//   - contracts/{contractId}/evaluations/{id}
//   - contracts/{contractId}/services/{id}
// - condos/{condoId}/insurancePolicies/{id}
// - condos/{condoId}/incidents/{id}
// - condos/{condoId}/riskMap/{id}
// Sem Storage: URLs apenas.

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

function normalizeStatus(value, allowed, fallback) {
  const v = cleanString(value).toLowerCase();
  return allowed.includes(v) ? v : fallback;
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

function normalizeScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 1) return 1;
  if (n > 5) return 5;
  return Math.round(n);
}

function parseMoneyToCents(value) {
  const s = cleanString(value);
  if (!s) return null;
  const norm = s.replace(/\./g, '').replace(',', '.');
  const n = Number(norm);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

// ===== Suppliers =====
export async function listSuppliers(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'suppliers'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => cleanString(a.name).localeCompare(cleanString(b.name)));
  return items;
}

export async function createSupplier(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const name = cleanString(data.name);
  if (!name) throw new Error('Nome do fornecedor é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const status = normalizeStatus(data.status, ['ativo', 'inativo'], 'ativo');

  const docData = {
    orgId,
    condoId: cId,
    name,
    cnpj: cleanString(data.cnpj),
    email: cleanString(data.email),
    phone: cleanString(data.phone),
    status,
    notes: cleanString(data.notes),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'suppliers'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'supplier.create',
    entityType: 'supplier',
    entityId: ref.id,
    targetPath: `condos/${cId}/suppliers/${ref.id}`,
    metadata: { name, status },
  });

  return { id: ref.id, ...docData };
}

export async function updateSupplier(condoId, supplierId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const sId = cleanString(supplierId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!sId) throw new Error('supplierId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'name')) patch.name = cleanString(data.name);
  if (Object.prototype.hasOwnProperty.call(data, 'cnpj')) patch.cnpj = cleanString(data.cnpj);
  if (Object.prototype.hasOwnProperty.call(data, 'email')) patch.email = cleanString(data.email);
  if (Object.prototype.hasOwnProperty.call(data, 'phone')) patch.phone = cleanString(data.phone);
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) {
    patch.status = normalizeStatus(data.status, ['ativo', 'inativo'], 'ativo');
  }

  await updateDoc(doc(db, 'condos', cId, 'suppliers', sId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'supplier.update',
    entityType: 'supplier',
    entityId: sId,
    targetPath: `condos/${cId}/suppliers/${sId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteSupplier(condoId, supplierId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const sId = cleanString(supplierId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!sId) throw new Error('supplierId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'suppliers', sId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'supplier.delete',
    entityType: 'supplier',
    entityId: sId,
    targetPath: `condos/${cId}/suppliers/${sId}`,
    metadata: {},
  });
}

// ===== Contracts =====
export async function listContracts(condoId, opts) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const supplierId = cleanString(opts.supplierId);
  const status = cleanString(opts.status);

  const col = collection(db, 'condos', cId, 'contracts');

  let qs;
  if (supplierId) {
    qs = await getDocs(query(col, where('supplierId', '==', supplierId)));
  } else if (status) {
    qs = await getDocs(query(col, where('status', '==', status)));
  } else {
    qs = await getDocs(col);
  }

  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => {
    const ae = a.endAt && typeof a.endAt.toDate === 'function' ? a.endAt.toDate().getTime() : 0;
    const be = b.endAt && typeof b.endAt.toDate === 'function' ? b.endAt.toDate().getTime() : 0;
    if (ae && be && ae !== be) return ae - be;
    const au = a.updatedAt && typeof a.updatedAt.toDate === 'function' ? a.updatedAt.toDate().getTime() : 0;
    const bu = b.updatedAt && typeof b.updatedAt.toDate === 'function' ? b.updatedAt.toDate().getTime() : 0;
    return bu - au;
  });
  return items;
}

export async function createContract(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const title = cleanString(data.title);
  const supplierId = cleanString(data.supplierId);
  if (!title) throw new Error('Título do contrato é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const status = normalizeStatus(data.status, ['ativo', 'encerrado', 'cancelado'], 'ativo');
  const startAt = data.startDate ? toDateOnly(data.startDate) : null;
  const endAt = data.endDate ? toDateOnly(data.endDate) : null;
  const renewalAt = data.renewalDate ? toDateOnly(data.renewalDate) : null;
  const contractUrl = normalizeUrl(data.contractUrl || data.url);

  const docData = {
    orgId,
    condoId: cId,
    title,
    supplierId: supplierId || null,
    status,
    startAt,
    endAt,
    renewalAt,
    contractUrl: contractUrl || null,
    value: cleanNumber(data.value),
    notes: cleanString(data.notes),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'contracts'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'contract.create',
    entityType: 'contract',
    entityId: ref.id,
    targetPath: `condos/${cId}/contracts/${ref.id}`,
    metadata: { title, status, supplierId: supplierId || null },
  });

  return { id: ref.id, ...docData };
}

export async function updateContract(condoId, contractId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const ctId = cleanString(contractId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!ctId) throw new Error('contractId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'supplierId')) patch.supplierId = cleanString(data.supplierId) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes);
  if (Object.prototype.hasOwnProperty.call(data, 'value')) patch.value = cleanNumber(data.value);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) {
    patch.status = normalizeStatus(data.status, ['ativo', 'encerrado', 'cancelado'], 'ativo');
  }
  if (Object.prototype.hasOwnProperty.call(data, 'startDate')) patch.startAt = toDateOnly(data.startDate);
  if (Object.prototype.hasOwnProperty.call(data, 'endDate')) patch.endAt = toDateOnly(data.endDate);
  if (Object.prototype.hasOwnProperty.call(data, 'renewalDate')) patch.renewalAt = data.renewalDate ? toDateOnly(data.renewalDate) : null;
  if (Object.prototype.hasOwnProperty.call(data, 'contractUrl') || Object.prototype.hasOwnProperty.call(data, 'url')) {
    patch.contractUrl = normalizeUrl(data.contractUrl || data.url) || null;
  }

  await updateDoc(doc(db, 'condos', cId, 'contracts', ctId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'contract.update',
    entityType: 'contract',
    entityId: ctId,
    targetPath: `condos/${cId}/contracts/${ctId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteContract(condoId, contractId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const ctId = cleanString(contractId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!ctId) throw new Error('contractId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'contracts', ctId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'contract.delete',
    entityType: 'contract',
    entityId: ctId,
    targetPath: `condos/${cId}/contracts/${ctId}`,
    metadata: {},
  });
}

function contractSubcol(db, condoId, contractId, sub) {
  const cId = cleanString(condoId);
  const ctId = cleanString(contractId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!ctId) throw new Error('Selecione um contrato.');
  return collection(db, 'condos', cId, 'contracts', ctId, sub);
}

async function listContractSub(db, condoId, contractId, sub, orderField) {
  const q = orderField ? query(contractSubcol(db, condoId, contractId, sub), orderBy(orderField, 'desc')) : contractSubcol(db, condoId, contractId, sub);
  const qs = await getDocs(q);
  return qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

async function createContractSub(db, user, condoId, contractId, sub, docData, audit) {
  const cId = cleanString(condoId);
  const ctId = cleanString(contractId);

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const ref = await addDoc(contractSubcol(db, cId, ctId, sub), {
    ...(docData || {}),
    orgId,
    condoId: cId,
    contractId: ctId,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (audit) {
    await writeAuditLog(db, {
      orgId,
      condoId: cId,
      actorUid: user.uid,
      action: audit.action,
      entityType: audit.entityType,
      entityId: ref.id,
      targetPath: `condos/${cId}/contracts/${ctId}/${sub}/${ref.id}`,
      metadata: audit.metadata || {},
    });
  }

  return ref.id;
}

async function updateContractSub(db, user, condoId, contractId, sub, subId, patch, audit) {
  const cId = cleanString(condoId);
  const ctId = cleanString(contractId);
  const sId = cleanString(subId);
  if (!sId) throw new Error('ID inválido.');

  await updateDoc(doc(db, 'condos', cId, 'contracts', ctId, sub, sId), { ...(patch || {}), updatedAt: serverTimestamp() });

  if (audit) {
    await writeAuditLog(db, {
      condoId: cId,
      actorUid: user.uid,
      action: audit.action,
      entityType: audit.entityType,
      entityId: sId,
      targetPath: `condos/${cId}/contracts/${ctId}/${sub}/${sId}`,
      metadata: { patch: patch || {} },
    });
  }
}

async function deleteContractSub(db, user, condoId, contractId, sub, subId, audit) {
  const cId = cleanString(condoId);
  const ctId = cleanString(contractId);
  const sId = cleanString(subId);
  if (!sId) throw new Error('ID inválido.');

  await deleteDoc(doc(db, 'condos', cId, 'contracts', ctId, sub, sId));

  if (audit) {
    await writeAuditLog(db, {
      condoId: cId,
      actorUid: user.uid,
      action: audit.action,
      entityType: audit.entityType,
      entityId: sId,
      targetPath: `condos/${cId}/contracts/${ctId}/${sub}/${sId}`,
      metadata: {},
    });
  }
}

// ===== Reajustes (adjustments) =====
export async function listContractAdjustments(condoId, contractId) {
  const { db } = await requireAuth();
  return await listContractSub(db, condoId, contractId, 'adjustments', 'effectiveAt');
}

export async function createContractAdjustment(condoId, contractId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const effectiveAt = data.effectiveDate ? toDateOnly(data.effectiveDate) : null;
  if (!effectiveAt) throw new Error('Data de vigência é obrigatória.');

  const docData = {
    effectiveAt,
    percent: cleanNumber(data.percent),
    index: cleanString(data.index),
    notes: cleanString(data.notes),
  };

  return await createContractSub(db, user, condoId, contractId, 'adjustments', docData, {
    action: 'contract.adjustment.create',
    entityType: 'contractAdjustment',
  });
}

export async function updateContractAdjustment(condoId, contractId, adjustmentId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, 'effectiveDate')) patch.effectiveAt = data.effectiveDate ? toDateOnly(data.effectiveDate) : null;
  if (Object.prototype.hasOwnProperty.call(data, 'percent')) patch.percent = cleanNumber(data.percent);
  if (Object.prototype.hasOwnProperty.call(data, 'index')) patch.index = cleanString(data.index);
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes);

  await updateContractSub(db, user, condoId, contractId, 'adjustments', adjustmentId, patch, {
    action: 'contract.adjustment.update',
    entityType: 'contractAdjustment',
  });
}

export async function deleteContractAdjustment(condoId, contractId, adjustmentId) {
  const { db, user } = await requireAuth();
  await deleteContractSub(db, user, condoId, contractId, 'adjustments', adjustmentId, {
    action: 'contract.adjustment.delete',
    entityType: 'contractAdjustment',
  });
}

// ===== Avaliações (evaluations) =====
export async function listContractEvaluations(condoId, contractId) {
  const { db } = await requireAuth();
  return await listContractSub(db, condoId, contractId, 'evaluations', 'date');
}

export async function createContractEvaluation(condoId, contractId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const date = data.date ? toDateOnly(data.date) : null;
  const score = normalizeScore(data.score);
  if (score == null) throw new Error('Nota (1-5) é obrigatória.');

  const docData = {
    date,
    score,
    notes: cleanString(data.notes),
  };

  return await createContractSub(db, user, condoId, contractId, 'evaluations', docData, {
    action: 'contract.evaluation.create',
    entityType: 'contractEvaluation',
    metadata: { score },
  });
}

export async function updateContractEvaluation(condoId, contractId, evaluationId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, 'date')) patch.date = data.date ? toDateOnly(data.date) : null;
  if (Object.prototype.hasOwnProperty.call(data, 'score')) patch.score = normalizeScore(data.score);
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes);

  await updateContractSub(db, user, condoId, contractId, 'evaluations', evaluationId, patch, {
    action: 'contract.evaluation.update',
    entityType: 'contractEvaluation',
  });
}

export async function deleteContractEvaluation(condoId, contractId, evaluationId) {
  const { db, user } = await requireAuth();
  await deleteContractSub(db, user, condoId, contractId, 'evaluations', evaluationId, {
    action: 'contract.evaluation.delete',
    entityType: 'contractEvaluation',
  });
}

// ===== Histórico de serviços (services) =====
export async function listContractServices(condoId, contractId) {
  const { db } = await requireAuth();
  return await listContractSub(db, condoId, contractId, 'services', 'date');
}

export async function createContractService(condoId, contractId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const description = cleanString(data.description);
  if (!description) throw new Error('Descrição é obrigatória.');

  const amountCents = data.amountCents != null ? cleanNumber(data.amountCents) : parseMoneyToCents(data.amount);

  const docData = {
    date: data.date ? toDateOnly(data.date) : null,
    description,
    workOrderId: cleanString(data.workOrderId) || null,
    accountsPayableId: cleanString(data.accountsPayableId || data.apId) || null,
    amountCents: amountCents != null ? amountCents : null,
    attachmentUrl: normalizeUrl(data.attachmentUrl),
    notes: cleanString(data.notes),
  };

  return await createContractSub(db, user, condoId, contractId, 'services', docData, {
    action: 'contract.service.create',
    entityType: 'contractService',
  });
}

export async function updateContractService(condoId, contractId, serviceId, data) {
  const { db, user } = await requireAuth();
  data = data || {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(data, 'date')) patch.date = data.date ? toDateOnly(data.date) : null;
  if (Object.prototype.hasOwnProperty.call(data, 'description')) patch.description = cleanString(data.description);
  if (Object.prototype.hasOwnProperty.call(data, 'workOrderId')) patch.workOrderId = cleanString(data.workOrderId) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'accountsPayableId') || Object.prototype.hasOwnProperty.call(data, 'apId')) {
    patch.accountsPayableId = cleanString(data.accountsPayableId || data.apId) || null;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'amountCents')) patch.amountCents = cleanNumber(data.amountCents);
  if (Object.prototype.hasOwnProperty.call(data, 'amount')) patch.amountCents = parseMoneyToCents(data.amount);
  if (Object.prototype.hasOwnProperty.call(data, 'attachmentUrl')) patch.attachmentUrl = normalizeUrl(data.attachmentUrl);
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes);

  await updateContractSub(db, user, condoId, contractId, 'services', serviceId, patch, {
    action: 'contract.service.update',
    entityType: 'contractService',
  });
}

export async function deleteContractService(condoId, contractId, serviceId) {
  const { db, user } = await requireAuth();
  await deleteContractSub(db, user, condoId, contractId, 'services', serviceId, {
    action: 'contract.service.delete',
    entityType: 'contractService',
  });
}

// ===== Insurance Policies (exports mantidos por compat) =====
export async function listInsurances(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const [qsNew, qsOld] = await Promise.all([
    getDocs(collection(db, 'condos', cId, 'insurancePolicies')),
    getDocs(collection(db, 'condos', cId, 'insurances')),
  ]);

  const itemsNew = qsNew.docs.map((d) => ({ id: d.id, ...(d.data() || {}), _collection: 'insurancePolicies' }));
  const itemsOld = qsOld.docs.map((d) => ({ id: d.id, ...(d.data() || {}), _collection: 'insurances' }));

  const byId = new Map();
  for (const it of itemsOld) byId.set(it.id, it);
  for (const it of itemsNew) byId.set(it.id, it);
  const items = Array.from(byId.values());
  items.sort((a, b) => {
    const ae = a.endAt && typeof a.endAt.toDate === 'function' ? a.endAt.toDate().getTime() : 0;
    const be = b.endAt && typeof b.endAt.toDate === 'function' ? b.endAt.toDate().getTime() : 0;
    if (ae && be && ae !== be) return ae - be;
    return cleanString(a.title).localeCompare(cleanString(b.title));
  });
  return items;
}

export async function createInsurance(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const title = cleanString(data.title);
  if (!title) throw new Error('Título do seguro é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const status = normalizeStatus(data.status, ['ativo', 'encerrado', 'cancelado'], 'ativo');
  const startAt = data.startDate ? toDateOnly(data.startDate) : null;
  const endAt = data.endDate ? toDateOnly(data.endDate) : null;
  const renewalAt = data.renewalDate ? toDateOnly(data.renewalDate) : null;
  const policyUrl = normalizeUrl(data.policyUrl || data.url);

  const docData = {
    orgId,
    condoId: cId,
    title,
    provider: cleanString(data.provider),
    policyNumber: cleanString(data.policyNumber),
    status,
    startAt,
    endAt,
    renewalAt,
    policyUrl: policyUrl || null,
    notes: cleanString(data.notes),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'insurancePolicies'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'insurance.create',
    entityType: 'insurancePolicy',
    entityId: ref.id,
    targetPath: `condos/${cId}/insurancePolicies/${ref.id}`,
    metadata: { title, status },
  });

  return { id: ref.id, ...docData };
}

export async function updateInsurance(condoId, insuranceId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const iId = cleanString(insuranceId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!iId) throw new Error('insuranceId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'provider')) patch.provider = cleanString(data.provider);
  if (Object.prototype.hasOwnProperty.call(data, 'policyNumber')) patch.policyNumber = cleanString(data.policyNumber);
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) {
    patch.status = normalizeStatus(data.status, ['ativo', 'encerrado', 'cancelado'], 'ativo');
  }
  if (Object.prototype.hasOwnProperty.call(data, 'startDate')) patch.startAt = toDateOnly(data.startDate);
  if (Object.prototype.hasOwnProperty.call(data, 'endDate')) patch.endAt = toDateOnly(data.endDate);
  if (Object.prototype.hasOwnProperty.call(data, 'renewalDate')) patch.renewalAt = data.renewalDate ? toDateOnly(data.renewalDate) : null;
  if (Object.prototype.hasOwnProperty.call(data, 'policyUrl') || Object.prototype.hasOwnProperty.call(data, 'url')) {
    patch.policyUrl = normalizeUrl(data.policyUrl || data.url) || null;
  }

  const newRef = doc(db, 'condos', cId, 'insurancePolicies', iId);
  const newSnap = await getDoc(newRef);
  const usedCol = newSnap.exists() ? 'insurancePolicies' : 'insurances';

  await updateDoc(doc(db, 'condos', cId, usedCol, iId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'insurance.update',
    entityType: 'insurancePolicy',
    entityId: iId,
    targetPath: `condos/${cId}/${usedCol}/${iId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteInsurance(condoId, insuranceId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const iId = cleanString(insuranceId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!iId) throw new Error('insuranceId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  const newRef = doc(db, 'condos', cId, 'insurancePolicies', iId);
  const newSnap = await getDoc(newRef);
  const usedCol = newSnap.exists() ? 'insurancePolicies' : 'insurances';

  await deleteDoc(doc(db, 'condos', cId, usedCol, iId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'insurance.delete',
    entityType: 'insurancePolicy',
    entityId: iId,
    targetPath: `condos/${cId}/${usedCol}/${iId}`,
    metadata: {},
  });
}

// ===== Incidents (Sinistros) =====
export async function listIncidents(condoId, opts) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const policyId = cleanString(opts.policyId);
  const col = collection(db, 'condos', cId, 'incidents');

  const qs = policyId ? await getDocs(query(col, where('policyId', '==', policyId))) : await getDocs(col);
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => {
    const ad = a.date && typeof a.date.toDate === 'function' ? a.date.toDate().getTime() : 0;
    const bd = b.date && typeof b.date.toDate === 'function' ? b.date.toDate().getTime() : 0;
    return bd - ad;
  });
  return items;
}

export async function createIncident(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const title = cleanString(data.title);
  const policyId = cleanString(data.policyId) || null;
  if (!title) throw new Error('Título é obrigatório.');

  const status = normalizeStatus(data.status, ['aberto', 'em_andamento', 'encerrado'], 'aberto');
  const date = data.date ? toDateOnly(data.date) : null;
  const amountCents = data.amountCents != null ? cleanNumber(data.amountCents) : parseMoneyToCents(data.amount);

  const docData = {
    orgId,
    condoId: cId,
    policyId,
    title,
    status,
    date,
    amountCents: amountCents != null ? amountCents : null,
    laudoUrl: normalizeUrl(data.laudoUrl || data.reportUrl),
    notes: cleanString(data.notes),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'incidents'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'incident.create',
    entityType: 'incident',
    entityId: ref.id,
    targetPath: `condos/${cId}/incidents/${ref.id}`,
    metadata: { status, policyId },
  });

  return { id: ref.id, ...docData };
}

export async function updateIncident(condoId, incidentId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const id = cleanString(incidentId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!id) throw new Error('incidentId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'policyId')) patch.policyId = cleanString(data.policyId) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizeStatus(data.status, ['aberto', 'em_andamento', 'encerrado'], 'aberto');
  if (Object.prototype.hasOwnProperty.call(data, 'date')) patch.date = data.date ? toDateOnly(data.date) : null;
  if (Object.prototype.hasOwnProperty.call(data, 'amountCents')) patch.amountCents = cleanNumber(data.amountCents);
  if (Object.prototype.hasOwnProperty.call(data, 'amount')) patch.amountCents = parseMoneyToCents(data.amount);
  if (Object.prototype.hasOwnProperty.call(data, 'laudoUrl') || Object.prototype.hasOwnProperty.call(data, 'reportUrl')) {
    patch.laudoUrl = normalizeUrl(data.laudoUrl || data.reportUrl);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes);

  await updateDoc(doc(db, 'condos', cId, 'incidents', id), patch);

  await writeAuditLog(db, {
    condoId: cId,
    actorUid: user.uid,
    action: 'incident.update',
    entityType: 'incident',
    entityId: id,
    targetPath: `condos/${cId}/incidents/${id}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteIncident(condoId, incidentId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const id = cleanString(incidentId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!id) throw new Error('incidentId inválido.');

  await deleteDoc(doc(db, 'condos', cId, 'incidents', id));

  await writeAuditLog(db, {
    condoId: cId,
    actorUid: user.uid,
    action: 'incident.delete',
    entityType: 'incident',
    entityId: id,
    targetPath: `condos/${cId}/incidents/${id}`,
    metadata: {},
  });
}

// ===== Risk Map (exports mantidos por compat) =====
export async function listRisks(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const [qsNew, qsOld] = await Promise.all([
    getDocs(collection(db, 'condos', cId, 'riskMap')),
    getDocs(collection(db, 'condos', cId, 'risks')),
  ]);

  const itemsNew = qsNew.docs.map((d) => ({ id: d.id, ...(d.data() || {}), _collection: 'riskMap' }));
  const itemsOld = qsOld.docs.map((d) => ({ id: d.id, ...(d.data() || {}), _collection: 'risks' }));

  const byId = new Map();
  for (const it of itemsOld) byId.set(it.id, it);
  for (const it of itemsNew) byId.set(it.id, it);
  const items = Array.from(byId.values());
  items.sort((a, b) => {
    const ad = a.dueAt && typeof a.dueAt.toDate === 'function' ? a.dueAt.toDate().getTime() : 0;
    const bd = b.dueAt && typeof b.dueAt.toDate === 'function' ? b.dueAt.toDate().getTime() : 0;
    if (ad && bd && ad !== bd) return ad - bd;
    return cleanString(a.title).localeCompare(cleanString(b.title));
  });
  return items;
}

export async function createRisk(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const title = cleanString(data.title);
  if (!title) throw new Error('Título do risco é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const severity = normalizeStatus(data.severity, ['baixa', 'media', 'alta', 'critica'], 'media');
  const status = normalizeStatus(data.status, ['aberto', 'mitigado', 'encerrado'], 'aberto');
  const dueAt = data.dueDate ? toDateOnly(data.dueDate) : null;

  const docData = {
    orgId,
    condoId: cId,
    title,
    category: cleanString(data.category),
    severity,
    status,
    dueAt,
    mitigation: cleanString(data.mitigation),
    notes: cleanString(data.notes),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'riskMap'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'risk.create',
    entityType: 'risk',
    entityId: ref.id,
    targetPath: `condos/${cId}/riskMap/${ref.id}`,
    metadata: { title, severity, status },
  });

  return { id: ref.id, ...docData };
}

export async function updateRisk(condoId, riskId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const rId = cleanString(riskId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!rId) throw new Error('riskId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'category')) patch.category = cleanString(data.category);
  if (Object.prototype.hasOwnProperty.call(data, 'mitigation')) patch.mitigation = cleanString(data.mitigation);
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes);
  if (Object.prototype.hasOwnProperty.call(data, 'severity')) {
    patch.severity = normalizeStatus(data.severity, ['baixa', 'media', 'alta', 'critica'], 'media');
  }
  if (Object.prototype.hasOwnProperty.call(data, 'status')) {
    patch.status = normalizeStatus(data.status, ['aberto', 'mitigado', 'encerrado'], 'aberto');
  }
  if (Object.prototype.hasOwnProperty.call(data, 'dueDate')) patch.dueAt = toDateOnly(data.dueDate);

  const newRef = doc(db, 'condos', cId, 'riskMap', rId);
  const newSnap = await getDoc(newRef);
  const usedCol = newSnap.exists() ? 'riskMap' : 'risks';

  await updateDoc(doc(db, 'condos', cId, usedCol, rId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'risk.update',
    entityType: 'risk',
    entityId: rId,
    targetPath: `condos/${cId}/${usedCol}/${rId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteRisk(condoId, riskId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const rId = cleanString(riskId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!rId) throw new Error('riskId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  const newRef = doc(db, 'condos', cId, 'riskMap', rId);
  const newSnap = await getDoc(newRef);
  const usedCol = newSnap.exists() ? 'riskMap' : 'risks';

  await deleteDoc(doc(db, 'condos', cId, usedCol, rId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'risk.delete',
    entityType: 'risk',
    entityId: rId,
    targetPath: `condos/${cId}/${usedCol}/${rId}`,
    metadata: {},
  });
}
