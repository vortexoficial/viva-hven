// Viva Haven — Notifications Feed (Morador)
// Agrega avisos, enquetes e chamados em um único feed.

import {
  listAnnouncements,
  listPolls,
  listMyReadReceipts,
  confirmRead,
} from './comms.js';

import { listTickets } from './maintenance.js';

function cleanString(value) {
  return String(value || '').trim();
}

function tsToDate(value) {
  try {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate();
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? null : dt;
  } catch (e) {
    return null;
  }
}

function dateMs(value) {
  const dt = tsToDate(value);
  return dt ? dt.getTime() : 0;
}

function normalizeTicketStatus(value) {
  const v = cleanString(value).toLowerCase();
  if (!v) return 'aberto';
  return v;
}

function receiptKey(kind, targetId) {
  return `${kind}:${targetId}`;
}

function toAnnouncementItem(item) {
  const title = cleanString(item.title) || 'Aviso';
  const body = cleanString(item.body);
  const preview = body.length > 160 ? `${body.slice(0, 160)}…` : body;

  return {
    id: cleanString(item.id),
    kind: 'announcement',
    title,
    preview,
    meta: 'Comunicado do condomínio',
    actionHref: '/app/avisos.html',
    createdAt: item.publishedAt || item.updatedAt || item.createdAt || null,
    raw: item,
  };
}

function toPollItem(item) {
  const title = cleanString(item.title) || 'Enquete';
  const desc = cleanString(item.description);
  const options = Array.isArray(item.options) ? item.options.length : 0;

  return {
    id: cleanString(item.id),
    kind: 'poll',
    title,
    preview: desc || `Enquete com ${options} opção(ões).`,
    meta: 'Participação pendente',
    actionHref: '/app/avisos.html',
    createdAt: item.updatedAt || item.openAt || item.createdAt || null,
    raw: item,
  };
}

function toTicketItem(item) {
  const title = cleanString(item.title) || 'Chamado';
  const status = normalizeTicketStatus(item.status);
  const priority = cleanString(item.priority || 'media').toLowerCase();

  return {
    id: cleanString(item.id),
    kind: 'ticket',
    title,
    preview: cleanString(item.description) || 'Acompanhe o andamento do chamado.',
    meta: `Status: ${status} • Prioridade: ${priority}`,
    actionHref: '/app/chamados.html',
    createdAt: item.updatedAt || item.createdAt || null,
    raw: item,
  };
}

function isOpenTicket(item) {
  const status = normalizeTicketStatus(item && item.status);
  return ['aberto', 'em_andamento', 'triagem', 'aprovado', 'aguardando_fornecedor'].includes(status);
}

export async function listNotificationFeed(condoId, opts) {
  opts = opts || {};
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const maxItems = Number.isFinite(Number(opts.limit)) ? Math.max(1, Math.floor(Number(opts.limit))) : 20;

  const [announcements, polls, tickets, receipts] = await Promise.all([
    listAnnouncements(cId, { publishedOnly: true, channel: 'app' }),
    listPolls(cId, { status: 'aberta' }),
    listTickets(cId, { mineOnly: true }),
    listMyReadReceipts(cId),
  ]);

  const readMap = new Map();
  (Array.isArray(receipts) ? receipts : []).forEach((r) => {
    const kind = cleanString(r.kind);
    const targetId = cleanString(r.targetId);
    if (!kind || !targetId) return;
    readMap.set(receiptKey(kind, targetId), true);
  });

  const items = [];

  (Array.isArray(announcements) ? announcements : []).forEach((a) => {
    const row = toAnnouncementItem(a);
    row.read = readMap.has(receiptKey('announcement', row.id));
    items.push(row);
  });

  (Array.isArray(polls) ? polls : []).forEach((p) => {
    const row = toPollItem(p);
    row.read = readMap.has(receiptKey('poll', row.id));
    items.push(row);
  });

  (Array.isArray(tickets) ? tickets : []).filter(isOpenTicket).forEach((t) => {
    const row = toTicketItem(t);
    // ticket não usa readReceipt por enquanto
    row.read = false;
    items.push(row);
  });

  items.sort((a, b) => dateMs(b.createdAt) - dateMs(a.createdAt));

  return items.slice(0, maxItems);
}

export async function markNotificationItemRead(condoId, item) {
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const kind = item && item.kind ? cleanString(item.kind) : '';
  const id = item && item.id ? cleanString(item.id) : '';
  if (!kind || !id) return false;

  if (kind === 'announcement') {
    await confirmRead(cId, 'announcement', id);
    return true;
  }

  if (kind === 'poll') {
    await confirmRead(cId, 'poll', id);
    return true;
  }

  return false;
}

export async function getNotificationSummary(condoId) {
  const feed = await listNotificationFeed(condoId, { limit: 50 });
  const unread = feed.filter((f) => !f.read).length;

  const byKind = {
    announcement: 0,
    poll: 0,
    ticket: 0,
  };

  feed.forEach((f) => {
    if (Object.prototype.hasOwnProperty.call(byKind, f.kind)) byKind[f.kind] += 1;
  });

  return {
    total: feed.length,
    unread,
    byKind,
    feed,
  };
}
