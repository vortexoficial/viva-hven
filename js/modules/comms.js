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
  getCountFromServer,
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

function normalizeChannel(value) {
  const v = cleanString(value).toLowerCase();
  if (['app', 'inapp', 'in-app', 'in_app'].includes(v)) return 'app';
  if (['email', 'e-mail', 'e_mail'].includes(v)) return 'email';
  if (['whatsapp', 'wpp', 'wa'].includes(v)) return 'whatsapp';
  return '';
}

function normalizeChannels(input) {
  const raw = Array.isArray(input) ? input : (typeof input === 'string' ? [input] : []);
  const norm = raw.map(normalizeChannel).filter(Boolean);
  const unique = [];
  const seen = new Set();
  for (const c of norm) {
    if (seen.has(c)) continue;
    seen.add(c);
    unique.push(c);
  }
  return unique;
}

function normalizeDeliveryStatus(value) {
  const v = cleanString(value).toLowerCase();
  if (['pendente', 'enviado', 'erro'].includes(v)) return v;
  if (['pending', 'sent', 'error'].includes(v)) {
    if (v === 'pending') return 'pendente';
    if (v === 'sent') return 'enviado';
    return 'erro';
  }
  return 'pendente';
}

function normalizeTemplateScope(value) {
  const v = cleanString(value).toLowerCase();
  if (['condo', 'condominio', 'condomínio'].includes(v)) return 'condo';
  if (['org', 'carteira', 'portfolio'].includes(v)) return 'org';
  return 'condo';
}

// ===== Templates =====
export async function listCondoCommsTemplates(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'commsTemplates'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
  return items;
}

export async function listOrgCommsTemplatesForCondo(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) return [];

  const qs = await getDocs(collection(db, 'orgs', orgId, 'commsTemplates'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'));
  return items;
}

export async function createCondoCommsTemplate(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const name = cleanString(data.name);
  const title = cleanString(data.title);
  const body = cleanString(data.body);
  const channelsDefault = normalizeChannels(data.channelsDefault);
  if (!name) throw new Error('Nome do template é obrigatório.');
  if (!title) throw new Error('Título do template é obrigatório.');
  if (!body) throw new Error('Conteúdo do template é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    orgId,
    condoId: cId,
    scope: 'condo',
    name,
    title,
    body,
    channelsDefault,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'condos', cId, 'commsTemplates'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'commsTemplate.create',
    entityType: 'commsTemplate',
    entityId: ref.id,
    targetPath: `condos/${cId}/commsTemplates/${ref.id}`,
    metadata: { scope: 'condo' },
  });

  return { id: ref.id, ...docData };
}

export async function updateCondoCommsTemplate(condoId, templateId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const tId = cleanString(templateId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!tId) throw new Error('templateId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };
  if (Object.prototype.hasOwnProperty.call(data, 'name')) patch.name = cleanString(data.name);
  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'body')) patch.body = cleanString(data.body);
  if (Object.prototype.hasOwnProperty.call(data, 'channelsDefault')) patch.channelsDefault = normalizeChannels(data.channelsDefault);

  await updateDoc(doc(db, 'condos', cId, 'commsTemplates', tId), patch);

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'commsTemplate.update',
    entityType: 'commsTemplate',
    entityId: tId,
    targetPath: `condos/${cId}/commsTemplates/${tId}`,
    metadata: { patch: data || {}, scope: 'condo' },
  });
}

export async function deleteCondoCommsTemplate(condoId, templateId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const tId = cleanString(templateId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!tId) throw new Error('templateId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  await deleteDoc(doc(db, 'condos', cId, 'commsTemplates', tId));

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'commsTemplate.delete',
    entityType: 'commsTemplate',
    entityId: tId,
    targetPath: `condos/${cId}/commsTemplates/${tId}`,
    metadata: { scope: 'condo' },
  });
}

export async function createOrgCommsTemplateForCondo(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const name = cleanString(data.name);
  const title = cleanString(data.title);
  const body = cleanString(data.body);
  const channelsDefault = normalizeChannels(data.channelsDefault);
  if (!name) throw new Error('Nome do template é obrigatório.');
  if (!title) throw new Error('Título do template é obrigatório.');
  if (!body) throw new Error('Conteúdo do template é obrigatório.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const docData = {
    orgId,
    scope: 'org',
    name,
    title,
    body,
    channelsDefault,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(db, 'orgs', orgId, 'commsTemplates'), docData);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'commsTemplate.create',
    entityType: 'commsTemplate',
    entityId: ref.id,
    targetPath: `orgs/${orgId}/commsTemplates/${ref.id}`,
    metadata: { scope: 'org' },
  });

  return { id: ref.id, ...docData };
}

export async function updateOrgCommsTemplateForCondo(condoId, templateId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const tId = cleanString(templateId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!tId) throw new Error('templateId inválido.');

  data = data || {};
  const patch = { updatedAt: serverTimestamp() };
  if (Object.prototype.hasOwnProperty.call(data, 'name')) patch.name = cleanString(data.name);
  if (Object.prototype.hasOwnProperty.call(data, 'title')) patch.title = cleanString(data.title);
  if (Object.prototype.hasOwnProperty.call(data, 'body')) patch.body = cleanString(data.body);
  if (Object.prototype.hasOwnProperty.call(data, 'channelsDefault')) patch.channelsDefault = normalizeChannels(data.channelsDefault);

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  await updateDoc(doc(db, 'orgs', orgId, 'commsTemplates', tId), patch);

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'commsTemplate.update',
    entityType: 'commsTemplate',
    entityId: tId,
    targetPath: `orgs/${orgId}/commsTemplates/${tId}`,
    metadata: { patch: data || {}, scope: 'org' },
  });
}

export async function deleteOrgCommsTemplateForCondo(condoId, templateId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const tId = cleanString(templateId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!tId) throw new Error('templateId inválido.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  await deleteDoc(doc(db, 'orgs', orgId, 'commsTemplates', tId));

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'commsTemplate.delete',
    entityType: 'commsTemplate',
    entityId: tId,
    targetPath: `orgs/${orgId}/commsTemplates/${tId}`,
    metadata: { scope: 'org' },
  });
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
  const channel = normalizeChannel(opts.channel);

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
  const filtered = channel
    ? items.filter((a) => {
        const ch = Array.isArray(a.channels) ? a.channels.map(normalizeChannel).filter(Boolean) : [];
        // Compat: aviso antigo sem channels conta como in-app
        return ch.length ? ch.includes(channel) : channel === 'app';
      })
    : items;

  filtered.sort((a, b) => {
    const ap = a.publishedAt && typeof a.publishedAt.toDate === 'function' ? a.publishedAt.toDate().getTime() : 0;
    const bp = b.publishedAt && typeof b.publishedAt.toDate === 'function' ? b.publishedAt.toDate().getTime() : 0;
    if (ap !== bp) return bp - ap;
    const au = a.updatedAt && typeof a.updatedAt.toDate === 'function' ? a.updatedAt.toDate().getTime() : 0;
    const bu = b.updatedAt && typeof b.updatedAt.toDate === 'function' ? b.updatedAt.toDate().getTime() : 0;
    return bu - au;
  });

  return filtered;
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
  const channels = normalizeChannels(data.channels);
  const template = data.template && typeof data.template === 'object' ? data.template : null;
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
    channels: channels.length ? channels : ['app'],
    template: template
      ? {
          scope: normalizeTemplateScope(template.scope),
          id: cleanString(template.id),
        }
      : null,
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
    entityType: 'announcement',
    entityId: ref.id,
    targetPath: `condos/${cId}/announcements/${ref.id}`,
    metadata: { status },
  });

  // MVP: registra intenção de envio para canais externos (não envia de verdade)
  try {
    await ensureAnnouncementDeliveries(db, {
      orgId,
      condoId: cId,
      announcementId: ref.id,
      actorUid: user.uid,
      channels: docData.channels,
    });
  } catch (e) {}

  return { id: ref.id, ...docData };
}

async function ensureAnnouncementDeliveries(db, payload) {
  payload = payload || {};
  const cId = cleanString(payload.condoId);
  const aId = cleanString(payload.announcementId);
  const orgId = cleanString(payload.orgId);
  const actorUid = cleanString(payload.actorUid);
  const channels = normalizeChannels(payload.channels);
  if (!cId || !aId || !actorUid) return;

  const external = channels.filter((c) => c === 'email' || c === 'whatsapp');
  for (const ch of external) {
    const deliveryId = ch; // determinístico
    const deliveryRef = doc(db, 'condos', cId, 'announcements', aId, 'deliveries', deliveryId);
    const snap = await getDoc(deliveryRef);
    if (snap.exists()) continue;

    const docData = {
      orgId: orgId || null,
      condoId: cId,
      announcementId: aId,
      channel: ch,
      status: 'pendente',
      provider: 'mock',
      createdBy: actorUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      errorMessage: null,
    };

    await setDoc(deliveryRef, docData);
  }
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
  if (Object.prototype.hasOwnProperty.call(data, 'channels')) {
    const channels = normalizeChannels(data.channels);
    patch.channels = channels.length ? channels : ['app'];
  }
  if (Object.prototype.hasOwnProperty.call(data, 'template')) {
    const t = data.template && typeof data.template === 'object' ? data.template : null;
    patch.template = t
      ? {
          scope: normalizeTemplateScope(t.scope),
          id: cleanString(t.id),
        }
      : null;
  }

  await updateDoc(doc(db, 'condos', cId, 'announcements', aId), patch);

  const orgId = await getOrgIdForCondo(db, cId);

  // Se adicionou canais externos, registra intenção de envio.
  try {
    const channels = Array.isArray(patch.channels) ? patch.channels : normalizeChannels(data.channels);
    await ensureAnnouncementDeliveries(db, {
      orgId: orgId || null,
      condoId: cId,
      announcementId: aId,
      actorUid: user.uid,
      channels,
    });
  } catch (e) {}

  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'announcement.update',
    entityType: 'announcement',
    entityId: aId,
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
    entityType: 'announcement',
    entityId: aId,
    targetPath: `condos/${cId}/announcements/${aId}`,
    metadata: {},
  });
}

// ===== Deliveries (intenção de envio por canal) =====
export async function listAnnouncementDeliveries(condoId, announcementId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  const aId = cleanString(announcementId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!aId) throw new Error('announcementId inválido.');

  const qs = await getDocs(collection(db, 'condos', cId, 'announcements', aId, 'deliveries'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => {
    const at = a.createdAt && typeof a.createdAt.toDate === 'function' ? a.createdAt.toDate().getTime() : 0;
    const bt = b.createdAt && typeof b.createdAt.toDate === 'function' ? b.createdAt.toDate().getTime() : 0;
    return bt - at;
  });
  return items;
}

export async function setAnnouncementDeliveryStatus(condoId, announcementId, channel, status, errorMessage) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const aId = cleanString(announcementId);
  const ch = normalizeChannel(channel);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!aId) throw new Error('announcementId inválido.');
  if (!ch || ch === 'app') throw new Error('Canal inválido.');

  const s = normalizeDeliveryStatus(status);
  const msg = cleanString(errorMessage) || null;

  const ref = doc(db, 'condos', cId, 'announcements', aId, 'deliveries', ch);
  await updateDoc(ref, {
    status: s,
    errorMessage: s === 'erro' ? (msg || 'Erro não especificado.') : null,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });

  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'announcement.delivery.update',
    entityType: 'announcementDelivery',
    entityId: `${aId}:${ch}`,
    targetPath: `condos/${cId}/announcements/${aId}/deliveries/${ch}`,
    metadata: { status: s },
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
    entityType: 'poll',
    entityId: ref.id,
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
    entityType: 'poll',
    entityId: pId,
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
    entityType: 'poll',
    entityId: pId,
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
    entityType: 'pollVote',
    entityId: user.uid,
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

export async function countReadReceipts(condoId, kind, targetId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  const k = normalizeReceiptKind(kind);
  const tId = cleanString(targetId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!tId) throw new Error('targetId inválido.');

  const col = collection(db, 'condos', cId, 'readReceipts');
  const q = query(col, where('kind', '==', k), where('targetId', '==', tId));
  const agg = await getCountFromServer(q);
  return agg && agg.data ? Number(agg.data().count || 0) : 0;
}

export async function countAnnouncementReads(condoId, announcementId) {
  return await countReadReceipts(condoId, 'announcement', announcementId);
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
    entityType: 'readReceipt',
    entityId: receiptId,
    targetPath: `condos/${cId}/readReceipts/${receiptId}`,
    metadata: { kind: k, targetId: tId },
  });

  return { id: receiptId, ...docData };
}

export const CommsTypes = {
  normalizeAnnouncementStatus,
  normalizePollStatus,
  normalizeReceiptKind,
  normalizeChannel,
  normalizeChannels,
  normalizeDeliveryStatus,
  normalizeTemplateScope,
  makeReceiptId,
};
