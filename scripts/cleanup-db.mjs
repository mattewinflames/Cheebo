/* cleanup-db.mjs — Pulizia chirurgica Firestore basata sull'audit.
   Elimina DEFINITIVAMENTE i dati di test identificati.

   Cosa cancella:
   - Orders di agosto (4) — test pre-go-live
   - Holds di agosto (38) + holds settembre anomali (scaduti/attesa/test)
   - Sessions di agosto (3)
   - TUTTI i logs (212) — debug BLE temporaneo
   - NON tocca: orders reali settembre, holds pagati settembre, sessions settembre

   Uso: node scripts/cleanup-db.mjs
   Chiede conferma esplicita prima di cancellare.
*/
import { readFileSync } from "fs";
import { createInterface } from "readline";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function loadEnvFile(path) {
  try {
    const lines = readFileSync(path, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* ignora */ }
}
loadEnvFile(".env");
loadEnvFile(".env.local");

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) { console.error("❌  FIREBASE_SERVICE_ACCOUNT non trovata in .env.local"); process.exit(1); }

const serviceAccount = JSON.parse(sa);
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function deleteAll(ids, collection) {
  let deleted = 0;
  const batch = db.batch();
  for (const id of ids) {
    batch.delete(db.collection(collection).doc(id));
    deleted++;
    // Firestore batch max 500 operazioni
    if (deleted % 400 === 0) { await batch.commit(); }
  }
  await batch.commit();
  return deleted;
}

console.log(`\n🧹  CLEANUP FIRESTORE — progetto: ${serviceAccount.project_id}\n`);
console.log("=".repeat(70));

const CUTOFF = new Date("2026-09-01T00:00:00Z");
function isAugust(val) {
  if (!val) return false;
  const d = val.toDate ? val.toDate() : new Date(val);
  return d < CUTOFF;
}

/* ---- Raccolta IDs da eliminare ---- */

// ORDERS di agosto
const ordersSnap = await db.collection("orders").get();
const ordersToDel = ordersSnap.docs
  .filter(d => {
    const data = d.data();
    const sk = data.serviceKey ?? "";
    const hasNexi = data.nexiOperationId && data.nexiOperationId.trim() !== "";
    return sk.startsWith("2026-08") || !hasNexi || data.pay !== "online";
  })
  .map(d => d.id);

// HOLDS: agosto + anomali settembre (attesa/scaduto + "Stocazzo" + "Al")
const HOLDS_SETTEMBRE_ANOMALI = [
  "joByilig", // Alessandro — scaduto
  "qEXHuUV0", // Stocazzo — attesa (test)
  "dDbNrO51", // Al — attesa (abbandonato)
  "LAwlOToi", // Letizia — attesa (abbandonato, occupa piastra)
];
const holdsSnap = await db.collection("holds").get();
const holdsToDel = holdsSnap.docs
  .filter(d => {
    const data = d.data();
    const sk = data.serviceKey ?? "";
    return sk.startsWith("2026-08") ||
           isAugust(data.createdAt) ||
           HOLDS_SETTEMBRE_ANOMALI.includes(d.id);
  })
  .map(d => d.id);

// SESSIONS di agosto
const sessionsSnap = await db.collection("sessions").get();
const sessionsToDel = sessionsSnap.docs
  .filter(d => d.id.startsWith("2026-08"))
  .map(d => d.id);

// LOGS — tutti
const logsSnap = await db.collection("logs").get();
const logsToDel = logsSnap.docs.map(d => d.id);

/* ---- Riepilogo ---- */
console.log("\n📋  PIANO DI CANCELLAZIONE\n");
console.log(`   orders da eliminare:   ${ordersToDel.length}`);
for (const id of ordersToDel) {
  const data = ordersSnap.docs.find(d => d.id === id)?.data();
  console.log(`     [${id.slice(0,8)}] ${(data?.name ?? "—").padEnd(20)} ${data?.serviceKey ?? "—"}`);
}
console.log(`\n   holds da eliminare:    ${holdsToDel.length}`);
console.log(`   sessions da eliminare: ${sessionsToDel.length}`);
for (const id of sessionsToDel) console.log(`     [${id}]`);
console.log(`   logs da eliminare:     ${logsToDel.length}  (tutti)`);
console.log(`\n   Orders/holds/sessions settembre INTOCCATI:`);
const realOrders = ordersSnap.docs.filter(d => !ordersToDel.includes(d.id));
for (const d of realOrders) {
  const data = d.data();
  console.log(`     ✅ [${d.id.slice(0,8)}] ${(data.name ?? "—").padEnd(20)} ${data.serviceKey ?? "—"}`);
}

/* ---- Conferma ---- */
console.log("\n" + "=".repeat(70));
console.log("⚠️   ATTENZIONE: questa operazione è IRREVERSIBILE.");
console.log(`     Verranno eliminati ${ordersToDel.length + holdsToDel.length + sessionsToDel.length + logsToDel.length} documenti totali.`);
console.log("=".repeat(70));
const risposta = await ask('\nDigita "CONFERMO" per procedere, qualsiasi altra cosa per annullare: ');

if (risposta !== "CONFERMO") {
  console.log("\n❌  Operazione annullata. Nessun dato modificato.\n");
  process.exit(0);
}

/* ---- Esecuzione ---- */
console.log("\n🔄  Cancellazione in corso...\n");

if (ordersToDel.length > 0) {
  await deleteAll(ordersToDel, "orders");
  console.log(`   ✅  orders eliminati:   ${ordersToDel.length}`);
}

if (holdsToDel.length > 0) {
  await deleteAll(holdsToDel, "holds");
  console.log(`   ✅  holds eliminati:    ${holdsToDel.length}`);
}

if (sessionsToDel.length > 0) {
  await deleteAll(sessionsToDel, "sessions");
  console.log(`   ✅  sessions eliminate: ${sessionsToDel.length}`);
}

if (logsToDel.length > 0) {
  // I log possono essere molti — elimina a batch da 400
  let deleted = 0;
  let batch = db.batch();
  for (const id of logsToDel) {
    batch.delete(db.collection("logs").doc(id));
    deleted++;
    if (deleted % 400 === 0) {
      await batch.commit();
      batch = db.batch();
      process.stdout.write(`   ⏳  logs: ${deleted}/${logsToDel.length}...\r`);
    }
  }
  await batch.commit();
  console.log(`   ✅  logs eliminati:     ${deleted}          `);
}

console.log("\n✅  Pulizia completata.\n");
process.exit(0);
