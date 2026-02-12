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
  limit,
  orderBy,
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

function stddev(values) {
  const arr = Array.isArray(values) ? values.filter((x) => typeof x === 'number' && Number.isFinite(x)) : [];
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((acc, x) => acc + Math.pow(x - mean, 2), 0) / (arr.length - 1);
  return Math.sqrt(v);
}

function clamp01(v) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return Math.max(0, Math.min(1, n));
}

function round0(v) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
}

function monthRefsBack(fromDate, monthsCount) {
  const base = startOfMonth(fromDate);
  const count = Math.max(1, Math.trunc(Number(monthsCount) || 1));
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(monthRef(addMonths(base, -i)));
  return out;
}

function monthRefToDateStart(ref) {
  const s = cleanString(ref);
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  const parts = s.split('-');
  const yyyy = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!yyyy || !mm) return null;
  return new Date(yyyy, mm - 1, 1);
}

async function writeAuditLog(db, payload) {
  payload = payload || {};

  const condoId = cleanString(payload.condoId);
  if (!condoId) throw new Error('condoId é obrigatório para auditLogs.');

  const docData = {
    orgId: cleanString(payload.orgId) || 'unknown',
    condoId,
    actorUid: cleanString(payload.actorUid),
    action: cleanString(payload.action),
    entityType: cleanString(payload.entityType || 'insights'),
    entityId: cleanString(payload.entityId || 'dashboard'),
    targetPath: cleanString(payload.targetPath || 'admin/insights.html'),
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

async function listExpensesForRange(db, condoId, fromDate, toDateExclusive) {
  const cId = cleanString(condoId);
  if (!cId) throw new Error('condoId inválido.');

  const col = collection(db, 'condos', cId, 'expenses');
  try {
    const q = query(col, where('date', '>=', fromDate), where('date', '<', toDateExclusive), limit(5000));
    const qs = await getDocs(q);
    return qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  } catch (e) {
    // fallback (sem range query)
    const qs = await getDocs(query(col, orderBy('date', 'desc'), limit(5000)));
    const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    return items.filter((x) => {
      const dt = tsToDate(x && x.date);
      if (!dt) return false;
      return dt.getTime() >= fromDate.getTime() && dt.getTime() < toDateExclusive.getTime();
    });
  }
}

async function listChargesForMonths(db, condoId, monthRefs) {
  const cId = cleanString(condoId);
  const refs = Array.isArray(monthRefs) ? monthRefs.map(cleanString).filter(Boolean) : [];
  if (!cId) throw new Error('condoId inválido.');
  if (!refs.length) return [];

  // Firestore: `in` suporta até 10 valores.
  const slice = refs.slice(0, 10);
  const col = collection(db, 'condos', cId, 'charges');
  const q = query(col, where('referenceMonth', 'in', slice), limit(5000));
  const qs = await getDocs(q);
  return qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

async function listPaymentsForRange(db, condoId, fromDate, toDateExclusive) {
  const cId = cleanString(condoId);
  if (!cId) throw new Error('condoId inválido.');

  const col = collection(db, 'condos', cId, 'payments');
  try {
    const q = query(col, where('paidAt', '>=', fromDate), where('paidAt', '<', toDateExclusive), limit(5000));
    const qs = await getDocs(q);
    return qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  } catch (e) {
    const qs = await getDocs(query(col, orderBy('paidAt', 'desc'), limit(5000)));
    const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    return items.filter((x) => {
      const dt = tsToDate(x && x.paidAt);
      if (!dt) return false;
      return dt.getTime() >= fromDate.getTime() && dt.getTime() < toDateExclusive.getTime();
    });
  }
}

async function listCostCenters(db, condoId) {
  const cId = cleanString(condoId);
  if (!cId) throw new Error('condoId inválido.');
  const cached = readCache(`insights:costCenters:${cId}`, 24 * 60 * 60 * 1000);
  if (cached && typeof cached === 'object') return cached;

  const qs = await getDocs(collection(db, 'condos', cId, 'costCenters'));
  const map = {};
  qs.docs.forEach((d) => {
    const data = d.data() || {};
    const name = cleanString(data.name) || d.id;
    map[d.id] = name;
  });
  writeCache(`insights:costCenters:${cId}`, map);
  return map;
}

async function listAssets(db, condoId) {
  const cId = cleanString(condoId);
  if (!cId) throw new Error('condoId inválido.');
  const qs = await getDocs(collection(db, 'condos', cId, 'assets'));
  return qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

async function listMaintenancePlans(db, condoId) {
  const cId = cleanString(condoId);
  if (!cId) throw new Error('condoId inválido.');
  const qs = await getDocs(collection(db, 'condos', cId, 'maintenancePlans'));
  return qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
}

async function listMaintenanceExecutionsForRange(db, condoId, fromDate) {
  const cId = cleanString(condoId);
  if (!cId) throw new Error('condoId inválido.');
  const col = collection(db, 'condos', cId, 'maintenanceExecutions');
  try {
    const qs = await getDocs(query(col, where('executedAt', '>=', fromDate), limit(5000)));
    return qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  } catch (e) {
    // fallback: lê tudo (MVP)
    const qs = await getDocs(col);
    const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    return items.filter((x) => {
      const dt = tsToDate(x && x.executedAt);
      return dt && dt.getTime() >= fromDate.getTime();
    });
  }
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

function buildAlert(id, severity, title, why, suggestion) {
  return {
    id: cleanString(id) || String(Math.random()).slice(2),
    severity: cleanString(severity) || 'info',
    title: cleanString(title) || 'Alerta',
    why: Array.isArray(why) ? why.filter(Boolean).map((x) => String(x)) : [],
    suggestion: suggestion ? String(suggestion) : null,
  };
}

function severityWeight(sev) {
  const s = cleanString(sev).toLowerCase();
  if (s === 'high' || s === 'alta') return 3;
  if (s === 'medium' || s === 'media') return 2;
  if (s === 'low' || s === 'baixa') return 1;
  return 0;
}

function sortAlerts(alerts) {
  const arr = Array.isArray(alerts) ? alerts.slice() : [];
  arr.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity));
  return arr;
}

function computeFinancialHealthScore(input) {
  input = input || {};
  const delinquencyRate = clamp01(input.delinquencyRate);
  const expenseDeltaPct = typeof input.expenseDeltaPct === 'number' && Number.isFinite(input.expenseDeltaPct) ? input.expenseDeltaPct : 0;
  const netCashCents = typeof input.netCashCents === 'number' && Number.isFinite(input.netCashCents) ? input.netCashCents : 0;
  const monthExpensesCents = typeof input.monthExpensesCents === 'number' && Number.isFinite(input.monthExpensesCents) ? input.monthExpensesCents : 0;

  let score = 100;
  // inadimplência pesa mais
  score -= delinquencyRate * 60;

  // gasto acima do normal (somente se aumento)
  if (expenseDeltaPct > 0) score -= Math.min(20, expenseDeltaPct * 50);

  // caixa (fluxo): se negativo, penaliza até 20 dependendo do tamanho vs despesas
  if (netCashCents < 0 && monthExpensesCents > 0) {
    const ratio = Math.min(1, Math.abs(netCashCents) / monthExpensesCents);
    score -= ratio * 20;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 80 ? 'boa' : score >= 60 ? 'atenção' : 'crítica';
  return { score, level };
}

export async function getCondoInsights(condoId, opts) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const now = opts.now instanceof Date ? opts.now : new Date();
  const monthsWindow = typeof opts.monthsWindow === 'number' ? Math.max(3, Math.min(12, Math.trunc(opts.monthsWindow))) : 6;
  const ttlMs = typeof opts.cacheTtlMs === 'number' ? Math.max(0, Math.trunc(opts.cacheTtlMs)) : 5 * 60 * 1000;

  const currentMonthRef = monthRef(startOfMonth(now));
  const cacheId = `insights:${cId}:${currentMonthRef}:w${monthsWindow}`;
  if (!opts.noCache) {
    const cached = readCache(cacheId, ttlMs);
    if (cached && typeof cached === 'object') return cached;
  }

  const monthRefs = monthRefsBack(now, monthsWindow);
  const from = monthRefToDateStart(monthRefs[0]);
  const toExclusive = addMonths(startOfMonth(now), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const orgId = await getOrgIdForCondo(db, cId);
  const [costCentersMap, expenses, charges, plans, assets] = await Promise.all([
    listCostCenters(db, cId),
    listExpensesForRange(db, cId, from || addMonths(startOfMonth(now), -(monthsWindow - 1)), toExclusive),
    listChargesForMonths(db, cId, monthRefs),
    listMaintenancePlans(db, cId),
    listAssets(db, cId),
  ]);

  // ===== Despesas por mês =====
  const expByMonth = bucketSumByMonth(expenses, 'date', 'amountCents');
  const expensesByMonth = monthRefs.map((ref) => ({ monthRef: ref, totalCents: expByMonth.get(ref) || 0 }));

  const curExpensesCents = expensesByMonth[expensesByMonth.length - 1] ? expensesByMonth[expensesByMonth.length - 1].totalCents : 0;
  const baselineExpenseMonths = expensesByMonth.slice(0, -1).map((x) => x.totalCents);
  const baselineExpensesAvg = avg(baselineExpenseMonths);
  const spendingOutlier = computeOutlier(curExpensesCents, baselineExpensesAvg, 0.3);

  const expenseDeltaPct = spendingOutlier.deltaPct != null ? spendingOutlier.deltaPct : 0;

  // ===== Ranking de custos (mês atual) =====
  const costsByCategory = new Map();
  const costsByCostCenter = new Map();
  let monthTotalCents = 0;
  expenses.forEach((e) => {
    const dt = tsToDate(e && e.date);
    if (!dt) return;
    if (monthRef(dt) !== currentMonthRef) return;
    const amt = typeof e.amountCents === 'number' ? e.amountCents : 0;
    monthTotalCents += amt;

    const cat = cleanString(e.category || 'geral') || 'geral';
    const ccId = cleanString(e.costCenterId) || 'sem_centro';
    costsByCategory.set(cat, (costsByCategory.get(cat) || 0) + amt);
    costsByCostCenter.set(ccId, (costsByCostCenter.get(ccId) || 0) + amt);
  });

  const topCategories = topNFromMap(costsByCategory, 5).map((x) => ({ category: x.key, amountCents: x.value }));
  const topCostCenters = topNFromMap(costsByCostCenter, 5).map((x) => ({
    costCenterId: x.key,
    costCenterName: x.key === 'sem_centro' ? 'Sem centro de custo' : (costCentersMap && costCentersMap[x.key] ? costCentersMap[x.key] : x.key),
    amountCents: x.value,
  }));

  // ===== Outliers por centro de custo (3-6 meses) =====
  const ccMonthly = new Map(); // ccId -> Map(monthRef -> cents)
  expenses.forEach((e) => {
    const dt = tsToDate(e && e.date);
    if (!dt) return;
    const ref = monthRef(dt);
    if (!monthRefs.includes(ref)) return;
    const ccId = cleanString(e.costCenterId) || 'sem_centro';
    const amt = typeof e.amountCents === 'number' ? e.amountCents : 0;
    if (!ccMonthly.has(ccId)) ccMonthly.set(ccId, new Map());
    const m = ccMonthly.get(ccId);
    m.set(ref, (m.get(ref) || 0) + amt);
  });

  const costCenterOutliers = [];
  ccMonthly.forEach((m, ccId) => {
    const series = monthRefs.map((ref) => (m.get(ref) || 0));
    const cur = series[series.length - 1] || 0;
    const baseArr = series.slice(0, -1);
    const baseAvg = avg(baseArr);
    const sd = stddev(baseArr);

    if (baseAvg == null || baseAvg <= 0) return;
    const delta = cur - baseAvg;
    const deltaPct = safePct(delta, baseAvg);
    const threshold = Math.max(baseAvg * 0.3, sd * 2);
    const isOut = delta > threshold;

    if (!isOut) return;

    costCenterOutliers.push({
      costCenterId: ccId,
      costCenterName: ccId === 'sem_centro' ? 'Sem centro de custo' : (costCentersMap && costCentersMap[ccId] ? costCentersMap[ccId] : ccId),
      currentCents: cur,
      baselineAvgCents: baseAvg,
      stddevCents: sd,
      deltaCents: delta,
      deltaPct,
    });
  });
  costCenterOutliers.sort((a, b) => (b.deltaCents || 0) - (a.deltaCents || 0));

  // ===== Inadimplência por mês (taxa + tendência) =====
  const delinquencyByMonth = monthRefs.map((ref) => ({ monthRef: ref, delinquentCents: 0, totalChargedCents: 0, delinquencyRate: 0, openCount: 0 }));
  const monthIndex = new Map();
  delinquencyByMonth.forEach((x, idx) => monthIndex.set(x.monthRef, idx));

  charges.forEach((c) => {
    const ref = cleanString(c.referenceMonth);
    if (!ref) return;
    const idx = monthIndex.get(ref);
    if (idx == null) return;

    const amount = typeof c.amountCents === 'number' ? c.amountCents : 0;
    delinquencyByMonth[idx].totalChargedCents += amount;

    const st = cleanString(c.status).toLowerCase();
    if (!(st === 'open' || st === 'partial')) return;

    const due = tsToDate(c.dueAt);
    if (!due) return;
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    if (dueDay.getTime() >= todayStart.getTime()) return;

    delinquencyByMonth[idx].delinquentCents += amount;
    delinquencyByMonth[idx].openCount += 1;
  });

  delinquencyByMonth.forEach((x) => {
    x.delinquencyRate = x.totalChargedCents > 0 ? x.delinquentCents / x.totalChargedCents : 0;
  });

  const curDelinq = delinquencyByMonth[delinquencyByMonth.length - 1];
  const prev3 = delinquencyByMonth.slice(Math.max(0, delinquencyByMonth.length - 4), -1);
  const baselineDelinqRateAvg = avg(prev3.map((x) => x.delinquencyRate));
  const delinqRateDelta = baselineDelinqRateAvg != null ? (curDelinq.delinquencyRate - baselineDelinqRateAvg) : null;

  const delinqIncreaseAlert = delinqRateDelta != null && delinqRateDelta >= 0.05;

  // ===== Caixa (fluxo): pagamentos - despesas no mês atual =====
  const m0Start = monthRefToDateStart(currentMonthRef) || startOfMonth(now);
  const m1StartExclusive = addMonths(m0Start, 1);
  let payments;
  try {
    payments = await listPaymentsForRange(db, cId, m0Start, m1StartExclusive);
  } catch (e) {
    payments = [];
  }
  const paymentsInCents = (payments || []).reduce((acc, p) => {
    const dir = cleanString(p && p.direction).toLowerCase();
    if (dir && dir !== 'in') return acc;
    const amt = typeof p.amountCents === 'number' ? p.amountCents : 0;
    return acc + amt;
  }, 0);

  const netCashCents = paymentsInCents - curExpensesCents;

  // ===== Saúde financeira (score) =====
  const health = computeFinancialHealthScore({
    delinquencyRate: curDelinq.delinquencyRate,
    expenseDeltaPct,
    netCashCents,
    monthExpensesCents: curExpensesCents,
  });

  // ===== Manutenções vencidas + previsão de obras =====
  const overduePlans = [];
  const dueSoonPlans = [];
  const overdueByAsset = new Map();
  (plans || []).forEach((p) => {
    const status = cleanString(p.status || 'ativo').toLowerCase();
    if (status && status !== 'ativo') return;
    const next = tsToDate(p.nextDueAt);
    if (!next) return;
    const nextDay = new Date(next.getFullYear(), next.getMonth(), next.getDate());
    const assetId = cleanString(p.assetId) || null;

    if (nextDay.getTime() < todayStart.getTime()) {
      overduePlans.push({ id: p.id, title: cleanString(p.title) || '(sem título)', nextDueAt: next, assetId });
      if (assetId) overdueByAsset.set(assetId, (overdueByAsset.get(assetId) || 0) + 1);
    } else {
      const days = Math.floor((nextDay.getTime() - todayStart.getTime()) / 86400000);
      if (days <= 30) dueSoonPlans.push({ id: p.id, title: cleanString(p.title) || '(sem título)', nextDueAt: next, assetId, days });
    }
  });
  overduePlans.sort((a, b) => (a.nextDueAt.getTime() || 0) - (b.nextDueAt.getTime() || 0));
  dueSoonPlans.sort((a, b) => (a.nextDueAt.getTime() || 0) - (b.nextDueAt.getTime() || 0));

  const assetMap = new Map();
  (assets || []).forEach((a) => assetMap.set(a.id, a));

  // Execuções recentes (histórico) — usado como indicador de desgaste
  let executions = [];
  try {
    executions = await listMaintenanceExecutionsForRange(db, cId, addMonths(todayStart, -12));
  } catch (e) {
    executions = [];
  }
  const execByAsset = new Map();
  (executions || []).forEach((e) => {
    const aId = cleanString(e.assetId);
    if (!aId) return;
    execByAsset.set(aId, (execByAsset.get(aId) || 0) + 1);
  });

  const worksForecast = [];
  const warrantySoonDays = 90;
  (assets || []).forEach((a) => {
    const w = tsToDate(a.warrantyUntil);
    const wDays = w ? Math.floor((w.getTime() - todayStart.getTime()) / 86400000) : null;
    const overdueCount = overdueByAsset.get(a.id) || 0;
    const exec12m = execByAsset.get(a.id) || 0;

    const reasons = [];
    if (wDays != null && wDays >= 0 && wDays <= warrantySoonDays) reasons.push(`Garantia vence em ${wDays} dia(s)`);
    if (overdueCount >= 1) reasons.push(`${overdueCount} plano(s) preventivo(s) vencido(s)`);
    if (exec12m >= 3) reasons.push(`${exec12m} execuções preventivas nos últimos 12 meses`);

    if (!reasons.length) return;

    worksForecast.push({
      assetId: a.id,
      assetName: cleanString(a.name) || a.id,
      type: cleanString(a.type || a.category || 'geral') || 'geral',
      reasons,
      priority: overdueCount >= 2 ? 'alta' : (overdueCount >= 1 ? 'media' : 'baixa'),
    });
  });
  worksForecast.sort((a, b) => severityWeight(b.priority) - severityWeight(a.priority));

  // ===== Sugestões (texto por regras) =====
  const suggestions = [];
  if (health.level === 'crítica') {
    suggestions.push('Priorize ações de caixa: reduzir despesas não essenciais e acelerar cobrança/negociação de inadimplentes.');
  }
  if (delinqIncreaseAlert) {
    suggestions.push('Revise o processo de cobrança: lembretes antes do vencimento, comunicação por canais e acordos de parcelamento.');
  }
  if (costCenterOutliers.length) {
    suggestions.push('Verifique os centros de custo com outlier: valide notas, contratos e recorrências (pode haver despesa extraordinária).');
  }
  if (overduePlans.length) {
    suggestions.push('Regularize a manutenção preventiva vencida para reduzir custo corretivo e risco operacional.');
  }

  // ===== Alertas explicáveis =====
  const alerts = [];
  if (health.level !== 'boa') {
    const why = [
      `Score ${health.score}/100 (nível: ${health.level})`,
      `Inadimplência do mês: ${round0(curDelinq.delinquencyRate * 100)}%`,
    ];
    if (spendingOutlier.deltaPct != null) why.push(`Variação de despesas vs média: ${round0(spendingOutlier.deltaPct * 100)}%`);
    if (curExpensesCents) why.push(`Fluxo do mês (pagamentos - despesas): ${centsToBr(netCashCents)}`);
    alerts.push(buildAlert('health', health.level === 'crítica' ? 'alta' : 'media', 'Saúde financeira em atenção', why, suggestions[0] || null));
  }

  if (costCenterOutliers.length) {
    const top = costCenterOutliers[0];
    alerts.push(buildAlert(
      'cc_outlier',
      'media',
      'Gasto fora do padrão por centro de custo',
      [
        `${top.costCenterName}: ${centsToBr(top.currentCents)} no mês`,
        `Média anterior: ${centsToBr(top.baselineAvgCents)} (desvio: ${centsToBr(Math.round(top.stddevCents || 0))})`,
        `Diferença: ${centsToBr(top.deltaCents)} (+${round0((top.deltaPct || 0) * 100)}%)`,
      ],
      'Confirme se houve despesa extraordinária ou ajuste contratual; se não, investigue lançamentos e fornecedores.'
    ));
  }

  if (delinqIncreaseAlert) {
    alerts.push(buildAlert(
      'delinq_trend',
      'alta',
      'Aumento de inadimplência (tendência)',
      [
        `Taxa atual: ${round0(curDelinq.delinquencyRate * 100)}%`,
        `Média dos 3 meses anteriores: ${round0((baselineDelinqRateAvg || 0) * 100)}%`,
        `Variação: +${round0((delinqRateDelta || 0) * 100)} p.p.`,
      ],
      'Aplique lembretes e negociações focadas nas unidades em atraso; revise calendário de vencimentos.'
    ));
  }

  if (overduePlans.length) {
    alerts.push(buildAlert(
      'maintenance_overdue',
      overduePlans.length >= 5 ? 'alta' : 'media',
      'Manutenções preventivas vencidas',
      [
        `${overduePlans.length} plano(s) ativo(s) com nextDueAt antes de hoje`,
        `Mais antigo: ${overduePlans[0].nextDueAt.toISOString().slice(0, 10)}`,
      ],
      'Planeje execução e registre as conclusões para manter o histórico e reduzir risco.'
    ));
  }

  if (worksForecast.length) {
    const top = worksForecast[0];
    alerts.push(buildAlert(
      'works_forecast',
      top.priority === 'alta' ? 'alta' : 'media',
      'Previsão de obras/manutenções (heurística)',
      [
        `Ativo destacado: ${top.assetName}`,
        ...top.reasons,
        'Obs.: sem ML; usamos garantia + vencimentos + volume de execuções como proxy de risco.',
      ],
      'Prepare orçamento e cronograma preventivo para os ativos com maior prioridade.'
    ));
  }

  const sortedAlerts = sortAlerts(alerts);

  // ===== Audit =====
  try {
    await writeAuditLog(db, {
      orgId: orgId || 'unknown',
      condoId: cId,
      actorUid: user.uid,
      action: 'insights.view',
      entityType: 'insights',
      entityId: cId,
      targetPath: 'admin/insights.html',
      metadata: {
        monthRef: currentMonthRef,
        monthsWindow,
        alerts: sortedAlerts.map((a) => ({ id: a.id, severity: a.severity })),
      },
    });
  } catch (e) {
    // não bloquear
  }

  const result = {
    condoId: cId,
    monthRef: currentMonthRef,
    health: {
      score: health.score,
      level: health.level,
      delinquencyRate: curDelinq.delinquencyRate,
      netCashCents,
      paymentsInCents,
      monthExpensesCents: curExpensesCents,
      expensesDeltaPct: spendingOutlier.deltaPct,
    },
    alerts: sortedAlerts,
    spendingOutlier: {
      ...spendingOutlier,
      currentBr: centsToBr(spendingOutlier.currentCents),
      baselineAvgBr: spendingOutlier.baselineAvgCents != null ? centsToBr(spendingOutlier.baselineAvgCents) : null,
    },
    spendingOutliersByCostCenter: costCenterOutliers.slice(0, 5).map((x) => ({
      costCenterId: x.costCenterId,
      costCenterName: x.costCenterName,
      currentBr: centsToBr(x.currentCents),
      baselineAvgBr: centsToBr(x.baselineAvgCents),
      deltaBr: centsToBr(x.deltaCents),
      deltaPct: x.deltaPct,
    })),
    delinquencyTrend: {
      currentRate: curDelinq.delinquencyRate,
      baselineRateAvg: baselineDelinqRateAvg,
      deltaRate: delinqRateDelta,
      series: delinquencyByMonth,
    },
    overdueMaintenance: {
      overdueCount: overduePlans.length,
      dueSoonCount: dueSoonPlans.length,
      items: overduePlans.slice(0, 10).map((x) => ({
        id: x.id,
        title: x.title,
        nextDueISO: x.nextDueAt.toISOString().slice(0, 10),
      })),
    },
    worksForecast: {
      items: worksForecast.slice(0, 10),
    },
    costRanking: {
      topCategories: topCategories.map((x) => ({ ...x, amountBr: centsToBr(x.amountCents) })),
      topCostCenters: topCostCenters.map((x) => ({ ...x, amountBr: centsToBr(x.amountCents) })),
      monthTotalCents,
      monthTotalBr: centsToBr(monthTotalCents),
    },
    suggestions,
    charts: {
      expensesByMonth,
      delinquencyByMonth: delinquencyByMonth.map((x) => ({
        monthRef: x.monthRef,
        delinquentCents: x.delinquentCents,
        totalChargedCents: x.totalChargedCents,
        delinquencyRate: x.delinquencyRate,
        openCount: x.openCount,
      })),
    },
  };

  if (!opts.noCache) writeCache(cacheId, result);
  return result;
}
