// Viva Haven — Comunicação (MVP)
// Firestore:
// - condos/{condoId}/announcements/{id}
// - condos/{condoId}/polls/{id}
// - condos/{condoId}/polls/{id}/votes/{uid}
// - condos/{condoId}/readReceipts/{id}

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

function normalizeAnnouncementStatus(value) {
  const v = cleanString(value).toLowerCase();
  if (['rascunho', 'publicado', 'arquivado'].includes(v)) return v;
  if (['draft', 'published', 'archived'].includes(v)) {
    if (v === 'draft') return 'rascunho';
    if (v === 'published') return 'publicado';
    if (v === 'archived') return 'arquivado';
  }
  return 'rascunho';
}

function normalizePollStatus(value) {
  const v = cleanString(value).toLowerCase();
  if (['aberta', 'encerrada'].includes(v)) return v;
  if (['open', 'closed'].includes(v)) return v === 'open' ? 'aberta' : 'encerrada';
  return 'aberta';
}

function normalizeReceiptKind(value) {
  const v = cleanString(value).toLowerCase();
  if (['announcement', 'poll'].includes(v)) return v;
  if (['aviso', 'avisos', 'anuncio', 'anuncios', 'comunicado', 'comunicados'].includes(v)) return 'announcement';
  if (['enquete', 'enquetes'].includes(v)) return 'poll';
  return 'announcement';
}

function makeReceiptId(uid, kind, targetId) {
  const u = cleanString(uid);
  const k = normalizeReceiptKind(kind);
  const t = cleanString(targetId);
  if (!u || !k || !t) return '';
  return `${u}_${k}_${t}`;
}

function normalizeOptions(optionsInput) {
  const options = Array.isArray(optionsInput) ? optionsInput : [];
  const labels = options
    .map((o) => (typeof o === 'string' ? o : (o && o.label ? o.label : '')))
    .map(cleanString)
    .filter(Boolean);

  const unique = [];
  const seen = new Set();
  for (const l of labels) {
    const key = l.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(l);
  }

  if (unique.length < 2) throw new Error('Informe pelo menos 2 opções.');

  return unique.slice(0, 10).map((label, idx) => ({
    id: `opt_${idx + 1}`,
    label,
  }));
}

// ===== Announcements =====
export async function listAnnouncements(condoId, opts) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const publishedOnly = !!opts.publishedOnly;
  const status = cleanString(opts.status);

  const col = collection(db, 'condos', cId, 'announcements');

  let qs;
  if (status) {
    qs = await getDocs(query(col, where('status', '==', normalizeAnnouncementStatus(status))));
  } else if (publishedOnly) {
    qs = await getDocs(query(col, where('status', '==', 'publicado')));
  } else {
    qs = await getDocs(col);
  }

  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => {
    const ap = a.publishedAt && typeof a.publishedAt.toDate === 'function' ? a.publishedAt.toDate().getTime() : 0;
    const bp = b.publishedAt && typeof b.publishedAt.toDate === 'function' ? b.publishedAt.toDate().getTime() : 0;
    if (ap !== bp) return bp - ap;
    const au = a.updatedAt && typeof a.updatedAt.toDate === 'function' ? a.updatedAt.toDate().getTime() : 0;
    const bu = b.updatedAt && typeof b.updatedAt.toDate === 'function' ? b.updatedAt.toDate().getTime() : 0;
    return bu - au;
  });

  return items;
}

export async function createAnnouncement(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const title = cleanString(data.title);
  const body = cleanString(data.body);
  const status = normalizeAnnouncementStatus(data.status || 'rascunho');
  const publishedAt = data.publishedDate ? toDateOnly(data.publishedDate) : null;
  if (!title) throw new Error('Título é obrigatório.');
  if (!body) throw new Error('Conteúdo é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    orgId,
    condoId: cId,
    title,
    body,
    status,
    publishedAt: publishedAt || null,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'announcements'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'announcement.create',
    targetPath: `condos/${cId}/announcements/${ref.id}`,
    metadata: { status },
  });

  return { id: ref.id, ...docData };
}

export async function updateAnnouncement(condoId, announcementId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const aId = cleanString(announcementId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!aId) throw new Error('announcementId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'body')) patch.body = cleanString(data.body);
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizeAnnouncementStatus(data.status);
  if (Object.prototype.hasOwnProperty.call(data, 'publishedDate')) patch.publishedAt = toDateOnly(data.publishedDate);

  await updateDoc(doc(db, 'condos', cId, 'announcements', aId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'announcement.update',
    targetPath: `condos/${cId}/announcements/${aId}`,
    metadata: { patch: data || {} },
  });
}

export async function deleteAnnouncement(condoId, announcementId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const aId = cleanString(announcementId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!aId) throw new Error('announcementId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'announcements', aId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'announcement.delete',
    targetPath: `condos/${cId}/announcements/${aId}`,
    metadata: {},
  });
}

// ===== Polls =====
export async function listPolls(condoId, opts) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const status = cleanString(opts.status);

  const col = collection(db, 'condos', cId, 'polls');
  const qs = status
    ? await getDocs(query(col, where('status', '==', normalizePollStatus(status))))
    : await getDocs(col);

  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => {
    const au = a.updatedAt && typeof a.updatedAt.toDate === 'function' ? a.updatedAt.toDate().getTime() : 0;
    const bu = b.updatedAt && typeof b.updatedAt.toDate === 'function' ? b.updatedAt.toDate().getTime() : 0;
    return bu - au;
  });
  return items;
}

export async function createPoll(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const title = cleanString(data.title);
  const description = cleanString(data.description) || null;
  const status = normalizePollStatus(data.status || 'aberta');
  if (!title) throw new Error('Título é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const options = normalizeOptions(data.options);
  const closeAt = data.closeDate ? toDateOnly(data.closeDate) : null;

  const docData = {
    orgId,
    condoId: cId,
    title,
    description,
    options,
    status,
    openAt: serverTimestamp(),
    closeAt: closeAt || null,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'polls'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'poll.create',
    targetPath: `condos/${cId}/polls/${ref.id}`,
    metadata: { status, optionCount: options.length },
  });

  return { id: ref.id, ...docData };
}

export async function updatePoll(condoId, pollId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(pollId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('pollId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };

  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'description')) patch.description = cleanString(data.description) || null;
  if (Object.prototype.hasOwnProperty.call(data, 'status')) patch.status = normalizePollStatus(data.status);
  if (Object.prototype.hasOwnProperty.call(data, 'closeDate')) patch.closeAt = toDateOnly(data.closeDate);
  if (Object.prototype.hasOwnProperty.call(data, 'options')) patch.options = normalizeOptions(data.options);

  await updateDoc(doc(db, 'condos', cId, 'polls', pId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'poll.update',
    targetPath: `condos/${cId}/polls/${pId}`,
    metadata: { patch: data || {} },
  });
}

export async function deletePoll(condoId, pollId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(pollId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('pollId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'polls', pId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'poll.delete',
    targetPath: `condos/${cId}/polls/${pId}`,
    metadata: {},
  });
}

export async function getMyVote(condoId, pollId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(pollId);
  if (!cId) throw new Error('condoId inválido.');
  if (!pId) throw new Error('pollId inválido.');

  const snap = await getDoc(doc(db, 'condos', cId, 'polls', pId, 'votes', user.uid));
  return snap.exists() ? ({ id: snap.id, ...(snap.data() || {}) }) : null;
}

export async function castVote(condoId, pollId, choiceId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(pollId);
  const ch = cleanString(choiceId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('pollId inválido.');
  if (!ch) throw new Error('Escolha uma opção.');

  const pollSnap = await getDoc(doc(db, 'condos', cId, 'polls', pId));
  if (!pollSnap.exists()) throw new Error('Enquete não encontrada.');
  const poll = pollSnap.data() || {};
  if (normalizePollStatus(poll.status) !== 'aberta') throw new Error('Enquete encerrada.');

  const options = Array.isArray(poll.options) ? poll.options : [];
  const opt = options.find((o) => o && cleanString(o.id) === ch);
  if (!opt) throw new Error('Opção inválida.');

  const voteRef = doc(db, 'condos', cId, 'polls', pId, 'votes', user.uid);
  const existing = await getDoc(voteRef);
  if (existing.exists()) throw new Error('Você já votou nesta enquete.');

  const orgId = poll.orgId ? cleanString(poll.orgId) : (await getOrgIdForCondo(db, cId));
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const voteDoc = {
    orgId,
    condoId: cId,
    pollId: pId,
    uid: user.uid,
    choiceId: cleanString(opt.id),
    choiceLabel: cleanString(opt.label),
    votedAt: serverTimestamp(),
  };

  await setDoc(voteRef, voteDoc);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'poll.vote',
    targetPath: `condos/${cId}/polls/${pId}/votes/${user.uid}`,
    metadata: { choiceId: voteDoc.choiceId },
  });

  return { id: user.uid, ...voteDoc };
}

export async function listPollVotes(condoId, pollId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(pollId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!pId) throw new Error('pollId inválido.');

  const qs = await getDocs(collection(db, 'condos', cId, 'polls', pId, 'votes'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => {
    const at = a.votedAt && typeof a.votedAt.toDate === 'function' ? a.votedAt.toDate().getTime() : 0;
    const bt = b.votedAt && typeof b.votedAt.toDate === 'function' ? b.votedAt.toDate().getTime() : 0;
    return bt - at;
  });
  return items;
}

// ===== Read receipts =====
export async function listMyReadReceipts(condoId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const col = collection(db, 'condos', cId, 'readReceipts');
  // Importante: mantém a regra de list exigindo where(uid == request.auth.uid)
  const qs = await getDocs(query(col, where('uid', '==', user.uid)));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  return items;
}

export async function confirmRead(condoId, kind, targetId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const k = normalizeReceiptKind(kind);
  const tId = cleanString(targetId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!tId) throw new Error('targetId inválido.');

  const receiptId = makeReceiptId(user.uid, k, tId);
  if (!receiptId) throw new Error('receiptId inválido.');

  const receiptRef = doc(db, 'condos', cId, 'readReceipts', receiptId);
  const snap = await getDoc(receiptRef);
  if (snap.exists()) return { id: snap.id, ...(snap.data() || {}) };

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    orgId,
    condoId: cId,
    uid: user.uid,
    kind: k,
    targetId: tId,
    createdAt: serverTimestamp(),
  };

  await setDoc(receiptRef, docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'readReceipt.create',
    targetPath: `condos/${cId}/readReceipts/${receiptId}`,
    metadata: { kind: k, targetId: tId },
  });

  return { id: receiptId, ...docData };
}

export const CommsTypes = {
  normalizeAnnouncementStatus,
  normalizePollStatus,
  normalizeReceiptKind,
  makeReceiptId,
};
