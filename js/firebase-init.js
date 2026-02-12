// Firebase Init (compat) — mantido para não quebrar imports existentes.
// Nota: Storage está desativado neste projeto (MVP). Use apenas Auth + Firestore.
// Uso:
//   import { initFirebase } from '/js/firebase-init.js';
//   const { auth, db } = await initFirebase();

import { initFirebase as initCoreFirebase } from './firebase.js';

/**
 * Inicializa Firebase (singleton) e retorna instâncias.
 * Compat: inclui `storage` apenas para não quebrar código legado (sempre `null`).
 * @returns {Promise<{app: any, auth: any, db: any, storage: null}>}
 */
export async function initFirebase() {
  const { app, auth, db } = await initCoreFirebase();
  return { app: app, auth: auth, db: db, storage: null };
}
