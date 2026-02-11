// Viva Haven — Contratos, Fornecedores, Seguros e Riscos (MVP)
// Firestore:
// - condos/{condoId}/suppliers/{id}
// - condos/{condoId}/contracts/{id}
// - condos/{condoId}/insurances/{id}
// - condos/{condoId}/risks/{id}

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

function normalizeStatus(value, allowed, fallback) {
  const v = cleanString(value).toLowerCase();
  return allowed.includes(v) ? v : fallback;
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

  const docData = {
    orgId,
    condoId: cId,
    title,
    supplierId: supplierId || null,
    status,
    startAt,
    endAt,
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

  await updateDoc(doc(db, 'condos', cId, 'contracts', ctId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'contract.update',
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
    targetPath: `condos/${cId}/contracts/${ctId}`,
    metadata: {},
  });
}

// ===== Insurances =====
export async function listInsurances(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'insurances'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
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

  const docData = {
    orgId,
    condoId: cId,
    title,
    provider: cleanString(data.provider),
    policyNumber: cleanString(data.policyNumber),
    status,
    startAt,
    endAt,
    notes: cleanString(data.notes),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'insurances'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'insurance.create',
    targetPath: `condos/${cId}/insurances/${ref.id}`,
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

  await updateDoc(doc(db, 'condos', cId, 'insurances', iId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'insurance.update',
    targetPath: `condos/${cId}/insurances/${iId}`,
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
  await deleteDoc(doc(db, 'condos', cId, 'insurances', iId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'insurance.delete',
    targetPath: `condos/${cId}/insurances/${iId}`,
    metadata: {},
  });
}

// ===== Risks =====
export async function listRisks(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'risks'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
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

  const ref = await addDoc(collection(db, 'condos', cId, 'risks'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'risk.create',
    targetPath: `condos/${cId}/risks/${ref.id}`,
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

  await updateDoc(doc(db, 'condos', cId, 'risks', rId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'risk.update',
    targetPath: `condos/${cId}/risks/${rId}`,
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
  await deleteDoc(doc(db, 'condos', cId, 'risks', rId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'risk.delete',
    targetPath: `condos/${cId}/risks/${rId}`,
    metadata: {},
  });
}
