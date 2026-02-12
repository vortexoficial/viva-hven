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
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const CACHE_PREFIX = 'vh:';

function cacheKey(key) {
  return CACHE_PREFIX + key;
}

function readCache(key, ttlMs) {
  try {
    const raw = localStorage.getItem(cacheKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.savedAt !== 'number') return null;
    if (ttlMs && Date.now() - parsed.savedAt > ttlMs) return null;
    return parsed.value;
  } catch (e) {
    return null;
  }
}

function writeCache(key, value) {
  try {
    localStorage.setItem(cacheKey(key), JSON.stringify({ savedAt: Date.now(), value }));
  } catch (e) {
    // ignore
  }
}

function yyyyMmDd(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
    entityType: cleanString(payload.entityType || 'portfolio'),
    entityId: cleanString(payload.entityId || orgId),
    targetPath: cleanString(payload.targetPath),
    createdAt: serverTimestamp(),
    metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {},
  };

  await addDoc(collection(db, 'auditLogs'), docData);
}

async function getUnitsCountForCondo(db, condoId, condoDocData) {
  const fromDoc = condoDocData && Number.isFinite(Number(condoDocData.unitsCount)) ? Math.trunc(Number(condoDocData.unitsCount)) : null;
  if (fromDoc != null && fromDoc >= 0) return fromDoc;

  const cId = cleanString(condoId);
  const cached = readCache(`condoUnitsCount:${cId}`, 7 * 24 * 60 * 60 * 1000);
  if (Number.isFinite(Number(cached)) && Number(cached) >= 0) return Math.trunc(Number(cached));

  const snap = await getCountFromServer(collection(db, 'condos', cId, 'units'));
  const count = snap && snap.data && typeof snap.data === 'function' ? (snap.data().count || 0) : 0;
  writeCache(`condoUnitsCount:${cId}`, count);
  return count;
}

async function getOverdueMaintenancePlansCount(db, condoId, todayFloor) {
  const cId = cleanString(condoId);
  const dayKey = yyyyMmDd(todayFloor);
  const cached = readCache(`condoOverdueMaintenancePlans:${cId}:${dayKey}`, 60 * 60 * 1000);
  if (Number.isFinite(Number(cached)) && Number(cached) >= 0) return Math.trunc(Number(cached));

  const q = query(
    collection(db, 'condos', cId, 'maintenancePlans'),
    where('nextDueAt', '<', todayFloor)
  );
  const snap = await getCountFromServer(q);
  const count = snap && snap.data && typeof snap.data === 'function' ? (snap.data().count || 0) : 0;
  writeCache(`condoOverdueMaintenancePlans:${cId}:${dayKey}`, count);
  return count;
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

  const condoDocData = opts && opts.condoDocData && typeof opts.condoDocData === 'object' ? opts.condoDocData : null;

  let unitsCount = null;
  try {
    unitsCount = await getUnitsCountForCondo(db, cId, condoDocData);
  } catch (e) {
    unitsCount = null;
  }

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
  let expensesSnap;
  try {
    expensesSnap = await getDocs(query(
      collection(db, 'condos', cId, 'expenses'),
      where('date', '>=', from),
      where('date', '<=', to),
      limit(2000)
    ));
  } catch (e) {
    // fallback para compat
    expensesSnap = await getDocs(collection(db, 'condos', cId, 'expenses'));
  }
  let monthExpensesCents = 0;
  expensesSnap.docs.forEach((d) => {
    const data = d.data() || {};
    const dt = tsToDate(data.date);
    if (!dt) return;
    if (!isDateInRange(dt, from, to)) return;
    monthExpensesCents += typeof data.amountCents === 'number' ? data.amountCents : 0;
  });

  let overdueMaintenancePlansCount = 0;
  try {
    overdueMaintenancePlansCount = await getOverdueMaintenancePlansCount(db, cId, todayFloor);
  } catch (e) {
    overdueMaintenancePlansCount = 0;
  }

  const monthExpensesPerUnitCents = unitsCount && unitsCount > 0 ? Math.round(monthExpensesCents / unitsCount) : null;

  return {
    condoId: cId,
    delinquentCount,
    delinquentCents,
    openTicketsCount,
    monthExpensesCents,
    unitsCount,
    monthExpensesPerUnitCents,
    overdueMaintenancePlansCount,
  };
}

export async function getOrgPortfolio(orgId, opts) {
  const { db, user } = await requireAuth();
  const oId = cleanString(orgId);
  if (!oId) throw new Error('orgId inválido.');

  opts = opts || {};
  const monthDate = opts.monthDate instanceof Date ? opts.monthDate : new Date();

  const monthRef = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
  if (!opts.noCache) {
    const cached = readCache(`orgPortfolio:${oId}:${monthRef}`, 5 * 60 * 1000);
    if (cached && typeof cached === 'object') {
      return {
        ...cached,
        format: {
          centsToBr,
        },
      };
    }
  }

  const condos = await listOrgCondos(oId);

  const metrics = await Promise.all(
    condos.map(async (c) => {
      const m = await getCondoMetrics(c.id, { monthDate, condoDocData: c });
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
      acc.overdueMaintenancePlansCount += x.overdueMaintenancePlansCount || 0;
      if (x.unitsCount && x.unitsCount > 0) acc.unitsCount += x.unitsCount;
      return acc;
    },
    {
      orgId: oId,
      condosCount: 0,
      delinquentCount: 0,
      delinquentCents: 0,
      openTicketsCount: 0,
      monthExpensesCents: 0,
      unitsCount: 0,
      overdueMaintenancePlansCount: 0,
    }
  );

  totals.monthExpensesPerUnitCents = totals.unitsCount && totals.unitsCount > 0 ? Math.round(totals.monthExpensesCents / totals.unitsCount) : null;

  // Log de visualização
  try {
    await writeAuditLog(db, {
      orgId: oId,
      condoId: null,
      actorUid: user.uid,
      action: 'portfolio.view',
      entityType: 'portfolio',
      entityId: oId,
      targetPath: 'admin/carteira.html',
      metadata: {
        condos: totals.condosCount,
      },
    });
  } catch (e) {
    // Não bloquear a tela por falha de log
  }

  const result = {
    orgId: oId,
    monthRef,
    totals,
    items: metrics,
  };

  if (!opts.noCache) writeCache(`orgPortfolio:${oId}:${monthRef}`, result);

  return {
    ...result,
    format: {
      centsToBr,
    },
  };
}
