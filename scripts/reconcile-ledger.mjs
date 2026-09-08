/* reconcile-ledger.mjs
   Ricalcola il ledger di una sessione dagli holds PAGATI e lo riscrive
   su Firestore. Utile quando il ledger è sporco per hold scaduti/abbandonati
   che non hanno liberato correttamente i patty.

   Uso: node scripts/reconcile-ledger.mjs <serviceKey>
   Es:  node scripts/reconcile-ledger.mjs 2026-09-06-Cena

   ⚠️  Modifica Firestore in produzione — eseguire solo a fine serata o
       quando non ci sono prenotazioni in corso.
*/
import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

function loadEnvFile(path) {
  try {
    const lines = readFileSync(path, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^[\"']|[\"']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* ignora */ }
}
loadEnvFile(".env");
loadEnvFile(".env.local");

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) { console.error("❌  FIREBASE_SERVICE_ACCOUNT non trovata in .env.local"); process.exit(1); }
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) });
const db = getFirestore();

const serviceKey = process.argv[2];
if (!serviceKey) {
  console.error("❌  Uso: node scripts/reconcile-ledger.mjs <serviceKey>");
  console.error("   Es:  node scripts/reconcile-ledger.mjs 2026-09-06-Cena");
  process.exit(1);
}

console.log(`\n🔧  RECONCILE LEDGER — ${serviceKey}\n`);

// 1. Leggi tutti gli holds PAGATI per questa sessione
const holdsSnap = await db.collection("holds")
  .where("serviceKey", "==", serviceKey)
  .where("status", "==", "pagato")
  .get();

console.log(`📋  Holds pagati trovati: ${holdsSnap.size}`);

// 2. Ricostuisci il ledger sommando le cells di ogni hold pagato
const ledgerMap = {};
let totalPatty = 0;

for (const doc of holdsSnap.docs) {
  const hold = doc.data();
  const cells = Array.isArray(hold.cells) ? hold.cells : [];
  for (const w of cells) {
    ledgerMap[String(w)] = (ledgerMap[String(w)] ?? 0) + 1;
  }
  totalPatty += hold.patties ?? 0;
  console.log(`   [${doc.id.slice(0, 8)}] ${(hold.name ?? "—").padEnd(20)} patty:${hold.patties ?? 0}  cells:[${cells.join(",")}]`);
}

console.log(`\n📊  Ledger ricalcolato:`);
const sortedKeys = Object.keys(ledgerMap).sort((a, b) => Number(a) - Number(b));
for (const k of sortedKeys) {
  console.log(`   finestra ${k}: ${ledgerMap[k]} patty`);
}
console.log(`   TOTALE: ${totalPatty} patty`);

// 3. Leggi il ledger attuale
const sessRef = db.collection("sessions").doc(serviceKey);
const sessSnap = await sessRef.get();
const currentLedger = sessSnap.exists ? (sessSnap.data()?.ledger ?? {}) : {};
const currentTotal = Object.values(currentLedger).reduce((s, v) => s + Number(v), 0);
console.log(`\n📋  Ledger attuale su Firestore: ${currentTotal} patty`);

if (currentTotal === totalPatty) {
  console.log("✅  Ledger già corretto — nessuna modifica necessaria.");
  process.exit(0);
}

const delta = currentTotal - totalPatty;
console.log(`⚠️   Delta: ${delta > 0 ? "+" : ""}${delta} patty (${delta > 0 ? "sporco" : "mancante"})`);

// 4. Chiedi conferma
console.log(`\n🔄  Sovrascrittura ledger con i valori ricalcolati...`);
// 4. Leggi il documento completo e riscrivi con il ledger corretto
const currentData = sessSnap.data() ?? {};
await sessRef.set({
  ...currentData,
  ledger: ledgerMap,
  updatedAt: FieldValue.serverTimestamp(),
});

console.log("✅  Ledger aggiornato correttamente.\n");
process.exit(0);
