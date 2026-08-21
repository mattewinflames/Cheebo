import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, deleteDoc, collection, getDocs, query, where } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

const SEP = "─".repeat(60);
const fbApp = initializeApp({
  apiKey: process.env.VITE_FB_API_KEY, authDomain: process.env.VITE_FB_AUTH_DOMAIN,
  projectId: process.env.VITE_FB_PROJECT_ID, storageBucket: process.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FB_SENDER_ID, appId: process.env.VITE_FB_APP_ID,
});
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);
const serviceKey = process.argv[2] ?? (process.env.STRESS_DATE ? `${process.env.STRESS_DATE}-Cena` : null);

console.log(SEP); console.log("🧹 PULIZIA DATI STRESS TEST"); console.log(SEP);
console.log(`   Progetto  : ${process.env.VITE_FB_PROJECT_ID}`);
console.log(`   ServiceKey: ${serviceKey ?? "(non specificata)"}`);

try {
  await signInWithEmailAndPassword(auth, process.env.SEED_EMAIL, process.env.SEED_PASSWORD);
  console.log(`   Login ok: ${auth.currentUser?.email}`);
} catch (e) { console.error(`\n❌ Login fallito: ${e.message}`); process.exit(1); }

let deleted = 0;
if (serviceKey) {
  console.log(`\n   sessions/${serviceKey}...`);
  const snap = await getDoc(doc(db, "sessions", serviceKey));
  if (snap.exists()) { await deleteDoc(snap.ref); console.log("   ✅ eliminato"); deleted++; }
  else console.log("   ℹ️  non trovato");
}

console.log("\n   holds StressTest-*...");
try {
  const q = query(collection(db, "holds"), where("name",">=","StressTest-"), where("name","<","StressTest."));
  const snaps = await getDocs(q);
  if (snaps.empty) { console.log("   ℹ️  nessun hold trovato"); }
  else { await Promise.all(snaps.docs.map(d => deleteDoc(d.ref))); console.log(`   ✅ eliminati ${snaps.size} hold`); deleted += snaps.size; }
} catch (e) {
  if (e.code === "permission-denied") {
    console.log("   ℹ️  holds server-only: scadono da soli in 30 min, oppure cancella da Firebase Console.");
  } else console.error(`   ❌ ${e.message}`);
}

console.log(`\n${SEP}`);
console.log(`✅ Pulizia completata — ${deleted} eliminati\n`);
process.exit(0);
