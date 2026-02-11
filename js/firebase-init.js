// Firebase Init (SDK modular via ESM)
// Uso:
//   import { initFirebase } from '/js/firebase-init.js';
//   const { auth, db, storage } = await initFirebase();

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';

import { firebaseConfig } from './firebase-config.js';

/**
 * Inicializa Firebase (singleton) e retorna instâncias.
 * @returns {Promise<{app: any, auth: any, db: any, storage: any}>}
 */
export async function initFirebase() {
  if (!firebaseConfig || typeof firebaseConfig !== 'object') {
    throw new Error('firebaseConfig ausente. Crie /js/firebase-config.js (veja firebase-config.example.js).');
  }

  var app = null;
  if (getApps().length) app = getApps()[0];
  else app = initializeApp(firebaseConfig);

  var auth = getAuth(app);
  var db = getFirestore(app);
  var storage = getStorage(app);

  return { app: app, auth: auth, db: db, storage: storage };
}
