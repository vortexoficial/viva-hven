// Viva Haven — Módulo de Assembleias
// Firestore:
// - condos/{condoId}/assemblies/{assemblyId} (metadata + busca)
// - assemblies/{assemblyId} (espelho metadata + hospeda subcoleções)
// - assemblies/{assemblyId}/attendances/{key} (key = uid OU unitId)
// - assemblies/{assemblyId}/votes/{key} (key = uid OU unitId)
// - assemblies/{assemblyId}/minutes/{minuteId} (latest + histórico)
// - assemblies/{assemblyId}/proxies/{unitId}
// - assemblies/{assemblyId}/signatures/{uid}

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
  writeBatch,
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

function normalizeVoteMode(value) {
  const v = cleanString(value).toLowerCase();
  if (v === 'user' || v === 'uid') return 'user';
  return 'unit';
}

function stripDiacritics(text) {
  try {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  } catch (e) {
    return String(text || '');
  }
}

function tokenizeForSearch(input) {
  const raw = stripDiacritics(input).toLowerCase();
  const parts = raw
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/g)
    .map((x) => cleanString(x))
    .filter(Boolean)
    .filter((x) => x.length >= 3);

  const out = [];
  const seen = new Set();
  for (const p of parts) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= 50) break;
  }
  return out;
}

async function sha256Hex(text) {
  const t = String(text || '');
  const c = typeof crypto !== 'undefined' ? crypto : null;
  if (!c || !c.subtle || typeof TextEncoder === 'undefined') return null;

  const bytes = new TextEncoder().encode(t);
  const hash = await c.subtle.digest('SHA-256', bytes);
  const arr = Array.from(new Uint8Array(hash));
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toDateOnly(value) {
  // yyyy-mm-dd -> Date
  const v = cleanString(value);
  if (!v) return null;
  const dt = new Date(v + 'T00:00:00');
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

async function getRootAssembly(db, assemblyId) {
  const aId = cleanString(assemblyId);
  if (!aId) throw new Error('assemblyId inválido.');
  const snap = await getDoc(doc(db, 'assemblies', aId));
  if (!snap.exists()) throw new Error('Assembleia não encontrada.');
  return snap.data() || {};
}

async function writeAuditLog(db, payload) {
  payload = payload || {};

  const orgId = cleanString(payload.orgId);
  const condoId = cleanString(payload.condoId);
  if (!orgId) throw new Error('orgId é obrigatório para auditLogs.');
  if (!condoId) throw new Error('condoId é obrigatório para auditLogs (condo-scoped).');

  const docData = {
    orgId,
    condoId,
    actorUid: cleanString(payload.actorUid),
    action: cleanString(payload.action),
    entityType: cleanString(payload.entityType),
    entityId: cleanString(payload.entityId),
    targetPath: cleanString(payload.targetPath) || null,
    createdAt: serverTimestamp(),
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };

  await addDoc(collection(db, 'condos', condoId, 'auditLogs'), docData);
}

async function getOrgIdForCondoByDb(db, condoId) {
  const cId = cleanString(condoId);
  if (!cId) return null;
  const snap = await getDoc(doc(db, 'condos', cId));
  if (!snap.exists()) return null;
  const data = snap.data() || {};
  return data.orgId ? cleanString(data.orgId) : null;
}

async function getMyMembershipForCondo(db, uid, condoId) {
  const u = cleanString(uid);
  const cId = cleanString(condoId);
  if (!u || !cId) return null;
  const membershipId = `${u}_${cId}`;
  const snap = await getDoc(doc(db, 'memberships', membershipId));
  return snap.exists() ? snap.data() || null : null;
}

async function getMyUnitIdOrThrow(db, uid, condoId) {
  const m = await getMyMembershipForCondo(db, uid, condoId);
  const unitId = m && m.unitId ? cleanString(m.unitId) : '';
  if (!unitId) throw new Error('Sua unidade não está vinculada ao seu acesso (membership.unitId).');
  return unitId;
}

async function getAttendanceKey(db, assemblyId, condoId, uid) {
  const root = await getRootAssembly(db, assemblyId);
  const mode = normalizeVoteMode(root.voteMode);
  if (mode === 'user') return cleanString(uid);
  return await getMyUnitIdOrThrow(db, uid, condoId);
}

async function getVoteKey(db, assemblyId, condoId, uid) {
  const root = await getRootAssembly(db, assemblyId);
  const mode = normalizeVoteMode(root.voteMode);
  if (mode === 'user') return cleanString(uid);
  return await getMyUnitIdOrThrow(db, uid, condoId);
}

export async function getOrgIdForCondo(condoId) {
  const { db } = await requireAuth();
  return await getOrgIdForCondoByDb(db, condoId);
}

export async function listAssembliesForCondo(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'assemblies'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  // Ordena por data (desc) e depois por createdAt
  items.sort((a, b) => {
    const ad = a.date && typeof a.date.toDate === 'function' ? a.date.toDate().getTime() : 0;
    const bd = b.date && typeof b.date.toDate === 'function' ? b.date.toDate().getTime() : 0;
    if (ad !== bd) return bd - ad;

    const ac = a.createdAt && typeof a.createdAt.toDate === 'function' ? a.createdAt.toDate().getTime() : 0;
    const bc = b.createdAt && typeof b.createdAt.toDate === 'function' ? b.createdAt.toDate().getTime() : 0;
    return bc - ac;
  });

  return items;
}

export async function searchAssembliesForCondo(condoId, keyword) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const token = tokenizeForSearch(keyword || '')[0] || '';
  if (!token) return await listAssembliesForCondo(cId);

  const qs = await getDocs(query(collection(db, 'condos', cId, 'assemblies'), where('searchTokens', 'array-contains', token)));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => {
    const ad = a.date && typeof a.date.toDate === 'function' ? a.date.toDate().getTime() : 0;
    const bd = b.date && typeof b.date.toDate === 'function' ? b.date.toDate().getTime() : 0;
    if (ad !== bd) return bd - ad;

    const ac = a.createdAt && typeof a.createdAt.toDate === 'function' ? a.createdAt.toDate().getTime() : 0;
    const bc = b.createdAt && typeof b.createdAt.toDate === 'function' ? b.createdAt.toDate().getTime() : 0;
    return bc - ac;
  });
  return items;
}

export async function createAssembly(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const orgId = await getOrgIdForCondoByDb(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const title = cleanString(data.title);
  if (!title) throw new Error('Título é obrigatório.');

  const date = toDateOnly(data.date);

  const noticeText = cleanString(data.noticeText);
  const agendaText = cleanString(data.agendaText);
  const voteMode = normalizeVoteMode(data.voteMode);
  const searchTokens = tokenizeForSearch([title, noticeText, agendaText, cleanString(data.location)].filter(Boolean).join(' '));

  const docData = {
    orgId,
    condoId: cId,
    title,
    date: date || null,
    location: cleanString(data.location) || null,
    noticeText: noticeText || null,
    agendaText: agendaText || null,
    voteMode,
    searchTokens,
    status: 'draft', // draft -> called -> closed
    voteStatus: 'closed', // open|closed
    calledAt: null,
    calledBy: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  const refCondo = doc(collection(db, 'condos', cId, 'assemblies'));
  const refRoot = doc(db, 'assemblies', refCondo.id);

  batch.set(refCondo, docData);
  batch.set(refRoot, docData);
  await batch.commit();

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'assembly.create',
    entityType: 'assembly',
    entityId: refCondo.id,
    targetPath: `condos/${cId}/assemblies/${refCondo.id}`,
    metadata: { title },
  });

  return { id: refCondo.id, ...docData };
}

export async function updateAssembly(condoId, assemblyId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const aId = cleanString(assemblyId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!aId) throw new Error('assemblyId inválido.');

  const patch = { updatedAt: serverTimestamp() };
  if (data && Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (data && Object.prototype.hasOwnProperty.call(data, 'location')) patch.location = cleanString(data.location) || null;
  if (data && Object.prototype.hasOwnProperty.call(data, 'date')) patch.date = toDateOnly(data.date);
  if (data && Object.prototype.hasOwnProperty.call(data, 'noticeText')) patch.noticeText = cleanString(data.noticeText) || null;
  if (data && Object.prototype.hasOwnProperty.call(data, 'agendaText')) patch.agendaText = cleanString(data.agendaText) || null;
  if (data && Object.prototype.hasOwnProperty.call(data, 'voteMode')) patch.voteMode = normalizeVoteMode(data.voteMode);

  // Atualiza tokens se qualquer campo relevante mudou
  if (
    (data && Object.prototype.hasOwnProperty.call(data, 'title')) ||
    (data && Object.prototype.hasOwnProperty.call(data, 'location')) ||
    (data && Object.prototype.hasOwnProperty.call(data, 'noticeText')) ||
    (data && Object.prototype.hasOwnProperty.call(data, 'agendaText'))
  ) {
    const current = await getDoc(doc(db, 'condos', cId, 'assemblies', aId));
    const base = current.exists() ? current.data() || {} : {};
    const merged = {
      title: Object.prototype.hasOwnProperty.call(patch, 'title') ? patch.title : base.title,
      location: Object.prototype.hasOwnProperty.call(patch, 'location') ? patch.location : base.location,
      noticeText: Object.prototype.hasOwnProperty.call(patch, 'noticeText') ? patch.noticeText : base.noticeText,
      agendaText: Object.prototype.hasOwnProperty.call(patch, 'agendaText') ? patch.agendaText : base.agendaText,
    };
    patch.searchTokens = tokenizeForSearch([merged.title, merged.location, merged.noticeText, merged.agendaText].filter(Boolean).join(' '));
  }

  await updateDoc(doc(db, 'condos', cId, 'assemblies', aId), patch);
  await updateDoc(doc(db, 'assemblies', aId), patch);

  const orgId = await getOrgIdForCondoByDb(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'assembly.update',
    entityType: 'assembly',
    entityId: aId,
    targetPath: `condos/${cId}/assemblies/${aId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteAssembly(condoId, assemblyId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const aId = cleanString(assemblyId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!aId) throw new Error('assemblyId inválido.');

  const orgId = await getOrgIdForCondoByDb(db, cId);

  await deleteDoc(doc(db, 'condos', cId, 'assemblies', aId));
  await deleteDoc(doc(db, 'assemblies', aId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'assembly.delete',
    entityType: 'assembly',
    entityId: aId,
    targetPath: `condos/${cId}/assemblies/${aId}`,
    metadata: {},
  });
}

export async function callAssembly(condoId, assemblyId, noticeText) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const aId = cleanString(assemblyId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!aId) throw new Error('assemblyId inválido.');

  let base = {};
  try {
    const cur = await getDoc(doc(db, 'condos', cId, 'assemblies', aId));
    base = cur.exists() ? cur.data() || {} : {};
  } catch (e) {}

  const patch = {
    status: 'called',
    calledAt: serverTimestamp(),
    calledBy: user.uid,
    noticeText: cleanString(noticeText) || null,
    updatedAt: serverTimestamp(),
  };

  patch.searchTokens = tokenizeForSearch(
    [base.title, base.location, base.agendaText, cleanString(noticeText)].filter(Boolean).join(' ')
  );

  await updateDoc(doc(db, 'condos', cId, 'assemblies', aId), patch);
  await updateDoc(doc(db, 'assemblies', aId), patch);

  const orgId = await getOrgIdForCondoByDb(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'assembly.call',
    entityType: 'assembly',
    entityId: aId,
    targetPath: `condos/${cId}/assemblies/${aId}`,
    metadata: { noticeText: cleanString(noticeText) || null },
  });
}

export async function openVoting(condoId, assemblyId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const aId = cleanString(assemblyId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!aId) throw new Error('assemblyId inválido.');

  const patch = { voteStatus: 'open', updatedAt: serverTimestamp() };
  await updateDoc(doc(db, 'condos', cId, 'assemblies', aId), patch);
  await updateDoc(doc(db, 'assemblies', aId), patch);

  const orgId = await getOrgIdForCondoByDb(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'vote.open',
    entityType: 'assembly',
    entityId: aId,
    targetPath: `condos/${cId}/assemblies/${aId}`,
    metadata: {},
  });
}

export async function closeVoting(condoId, assemblyId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const aId = cleanString(assemblyId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!aId) throw new Error('assemblyId inválido.');

  const patch = { voteStatus: 'closed', updatedAt: serverTimestamp() };
  await updateDoc(doc(db, 'condos', cId, 'assemblies', aId), patch);
  await updateDoc(doc(db, 'assemblies', aId), patch);

  const orgId = await getOrgIdForCondoByDb(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'vote.close',
    entityType: 'assembly',
    entityId: aId,
    targetPath: `condos/${cId}/assemblies/${aId}`,
    metadata: {},
  });
}

export async function confirmAttendance(assemblyId, condoId) {
  const { db, user } = await requireAuth();
  const aId = cleanString(assemblyId);
  const cId = cleanString(condoId);
  if (!aId) throw new Error('assemblyId inválido.');
  if (!cId) throw new Error('condoId inválido.');

  const root = await getRootAssembly(db, aId);
  if (root.condoId && cleanString(root.condoId) !== cId) throw new Error('Condomínio não confere para esta assembleia.');

  const orgId = await getOrgIdForCondoByDb(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const key = await getAttendanceKey(db, aId, cId, user.uid);
  const unitId = key !== user.uid ? cleanString(key) : null;
  const ref = doc(db, 'assemblies', aId, 'attendances', key);
  await setDoc(
    ref,
    {
      uid: user.uid,
      unitId,
      condoId: cId,
      confirmedAt: serverTimestamp(),
      confirmedByUid: user.uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'attendance.confirm',
    entityType: 'assembly',
    entityId: aId,
    targetPath: `assemblies/${aId}/attendances/${key}`,
    metadata: {},
  });
}

export async function castVote(assemblyId, condoId, choice) {
  const { db, user } = await requireAuth();
  const aId = cleanString(assemblyId);
  const cId = cleanString(condoId);
  const v = cleanString(choice).toLowerCase();
  if (!aId) throw new Error('assemblyId inválido.');
  if (!cId) throw new Error('condoId inválido.');
  if (!['sim', 'nao', 'abstencao'].includes(v)) throw new Error('Voto inválido.');

  const root = await getRootAssembly(db, aId);
  if (root.condoId && cleanString(root.condoId) !== cId) throw new Error('Condomínio não confere para esta assembleia.');
  if (cleanString(root.voteStatus) !== 'open') throw new Error('Votação está fechada.');

  const orgId = await getOrgIdForCondoByDb(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const key = await getVoteKey(db, aId, cId, user.uid);
  const unitId = key !== user.uid ? cleanString(key) : null;
  const ref = doc(db, 'assemblies', aId, 'votes', key);
  await setDoc(
    ref,
    {
      uid: user.uid,
      unitId,
      condoId: cId,
      choice: v,
      votedAt: serverTimestamp(),
      votedByUid: user.uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'vote.cast',
    entityType: 'assembly',
    entityId: aId,
    targetPath: `assemblies/${aId}/votes/${key}`,
    metadata: { choice: v },
  });
}

export async function getAttendanceForUser(assemblyId, condoId) {
  const { db, user } = await requireAuth();
  const aId = cleanString(assemblyId);
  const cId = cleanString(condoId);
  if (!aId) throw new Error('assemblyId inválido.');
  if (!cId) throw new Error('condoId inválido.');
  try {
    const key = await getAttendanceKey(db, aId, cId, user.uid);
    const snap = await getDoc(doc(db, 'assemblies', aId, 'attendances', key));
    return snap.exists() ? snap.data() || null : null;
  } catch (e) {
    return null;
  }
}

export async function getVoteForUser(assemblyId, condoId) {
  const { db, user } = await requireAuth();
  const aId = cleanString(assemblyId);
  const cId = cleanString(condoId);
  if (!aId) throw new Error('assemblyId inválido.');
  if (!cId) throw new Error('condoId inválido.');
  try {
    const key = await getVoteKey(db, aId, cId, user.uid);
    const snap = await getDoc(doc(db, 'assemblies', aId, 'votes', key));
    return snap.exists() ? snap.data() || null : null;
  } catch (e) {
    return null;
  }
}

export async function getLatestMinutes(assemblyId) {
  const { db } = await requireAuth();
  const aId = cleanString(assemblyId);
  if (!aId) throw new Error('assemblyId inválido.');
  const snap = await getDoc(doc(db, 'assemblies', aId, 'minutes', 'latest'));
  return snap.exists() ? snap.data() || null : null;
}

export async function listMinutesHistory(assemblyId) {
  const { db } = await requireAuth();
  const aId = cleanString(assemblyId);
  if (!aId) throw new Error('assemblyId inválido.');
  const qs = await getDocs(collection(db, 'assemblies', aId, 'minutes'));
  const items = qs.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((x) => x.id !== 'latest');

  items.sort((a, b) => {
    const ac = a.createdAt && typeof a.createdAt.toDate === 'function' ? a.createdAt.toDate().getTime() : 0;
    const bc = b.createdAt && typeof b.createdAt.toDate === 'function' ? b.createdAt.toDate().getTime() : 0;
    return bc - ac;
  });
  return items;
}

export async function saveMinutes(assemblyId, condoId, text) {
  const { db, user } = await requireAuth();
  const aId = cleanString(assemblyId);
  const cId = cleanString(condoId);
  const t = String(text || '').trim();
  if (!aId) throw new Error('assemblyId inválido.');
  if (!cId) throw new Error('condoId inválido.');
  if (!t) throw new Error('Texto da ata é obrigatório.');

  const orgId = await getOrgIdForCondoByDb(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const latestRef = doc(db, 'assemblies', aId, 'minutes', 'latest');
  const latestSnap = await getDoc(latestRef);
  const latest = latestSnap.exists() ? latestSnap.data() || {} : {};
  const prevVersion = typeof latest.version === 'number' ? latest.version : 0;
  const version = prevVersion + 1;

  const hash = (latest && latest.hash && String(latest.text || '').trim() === t) ? cleanString(latest.hash) : await sha256Hex(t);
  const searchTokens = tokenizeForSearch(t);

  await setDoc(
    latestRef,
    {
      condoId: cId,
      orgId,
      text: t,
      hash: hash || null,
      version,
      searchTokens,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      createdAt: latest && latest.createdAt ? latest.createdAt : serverTimestamp(),
    },
    { merge: true }
  );

  // Histórico (versões): 1 doc por salvamento
  await addDoc(collection(db, 'assemblies', aId, 'minutes'), {
    condoId: cId,
    orgId,
    text: t,
    hash: hash || null,
    version,
    searchTokens,
    createdAt: serverTimestamp(),
    createdBy: user.uid,
  });

  // Atualiza tokens no documento da assembleia (para busca unificada)
  try {
    const aRef = doc(db, 'condos', cId, 'assemblies', aId);
    const aSnap = await getDoc(aRef);
    const a = aSnap.exists() ? aSnap.data() || {} : {};
    const baseTokens = Array.isArray(a.searchTokens) ? a.searchTokens : [];
    const merged = [];
    const seen = new Set();
    [...baseTokens, ...searchTokens].forEach((x) => {
      const v = cleanString(x).toLowerCase();
      if (!v) return;
      if (seen.has(v)) return;
      seen.add(v);
      merged.push(v);
    });
    await updateDoc(aRef, { searchTokens: merged.slice(0, 50), updatedAt: serverTimestamp() });
    await updateDoc(doc(db, 'assemblies', aId), { searchTokens: merged.slice(0, 50), updatedAt: serverTimestamp() });
  } catch (e) {}

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'minutes.save',
    entityType: 'assembly',
    entityId: aId,
    targetPath: `assemblies/${aId}/minutes/latest`,
    metadata: { length: t.length, version, hash: hash || null },
  });
}

export async function signLatestMinutes(assemblyId, condoId) {
  const { db, user } = await requireAuth();
  const aId = cleanString(assemblyId);
  const cId = cleanString(condoId);
  if (!aId) throw new Error('assemblyId inválido.');
  if (!cId) throw new Error('condoId inválido.');

  const orgId = await getOrgIdForCondoByDb(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const minutes = await getLatestMinutes(aId);
  if (!minutes || !minutes.text) throw new Error('Não há ata publicada para assinar.');
  const hash = minutes.hash ? cleanString(minutes.hash) : await sha256Hex(minutes.text);
  if (!hash) throw new Error('Não foi possível calcular hash da ata neste dispositivo.');

  await setDoc(
    doc(db, 'assemblies', aId, 'signatures', user.uid),
    {
      orgId,
      condoId: cId,
      uid: user.uid,
      minutesHash: hash,
      minutesVersion: typeof minutes.version === 'number' ? minutes.version : null,
      signedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'minutes.sign',
    entityType: 'assembly',
    entityId: aId,
    targetPath: `assemblies/${aId}/signatures/${user.uid}`,
    metadata: { minutesHash: hash },
  });

  return { ok: true, minutesHash: hash };
}

export async function getMySignature(assemblyId) {
  const { db, user } = await requireAuth();
  const aId = cleanString(assemblyId);
  if (!aId) throw new Error('assemblyId inválido.');
  const snap = await getDoc(doc(db, 'assemblies', aId, 'signatures', user.uid));
  return snap.exists() ? snap.data() || null : null;
}

export async function listSignatures(assemblyId) {
  const { db } = await requireAuth();
  const aId = cleanString(assemblyId);
  if (!aId) throw new Error('assemblyId inválido.');
  const qs = await getDocs(collection(db, 'assemblies', aId, 'signatures'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => {
    const ad = a.signedAt && typeof a.signedAt.toDate === 'function' ? a.signedAt.toDate().getTime() : 0;
    const bd = b.signedAt && typeof b.signedAt.toDate === 'function' ? b.signedAt.toDate().getTime() : 0;
    return bd - ad;
  });
  return items;
}

export async function upsertProxy(assemblyId, condoId, proxy) {
  const { db, user } = await requireAuth();
  const aId = cleanString(assemblyId);
  const cId = cleanString(condoId);
  if (!aId) throw new Error('assemblyId inválido.');
  if (!cId) throw new Error('condoId inválido.');

  proxy = proxy || {};
  const unitId = cleanString(proxy.unitId);
  const delegateUid = cleanString(proxy.delegateUid);
  const docUrl = cleanString(proxy.docUrl) || null;
  const note = cleanString(proxy.note) || null;
  if (!unitId) throw new Error('unitId é obrigatório.');
  if (!delegateUid) throw new Error('delegateUid é obrigatório.');

  const orgId = await getOrgIdForCondoByDb(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  await setDoc(
    doc(db, 'assemblies', aId, 'proxies', unitId),
    {
      orgId,
      condoId: cId,
      unitId,
      delegateUid,
      docUrl,
      note,
      status: 'active',
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'proxy.upsert',
    entityType: 'assembly',
    entityId: aId,
    targetPath: `assemblies/${aId}/proxies/${unitId}`,
    metadata: { unitId, delegateUid },
  });

  return { ok: true };
}

export async function deleteProxy(assemblyId, condoId, unitId) {
  const { db, user } = await requireAuth();
  const aId = cleanString(assemblyId);
  const cId = cleanString(condoId);
  const uId = cleanString(unitId);
  if (!aId) throw new Error('assemblyId inválido.');
  if (!cId) throw new Error('condoId inválido.');
  if (!uId) throw new Error('unitId inválido.');

  const orgId = await getOrgIdForCondoByDb(db, cId);
  await deleteDoc(doc(db, 'assemblies', aId, 'proxies', uId));

  if (orgId) {
    await writeAuditLog(db, {
      orgId,
      condoId: cId,
      actorUid: user.uid,
      action: 'proxy.delete',
      entityType: 'assembly',
      entityId: aId,
      targetPath: `assemblies/${aId}/proxies/${uId}`,
      metadata: { unitId: uId },
    });
  }
}

export async function listProxies(assemblyId) {
  const { db } = await requireAuth();
  const aId = cleanString(assemblyId);
  if (!aId) throw new Error('assemblyId inválido.');
  const qs = await getDocs(collection(db, 'assemblies', aId, 'proxies'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => cleanString(a.unitId).localeCompare(cleanString(b.unitId)));
  return items;
}

export async function setVoteForUnit(assemblyId, condoId, unitId, choice) {
  const { db, user } = await requireAuth();
  const aId = cleanString(assemblyId);
  const cId = cleanString(condoId);
  const uId = cleanString(unitId);
  const v = cleanString(choice).toLowerCase();
  if (!aId) throw new Error('assemblyId inválido.');
  if (!cId) throw new Error('condoId inválido.');
  if (!uId) throw new Error('unitId inválido.');
  if (!['sim', 'nao', 'abstencao'].includes(v)) throw new Error('Voto inválido.');

  const orgId = await getOrgIdForCondoByDb(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  await setDoc(
    doc(db, 'assemblies', aId, 'votes', uId),
    {
      uid: user.uid,
      unitId: uId,
      condoId: cId,
      choice: v,
      votedAt: serverTimestamp(),
      votedByUid: user.uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'vote.set_for_unit',
    entityType: 'assembly',
    entityId: aId,
    targetPath: `assemblies/${aId}/votes/${uId}`,
    metadata: { unitId: uId, choice: v },
  });
}

export async function setAttendanceForUnit(assemblyId, condoId, unitId) {
  const { db, user } = await requireAuth();
  const aId = cleanString(assemblyId);
  const cId = cleanString(condoId);
  const uId = cleanString(unitId);
  if (!aId) throw new Error('assemblyId inválido.');
  if (!cId) throw new Error('condoId inválido.');
  if (!uId) throw new Error('unitId inválido.');

  const orgId = await getOrgIdForCondoByDb(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  await setDoc(
    doc(db, 'assemblies', aId, 'attendances', uId),
    {
      uid: user.uid,
      unitId: uId,
      condoId: cId,
      confirmedAt: serverTimestamp(),
      confirmedByUid: user.uid,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'attendance.set_for_unit',
    entityType: 'assembly',
    entityId: aId,
    targetPath: `assemblies/${aId}/attendances/${uId}`,
    metadata: { unitId: uId },
  });
}

export async function getQuorumSummary(condoId, assemblyId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  const aId = cleanString(assemblyId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!aId) throw new Error('assemblyId inválido.');

  const units = await getDocs(collection(db, 'condos', cId, 'units'));
  const att = await getDocs(collection(db, 'assemblies', aId, 'attendances'));
  const votes = await getDocs(collection(db, 'assemblies', aId, 'votes'));

  const totalUnits = units.size;
  const presentUnits = att.size;
  const votedUnits = votes.size;
  const pct = totalUnits ? Math.round((presentUnits / totalUnits) * 100) : 0;

  return { totalUnits, presentUnits, votedUnits, presencePct: pct };
}

export async function generateMinutesText(condoId, assemblyId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const aId = cleanString(assemblyId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!aId) throw new Error('assemblyId inválido.');

  const aSnap = await getDoc(doc(db, 'condos', cId, 'assemblies', aId));
  if (!aSnap.exists()) throw new Error('Assembleia não encontrada.');
  const a = aSnap.data() || {};

  const att = await getDocs(collection(db, 'assemblies', aId, 'attendances'));
  const votes = await getDocs(collection(db, 'assemblies', aId, 'votes'));

  let sim = 0;
  let nao = 0;
  let abst = 0;
  votes.docs.forEach((d) => {
    const v = d.data() || {};
    const c = cleanString(v.choice).toLowerCase();
    if (c === 'sim') sim++;
    else if (c === 'nao') nao++;
    else if (c === 'abstencao') abst++;
  });

  let dateStr = '';
  try {
    if (a.date && typeof a.date.toDate === 'function') {
      const dt = a.date.toDate();
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      dateStr = `${dd}/${mm}/${yyyy}`;
    }
  } catch (e) {}

  const lines = [];
  lines.push(`ATA DE ASSEMBLEIA — ${cleanString(a.title) || aId}`);
  if (dateStr) lines.push(`Data: ${dateStr}`);
  if (a.location) lines.push(`Local: ${cleanString(a.location)}`);
  if (a.agendaText) {
    lines.push('');
    lines.push('PAUTA');
    lines.push(cleanString(a.agendaText));
  }
  lines.push('');
  lines.push(`Responsável pela geração: ${user.uid}`);
  lines.push('');
  lines.push(`Presenças confirmadas: ${att.size}`);
  lines.push('');
  lines.push('VOTAÇÃO (quando aplicável)');
  lines.push(`- Sim: ${sim}`);
  lines.push(`- Não: ${nao}`);
  lines.push(`- Abstenção: ${abst}`);
  lines.push('');
  lines.push('Observações:');
  lines.push('- ');

  return lines.join('\n');
}
