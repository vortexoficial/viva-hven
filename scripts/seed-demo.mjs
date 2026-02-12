import fs from 'node:fs';
import process from 'node:process';

import admin from 'firebase-admin';

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

function readServiceAccount() {
  const filePath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  if (!filePath) {
    throw new Error('Defina GOOGLE_APPLICATION_CREDENTIALS apontando para o JSON da Service Account.');
  }
  const json = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(json);
}

function normalizeRoleLower(value) {
  return String(value || '').trim().toLowerCase();
}

function condoMembershipId(uid, condoId) {
  return `${uid}_${condoId}`;
}

function orgMembershipId(uid, orgId) {
  return `${uid}_org_${orgId}`;
}

async function ensureUser({ email, password, displayName }) {
  try {
    const existing = await admin.auth().getUserByEmail(email);
    // garante nome
    if (displayName && existing.displayName !== displayName) {
      await admin.auth().updateUser(existing.uid, { displayName });
    }
    return existing;
  } catch (e) {
    const code = String(e?.code || '');
    if (!code.includes('auth/user-not-found')) throw e;
  }

  return await admin.auth().createUser({
    email,
    password,
    displayName,
    emailVerified: true,
    disabled: false,
  });
}

async function upsertDoc(path, data) {
  await admin.firestore().doc(path).set(data, { merge: true });
}

async function main() {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || 'vivahaven-2906a').trim();
  const password = String(process.env.SEED_PASSWORD || 'Senha@123').trim();

  const serviceAccount = readServiceAccount();

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId,
  });

  const orgId = String(process.env.SEED_ORG_ID || 'org_demo').trim();
  const condoId = String(process.env.SEED_CONDO_ID || 'condo_demo').trim();

  // Base docs
  await upsertDoc(`organizations/${orgId}`, {
    name: 'Organização Demo',
    status: 'active',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await upsertDoc(`condos/${condoId}`, {
    orgId,
    name: 'Condomínio Demo',
    status: 'active',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const accounts = [
    { key: 'morador', email: 'morador.teste@exemplo.com', name: 'Morador Teste', userRole: 'MORADOR', membershipScope: 'condo', membershipRole: 'morador' },
    { key: 'gestor', email: 'gestor.teste@exemplo.com', name: 'Gestor Teste', userRole: 'GESTOR', membershipScope: 'condo', membershipRole: 'gestor' },
    { key: 'sindico', email: 'sindico.teste@exemplo.com', name: 'Síndico Teste', userRole: 'SINDICO', membershipScope: 'condo', membershipRole: 'sindico' },
    { key: 'carteira', email: 'carteira.teste@exemplo.com', name: 'Carteira Teste', userRole: 'CARTEIRA', membershipScope: 'org', membershipRole: 'carteira' },
    { key: 'administradora', email: 'administradora.teste@exemplo.com', name: 'Administradora Teste', userRole: 'ADMINISTRADORA', membershipScope: 'org', membershipRole: 'administradora' },
  ];

  console.log(`Seeding project=${projectId} orgId=${orgId} condoId=${condoId}`);
  console.log(`Using password=${password}`);

  for (const acc of accounts) {
    const user = await ensureUser({ email: acc.email, password, displayName: acc.name });

    await upsertDoc(`users/${user.uid}`, {
      name: acc.name,
      email: acc.email,
      role: acc.userRole,
      cpf: null,
      cpfNormalized: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (acc.membershipScope === 'condo') {
      const membershipId = condoMembershipId(user.uid, condoId);
      await upsertDoc(`memberships/${membershipId}`, {
        uid: user.uid,
        scope: 'condo',
        condoId,
        orgId,
        role: normalizeRoleLower(acc.membershipRole),
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      const membershipId = orgMembershipId(user.uid, orgId);
      await upsertDoc(`memberships/${membershipId}`, {
        uid: user.uid,
        scope: 'org',
        orgId,
        condoId: null,
        role: normalizeRoleLower(acc.membershipRole),
        status: 'active',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    console.log(`OK ${acc.key}: ${acc.email} uid=${user.uid}`);
  }

  console.log('Done. Logue no site com os e-mails acima e a senha definida.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
