// Viva Haven — Gestão de Moradores (MVP)
// Firestore:
// - condos/{condoId}/residents/{id}
// - condos/{condoId}/vehicles/{id}
// - condos/{condoId}/pets/{id}
// - condos/{condoId}/reservations/{id}
// - condos/{condoId}/warnings/{id}
// - condos/{condoId}/fines/{id}

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

function toDateTimeLocal(value) {
  // value: yyyy-mm-ddThh:mm
  const v = cleanString(value);
  if (!v) return null;
  const dt = new Date(v);
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

function normalizeReservationStatus(value) {
  const v = cleanString(value).toLowerCase();
  if (['solicitado', 'aprovado', 'reprovado', 'cancelado'].includes(v)) return v;
  return 'solicitado';
}

function normalizeWarningStatus(value) {
  const v = cleanString(value).toLowerCase();
  if (['ativa', 'encerrada'].includes(v)) return v;
  return 'ativa';
}

function normalizeFineStatus(value) {
  const v = cleanString(value).toLowerCase();
  if (['aberta', 'paga', 'cancelada'].includes(v)) return v;
  return 'aberta';
}

// ===== Residents =====
export async function listResidents(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'residents'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => cleanString(a.name).localeCompare(cleanString(b.name)));
  return items;
}

export async function createResident(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const name = cleanString(data.name);
  if (!name) throw new Error('Nome é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    orgId,
    condoId: cId,
    uid: cleanString(data.uid) || null,
    name,
    unitId: cleanString(data.unitId) || null,
    unitLabel: cleanString(data.unitLabel) || null,
    phone: cleanString(data.phone) || null,
    email: cleanString(data.email) || null,
    status: cleanString(data.status) || 'ativo',
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'residents'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'resident.create',
    targetPath: `condos/${cId}/residents/${ref.id}`,
    metadata: { name, unitLabel: docData.unitLabel },
  });

  return { id: ref.id, ...docData };
}

export async function updateResident(condoId, residentId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const rId = cleanString(residentId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!rId) throw new Error('residentId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'uid')) patch.uid = cleanString(data.uid) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'name')) patch.name = cleanString(data.name);
  if (Object.prototype.hasOwnProperty.call(data, 'unitId')) patch.unitId = cleanString(data.unitId) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'unitLabel')) patch.unitLabel = cleanString(data.unitLabel) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'phone')) patch.phone = cleanString(data.phone) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'email')) patch.email = cleanString(data.email) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = cleanString(data.status) || 'ativo';

  await updateDoc(doc(db, 'condos', cId, 'residents', rId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'resident.update',
    targetPath: `condos/${cId}/residents/${rId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteResident(condoId, residentId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const rId = cleanString(residentId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!rId) throw new Error('residentId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'residents', rId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'resident.delete',
    targetPath: `condos/${cId}/residents/${rId}`,
    metadata: {},
  });
}

// ===== Vehicles =====
export async function listVehicles(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'vehicles'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => cleanString(a.plate).localeCompare(cleanString(b.plate)));
  return items;
}

export async function createVehicle(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const plate = cleanString(data.plate);
  if (!plate) throw new Error('Placa é obrigatória.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    orgId,
    condoId: cId,
    plate,
    model: cleanString(data.model) || null,
    color: cleanString(data.color) || null,
    unitLabel: cleanString(data.unitLabel) || null,
    ownerUid: cleanString(data.ownerUid) || null,
    residentId: cleanString(data.residentId) || null,
    status: cleanString(data.status) || 'ativo',
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'vehicles'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'vehicle.create',
    targetPath: `condos/${cId}/vehicles/${ref.id}`,
    metadata: { plate },
  });

  return { id: ref.id, ...docData };
}

export async function updateVehicle(condoId, vehicleId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const vId = cleanString(vehicleId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!vId) throw new Error('vehicleId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'plate')) patch.plate = cleanString(data.plate);
  if (Object.prototype.hasOwnProperty.call(data, 'model')) patch.model = cleanString(data.model) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'color')) patch.color = cleanString(data.color) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'unitLabel')) patch.unitLabel = cleanString(data.unitLabel) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'ownerUid')) patch.ownerUid = cleanString(data.ownerUid) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'residentId')) patch.residentId = cleanString(data.residentId) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = cleanString(data.status) || 'ativo';

  await updateDoc(doc(db, 'condos', cId, 'vehicles', vId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'vehicle.update',
    targetPath: `condos/${cId}/vehicles/${vId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteVehicle(condoId, vehicleId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const vId = cleanString(vehicleId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!vId) throw new Error('vehicleId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'vehicles', vId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'vehicle.delete',
    targetPath: `condos/${cId}/vehicles/${vId}`,
    metadata: {},
  });
}

// ===== Pets =====
export async function listPets(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'pets'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => cleanString(a.name).localeCompare(cleanString(b.name)));
  return items;
}

export async function createPet(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const name = cleanString(data.name);
  if (!name) throw new Error('Nome do pet é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    orgId,
    condoId: cId,
    name,
    species: cleanString(data.species) || 'outro',
    breed: cleanString(data.breed) || null,
    unitLabel: cleanString(data.unitLabel) || null,
    ownerUid: cleanString(data.ownerUid) || null,
    residentId: cleanString(data.residentId) || null,
    notes: cleanString(data.notes) || null,
    status: cleanString(data.status) || 'ativo',
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'pets'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'pet.create',
    targetPath: `condos/${cId}/pets/${ref.id}`,
    metadata: { name, species: docData.species },
  });

  return { id: ref.id, ...docData };
}

export async function updatePet(condoId, petId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(petId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('petId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'name')) patch.name = cleanString(data.name);
  if (Object.prototype.hasOwnProperty.call(data, 'species')) patch.species = cleanString(data.species) || 'outro';
  if (Object.prototype.hasOwnProperty.call(data, 'breed')) patch.breed = cleanString(data.breed) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'unitLabel')) patch.unitLabel = cleanString(data.unitLabel) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'ownerUid')) patch.ownerUid = cleanString(data.ownerUid) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'residentId')) patch.residentId = cleanString(data.residentId) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) patch.notes = cleanString(data.notes) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = cleanString(data.status) || 'ativo';

  await updateDoc(doc(db, 'condos', cId, 'pets', pId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'pet.update',
    targetPath: `condos/${cId}/pets/${pId}`,
    metadata: { patch: data || {} },
  });
}

export async function deletePet(condoId, petId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(petId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('petId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'pets', pId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'pet.delete',
    targetPath: `condos/${cId}/pets/${pId}`,
    metadata: {},
  });
}

// ===== Reservations =====
export async function listReservations(condoId, opts) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const mineOnly = !!opts.mineOnly;
  const status = cleanString(opts.status);

  let qRef = collection(db, 'condos', cId, 'reservations');
  const filters = [];
  if (mineOnly) filters.push(where('createdBy', '==', user.uid));
  if (status) filters.push(where('status', '==', normalizeReservationStatus(status)));

  const qs = filters.length ? await getDocs(query(qRef, ...filters)) : await getDocs(qRef);
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  items.sort((a, b) => {
    const as = a.startAt && typeof a.startAt.toDate === 'function' ? a.startAt.toDate().getTime() : 0;
    const bs = b.startAt && typeof b.startAt.toDate === 'function' ? b.startAt.toDate().getTime() : 0;
    return bs - as;
  });

  return items;
}

export async function createReservation(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const area = cleanString(data.area);
  const title = cleanString(data.title);
  const startAt = toDateTimeLocal(data.startAt);
  const endAt = toDateTimeLocal(data.endAt);
  if (!area) throw new Error('Área é obrigatória.');
  if (!title) throw new Error('Título é obrigatório.');
  if (!startAt) throw new Error('Início inválido.');
  if (!endAt) throw new Error('Fim inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    orgId,
    condoId: cId,
    area,
    title,
    note: cleanString(data.note) || null,
    startAt,
    endAt,
    status: 'solicitado',
    decisionNote: null,
    decisionBy: null,
    decisionAt: null,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'reservations'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'reservation.create',
    targetPath: `condos/${cId}/reservations/${ref.id}`,
    metadata: { area, startAt: startAt.toISOString() },
  });

  return { id: ref.id, ...docData };
}

export async function updateReservationAsAdmin(condoId, reservationId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const rId = cleanString(reservationId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!rId) throw new Error('reservationId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizeReservationStatus(data.status);
  if (Object.prototype.hasOwnProperty.call(data, 'decisionNote')) patch.decisionNote = cleanString(data.decisionNote) || null;

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

  await updateDoc(doc(db, 'condos', cId, 'reservations', rId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'reservation.update.admin',
    targetPath: `condos/${cId}/reservations/${rId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteReservation(condoId, reservationId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const rId = cleanString(reservationId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!rId) throw new Error('reservationId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'reservations', rId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'reservation.delete',
    targetPath: `condos/${cId}/reservations/${rId}`,
    metadata: {},
  });
}

// ===== Warnings =====
export async function listWarnings(condoId, opts) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const mineOnly = !!opts.mineOnly;
  const status = cleanString(opts.status);

  let qRef = collection(db, 'condos', cId, 'warnings');
  const filters = [];
  if (mineOnly) filters.push(where('targetUid', '==', user.uid));
  if (status) filters.push(where('status', '==', normalizeWarningStatus(status)));

  const qs = filters.length ? await getDocs(query(qRef, ...filters)) : await getDocs(qRef);
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  items.sort((a, b) => {
    const ai = a.issuedAt && typeof a.issuedAt.toDate === 'function' ? a.issuedAt.toDate().getTime() : 0;
    const bi = b.issuedAt && typeof b.issuedAt.toDate === 'function' ? b.issuedAt.toDate().getTime() : 0;
    return bi - ai;
  });

  return items;
}

export async function createWarning(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const targetUid = cleanString(data.targetUid);
  const title = cleanString(data.title);
  const description = cleanString(data.description);
  if (!targetUid) throw new Error('targetUid é obrigatório.');
  if (!title) throw new Error('Título é obrigatório.');
  if (!description) throw new Error('Descrição é obrigatória.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    orgId,
    condoId: cId,
    targetUid,
    unitLabel: cleanString(data.unitLabel) || null,
    title,
    description,
    status: normalizeWarningStatus(data.status || 'ativa'),
    issuedAt: serverTimestamp(),
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'warnings'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'warning.create',
    targetPath: `condos/${cId}/warnings/${ref.id}`,
    metadata: { targetUid, status: docData.status },
  });

  return { id: ref.id, ...docData };
}

export async function updateWarning(condoId, warningId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const wId = cleanString(warningId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!wId) throw new Error('warningId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'targetUid')) patch.targetUid = cleanString(data.targetUid);
  if (Object.prototype.hasOwnProperty.call(data, 'unitLabel')) patch.unitLabel = cleanString(data.unitLabel) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'description')) patch.description = cleanString(data.description);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizeWarningStatus(data.status);

  await updateDoc(doc(db, 'condos', cId, 'warnings', wId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'warning.update',
    targetPath: `condos/${cId}/warnings/${wId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteWarning(condoId, warningId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const wId = cleanString(warningId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!wId) throw new Error('warningId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'warnings', wId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'warning.delete',
    targetPath: `condos/${cId}/warnings/${wId}`,
    metadata: {},
  });
}

// ===== Fines =====
export async function listFines(condoId, opts) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const mineOnly = !!opts.mineOnly;
  const status = cleanString(opts.status);

  let qRef = collection(db, 'condos', cId, 'fines');
  const filters = [];
  if (mineOnly) filters.push(where('targetUid', '==', user.uid));
  if (status) filters.push(where('status', '==', normalizeFineStatus(status)));

  const qs = filters.length ? await getDocs(query(qRef, ...filters)) : await getDocs(qRef);
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  items.sort((a, b) => {
    const ai = a.issuedAt && typeof a.issuedAt.toDate === 'function' ? a.issuedAt.toDate().getTime() : 0;
    const bi = b.issuedAt && typeof b.issuedAt.toDate === 'function' ? b.issuedAt.toDate().getTime() : 0;
    return bi - ai;
  });

  return items;
}

export async function createFine(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const targetUid = cleanString(data.targetUid);
  const title = cleanString(data.title);
  const description = cleanString(data.description);
  const amountCents = cleanNumber(data.amountCents);
  if (!targetUid) throw new Error('targetUid é obrigatório.');
  if (!title) throw new Error('Título é obrigatório.');
  if (!description) throw new Error('Descrição é obrigatória.');
  if (amountCents == null || amountCents <= 0) throw new Error('Valor (centavos) inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const dueAt = data.dueDate ? toDateOnly(data.dueDate) : null;

  const docData = {
    orgId,
    condoId: cId,
    targetUid,
    unitLabel: cleanString(data.unitLabel) || null,
    title,
    description,
    amountCents,
    dueAt,
    status: normalizeFineStatus(data.status || 'aberta'),
    issuedAt: serverTimestamp(),
    paidAt: null,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'fines'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'fine.create',
    targetPath: `condos/${cId}/fines/${ref.id}`,
    metadata: { targetUid, amountCents, status: docData.status },
  });

  return { id: ref.id, ...docData };
}

export async function updateFine(condoId, fineId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const fId = cleanString(fineId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!fId) throw new Error('fineId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'targetUid')) patch.targetUid = cleanString(data.targetUid);
  if (Object.prototype.hasOwnProperty.call(data, 'unitLabel')) patch.unitLabel = cleanString(data.unitLabel) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'description')) patch.description = cleanString(data.description);
  if (Object.prototype.hasOwnProperty.call(data, 'amountCents')) patch.amountCents = cleanNumber(data.amountCents);
  if (Object.prototype.hasOwnProperty.call(data, 'dueDate')) patch.dueAt = toDateOnly(data.dueDate);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizeFineStatus(data.status);
  if (Object.prototype.hasOwnProperty.call(data, 'paid')) {
    const paid = !!data.paid;
    patch.paidAt = paid ? serverTimestamp() : null;
    if (paid) patch.status = 'paga';
  }

  await updateDoc(doc(db, 'condos', cId, 'fines', fId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'fine.update',
    targetPath: `condos/${cId}/fines/${fId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteFine(condoId, fineId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const fId = cleanString(fineId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!fId) throw new Error('fineId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'fines', fId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'fine.delete',
    targetPath: `condos/${cId}/fines/${fId}`,
    metadata: {},
  });
}

export const ResidentsTypes = {
  toDateOnly,
  toDateTimeLocal,
  normalizeReservationStatus,
  normalizeWarningStatus,
  normalizeFineStatus,
};
