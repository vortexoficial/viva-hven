// Viva Haven — Módulo Financeiro (MVP, sem integrações externas)
// Firestore:
// - condos/{condoId}/charges/{chargeId}
// - condos/{condoId}/payments/{paymentId}
// - condos/{condoId}/expenses/{expenseId}
// - condos/{condoId}/ledger/{entryId}
// Anexos (MVP sem Storage):
// - Salvar apenas URL em `payments.receipt` e `expenses.attachment`

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

function isFileLike(value) {
  try {
    return typeof File !== 'undefined' && value instanceof File;
  } catch (e) {
    return false;
  }
}

function normalizeUrl(value) {
  const v = cleanString(value);
  if (!v) return '';
  try {
    const u = new URL(v);
    return u.href;
  } catch (e) {
    return v;
  }
}

function normalizeUrlAttachment(input, nameFallback) {
  if (!input) return null;
  if (isFileLike(input)) {
    throw new Error('Upload de arquivos está indisponível no momento (Storage desativado). Informe uma URL.');
  }

  if (typeof input === 'string') {
    const url = normalizeUrl(input);
    if (!url) return null;
    return { url, name: nameFallback || 'arquivo', source: 'url' };
  }

  if (typeof input === 'object') {
    const url = normalizeUrl(input.url);
    if (!url) return null;
    const name = cleanString(input.name) || nameFallback || 'arquivo';
    return { url, name, source: 'url' };
  }

  return null;
}

function nowMonthRef() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function toDateMs(value) {
  try {
    if (!value) return 0;
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    return 0;
  } catch (e) {
    return 0;
  }
}

function monthRefFromDate(date) {
  try {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
  } catch (e) {
    return '';
  }
}

function computeLateBreakdown(amountCents, charge, asOfDate) {
  const base = cleanNumber(amountCents) || 0;
  const dueMs = charge && charge.dueAt ? toDateMs(charge.dueAt) : 0;
  const now = asOfDate instanceof Date ? asOfDate : new Date();
  const nowMs = now.getTime();
  const daysLate = dueMs && nowMs > dueMs ? Math.floor((nowMs - dueMs) / (24 * 60 * 60 * 1000)) : 0;
  if (!daysLate) return { daysLate: 0, fineCents: 0, interestCents: 0, totalCents: base };

  const finePercent = charge && charge.finePercent != null ? Number(charge.finePercent) : 0;
  const interestMonthly = charge && charge.interestMonthlyPercent != null ? Number(charge.interestMonthlyPercent) : 0;

  const fineCents = finePercent > 0 ? Math.round((base * finePercent) / 100) : 0;
  const interestDaily = interestMonthly > 0 ? (interestMonthly / 100) / 30 : 0;
  const interestCents = interestDaily > 0 ? Math.round(base * interestDaily * daysLate) : 0;
  const totalCents = Math.max(0, base + fineCents + interestCents);
  return { daysLate, fineCents, interestCents, totalCents };
}

export function buildDelinquencyLetterHtml(input) {
  input = input || {};
  const condoName = cleanString(input.condoName) || 'Condomínio';
  const unitLabel = cleanString(input.unitLabel) || '';
  const asOf = input.asOfDate instanceof Date ? input.asOfDate : new Date();
  const charges = Array.isArray(input.charges) ? input.charges : (input.charge ? [input.charge] : []);

  const rows = charges
    .map((c) => {
      const amount = cleanNumber(c && c.amountCents) || 0;
      const due = c && c.dueAt && typeof c.dueAt.toDate === 'function' ? c.dueAt.toDate() : (c && c.dueAt instanceof Date ? c.dueAt : null);
      const dueStr = due ? `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}` : '';
      const ref = cleanString(c && c.referenceMonth);
      const late = computeLateBreakdown(amount, c, asOf);
      return {
        ref,
        dueStr,
        base: centsToBr(amount),
        fine: late.fineCents ? centsToBr(late.fineCents) : '',
        interest: late.interestCents ? centsToBr(late.interestCents) : '',
        total: centsToBr(late.totalCents),
      };
    })
    .map(
      (r) =>
        '<tr>' +
        `<td style="padding:8px;border-bottom:1px solid #ddd;">${r.ref || ''}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #ddd;">${r.dueStr || ''}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #ddd;text-align:right;">${r.base || ''}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #ddd;text-align:right;">${r.fine || '—'}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #ddd;text-align:right;">${r.interest || '—'}</td>` +
        `<td style="padding:8px;border-bottom:1px solid #ddd;text-align:right;font-weight:700;">${r.total || ''}</td>` +
        '</tr>'
    )
    .join('');

  const asOfStr = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}-${String(asOf.getDate()).padStart(2, '0')}`;

  return (
    '<!doctype html>' +
    '<html lang="pt-BR">' +
    '<head>' +
    '<meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<title>Carta de cobrança</title>' +
    '</head>' +
    '<body style="font-family:Arial, sans-serif; color:#111; line-height:1.35; padding:24px;">' +
    `<h1 style="margin:0 0 8px; font-size:18px;">Carta de Cobrança</h1>` +
    `<div style="color:#444; font-size:12px; margin-bottom:18px;">${condoName}${unitLabel ? ' • ' + unitLabel : ''} • Data-base: ${asOfStr}</div>` +
    '<p style="margin:0 0 12px;">Prezado(a),</p>' +
    '<p style="margin:0 0 16px;">Constam valores em aberto referentes às cobranças abaixo. Solicitamos a regularização. Caso já tenha efetuado o pagamento, desconsidere.</p>' +
    '<table style="width:100%; border-collapse:collapse; font-size:12px;">' +
    '<thead>' +
    '<tr>' +
    '<th style="text-align:left; padding:8px; border-bottom:2px solid #111;">Referência</th>' +
    '<th style="text-align:left; padding:8px; border-bottom:2px solid #111;">Vencimento</th>' +
    '<th style="text-align:right; padding:8px; border-bottom:2px solid #111;">Valor</th>' +
    '<th style="text-align:right; padding:8px; border-bottom:2px solid #111;">Multa</th>' +
    '<th style="text-align:right; padding:8px; border-bottom:2px solid #111;">Juros</th>' +
    '<th style="text-align:right; padding:8px; border-bottom:2px solid #111;">Total estimado</th>' +
    '</tr>' +
    '</thead>' +
    `<tbody>${rows || ''}</tbody>` +
    '</table>' +
    '<div style="margin-top:18px; font-size:12px; color:#444;">Obs.: multa/juros são estimativas conforme parametrização da cobrança.</div>' +
    '<div style="margin-top:28px;">' +
    '<div>Atenciosamente,</div>' +
    `<div style="margin-top:28px; border-top:1px solid #111; width:280px; padding-top:6px;">${condoName}</div>` +
    '</div>' +
    '</body></html>'
  );
}

async function writeAuditLog(db, payload) {
  payload = payload || {};

  const condoId = cleanString(payload.condoId);
  if (!condoId) throw new Error('condoId é obrigatório para auditLogs.');

  const docData = {
    orgId: payload.orgId ? cleanString(payload.orgId) : null,
    condoId,
    actorUid: cleanString(payload.actorUid),
    action: cleanString(payload.action) || null,
    entityType: payload.entityType ? cleanString(payload.entityType) : null,
    entityId: payload.entityId ? cleanString(payload.entityId) : null,
    targetPath: payload.targetPath ? cleanString(payload.targetPath) : null,
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

  const finePercent = base.finePercent != null ? cleanNumber(base.finePercent) : null;
  const interestMonthlyPercent = base.interestMonthlyPercent != null ? cleanNumber(base.interestMonthlyPercent) : null;

  if (!referenceMonth) throw new Error('Mês de referência inválido.');
  if (!dueAt) throw new Error('Vencimento é obrigatório.');
  if (amountCents == null || amountCents <= 0) throw new Error('Valor inválido.');

  return { referenceMonth, dueAt, amountCents, description, finePercent, interestMonthlyPercent };
}

export async function generateMonthlyCharges(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const payload = buildChargePayload(data);

  const billingRef = doc(collection(db, 'condos', cId, 'billing'));
  await setDoc(billingRef, {
    orgId,
    condoId: cId,
    type: 'monthly_charges',
    referenceMonth: payload.referenceMonth,
    dueAt: payload.dueAt,
    amountCents: payload.amountCents,
    currency: 'BRL',
    description: payload.description,
    finePercent: payload.finePercent,
    interestMonthlyPercent: payload.interestMonthlyPercent,
    status: 'generated',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
  });

  const units = await listUnitsForCondo(db, cId);
  if (!units || units.length === 0) throw new Error('Nenhuma unidade cadastrada.');

  // Firestore batch tem limite 500 writes.
  // Cada unidade: 1 charge (raiz) + 1 charge (espelho por unidade) + 1 ledger = 3 writes.
  const CHUNK_SIZE = 150;
  let created = 0;

  for (let i = 0; i < units.length; i += CHUNK_SIZE) {
    const slice = units.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);

    slice.forEach((u) => {
      const chargeRef = doc(collection(db, 'condos', cId, 'charges'));
      const unitChargeRef = doc(db, 'condos', cId, 'units', u.id, 'charges', chargeRef.id);
      const ledgerRef = doc(collection(db, 'condos', cId, 'ledger'));

      const unitNumber = cleanString(u.number) || null;
      const blockId = cleanString(u.blockId) || null;

      const chargeDoc = {
        orgId,
        condoId: cId,
        billingId: billingRef.id,
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
        // Campos úteis para o app do morador (sem precisar ler payments)
        paymentReceiptUrl: null,
        paymentUrl: null,
        boletoUrl: null,
        pixCopyPaste: null,
        finePercent: payload.finePercent,
        interestMonthlyPercent: payload.interestMonthlyPercent,
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
        costCenterId: null,
        ref: {
          chargeId: chargeRef.id,
          unitId: u.id,
          referenceMonth: payload.referenceMonth,
        },
        createdAt: serverTimestamp(),
        createdBy: user.uid,
      };

      batch.set(chargeRef, chargeDoc);
      batch.set(unitChargeRef, chargeDoc);
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
    entityType: 'billing',
    entityId: billingRef.id,
    targetPath: `condos/${cId}/charges/*`,
    metadata: {
      referenceMonth: payload.referenceMonth,
      dueDate: cleanString(data && data.dueDate),
      amountCents: payload.amountCents,
      finePercent: payload.finePercent,
      interestMonthlyPercent: payload.interestMonthlyPercent,
      units: units.length,
    },
  });

  return { ok: true, createdCount: created, referenceMonth: payload.referenceMonth, amountCents: payload.amountCents };
}

/**
 * listMyCharges(condoId)
 * App do morador: lê cobranças somente da unidade vinculada no membership.
 * Path: condos/{condoId}/units/{unitId}/charges/{chargeId}
 */
export async function listMyCharges(condoId, opts) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const status = cleanString(opts.status);

  const membership = await getMembershipForCondo(db, user.uid, cId);
  const unitId = membership && membership.unitId ? cleanString(membership.unitId) : '';
  if (!unitId) throw new Error('Sua unidade não está vinculada ao seu acesso (membership.unitId).');

  const col = collection(db, 'condos', cId, 'units', unitId, 'charges');
  const qs = status
    ? await getDocs(query(col, where('status', '==', status)))
    : await getDocs(col);

  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => {
    const ad = a.dueAt && typeof a.dueAt.toDate === 'function' ? a.dueAt.toDate().getTime() : 0;
    const bd = b.dueAt && typeof b.dueAt.toDate === 'function' ? b.dueAt.toDate().getTime() : 0;
    return bd - ad;
  });
  return items;
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

  items = items.map((c) => {
    const amountCents = cleanNumber(c.amountCents) || 0;
    const late = computeLateBreakdown(amountCents, c, now);
    return {
      ...c,
      late: {
        ...late,
        total: centsToBr(late.totalCents),
        fine: centsToBr(late.fineCents),
        interest: centsToBr(late.interestCents),
      },
    };
  });

  items.sort((a, b) => {
    const ad = a.dueAt && typeof a.dueAt.toDate === 'function' ? a.dueAt.toDate().getTime() : 0;
    const bd = b.dueAt && typeof b.dueAt.toDate === 'function' ? b.dueAt.toDate().getTime() : 0;
    return ad - bd;
  });

  return items;
}

// TODO: se futuramente habilitar Storage, implementar upload aqui.

export async function registerPayment(condoId, data) {
  const { db, user } = await requireAuth();
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
  const receiptUrl = cleanString(data.receiptUrl || data.receiptURL) || '';

  if (receiptFile) {
    throw new Error('Upload de comprovante está indisponível (Storage desativado). Informe a URL do comprovante.');
  }

  const chargeAmount = cleanNumber(charge.amountCents) || 0;
  const payCents = amountCents != null ? amountCents : chargeAmount;
  if (payCents <= 0) throw new Error('Valor do pagamento inválido.');

  const paymentDoc = {
    orgId,
    condoId: cId,
    type: 'charge_payment',
    direction: 'in',
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

  // Comprovante (opcional) via URL
  let receipt = null;
  if (receiptUrl) {
    receipt = normalizeUrlAttachment(receiptUrl, 'comprovante');
    if (receipt) await updateDoc(paymentRef, { receipt, updatedAt: serverTimestamp() });
  }

  // Atualiza cobrança
  const isPaid = payCents >= chargeAmount && chargeAmount > 0;
  const status = isPaid ? 'paid' : 'partial';
  const remainingCents = isPaid ? 0 : Math.max(0, chargeAmount - payCents);

  await updateDoc(chargeRef, {
    status,
    paidAt: isPaid ? paidAt : null,
    paymentId: paymentRef.id,
    paymentReceiptUrl: receipt && receipt.url ? receipt.url : (receiptUrl || null),
    paymentUrl: cleanString(data.paymentUrl) || null,
    boletoUrl: cleanString(data.boletoUrl) || null,
    pixCopyPaste: cleanString(data.pixCopyPaste) || null,
    remainingCents,
    updatedAt: serverTimestamp(),
  });

  // Espelho por unidade (best-effort)
  try {
    const unitId = charge.unitId ? cleanString(charge.unitId) : '';
    if (unitId) {
      await updateDoc(doc(db, 'condos', cId, 'units', unitId, 'charges', chargeId), {
        status,
        paidAt: isPaid ? paidAt : null,
        paymentId: paymentRef.id,
        paymentReceiptUrl: receipt && receipt.url ? receipt.url : (receiptUrl || null),
        paymentUrl: cleanString(data.paymentUrl) || null,
        boletoUrl: cleanString(data.boletoUrl) || null,
        pixCopyPaste: cleanString(data.pixCopyPaste) || null,
        remainingCents,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (e) {}

  // Ledger
  await addDoc(collection(db, 'condos', cId, 'ledger'), {
    orgId,
    condoId: cId,
    type: 'payment',
    direction: 'in',
    amountCents: payCents,
    date: paidAt,
    costCenterId: null,
    ref: { paymentId: paymentRef.id, chargeId, unitId: charge.unitId ? cleanString(charge.unitId) : null },
    createdAt: serverTimestamp(),
    createdBy: user.uid,
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'payment.register',
    entityType: 'payment',
    entityId: paymentRef.id,
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
  const { db, user } = await requireAuth();
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
  const costCenterId = cleanString(data.costCenterId) || null;
  const attachmentFile = data.attachmentFile || null;
  const attachmentUrl = cleanString(data.attachmentUrl || data.attachmentURL) || '';

  if (attachmentFile) {
    throw new Error('Upload de anexos está indisponível (Storage desativado). Informe a URL do anexo.');
  }

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
    costCenterId,
    attachment: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
  };

  const expenseRef = await addDoc(collection(db, 'condos', cId, 'expenses'), expenseDoc);

  let attachment = null;
  if (attachmentUrl) {
    attachment = normalizeUrlAttachment(attachmentUrl, 'anexo');
    if (attachment) await updateDoc(expenseRef, { attachment, updatedAt: serverTimestamp() });
  }

  await addDoc(collection(db, 'condos', cId, 'ledger'), {
    orgId,
    condoId: cId,
    type: 'expense',
    direction: 'out',
    amountCents,
    date,
    costCenterId,
    ref: { expenseId: expenseRef.id, category },
    createdAt: serverTimestamp(),
    createdBy: user.uid,
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'expense.create',
    entityType: 'expense',
    entityId: expenseRef.id,
    targetPath: `condos/${cId}/expenses/${expenseRef.id}`,
    metadata: { amountCents, category, hasAttachment: !!attachment, costCenterId },
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

// ===== Centros de custo =====

export async function createCostCenter(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const name = cleanString(data.name);
  const code = cleanString(data.code) || null;
  if (!name) throw new Error('Nome do centro de custo é obrigatório.');

  const ref = await addDoc(collection(db, 'condos', cId, 'costCenters'), {
    orgId,
    condoId: cId,
    name,
    code,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'costCenter.create',
    entityType: 'costCenter',
    entityId: ref.id,
    targetPath: `condos/${cId}/costCenters/${ref.id}`,
    metadata: { name, code },
  });

  return { id: ref.id, name, code };
}

export async function listCostCenters(condoId) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  const qs = await getDocs(collection(db, 'condos', cId, 'costCenters'));
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => cleanString(a.name).localeCompare(cleanString(b.name)));
  return items;
}

// ===== Orçamento =====

function budgetDocId(monthRef, costCenterId) {
  const m = toMonthRef(monthRef);
  const cc = cleanString(costCenterId);
  if (!m) throw new Error('Mês (ref.) inválido.');
  if (!cc) throw new Error('Centro de custo é obrigatório.');
  return `${m}_${cc}`;
}

export async function upsertBudgetItem(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const monthRef = toMonthRef(data.monthRef);
  const costCenterId = cleanString(data.costCenterId);
  const plannedOutCents = data.plannedOutCents != null ? cleanNumber(data.plannedOutCents) : parseMoneyToCents(data.plannedOut);

  if (!monthRef) throw new Error('Mês (ref.) inválido.');
  if (!costCenterId) throw new Error('Centro de custo é obrigatório.');
  if (plannedOutCents == null || plannedOutCents < 0) throw new Error('Valor orçado inválido.');

  const id = budgetDocId(monthRef, costCenterId);
  const ref = doc(db, 'condos', cId, 'budget', id);

  await setDoc(
    ref,
    {
      orgId,
      condoId: cId,
      monthRef,
      costCenterId,
      plannedOutCents,
      currency: 'BRL',
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    },
    { merge: true }
  );

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'budget.upsert',
    entityType: 'budget',
    entityId: id,
    targetPath: `condos/${cId}/budget/${id}`,
    metadata: { monthRef, costCenterId, plannedOutCents },
  });

  return { id, monthRef, costCenterId, plannedOutCents };
}

export async function listBudget(condoId, opts) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const monthRef = toMonthRef(opts.monthRef);

  const col = collection(db, 'condos', cId, 'budget');
  const qs = monthRef ? await getDocs(query(col, where('monthRef', '==', monthRef))) : await getDocs(col);
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => cleanString(a.costCenterId).localeCompare(cleanString(b.costCenterId)));
  return items;
}

// ===== Contas a pagar (aprovação em 2 níveis) =====

export async function createAccountsPayable(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const description = cleanString(data.description);
  const vendor = cleanString(data.vendor) || null;
  const supplierId = cleanString(data.supplierId) || null;
  const contractId = cleanString(data.contractId) || null;
  const dueAt = toDateOnly(data.dueDate || data.dueAt) || new Date();
  const amountCents = data.amountCents != null ? cleanNumber(data.amountCents) : parseMoneyToCents(data.amount);
  const costCenterId = cleanString(data.costCenterId) || null;
  const attachmentUrl = cleanString(data.attachmentUrl || data.attachmentURL) || '';

  if (!description) throw new Error('Descrição é obrigatória.');
  if (amountCents == null || amountCents <= 0) throw new Error('Valor inválido.');

  const apDoc = {
    orgId,
    condoId: cId,
    description,
    vendor,
    supplierId,
    contractId,
    dueAt,
    amountCents,
    currency: 'BRL',
    costCenterId,
    status: 'pending_manager', // pending_manager | pending_council | approved | rejected | paid
    approval: {
      manager: { by: null, at: null },
      council: { by: null, at: null },
    },
    rejection: null,
    attachment: null,
    paidAt: null,
    paymentId: null,
    paymentReceiptUrl: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
  };

  const apRef = await addDoc(collection(db, 'condos', cId, 'accountsPayable'), apDoc);

  let attachment = null;
  if (attachmentUrl) {
    attachment = normalizeUrlAttachment(attachmentUrl, 'anexo');
    if (attachment) await updateDoc(apRef, { attachment, updatedAt: serverTimestamp() });
  }

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'accountsPayable.create',
    entityType: 'accountsPayable',
    entityId: apRef.id,
    targetPath: `condos/${cId}/accountsPayable/${apRef.id}`,
    metadata: { amountCents, vendor, supplierId, contractId, costCenterId, hasAttachment: !!attachment },
  });

  return { id: apRef.id, ...apDoc, attachment };
}

export async function listAccountsPayable(condoId, opts) {
  const { db } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  opts = opts || {};
  const status = cleanString(opts.status);
  const col = collection(db, 'condos', cId, 'accountsPayable');
  const qs = status ? await getDocs(query(col, where('status', '==', status))) : await getDocs(col);
  const items = qs.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
  items.sort((a, b) => toDateMs(b.dueAt) - toDateMs(a.dueAt));
  return items;
}

async function updateAp(db, condoId, apId, patch) {
  const cId = cleanString(condoId);
  const id = cleanString(apId);
  if (!cId || !id) throw new Error('Parâmetros inválidos.');
  await updateDoc(doc(db, 'condos', cId, 'accountsPayable', id), { ...(patch || {}), updatedAt: serverTimestamp() });
}

export async function approveAccountsPayableLevel1(condoId, apId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const id = cleanString(apId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!id) throw new Error('Conta a pagar inválida.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  await updateAp(db, cId, id, {
    status: 'pending_council',
    'approval.manager.by': user.uid,
    'approval.manager.at': serverTimestamp(),
    rejection: null,
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'accountsPayable.approve_l1',
    entityType: 'accountsPayable',
    entityId: id,
    targetPath: `condos/${cId}/accountsPayable/${id}`,
    metadata: {},
  });

  return { ok: true };
}

export async function approveAccountsPayableLevel2(condoId, apId) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const id = cleanString(apId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!id) throw new Error('Conta a pagar inválida.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  await updateAp(db, cId, id, {
    status: 'approved',
    'approval.council.by': user.uid,
    'approval.council.at': serverTimestamp(),
    rejection: null,
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'accountsPayable.approve_l2',
    entityType: 'accountsPayable',
    entityId: id,
    targetPath: `condos/${cId}/accountsPayable/${id}`,
    metadata: {},
  });

  return { ok: true };
}

export async function rejectAccountsPayable(condoId, apId, reason) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  const id = cleanString(apId);
  if (!cId) throw new Error('Selecione um condomínio.');
  if (!id) throw new Error('Conta a pagar inválida.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const msg = cleanString(reason) || 'Reprovado';
  await updateAp(db, cId, id, {
    status: 'rejected',
    rejection: { by: user.uid, at: serverTimestamp(), reason: msg },
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'accountsPayable.reject',
    entityType: 'accountsPayable',
    entityId: id,
    targetPath: `condos/${cId}/accountsPayable/${id}`,
    metadata: { reason: msg },
  });

  return { ok: true };
}

export async function payAccountsPayable(condoId, data) {
  const { db, user } = await requireAuth();
  const cId = cleanString(condoId);
  if (!cId) throw new Error('Selecione um condomínio.');

  data = data || {};
  const apId = cleanString(data.apId || data.accountsPayableId);
  if (!apId) throw new Error('Selecione uma conta a pagar.');

  const orgId = await getOrgIdForCondo(db, cId);
  if (!orgId) throw new Error('Condomínio sem orgId.');

  const apRef = doc(db, 'condos', cId, 'accountsPayable', apId);
  const snap = await getDoc(apRef);
  if (!snap.exists()) throw new Error('Conta a pagar não encontrada.');
  const ap = snap.data() || {};

  if (cleanString(ap.status) !== 'approved') throw new Error('Conta a pagar precisa estar aprovada para pagamento.');

  const paidAt = toDateOnly(data.paidDate) || new Date();
  const method = cleanString(data.method) || 'manual';
  const note = cleanString(data.note) || null;
  const receiptUrl = cleanString(data.receiptUrl || data.receiptURL) || '';

  const apAmount = cleanNumber(ap.amountCents) || 0;
  const amountCents = data.amountCents != null ? cleanNumber(data.amountCents) : parseMoneyToCents(data.amount);
  const payCents = amountCents != null ? amountCents : apAmount;
  if (payCents <= 0) throw new Error('Valor do pagamento inválido.');

  const paymentDoc = {
    orgId,
    condoId: cId,
    type: 'ap_payment',
    direction: 'out',
    accountsPayableId: apId,
    chargeId: null,
    unitId: null,
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

  let receipt = null;
  if (receiptUrl) {
    receipt = normalizeUrlAttachment(receiptUrl, 'comprovante');
    if (receipt) await updateDoc(paymentRef, { receipt, updatedAt: serverTimestamp() });
  }

  await updateDoc(apRef, {
    status: 'paid',
    paidAt,
    paymentId: paymentRef.id,
    paymentReceiptUrl: receipt && receipt.url ? receipt.url : (receiptUrl || null),
    updatedAt: serverTimestamp(),
  });

  await addDoc(collection(db, 'condos', cId, 'ledger'), {
    orgId,
    condoId: cId,
    type: 'ap_payment',
    direction: 'out',
    amountCents: payCents,
    date: paidAt,
    costCenterId: ap.costCenterId ? cleanString(ap.costCenterId) : null,
    ref: { paymentId: paymentRef.id, accountsPayableId: apId },
    createdAt: serverTimestamp(),
    createdBy: user.uid,
  });

  await writeAuditLog(db, {
    orgId,
    condoId: cId,
    actorUid: user.uid,
    action: 'accountsPayable.pay',
    entityType: 'accountsPayable',
    entityId: apId,
    targetPath: `condos/${cId}/accountsPayable/${apId}`,
    metadata: { paymentId: paymentRef.id, amountCents: payCents, method, hasReceipt: !!receipt },
  });

  return { ok: true, paymentId: paymentRef.id };
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

  const outByCostCenter = {};

  const cashFlow = [];

  ledger.forEach((e) => {
    const t = cleanString(e.type);
    const dir = cleanString(e.direction);
    const amount = cleanNumber(e.amountCents) || 0;
    const ccId = cleanString(e.costCenterId) || '';

    if (t === 'charge') chargesIssuedCents += amount;
    if (t === 'payment' && dir === 'in') paymentsInCents += amount;
    if ((t === 'expense' || t === 'ap_payment') && dir === 'out') {
      expensesOutCents += amount;
      if (ccId) outByCostCenter[ccId] = (outByCostCenter[ccId] || 0) + amount;
    }

    if (t === 'payment' || t === 'expense' || t === 'ap_payment') {
      cashFlow.push({
        id: e.id,
        type: t,
        direction: dir,
        amountCents: amount,
        date: e.date || null,
        ref: e.ref || null,
        costCenterId: e.costCenterId || null,
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

  const budgetMonthRef = toMonthRef(opts.budgetMonthRef) || (from ? monthRefFromDate(from) : nowMonthRef());
  let budgetItems = [];
  try {
    budgetItems = await listBudget(cId, { monthRef: budgetMonthRef });
  } catch (e) {
    budgetItems = [];
  }

  const plannedOutCents = budgetItems.reduce((sum, b) => sum + (cleanNumber(b.plannedOutCents) || 0), 0);
  let actualOutCents = 0;
  ledger.forEach((e) => {
    const t = cleanString(e.type);
    const dir = cleanString(e.direction);
    if (!((t === 'expense' || t === 'ap_payment') && dir === 'out')) return;
    const d = entryDateMs(e);
    if (!d) return;
    const mr = monthRefFromDate(new Date(d));
    if (mr === budgetMonthRef) actualOutCents += (cleanNumber(e.amountCents) || 0);
  });

  const budget = {
    monthRef: budgetMonthRef,
    plannedOutCents,
    actualOutCents,
    plannedOut: centsToBr(plannedOutCents),
    actualOut: centsToBr(actualOutCents),
    varianceCents: plannedOutCents - actualOutCents,
    variance: centsToBr(plannedOutCents - actualOutCents),
    byCostCenterOut: Object.keys(outByCostCenter)
      .map((ccId) => ({ ccId, outCents: outByCostCenter[ccId] || 0, out: centsToBr(outByCostCenter[ccId] || 0) }))
      .sort((a, b) => (b.outCents || 0) - (a.outCents || 0)),
  };

  return { summary, cashFlow, budget, outByCostCenter };
}

export const Money = { parseMoneyToCents, centsToBr };

export const FinanceLate = { computeLateBreakdown };
