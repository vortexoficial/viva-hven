// Viva Haven — Módulo de Assembleias
// Firestore:
// - condos/{condoId}/assemblies/{assemblyId}
// - assemblies/{assemblyId}/attendances/{uid}
// - assemblies/{assemblyId}/votes/{uid}
// - assemblies/{assemblyId}/minutes/{minuteId}

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

export async function getOrgIdForCondo(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) return null;
  const snap = await getDoc(doc(db, 'condos', cId));
  if (!snap.exists()) return null;
  const data = snap.data() || {};
  return data.orgId ? cleanString(data.orgId) : null;
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

export async function createAssembly(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const orgId = await getOrgIdForCondo(cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const title = cleanString(data.title);
  if (!title) throw new Error('Título é obrigatório.');

  const date = toDateOnly(data.date);

  const docData = {
    orgId,
    condoId: cId,
    title,
    date: date || null,
    location: cleanString(data.location) || null,
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

  await updateDoc(doc(db, 'condos', cId, 'assemblies', aId), patch);
  await updateDoc(doc(db, 'assemblies', aId), patch);

  const orgId = await getOrgIdForCondo(cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'assembly.update',
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

  const orgId = await getOrgIdForCondo(cId);

  await deleteDoc(doc(db, 'condos', cId, 'assemblies', aId));
  await deleteDoc(doc(db, 'assemblies', aId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'assembly.delete',
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

  const patch = {
    status: 'called',
    calledAt: serverTimestamp(),
    calledBy: user.uid,
    noticeText: cleanString(noticeText) || null,
    updatedAt: serverTimestamp(),
  };

  await updateDoc(doc(db, 'condos', cId, 'assemblies', aId), patch);
  await updateDoc(doc(db, 'assemblies', aId), patch);

  const orgId = await getOrgIdForCondo(cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'assembly.call',
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

  const orgId = await getOrgIdForCondo(cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'vote.open',
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

  const orgId = await getOrgIdForCondo(cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'vote.close',
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

  const orgId = await getOrgIdForCondo(cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const ref = doc(db, 'assemblies', aId, 'attendances', user.uid);
  await setDoc(
    ref,
    {
      uid: user.uid,
      condoId: cId,
      confirmedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'attendance.confirm',
    targetPath: `assemblies/${aId}/attendances/${user.uid}`,
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

  const orgId = await getOrgIdForCondo(cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const ref = doc(db, 'assemblies', aId, 'votes', user.uid);
  await setDoc(
    ref,
    {
      uid: user.uid,
      condoId: cId,
      choice: v,
      votedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'vote.cast',
    targetPath: `assemblies/${aId}/votes/${user.uid}`,
    metadata: { choice: v },
  });
}

export async function getAttendanceForUser(assemblyId) {
  const { db, user } = await requireAuth();
  const aId = cleanString(assemblyId);
  if (!aId) throw new Error('assemblyId inválido.');
  const snap = await getDoc(doc(db, 'assemblies', aId, 'attendances', user.uid));
  return snap.exists() ? snap.data() || null : null;
}

export async function getVoteForUser(assemblyId) {
  const { db, user } = await requireAuth();
  const aId = cleanString(assemblyId);
  if (!aId) throw new Error('assemblyId inválido.');
  const snap = await getDoc(doc(db, 'assemblies', aId, 'votes', user.uid));
  return snap.exists() ? snap.data() || null : null;
}

export async function getLatestMinutes(assemblyId) {
  const { db } = await requireAuth();
  const aId = cleanString(assemblyId);
  if (!aId) throw new Error('assemblyId inválido.');
  const snap = await getDoc(doc(db, 'assemblies', aId, 'minutes', 'latest'));
  return snap.exists() ? snap.data() || null : null;
}

export async function saveMinutes(assemblyId, condoId, text) {
  const { db, user } = await requireAuth();
  const aId = cleanString(assemblyId);
  const cId = cleanString(condoId);
  const t = String(text || '').trim();
  if (!aId) throw new Error('assemblyId inválido.');
  if (!cId) throw new Error('condoId inválido.');
  if (!t) throw new Error('Texto da ata é obrigatório.');

  const orgId = await getOrgIdForCondo(cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  await setDoc(
    doc(db, 'assemblies', aId, 'minutes', 'latest'),
    {
      condoId: cId,
      orgId,
      text: t,
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
    action: 'minutes.save',
    targetPath: `assemblies/${aId}/minutes/latest`,
    metadata: { length: t.length },
  });
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
