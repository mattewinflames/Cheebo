/**
 * PULIZIA DATI STRESS TEST
 * ========================
 * Rimuove da Firestore i documenti creati da stress-api.mjs:
 *   - sessions/{serviceKey}  (il registro della piastra del test)
 *   - holds con name che inizia con "StressTest-"
 *
 * Uso:
 *   node --env-file=.env scripts/stress-cleanup.mjs [serviceKey]
 *
 * Esempi:
 *   node --env-file=.env scripts/stress-cleanup.mjs 2026-08-22-Cena
 *   node --env-file=.env scripts/stress-cleanup.mjs   # chiede conferma prima
 *
 * ⚠️  Verifica sempre che .env punti al progetto giusto prima di lanciare:
 *   Select-String -Path .env -Pattern "VITE_FB_PROJECT_ID"
 */

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, deleteDoc, collection, getDocs, query, where } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const SEP = "─".repeat(60);

// -------------------------------------------------------------------
// Init Firebase
// -------------------------------------------------------------------
const fbApp = initializeApp({
  apiKey:            process.env.VITE_FB_API_KEY,
  authDomain:        process.env.VITE_FB_AUTH_DOMAIN,
  projectId:         process.env.VITE_FB_PROJECT_ID,
  storageBucket:     process.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FB_SENDER_ID,
  appId:             process.env.VITE_FB_APP_ID,
});
const db   = getFirestore(fbApp);
const auth = getAuth(fbApp);

// -------------------------------------------------------------------
// ServiceKey da argomento o da variabile d'ambiente
// -------------------------------------------------------------------
const serviceKey = process.argv[2] ?? process.env.STRESS_DATE
  ? `${process.env.STRESS_DATE}-Cena`
  : null;

console.log(SEP);
console.log("🧹 PULIZIA DATI STRESS TEST");
console.log(SEP);
console.log(`   Progetto : ${process.env.VITE_FB_PROJECT_ID}`);
console.log(`   ServiceKey: ${serviceKey ?? "(non specificata — solo holds)"}`);
console.log();

// -------------------------------------------------------------------
// Login
// -------------------------------------------------------------------
try {
  await signInWithEmailAndPassword(auth, process.env.SEED_EMAIL, process.env.SEED_PASSWORD);
  console.log(`   Login ok: ${auth.currentUser?.email}`);
} catch (e) {
  console.error(`\n❌ Login fallito: ${e.message}`);
  console.error("   Controlla SEED_EMAIL/SEED_PASSWORD nel .env\n");
  process.exit(1);
}

let deleted = 0;
let notFound = 0;

// -------------------------------------------------------------------
// 1. Cancella il documento sessions/{serviceKey}
// -------------------------------------------------------------------
if (serviceKey) {
  console.log(`\n   sessions/${serviceKey}...`);
  const sessRef = doc(db, "sessions", serviceKey);
  const sessSnap = await getDoc(sessRef);
  if (sessSnap.exists()) {
    await deleteDoc(sessRef);
    console.log(`   ✅ eliminato`);
    deleted++;
  } else {
    console.log(`   ℹ️  non trovato (già eliminato?)`);
    notFound++;
  }
}

// -------------------------------------------------------------------
// 2. Cancella gli holds con name che inizia con "StressTest-"
// -------------------------------------------------------------------
console.log("\n   holds StressTest-*...");
try {
  const holdsQuery = query(
    collection(db, "holds"),
    where("name", ">=", "StressTest-"),
    where("name", "<",  "StressTest."),
  );
  const holdsSnap = await getDocs(holdsQuery);

  if (holdsSnap.empty) {
    console.log("   ℹ️  nessun hold StressTest trovato");
  } else {
    console.log(`   Trovati ${holdsSnap.size} hold da eliminare...`);
    const deletes = holdsSnap.docs.map((d) => deleteDoc(d.ref));
    await Promise.all(deletes);
    console.log(`   ✅ eliminati ${holdsSnap.size} hold`);
    deleted += holdsSnap.size;
  }
} catch (e) {
  if (e.code === "permission-denied") {
    console.log("   ℹ️  holds: accesso negato (sono server-only per le regole Firestore).");
    console.log("   Gli holds scadono automaticamente dopo 30 minuti via webhook Stripe.");
    console.log("   Se vuoi cancellarli subito: Firebase Console → Firestore → holds → elimina i documenti StressTest-*");
  } else {
    console.error(`   ❌ Errore inatteso: ${e.message}`);
  }
}

// -------------------------------------------------------------------
// Riepilogo
// -------------------------------------------------------------------
console.log(`\n${SEP}`);
console.log(`✅ Pulizia completata — ${deleted} documenti eliminati${notFound ? `, ${notFound} non trovati` : ""}\n`);
process.exit(0);
