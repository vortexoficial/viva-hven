// Viva Haven — Carteira (Portfolio por Organização)
// Objetivo: consolidar métricas por orgId (lista de condos + comparativos)
// Firestore:
// - condos/{condoId}
// - condos/{condoId}/charges
// - condos/{condoId}/expenses
// - condos/{condoId}/tickets

import { initFirebase } from '../firebase-init.js';

import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
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

function centsToBr(value) {
  const cents = cleanNumber(value);
  if (cents == null) return 'R$ 0,00';
  const n = cents / 100;
  try {
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  } catch (e) {
    return 'R$ ' + n.toFixed(2).replace('.', ',');
  }
}

function tsToDate(ts) {
  if (!ts) return null;
  try {
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (ts instanceof Date) return ts;
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch (e) {
    return null;
  }
}

function startOfMonth(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function isDateInRange(dt, from, to) {
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return false;
  if (from && dt.getTime() < from.getTime()) return false;
  if (to && dt.getTime() > to.getTime()) return false;
  return true;
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

export async function getMyProfile() {
  const { db, user } = await requireAuth();
  const snap = await getDoc(doc(db, 'users', user.uid));
  return snap.exists() ? (snap.data() || {}) : null;
}

export async function listOrgCondos(orgId) {
  const { db } = await requireAuth();
  const oId = cleanString(orgId);
  if (!oId) throw new Error('orgId inválido.');

  const qs = await getDocs(query(collection(db, 'condos'), where('orgId', '==', oId)));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => cleanString(a.name).localeCompare(cleanString(b.name)));
  return items;
}

export async function listVisibleCondos() {
  // Fallback (sem orgId): lista apenas os condos que o usuário consegue ler via rules.
  const { db } = await requireAuth();
  const qs = await getDocs(collection(db, 'condos'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => cleanString(a.name).localeCompare(cleanString(b.name)));
  return items;
}

export async function getCondoMetrics(condoId, opts) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('condoId inválido.');

  opts = opts || {};
  const monthDate = opts.monthDate instanceof Date ? opts.monthDate : new Date();
  const from = startOfMonth(monthDate);
  const to = endOfMonth(monthDate);
  const today = new Date();
  const todayFloor = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // Inadimplência: charges open/partial com dueAt < hoje
  const chargesSnap = await getDocs(query(
    collection(db, 'condos', cId, 'charges'),
    where('status', 'in', ['open', 'partial'])
  ));
  let delinquentCount = 0;
  let delinquentCents = 0;
  chargesSnap.docs.forEach((d) => {
    const data = d.data() || {};
    const dueAt = tsToDate(data.dueAt);
    if (!dueAt) return;
    const dueFloor = new Date(dueAt.getFullYear(), dueAt.getMonth(), dueAt.getDate());
    if (dueFloor.getTime() >= todayFloor.getTime()) return;

    delinquentCount++;
    delinquentCents += typeof data.amountCents === 'number' ? data.amountCents : 0;
  });

  // Tickets em aberto: status in aberto/em_andamento
  const ticketsSnap = await getDocs(query(
    collection(db, 'condos', cId, 'tickets'),
    where('status', 'in', ['aberto', 'em_andamento'])
  ));
  const openTicketsCount = ticketsSnap.size;

  // Gastos: soma de expenses no mês
  const expensesSnap = await getDocs(collection(db, 'condos', cId, 'expenses'));
  let monthExpensesCents = 0;
  expensesSnap.docs.forEach((d) => {
    const data = d.data() || {};
    const dt = tsToDate(data.date);
    if (!dt) return;
    if (!isDateInRange(dt, from, to)) return;
    monthExpensesCents += typeof data.amountCents === 'number' ? data.amountCents : 0;
  });

  return {
    condoId: cId,
    delinquentCount,
    delinquentCents,
    openTicketsCount,
    monthExpensesCents,
  };
}

export async function getOrgPortfolio(orgId, opts) {
  const { db, user } = await requireAuth();
  const oId = cleanString(orgId);
  if (!oId) throw new Error('orgId inválido.');

  opts = opts || {};
  const monthDate = opts.monthDate instanceof Date ? opts.monthDate : new Date();

  const condos = await listOrgCondos(oId);

  const metrics = await Promise.all(
    condos.map(async (c) => {
      const m = await getCondoMetrics(c.id, { monthDate });
      return {
        condoId: c.id,
        condoName: cleanString(c.name) || c.id,
        ...m,
      };
    })
  );

  const totals = metrics.reduce(
    (acc, x) => {
      acc.condosCount += 1;
      acc.delinquentCount += x.delinquentCount || 0;
      acc.delinquentCents += x.delinquentCents || 0;
      acc.openTicketsCount += x.openTicketsCount || 0;
      acc.monthExpensesCents += x.monthExpensesCents || 0;
      return acc;
    },
    {
      orgId: oId,
      condosCount: 0,
      delinquentCount: 0,
      delinquentCents: 0,
      openTicketsCount: 0,
      monthExpensesCents: 0,
    }
  );

  // Log de visualização
  try {
    await writeAuditLog(db, {
      orgId: oId,
      condoId: null,
      actorUid: user.uid,
      action: 'portfolio.view',
      targetPath: 'admin/carteira.html',
      metadata: {
        condos: totals.condosCount,
      },
    });
  } catch (e) {
    // Não bloquear a tela por falha de log
  }

  return {
    orgId: oId,
    monthRef: `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`,
    totals,
    items: metrics,
    format: {
      centsToBr,
    },
  };
}
