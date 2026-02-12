// Viva Haven — Auth (Firebase)
// SDK modular via ESM (sem bundler)

import { initFirebase } from './firebase-init.js';

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';

import {
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  limit,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

function normalizeRole(role) {
  return String(role || '').trim().toUpperCase();
}

function normalizeCpf(value) {
  var digits = String(value || '').replace(/\D+/g, '');
  return digits;
}

function looksLikeEmail(value) {
  var v = String(value || '').trim();
  return v.includes('@');
}

function authErrorMessage(e, fallback) {
  var code = String(e && e.code ? e.code : '').toLowerCase();
  if (!code) return fallback;

  if (code.includes('auth/invalid-credential') || code.includes('auth/wrong-password')) {
    return 'E-mail ou senha inválidos.';
  }
  if (code.includes('auth/user-disabled')) {
    return 'Usuário desativado.';
  }
  if (code.includes('auth/too-many-requests')) {
    return 'Muitas tentativas. Tente novamente em alguns minutos.';
  }
  if (code.includes('auth/email-already-in-use')) {
    return 'Este e-mail já está em uso.';
  }
  if (code.includes('auth/weak-password')) {
    return 'Senha fraca. Use uma senha mais forte.';
  }
  if (code.includes('auth/invalid-email')) {
    return 'E-mail inválido.';
  }
  if (code.includes('auth/operation-not-allowed')) {
    return 'Login por e-mail/senha não está habilitado no Firebase Authentication.';
  }

  return fallback;
}

async function getUserProfileByUid(db, uid) {
  var ref = doc(db, 'users', uid);
  var snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return snap.data() || null;
}

// Login por CPF exigiria uma rotina server-side (para evitar enumeração e respeitar rules).
// No modo online/produção, mantemos apenas login por e-mail.

export async function registerUser(payload) {
  payload = payload || {};

  var name = String(payload.name || '').trim();
  var email = String(payload.email || '').trim();
  var cpf = String(payload.cpf || '').trim();
  var password = String(payload.password || '').trim();
  var role = 'MORADOR';

  if (!name) throw new Error('Nome é obrigatório.');
  if (!email) throw new Error('E-mail é obrigatório.');
  if (!looksLikeEmail(email)) throw new Error('E-mail inválido.');
  if (!password) throw new Error('Senha é obrigatória.');

  var cpfNormalized = cpf ? normalizeCpf(cpf) : '';

  var firebase = await initFirebase();
  var auth = firebase.auth;
  var db = firebase.db;

  var cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
  } catch (e) {
    throw new Error(authErrorMessage(e, 'Falha ao cadastrar.'));
  }
  var user = cred.user;

  try {
    await updateProfile(user, { displayName: name });
  } catch (e) {
    // não bloqueia o cadastro
  }

  var profileDoc = {
    name: name,
    email: email,
    role: role,
    cpf: cpf || null,
    cpfNormalized: cpfNormalized || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, 'users', user.uid), profileDoc, { merge: true });

  return { user: user, profile: profileDoc };
}

export async function loginUser(payload) {
  payload = payload || {};

  var identifier = String(payload.identifier || '').trim();
  var password = String(payload.password || '').trim();

  if (!identifier) throw new Error('E-mail ou CPF é obrigatório.');
  if (!password) throw new Error('Senha é obrigatória.');

  var firebase = await initFirebase();
  var auth = firebase.auth;
  var db = firebase.db;

  if (!looksLikeEmail(identifier)) {
    throw new Error('Login por CPF indisponível. Use e-mail.');
  }

  var email = identifier;

  var cred;
  try {
    cred = await signInWithEmailAndPassword(auth, email, password);
  } catch (e) {
    throw new Error(authErrorMessage(e, 'Falha ao entrar.'));
  }
  var user = cred.user;

  var profile = await getUserProfileByUid(db, user.uid);
  if (!profile || !profile.role) throw new Error('Perfil do usuário não encontrado.');

  var role = normalizeRole(profile.role);

  return { user: user, role: role, profile: profile };
}

export async function requestPasswordReset(identifier) {
  var raw = String(identifier || '').trim();
  if (!raw) throw new Error('Informe e-mail ou CPF.');

  var firebase = await initFirebase();
  var auth = firebase.auth;

  if (!looksLikeEmail(raw)) {
    throw new Error('Recuperação por CPF indisponível. Use e-mail.');
  }

  var email = raw;

  try {
    await sendPasswordResetEmail(auth, email);
  } catch (e) {
    // Não revela existência de conta (user-not-found) nem falha em e-mails inválidos
    var code = String(e && e.code ? e.code : '').toLowerCase();
    if (code.includes('user-not-found') || code.includes('invalid-email')) {
      return { ok: true };
    }
    throw e;
  }

  return { ok: true };
}

export async function logoutUser() {
  var firebase = await initFirebase();
  await signOut(firebase.auth);
}

export async function getCurrentUser() {
  var firebase = await initFirebase();
  return firebase.auth.currentUser;
}

export async function waitForAuthReady() {
  var firebase = await initFirebase();
  var auth = firebase.auth;

  return await new Promise(function (resolve) {
    var unsub = onAuthStateChanged(auth, function (user) {
      try {
        unsub();
      } catch (e) {}
      resolve(user || null);
    });
  });
}
