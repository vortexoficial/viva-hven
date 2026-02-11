// Viva Haven — Módulo de Governança (cadastros)
// CRUD: condos, blocks, units, mandates + auditLogs

import { initFirebase } from '../firebase-init.js';

import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
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

function toTimestampDate(value) {
  // value: yyyy-mm-dd
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
  const snap = await getDoc(doc(db, 'condos', condoId));
  if (!snap.exists()) return null;
  const data = snap.data() || {};
  return data.orgId ? cleanString(data.orgId) : null;
}

export async function listCondos() {
  const { db } = await requireAuth();
  const qs = await getDocs(collection(db, 'condos'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => cleanString(a.name).localeCompare(cleanString(b.name)));
  return items;
}

export async function createCondo(data) {
  const { db, user } = await requireAuth();
  const orgId = cleanString(data.orgId);
  const name = cleanString(data.name);
  const status = cleanString(data.status || 'active');
  if (!orgId) throw new Error('Org ID é obrigatório.');
  if (!name) throw new Error('Nome do condomínio é obrigatório.');

  const docData = {
    orgId,
    name,
    status,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos'), docData);
  await writeAuditLog(db, {
    orgId,
    condoId: ref.id,
    actorUid: user.uid,
    action: 'condo.create',
    targetPath: `condos/${ref.id}`,
    metadata: { name, status },
  });

  return { id: ref.id, ...docData };
}

export async function updateCondo(condoId, data) {
  const { db, user } = await requireAuth();
  const id = cleanString(condoId);
  if (!id) throw new Error('condoId inválido.');

  const patch = {
    updatedAt: serverTimestamp(),
  };

  if (data && Object.prototype.hasOwnProperty.call(data, 'name')) patch.name = cleanString(data.name);
  if (data && Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = cleanString(data.status);

  await updateDoc(doc(db, 'condos', id), patch);

  const orgId = await getOrgIdForCondo(db, id);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: id,
    actorUid: user.uid,
    action: 'condo.update',
    targetPath: `condos/${id}`,
    metadata: { patch: data || {} },
  });

  return { id, ...patch };
}

export async function deleteCondo(condoId) {
  const { db, user } = await requireAuth();
  const id = cleanString(condoId);
  if (!id) throw new Error('condoId inválido.');

  const orgId = await getOrgIdForCondo(db, id);

  await deleteDoc(doc(db, 'condos', id));
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: id,
    actorUid: user.uid,
    action: 'condo.delete',
    targetPath: `condos/${id}`,
    metadata: {},
  });
}

export async function listBlocks(condoId) {
  const { db } = await requireAuth();
  const id = cleanString(condoId);
  if (!id) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', id, 'blocks'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => {
    const ao = cleanNumber(a.order);
    const bo = cleanNumber(b.order);
    if (ao != null && bo != null && ao !== bo) return ao - bo;
    return cleanString(a.name).localeCompare(cleanString(b.name));
  });
  return items;
}

export async function createBlock(condoId, data) {
  const { db, user } = await requireAuth();
  const id = cleanString(condoId);
  if (!id) throw new Error('Selecione um condomínio.');

  const name = cleanString(data.name);
  const order = cleanNumber(data.order);
  if (!name) throw new Error('Nome do bloco é obrigatório.');

  const orgId = await getOrgIdForCondo(db, id);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    name,
    order,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', id, 'blocks'), docData);
  await writeAuditLog(db, {
    orgId,
    condoId: id,
    actorUid: user.uid,
    action: 'block.create',
    targetPath: `condos/${id}/blocks/${ref.id}`,
    metadata: { name, order },
  });

  return { id: ref.id, ...docData };
}

export async function updateBlock(condoId, blockId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const bId = cleanString(blockId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!bId) throw new Error('blockId inválido.');

  const patch = { updatedAt: serverTimestamp() };
  if (data && Object.prototype.hasOwnProperty.call(data, 'name')) patch.name = cleanString(data.name);
  if (data && Object.prototype.hasOwnProperty.call(data, 'order')) patch.order = cleanNumber(data.order);

  await updateDoc(doc(db, 'condos', cId, 'blocks', bId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'block.update',
    targetPath: `condos/${cId}/blocks/${bId}`,
    metadata: { patch: data || {} },
  });

  return { id: bId, ...patch };
}

export async function deleteBlock(condoId, blockId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const bId = cleanString(blockId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!bId) throw new Error('blockId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);

  await deleteDoc(doc(db, 'condos', cId, 'blocks', bId));
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'block.delete',
    targetPath: `condos/${cId}/blocks/${bId}`,
    metadata: {},
  });
}

export async function listUnits(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'units'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => cleanString(a.number).localeCompare(cleanString(b.number)));
  return items;
}

export async function createUnit(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const number = cleanString(data.number);
  const blockId = cleanString(data.blockId);
  const floor = cleanNumber(data.floor);
  if (!number) throw new Error('Número da unidade é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    number,
    blockId: blockId || null,
    floor,
    status: cleanString(data.status || 'active'),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'units'), docData);
  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'unit.create',
    targetPath: `condos/${cId}/units/${ref.id}`,
    metadata: { number, blockId: blockId || null, floor },
  });

  return { id: ref.id, ...docData };
}

export async function updateUnit(condoId, unitId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const uId = cleanString(unitId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!uId) throw new Error('unitId inválido.');

  const patch = { updatedAt: serverTimestamp() };
  if (data && Object.prototype.hasOwnProperty.call(data, 'number')) patch.number = cleanString(data.number);
  if (data && Object.prototype.hasOwnProperty.call(data, 'blockId')) patch.blockId = cleanString(data.blockId) || null;
  if (data && Object.prototype.hasOwnProperty.call(data, 'floor')) patch.floor = cleanNumber(data.floor);
  if (data && Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = cleanString(data.status);

  await updateDoc(doc(db, 'condos', cId, 'units', uId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'unit.update',
    targetPath: `condos/${cId}/units/${uId}`,
    metadata: { patch: data || {} },
  });

  return { id: uId, ...patch };
}

export async function deleteUnit(condoId, unitId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const uId = cleanString(unitId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!uId) throw new Error('unitId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);

  await deleteDoc(doc(db, 'condos', cId, 'units', uId));
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'unit.delete',
    targetPath: `condos/${cId}/units/${uId}`,
    metadata: {},
  });
}

export async function listMandates(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'mandates'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => {
    const at = a.startsAt && typeof a.startsAt.toDate === 'function' ? a.startsAt.toDate().getTime() : 0;
    const bt = b.startsAt && typeof b.startsAt.toDate === 'function' ? b.startsAt.toDate().getTime() : 0;
    return bt - at;
  });
  return items;
}

export async function createMandate(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const title = cleanString(data.title);
  if (!title) throw new Error('Título do mandato é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const startsAt = toTimestampDate(data.startsAt);
  const endsAt = toTimestampDate(data.endsAt);
  const docData = {
    title,
    sindicoName: cleanString(data.sindicoName) || null,
    startsAt: startsAt || null,
    endsAt: endsAt || null,
    notes: cleanString(data.notes) || null,
    status: cleanString(data.status || 'active'),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'mandates'), docData);
  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'mandate.create',
    targetPath: `condos/${cId}/mandates/${ref.id}`,
    metadata: { title },
  });

  return { id: ref.id, ...docData };
}

export async function updateMandate(condoId, mandateId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const mId = cleanString(mandateId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!mId) throw new Error('mandateId inválido.');

  const patch = { updatedAt: serverTimestamp() };
  if (data && Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (data && Object.prototype.hasOwnProperty.call(data, 'sindicoName')) patch.sindicoName = cleanString(data.sindicoName) || null;
  if (data && Object.prototype.hasOwnProperty.call(data, 'startsAt')) patch.startsAt = toTimestampDate(data.startsAt);
  if (data && Object.prototype.hasOwnProperty.call(data, 'endsAt')) patch.endsAt = toTimestampDate(data.endsAt);
  if (data && Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes) || null;
  if (data && Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = cleanString(data.status);

  await updateDoc(doc(db, 'condos', cId, 'mandates', mId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'mandate.update',
    targetPath: `condos/${cId}/mandates/${mId}`,
    metadata: { patch: data || {} },
  });

  return { id: mId, ...patch };
}

export async function deleteMandate(condoId, mandateId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const mId = cleanString(mandateId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!mId) throw new Error('mandateId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);

  await deleteDoc(doc(db, 'condos', cId, 'mandates', mId));
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'mandate.delete',
    targetPath: `condos/${cId}/mandates/${mId}`,
    metadata: {},
  });
}
