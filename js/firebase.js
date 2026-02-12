// Viva Haven — Core Firebase (sem Storage)
// Uso:
//   import { initFirebase } from '/js/firebase.js';
//   const { auth, db } = await initFirebase();

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

import { firebaseConfig } from './firebase-config.js';

let cached = null;

function assertConfig() {
  if (!firebaseConfig || typeof firebaseConfig !== 'object') {
    throw new Error('firebaseConfig ausente. Crie /js/firebase-config.js (veja firebase-config.example.js).');
  }
}

/**
 * Inicializa Firebase (singleton) e retorna instâncias.
 * @returns {Promise<{app:any, auth:any, db:any}>}
 */
export async function initFirebase() {
  if (cached) return cached;
  assertConfig();

  let app = null;
  if (getApps().length) app = getApps()[0];
  else app = initializeApp(firebaseConfig);

  const auth = getAuth(app);
  const db = getFirestore(app);

  cached = { app, auth, db };
  return cached;
}

export function resetFirebaseForTestsOnly() {
  cached = null;
}
