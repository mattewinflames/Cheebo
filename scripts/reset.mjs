/* CHEEBO · Reset rapido dell'ambiente di test.
   Cancella TUTTI gli ordini e TUTTI i registri della piastra, senza chiedere nulla.
   Uso:  npm.cmd run reset

   ⚠️ Nessuna conferma e nessun recupero: pensato per l'ambiente di test.
      Per un uso prudente (simulazione, filtro per data) c'è pulisci-ordini.mjs.
*/

import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, writeBatch } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const app = initializeApp({
  apiKey: process.env.VITE_FB_API_KEY,
  authDomain: process.env.VITE_FB_AUTH_DOMAIN,
  projectId: process.env.VITE_FB_PROJECT_ID,
  storageBucket: process.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FB_SENDER_ID,
  appId: process.env.VITE_FB_APP_ID,
});
const db = getFirestore(app);

// le regole richiedono l'admin loggato per cancellare gli ordini
await signInWithEmailAndPassword(getAuth(app), process.env.SEED_EMAIL, process.env.SEED_PASSWORD);

const [ordini, sessioni] = await Promise.all([
  getDocs(collection(db, "orders")),
  getDocs(collection(db, "sessions")),
]);

const refs = [...ordini.docs, ...sessioni.docs].map((d) => d.ref);
for (let i = 0; i < refs.length; i += 450) { // Firestore: max 500 operazioni per batch
  const batch = writeBatch(db);
  refs.slice(i, i + 450).forEach((r) => batch.delete(r));
  await batch.commit();
}

console.log(`✓ ${process.env.VITE_FB_PROJECT_ID}: cancellati ${ordini.size} ordini e ${sessioni.size} registri piastra.`);
process.exit(0);
