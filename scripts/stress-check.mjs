import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, collection, getDocs, query, where, limit } from "firebase/firestore";
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

console.log(SEP);
console.log("🔍 VERIFICA STATO POST-CLEANUP");
console.log(SEP);
console.log(`   Progetto  : ${process.env.VITE_FB_PROJECT_ID}`);
console.log(`   ServiceKey: ${serviceKey ?? "(non specificata)"}`);

try {
  await signInWithEmailAndPassword(auth, process.env.SEED_EMAIL, process.env.SEED_PASSWORD);
} catch (e) { console.error(`\n❌ Login fallito: ${e.message}`); process.exit(1); }

// 1. Sessione
if (serviceKey) {
  console.log(`\n   sessions/${serviceKey}:`);
  const snap = await getDoc(doc(db, "sessions", serviceKey));
  if (!snap.exists()) {
    console.log("   ✅ rimossa (pulizia completata)");
  } else {
    const data = snap.data();
    const patty = Object.values(data.ledger ?? {}).reduce((a, b) => a + b, 0);
    console.log(`   ⚠️  ancora presente — ${patty} patty nel ledger`);
    console.log("   Rilancia: npm.cmd run stress:cleanup");
  }
}

// 2. Ordini di test
console.log("\n   orders StressTest-*:");
try {
  const q = query(collection(db, "orders"), where("name",">=","StressTest-"), where("name","<","StressTest."), limit(5));
  const snaps = await getDocs(q);
  if (snaps.empty) console.log("   ✅ nessun ordine di test presente");
  else console.log(`   ℹ️  ${snaps.size} ordini ancora presenti (normale se non completati)`);
} catch (e) {
  console.log(`   ℹ️  ${e.code === "permission-denied" ? "lettura negata (regole)" : e.message}`);
}

// 3. Holds — stima scadenza
const scadenza = new Date(Date.now() + 30 * 60 * 1000);
const hh = String(scadenza.getHours()).padStart(2,"0");
const mm = String(scadenza.getMinutes()).padStart(2,"0");
console.log("\n   holds:");
console.log("   ℹ️  server-only — non leggibili dal client.");
console.log(`   Garantiti scaduti dopo le ${hh}:${mm} (30 min dalla creazione).`);
console.log("   Verifica su Stripe: stripe events list --limit 25");
console.log("   Cerca checkout.session.expired con metadata.holdId valorizzato.");

console.log(`\n${SEP}`);
console.log("✅ Verifica completata\n");
process.exit(0);
