// Viva Haven — Módulo Financeiro (MVP, sem integrações externas)
// Firestore:
// - condos/{condoId}/charges/{chargeId}
// - condos/{condoId}/payments/{paymentId}
// - condos/{condoId}/expenses/{expenseId}
// - condos/{condoId}/ledger/{entryId}
// Storage (anexos):
// - condos/{condoId}/expenses/{expenseId}/attachment
// - condos/{condoId}/payments/{paymentId}/receipt

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
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

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
  const { auth, db, storage } = await initFirebase();
  const user = await waitForUser(auth);
  if (!user) throw new Error('Você precisa estar logado.');
  return { auth, db, storage, user };
}

function cleanString(value) {
  return String(value || '').trim();
}

function cleanNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMoneyToCents(value) {
  // Aceita number, "123.45" ou "123,45".
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100);

  const raw = cleanString(value);
  if (!raw) return null;

  const normalized = raw.replace(/\./g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function centsToBr(value) {
  const cents = cleanNumber(value);
  if (cents == null) return '';
  const n = cents / 100;
  try {
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  } catch (e) {
    return 'R$ ' + n.toFixed(2).replace('.', ',');
  }
}

function toDateOnly(value) {
  // yyyy-mm-dd -> Date
  const v = cleanString(value);
  if (!v) return null;
  const dt = new Date(v + 'T00:00:00');
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function toMonthRef(value) {
  // yyyy-mm (input type=month)
  const v = cleanString(value);
  if (!v) return '';
  if (!/^\d{4}-\d{2}$/.test(v)) return '';
  return v;
}

function nowMonthRef() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
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

async function getMembershipForCondo(db, uid, condoId) {
  const u = cleanString(uid);
  const cId = cleanString(condoId);
  if (!u || !cId) return null;

  const membershipId = `${u}_${cId}`;
  const snap = await getDoc(doc(db, 'memberships', membershipId));
  if (!snap.exists()) return null;
  return snap.data() || null;
}

async function listUnitsForCondo(db, condoId) {
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');
  const qs = await getDocs(collection(db, 'condos', cId, 'units'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => cleanString(a.number).localeCompare(cleanString(b.number)));
  return items;
}

function buildChargePayload(base) {
  base = base || {};

  const referenceMonth = toMonthRef(base.referenceMonth) || nowMonthRef();
  const dueAt = toDateOnly(base.dueDate);
  const amountCents = base.amountCents != null ? cleanNumber(base.amountCents) : parseMoneyToCents(base.amount);
  const description = cleanString(base.description) || `Cota condominial — ${referenceMonth}`;

  if (!referenceMonth) throw new Error('Mês de referência inválido.');
  if (!dueAt) throw new Error('Vencimento é obrigatório.');
  if (amountCents == null || amountCents <= 0) throw new Error('Valor inválido.');

  return { referenceMonth, dueAt, amountCents, description };
}

export async function generateMonthlyCharges(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const payload = buildChargePayload(data);
  const units = await listUnitsForCondo(db, cId);
  if (!units || units.length === 0) throw new Error('Nenhuma unidade cadastrada.');

  // Firestore batch tem limite 500 writes. Cada unidade: 1 charge + 1 ledger.
  const CHUNK_SIZE = 200;
  let created = 0;

  for (let i = 0; i < units.length; i += CHUNK_SIZE) {
    const slice = units.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);

    slice.forEach((u) => {
      const chargeRef = doc(collection(db, 'condos', cId, 'charges'));
      const ledgerRef = doc(collection(db, 'condos', cId, 'ledger'));

      const unitNumber = cleanString(u.number) || null;
      const blockId = cleanString(u.blockId) || null;

      const chargeDoc = {
        orgId,
        condoId: cId,
        unitId: u.id,
        unitNumber,
        blockId,
        referenceMonth: payload.referenceMonth,
        description: payload.description,
        amountCents: payload.amountCents,
        currency: 'BRL',
        dueAt: payload.dueAt,
        status: 'open', // open | partial | paid | cancelled
        paidAt: null,
        paymentId: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: user.uid,
      };

      const ledgerDoc = {
        orgId,
        condoId: cId,
        type: 'charge',
        direction: 'in',
        amountCents: payload.amountCents,
        date: payload.dueAt,
        ref: {
          chargeId: chargeRef.id,
          unitId: u.id,
          referenceMonth: payload.referenceMonth,
        },
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      };

      batch.set(chargeRef, chargeDoc);
      batch.set(ledgerRef, ledgerDoc);
      created++;
    });

    await batch.commit();
  }

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'charge.generate_monthly',
    targetPath: `condos/${cId}/charges/*`,
    metadata: {
      referenceMonth: payload.referenceMonth,
      dueDate: cleanString(data && data.dueDate),
      amountCents: payload.amountCents,
      units: units.length,
    },
  });

  return { ok: true, createdCount: created, referenceMonth: payload.referenceMonth, amountCents: payload.amountCents };
}

export async function listCharges(condoId, opts) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const status = cleanString(opts.status);

  // Morador: se membership tiver unitId, filtra por unidade no client.
  const membership = await getMembershipForCondo(db, user.uid, cId);
  const unitIdFilter = membership && membership.unitId ? cleanString(membership.unitId) : '';

  let qs;
  if (status) {
    qs = await getDocs(query(collection(db, 'condos', cId, 'charges'), where('status', '==', status)));
  } else {
    qs = await getDocs(collection(db, 'condos', cId, 'charges'));
  }

  let items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  if (unitIdFilter) items = items.filter((c) => cleanString(c.unitId) === unitIdFilter);

  items.sort((a, b) => {
    const ad = a.dueAt && typeof a.dueAt.toDate === 'function' ? a.dueAt.toDate().getTime() : 0;
    const bd = b.dueAt && typeof b.dueAt.toDate === 'function' ? b.dueAt.toDate().getTime() : 0;
    if (ad !== bd) return bd - ad;
    return cleanString(a.referenceMonth).localeCompare(cleanString(b.referenceMonth));
  });

  return items;
}

export async function listDelinquents(condoId, asOfDate) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const now = asOfDate instanceof Date ? asOfDate : new Date();

  const qs = await getDocs(query(collection(db, 'condos', cId, 'charges'), where('status', 'in', ['open', 'partial'])));
  let items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  items = items.filter((c) => {
    if (!c.dueAt || typeof c.dueAt.toDate !== 'function') return false;
    return c.dueAt.toDate().getTime() < now.getTime();
  });

  items.sort((a, b) => {
    const ad = a.dueAt && typeof a.dueAt.toDate === 'function' ? a.dueAt.toDate().getTime() : 0;
    const bd = b.dueAt && typeof b.dueAt.toDate === 'function' ? b.dueAt.toDate().getTime() : 0;
    return ad - bd;
  });

  return items;
}

async function uploadToStorage(storage, path, file) {
  if (!file) return null;
  if (!storage) {
    throw new Error('Upload de arquivos está indisponível no momento (Storage desativado).');
  }
  const p = cleanString(path);
  if (!p) throw new Error('Path inválido para upload.');

  const r = storageRef(storage, p);
  const result = await uploadBytes(r, file, {
    contentType: file.type || undefined,
  });
  const url = await getDownloadURL(result.ref);

  return {
    path: p,
    url,
    name: cleanString(file.name) || 'arquivo',
    contentType: cleanString(file.type) || null,
    size: typeof file.size === 'number' ? file.size : null,
  };
}

export async function registerPayment(condoId, data) {
  const { db, storage, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const chargeId = cleanString(data.chargeId);
  if (!chargeId) throw new Error('Selecione uma cobrança.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const chargeRef = doc(db, 'condos', cId, 'charges', chargeId);
  const chargeSnap = await getDoc(chargeRef);
  if (!chargeSnap.exists()) throw new Error('Cobrança não encontrada.');
  const charge = chargeSnap.data() || {};

  const paidAt = toDateOnly(data.paidDate) || new Date();
  const amountCents = data.amountCents != null ? cleanNumber(data.amountCents) : parseMoneyToCents(data.amount);
  const method = cleanString(data.method) || 'manual';
  const note = cleanString(data.note) || null;
  const receiptFile = data.receiptFile || null;

  const chargeAmount = cleanNumber(charge.amountCents) || 0;
  const payCents = amountCents != null ? amountCents : chargeAmount;
  if (payCents <= 0) throw new Error('Valor do pagamento inválido.');

  const paymentDoc = {
    orgId,
    condoId: cId,
    chargeId,
    unitId: charge.unitId ? cleanString(charge.unitId) : null,
    amountCents: payCents,
    currency: 'BRL',
    paidAt,
    method,
    note,
    receipt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
  };

  const paymentRef = await addDoc(collection(db, 'condos', cId, 'payments'), paymentDoc);

  // Upload de comprovante (opcional)
  let receipt = null;
  if (receiptFile) {
    receipt = await uploadToStorage(storage, `condos/${cId}/payments/${paymentRef.id}/receipt`, receiptFile);
    await updateDoc(paymentRef, { receipt, updatedAt: serverTimestamp() });
  }

  // Atualiza cobrança
  const isPaid = payCents >= chargeAmount && chargeAmount > 0;
  const status = isPaid ? 'paid' : 'partial';
  const remainingCents = isPaid ? 0 : Math.max(0, chargeAmount - payCents);

  await updateDoc(chargeRef, {
    status,
    paidAt: isPaid ? paidAt : null,
    paymentId: paymentRef.id,
    remainingCents,
    updatedAt: serverTimestamp(),
  });

  // Ledger
  await addDoc(collection(db, 'condos', cId, 'ledger'), {
    orgId,
    condoId: cId,
    type: 'payment',
    direction: 'in',
    amountCents: payCents,
    date: paidAt,
    ref: { paymentId: paymentRef.id, chargeId, unitId: charge.unitId ? cleanString(charge.unitId) : null },
    createdAt: serverTimestamp(),
    createdBy: user.uid,
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'payment.register',
    targetPath: `condos/${cId}/payments/${paymentRef.id}`,
    metadata: { chargeId, amountCents: payCents, method, hasReceipt: !!receipt },
  });

  return { id: paymentRef.id, ...paymentDoc, receipt };
}

export async function getPayment(condoId, paymentId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  const pId = cleanString(paymentId);
  if (!cId) throw new Error('condoId inválido.');
  if (!pId) throw new Error('paymentId inválido.');

  const snap = await getDoc(doc(db, 'condos', cId, 'payments', pId));
  return snap.exists() ? ({ id: snap.id, ...(snap.data() || {}) }) : null;
}

export async function createExpense(condoId, data) {
  const { db, storage, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const description = cleanString(data.description);
  const category = cleanString(data.category) || 'geral';
  const vendor = cleanString(data.vendor) || null;
  const date = toDateOnly(data.date) || new Date();
  const amountCents = data.amountCents != null ? cleanNumber(data.amountCents) : parseMoneyToCents(data.amount);
  const attachmentFile = data.attachmentFile || null;

  if (!description) throw new Error('Descrição é obrigatória.');
  if (amountCents == null || amountCents <= 0) throw new Error('Valor inválido.');

  const expenseDoc = {
    orgId,
    condoId: cId,
    description,
    category,
    vendor,
    date,
    amountCents,
    currency: 'BRL',
    attachment: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
  };

  const expenseRef = await addDoc(collection(db, 'condos', cId, 'expenses'), expenseDoc);

  let attachment = null;
  if (attachmentFile) {
    attachment = await uploadToStorage(storage, `condos/${cId}/expenses/${expenseRef.id}/attachment`, attachmentFile);
    await updateDoc(expenseRef, { attachment, updatedAt: serverTimestamp() });
  }

  await addDoc(collection(db, 'condos', cId, 'ledger'), {
    orgId,
    condoId: cId,
    type: 'expense',
    direction: 'out',
    amountCents,
    date,
    ref: { expenseId: expenseRef.id, category },
    createdAt: serverTimestamp(),
    createdBy: user.uid,
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'expense.create',
    targetPath: `condos/${cId}/expenses/${expenseRef.id}`,
    metadata: { amountCents, category, hasAttachment: !!attachment },
  });

  return { id: expenseRef.id, ...expenseDoc, attachment };
}

export async function listExpenses(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'expenses'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  items.sort((a, b) => {
    const ad = a.date && typeof a.date.toDate === 'function' ? a.date.toDate().getTime() : (a.date instanceof Date ? a.date.getTime() : 0);
    const bd = b.date && typeof b.date.toDate === 'function' ? b.date.toDate().getTime() : (b.date instanceof Date ? b.date.getTime() : 0);
    return bd - ad;
  });

  return items;
}

export async function getSimpleReports(condoId, opts) {
  // Retorna: balancete (totais) + fluxo de caixa (lista simplificada)
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const from = toDateOnly(opts.from) || null;
  const to = toDateOnly(opts.to) || null;

  const ledgerSnap = await getDocs(collection(db, 'condos', cId, 'ledger'));
  let ledger = ledgerSnap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));

  function entryDateMs(e) {
    try {
      if (!e || !e.date) return 0;
      if (typeof e.date.toDate === 'function') return e.date.toDate().getTime();
      if (e.date instanceof Date) return e.date.getTime();
      return 0;
    } catch (err) {
      return 0;
    }
  }

  if (from) ledger = ledger.filter((e) => entryDateMs(e) >= from.getTime());
  if (to) {
    const end = new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1);
    ledger = ledger.filter((e) => entryDateMs(e) <= end.getTime());
  }

  let chargesIssuedCents = 0;
  let paymentsInCents = 0;
  let expensesOutCents = 0;

  const cashFlow = [];

  ledger.forEach((e) => {
    const t = cleanString(e.type);
    const dir = cleanString(e.direction);
    const amount = cleanNumber(e.amountCents) || 0;

    if (t === 'charge') chargesIssuedCents += amount;
    if (t === 'payment' && dir === 'in') paymentsInCents += amount;
    if (t === 'expense' && dir === 'out') expensesOutCents += amount;

    if (t === 'payment' || t === 'expense') {
      cashFlow.push({
        id: e.id,
        type: t,
        direction: dir,
        amountCents: amount,
        date: e.date || null,
        ref: e.ref || null,
      });
    }
  });

  cashFlow.sort((a, b) => entryDateMs(a) - entryDateMs(b));

  const summary = {
    chargesIssuedCents,
    paymentsInCents,
    expensesOutCents,
    netCashCents: paymentsInCents - expensesOutCents,
    chargesIssued: centsToBr(chargesIssuedCents),
    paymentsIn: centsToBr(paymentsInCents),
    expensesOut: centsToBr(expensesOutCents),
    netCash: centsToBr(paymentsInCents - expensesOutCents),
  };

  return { summary, cashFlow };
}

export const Money = { parseMoneyToCents, centsToBr };
