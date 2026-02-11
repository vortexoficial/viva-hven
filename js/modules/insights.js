// Viva Haven — Dashboard Inteligente (heurísticas locais)
// Objetivo: gerar insights operacionais sem IA externa
// Firestore:
// - condos/{condoId}
// - condos/{condoId}/expenses
// - condos/{condoId}/charges
// - condos/{condoId}/maintenancePlans

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

function addMonths(dateObj, delta) {
  const d = dateObj instanceof Date ? dateObj : new Date();
  return new Date(d.getFullYear(), d.getMonth() + (Number(delta) || 0), 1);
}

function monthRef(dateObj) {
  const d = dateObj instanceof Date ? dateObj : new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${mm}`;
}

function safePct(delta, base) {
  const b = cleanNumber(base);
  const d = cleanNumber(delta);
  if (b == null || b <= 0 || d == null) return null;
  return d / b;
}

function avg(values) {
  const arr = Array.isArray(values) ? values.filter((x) => typeof x === 'number' && Number.isFinite(x)) : [];
  if (!arr.length) return null;
  const sum = arr.reduce((a, b) => a + b, 0);
  return sum / arr.length;
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

async function listExpensesForRange(db, condoId, fromDate, toDateExclusive) {
  const cId = cleanString(condoId);
  if (!cId) throw new Error('condoId inválido.');

  const col = collection(db, 'condos', cId, 'expenses');
  const q = query(col, where('date', '>=', fromDate), where('date', '<', toDateExclusive));
  const qs = await getDocs(q);
  return qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

async function listChargesForMonth(db, condoId, refMonth) {
  const cId = cleanString(condoId);
  const m = cleanString(refMonth);
  if (!cId) throw new Error('condoId inválido.');
  if (!m) throw new Error('referenceMonth inválido.');

  const col = collection(db, 'condos', cId, 'charges');
  const q = query(col, where('referenceMonth', '==', m), where('status', 'in', ['open', 'partial']));
  const qs = await getDocs(q);
  return qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

async function listMaintenancePlans(db, condoId) {
  const cId = cleanString(condoId);
  if (!cId) throw new Error('condoId inválido.');
  const qs = await getDocs(collection(db, 'condos', cId, 'maintenancePlans'));
  return qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

function bucketSumByMonth(items, dateField, amountField) {
  const out = new Map();
  (items || []).forEach((it) => {
    const dt = tsToDate(it && it[dateField]);
    if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return;
    const key = monthRef(dt);
    const amount = typeof it[amountField] === 'number' ? it[amountField] : 0;
    out.set(key, (out.get(key) || 0) + amount);
  });
  return out;
}

function topNFromMap(map, n) {
  const arr = Array.from(map.entries()).map(([key, value]) => ({ key, value }));
  arr.sort((a, b) => (b.value || 0) - (a.value || 0));
  return arr.slice(0, Math.max(0, Number(n) || 0));
}

function computeOutlier(currentCents, baselineAvgCents, thresholdPct) {
  const cur = typeof currentCents === 'number' ? currentCents : 0;
  const base = typeof baselineAvgCents === 'number' ? baselineAvgCents : null;
  const t = typeof thresholdPct === 'number' ? thresholdPct : 0.3;
  if (base == null || base <= 0) {
    return {
      ok: true,
      isOutlier: false,
      thresholdPct: t,
      currentCents: cur,
      baselineAvgCents: base,
      deltaCents: null,
      deltaPct: null,
      note: 'Sem base suficiente (precisa de 3 meses anteriores).',
    };
  }

  const deltaCents = cur - base;
  const deltaPct = safePct(deltaCents, base);
  const isOutlier = deltaPct != null ? (deltaPct >= t) : false;

  return {
    ok: true,
    isOutlier,
    thresholdPct: t,
    currentCents: cur,
    baselineAvgCents: base,
    deltaCents,
    deltaPct,
    note: null,
  };
}

export async function getCondoInsights(condoId, opts) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const now = opts.now instanceof Date ? opts.now : new Date();

  const m0 = startOfMonth(now);
  const m1 = addMonths(m0, -1);
  const m2 = addMonths(m0, -2);
  const m3 = addMonths(m0, -3);
  const m4 = addMonths(m0, 1);

  const months = [m3, m2, m1, m0];
  const monthRefs = months.map((d) => monthRef(d));

  // ===== Despesas: últimos 4 meses (inclui mês atual) =====
  const expenses = await listExpensesForRange(db, cId, m3, m4);
  const expByMonth = bucketSumByMonth(expenses, 'date', 'amountCents');
  const expensesByMonth = monthRefs.map((ref) => ({ monthRef: ref, totalCents: expByMonth.get(ref) || 0 }));

  const currentExpensesCents = expensesByMonth[3] ? expensesByMonth[3].totalCents : 0;
  const baselineExpensesAvg = avg([expensesByMonth[0].totalCents, expensesByMonth[1].totalCents, expensesByMonth[2].totalCents]);
  const spendingOutlier = computeOutlier(currentExpensesCents, baselineExpensesAvg, 0.3);

  // Ranking de custos (mês atual) por categoria
  const currentMonthRef = monthRef(m0);
  const costsByCategory = new Map();
  expenses.forEach((e) => {
    const dt = tsToDate(e && e.date);
    if (!dt) return;
    if (monthRef(dt) !== currentMonthRef) return;
    const cat = cleanString(e.category || 'geral') || 'geral';
    const amt = typeof e.amountCents === 'number' ? e.amountCents : 0;
    costsByCategory.set(cat, (costsByCategory.get(cat) || 0) + amt);
  });
  const topCategories = topNFromMap(costsByCategory, 5).map((x) => ({ category: x.key, amountCents: x.value }));

  // ===== Inadimplência: open/partial por referenceMonth (últimos 4 meses) =====
  const delinquencyByMonth = [];
  for (const ref of monthRefs) {
    const charges = await listChargesForMonth(db, cId, ref);
    let total = 0;
    charges.forEach((c) => {
      total += typeof c.amountCents === 'number' ? c.amountCents : 0;
    });
    delinquencyByMonth.push({ monthRef: ref, amountCents: total, openCount: charges.length });
  }

  const currentDelinquencyCents = delinquencyByMonth[3] ? delinquencyByMonth[3].amountCents : 0;
  const baselineDelinqAvg = avg([
    delinquencyByMonth[0].amountCents,
    delinquencyByMonth[1].amountCents,
    delinquencyByMonth[2].amountCents,
  ]);
  const delinqOutlier = computeOutlier(currentDelinquencyCents, baselineDelinqAvg, 0.15);

  // ===== Manutenções vencidas =====
  const plans = await listMaintenancePlans(db, cId);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const overdue = [];
  (plans || []).forEach((p) => {
    const status = cleanString(p.status || 'ativo').toLowerCase();
    if (status && status !== 'ativo') return;
    const next = tsToDate(p.nextDueAt);
    if (!next) return;
    const nextDay = new Date(next.getFullYear(), next.getMonth(), next.getDate());
    if (nextDay.getTime() < todayStart.getTime()) {
      overdue.push({
        id: p.id,
        title: cleanString(p.title) || '(sem título)',
        nextDueAt: next,
        frequencyDays: typeof p.frequencyDays === 'number' ? p.frequencyDays : null,
        assetId: cleanString(p.assetId) || null,
      });
    }
  });
  overdue.sort((a, b) => (a.nextDueAt.getTime() || 0) - (b.nextDueAt.getTime() || 0));

  // ===== Audit =====
  const orgId = await getOrgIdForCondo(db, cId);
  await writeAuditLog(db, {
    orgId: orgId || 'unknown',
    condoId: cId,
    actorUid: user.uid,
    action: 'insights.view',
    targetPath: 'admin/insights.html',
    metadata: {
      monthRef: currentMonthRef,
      thresholds: {
        spendingOutlierPct: spendingOutlier.thresholdPct,
        delinquencyIncreasePct: delinqOutlier.thresholdPct,
      },
    },
  });

  return {
    condoId: cId,
    monthRef: currentMonthRef,
    spendingOutlier: {
      ...spendingOutlier,
      currentBr: centsToBr(spendingOutlier.currentCents),
      baselineAvgBr: spendingOutlier.baselineAvgCents != null ? centsToBr(spendingOutlier.baselineAvgCents) : null,
    },
    delinquencyIncrease: {
      ...delinqOutlier,
      currentBr: centsToBr(delinqOutlier.currentCents),
      baselineAvgBr: delinqOutlier.baselineAvgCents != null ? centsToBr(delinqOutlier.baselineAvgCents) : null,
      series: delinquencyByMonth,
    },
    overdueMaintenance: {
      overdueCount: overdue.length,
      items: overdue.slice(0, 10).map((x) => ({
        id: x.id,
        title: x.title,
        nextDueISO: x.nextDueAt.toISOString().slice(0, 10),
      })),
    },
    costRanking: {
      topCategories: topCategories.map((x) => ({ ...x, amountBr: centsToBr(x.amountCents) })),
      monthTotalCents: currentExpensesCents,
      monthTotalBr: centsToBr(currentExpensesCents),
    },
    charts: {
      expensesByMonth,
      delinquencyByMonth,
    },
  };
}
