/* audit-db.mjs — Individua dati di test/spazzatura in Firestore.
   Criterio temporale: tutto ciò che risale ad AGOSTO 2026 è test cancellabile.
   NON cancella nulla — produce solo un report.

   Uso: node scripts/audit-db.mjs
   (legge .env e .env.local automaticamente)
*/
import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Carica manualmente .env e .env.local
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
  } catch { /* file non esistente, ignora */ }
}
loadEnvFile(".env");
loadEnvFile(".env.local");

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) { console.error("❌  FIREBASE_SERVICE_ACCOUNT non trovata in .env.local"); process.exit(1); }

const serviceAccount = JSON.parse(sa);
if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const CUTOFF = new Date("2026-09-01T00:00:00Z");

function isAugust(val) {
  if (!val) return false;
  const d = val.toDate ? val.toDate() : new Date(val);
  return d < CUTOFF;
}
function fmtDate(val) {
  if (!val) return "(assente)";
  const d = val.toDate ? val.toDate() : new Date(val);
  return d.toLocaleString("it-IT", { timeZone: "Europe/Rome" });
}

console.log(`\n🔍  AUDIT FIRESTORE — progetto: ${serviceAccount.project_id}`);
console.log(`📅  Cutoff: tutto prima del 01/09/2026 è considerato TEST\n`);
console.log("=".repeat(70));

/* ORDERS */
console.log("\n📦  ORDERS\n");
const ordersSnap = await db.collection("orders").get();
const realOrders = [], testOrders = [];
for (const d of ordersSnap.docs) {
  const data = d.data();
  const hasNexi = data.nexiOperationId && data.nexiOperationId.trim() !== "";
  const isPaid  = data.pay === "online";
  const sk      = data.serviceKey ?? "";
  const isTest  = sk.startsWith("2026-08") || !isPaid || !hasNexi;
  const row = { id: d.id, name: data.name ?? "—", serviceKey: sk, total: data.total ?? 0, pay: data.pay ?? "—", status: data.status ?? "—", nexiId: data.nexiOperationId ?? "(assente)" };
  isTest ? testOrders.push(row) : realOrders.push(row);
}
console.log(`✅  Ordini REALI (settembre+, pay=online, nexiId): ${realOrders.length}`);
for (const o of realOrders) console.log(`   [${o.id.slice(0,8)}] ${o.name.padEnd(20)} ${o.serviceKey.padEnd(22)} €${String(o.total).padStart(6)}  ${o.status}`);
console.log(`\n🗑️   Ordini TEST (agosto o senza nexiId): ${testOrders.length}`);
for (const o of testOrders) console.log(`   [${o.id.slice(0,8)}] ${o.name.padEnd(20)} ${o.serviceKey.padEnd(22)} €${String(o.total).padStart(6)}  pay:${o.pay}`);

/* HOLDS */
console.log("\n\n🔒  HOLDS\n");
const holdsSnap = await db.collection("holds").get();
const realHolds = [], testHolds = [];
for (const d of holdsSnap.docs) {
  const data = d.data();
  const sk = data.serviceKey ?? "";
  const isTest = sk.startsWith("2026-08") || isAugust(data.createdAt);
  const row = { id: d.id, serviceKey: sk, status: data.status ?? "—", name: data.name ?? "—", createdAt: fmtDate(data.createdAt) };
  isTest ? testHolds.push(row) : realHolds.push(row);
}
console.log(`✅  Holds REALI (settembre+): ${realHolds.length}`);
for (const h of realHolds) console.log(`   [${h.id.slice(0,8)}] ${h.name.padEnd(20)} ${h.serviceKey.padEnd(22)} status:${h.status}  creato:${h.createdAt}`);
console.log(`\n🗑️   Holds TEST (agosto): ${testHolds.length}`);
for (const h of testHolds) console.log(`   [${h.id.slice(0,8)}] ${h.name.padEnd(20)} ${h.serviceKey.padEnd(22)} status:${h.status}  creato:${h.createdAt}`);

/* SESSIONS */
console.log("\n\n📅  SESSIONS\n");
const sessionsSnap = await db.collection("sessions").get();
const realSessions = [], testSessions = [];
for (const d of sessionsSnap.docs) {
  const data = d.data();
  const isTest = d.id.startsWith("2026-08");
  const ledger = data.ledger ?? {};
  const ledgerValues = typeof ledger === "object" && !Array.isArray(ledger)
    ? Object.values(ledger)
    : (Array.isArray(ledger) ? ledger : []);
  const totPatty = ledgerValues.reduce((s, v) => s + (Number(v) || 0), 0);
  const row = { id: d.id, ledger: ledgerValues.join(", "), totPatty, seq: data.seq ?? "—" };
  isTest ? testSessions.push(row) : realSessions.push(row);
}
console.log(`✅  Sessioni REALI (settembre+): ${realSessions.length}`);
for (const s of realSessions) console.log(`   [${s.id}]  ledger:[${s.ledger}]  tot:${s.totPatty}  seq:${s.seq}`);
console.log(`\n🗑️   Sessioni TEST (agosto): ${testSessions.length}`);
for (const s of testSessions) console.log(`   [${s.id}]  ledger:[${s.ledger}]  tot:${s.totPatty}`);

/* LOGS */
console.log("\n\n📋  LOGS\n");
const logsSnap = await db.collection("logs").get();
const testLogs = logsSnap.docs.filter(d => isAugust(d.data().ts));
console.log(`   Totale log: ${logsSnap.size}  (di agosto: ${testLogs.length})`);

/* RIEPILOGO */
console.log("\n\n" + "=".repeat(70));
console.log("📊  RIEPILOGO CANDIDATI ALLA CANCELLAZIONE");
console.log("=".repeat(70));
console.log(`   orders di test:    ${testOrders.length}`);
console.log(`   holds di test:     ${testHolds.length}`);
console.log(`   sessioni di test:  ${testSessions.length}`);
console.log(`   log di agosto:     ${testLogs.length}`);
console.log(`   TUTTI i log:       ${logsSnap.size}  (tutti eliminabili — debug temporaneo)`);
console.log("\n⚠️   Nessun dato è stato modificato o cancellato.\n");
process.exit(0);
