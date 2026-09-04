/* inspect-session.mjs — Mostra holds e ledger per un serviceKey specifico.
   Uso: node scripts/inspect-session.mjs 2026-09-04-Pranzo
*/
import { readFileSync } from "fs";
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

const serviceKey = process.argv[2];
if (!serviceKey) {
  console.error("❌  Specifica un serviceKey es: node scripts/inspect-session.mjs 2026-09-04-Pranzo");
  process.exit(1);
}

function fmtDate(val) {
  if (!val) return "(assente)";
  const d = val.toDate ? val.toDate() : new Date(val);
  return d.toLocaleString("it-IT", { timeZone: "Europe/Rome" });
}
function fmtMin(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

console.log(`\n🔍  ISPEZIONE — ${serviceKey}\n`);
console.log("=".repeat(70));

/* SESSION / LEDGER */
const sessionDoc = await db.collection("sessions").doc(serviceKey).get();
if (sessionDoc.exists) {
  const data = sessionDoc.data();
  const startMin = data.startMin ?? 0;
  const ledger = data.ledger ?? {};
  console.log(`\n📅  SESSION`);
  console.log(`   startMin: ${startMin} (${fmtMin(startMin)})  endMin: ${data.endMin}  seq: ${data.seq}`);
  console.log(`\n   Ledger (finestra → patty occupati):`);
  const indices = Object.keys(ledger).map(Number).sort((a,b) => a-b);
  for (const i of indices) {
    const windowStart = startMin + i * 10;
    const windowEnd   = windowStart + 10;
    const val = ledger[i];
    const bar = "█".repeat(Math.min(val, 13)) + "░".repeat(Math.max(0, 13 - val));
    console.log(`   [${i}] ${fmtMin(windowStart)}–${fmtMin(windowEnd)}  ${bar}  ${val}/13`);
  }
} else {
  console.log(`\n⚠️   Nessuna session trovata per ${serviceKey}`);
}

/* ORDERS */
console.log(`\n\n📦  ORDERS`);
const ordersSnap = await db.collection("orders")
  .where("serviceKey", "==", serviceKey)
  .get();
if (ordersSnap.empty) {
  console.log("   (nessuno)");
} else {
  for (const d of ordersSnap.docs) {
    const o = d.data();
    const patty = o.patties ?? o.patty ?? "?";
    console.log(`   [${d.id.slice(0,8)}] ${(o.name ?? "—").padEnd(20)} patty:${patty}  readyMin:${o.readyMin}(${fmtMin(o.readyMin ?? 0)})  status:${o.status}  pay:${o.pay}`);
    (o.items ?? []).forEach(item => console.log(`              • ${item}`));
  }
}

/* HOLDS */
console.log(`\n\n🔒  HOLDS`);
const holdsSnap = await db.collection("holds")
  .where("serviceKey", "==", serviceKey)
  .get();
if (holdsSnap.empty) {
  console.log("   (nessuno)");
} else {
  const byStatus = {};
  for (const d of holdsSnap.docs) {
    const h = d.data();
    const s = h.status ?? "?";
    if (!byStatus[s]) byStatus[s] = [];
    byStatus[s].push({ id: d.id, ...h });
  }
  for (const [status, list] of Object.entries(byStatus)) {
    const icon = status === "pagato" ? "✅" : status === "scaduto" ? "⏱️" : "⚠️";
    console.log(`\n   ${icon}  Status: ${status} (${list.length})`);
    for (const h of list) {
      const patty = h.patties ?? h.cells?.reduce((s,v) => s+(v||0), 0) ?? "?";
      const windowStart = h.startMin != null ? fmtMin(h.startMin) : "?";
      console.log(`   [${h.id.slice(0,8)}] ${(h.name ?? "—").padEnd(20)} patty:${patty}  window:${windowStart}  creato:${fmtDate(h.createdAt)}`);
    }
  }
}

/* RIEPILOGO PATTY */
console.log(`\n\n📊  RIEPILOGO PATTY`);
console.log(`   (Il ledger è l'autorità — gli holds pagati NON vanno sommati agli orders)`);
let totOrders = 0, totHoldsScaduti = 0, totHoldsAttesa = 0;
for (const d of ordersSnap.docs) { totOrders += (d.data().patties ?? 0); }
for (const d of holdsSnap.docs) {
  const h = d.data();
  const p = h.patties ?? h.cells?.reduce((s, v) => s + (v || 0), 0) ?? 0;
  if (h.status === "scaduto") totHoldsScaduti += p;
  else if (h.status === "attesa") totHoldsAttesa += p;
}
const ledgerTot = Object.values(sessionDoc.exists ? (sessionDoc.data()?.ledger ?? {}) : {}).reduce((s, v) => s + (Number(v) || 0), 0);
console.log(`   Orders confermati:  ${totOrders} patty`);
console.log(`   Holds scaduti:      ${totHoldsScaduti} patty (già sottratti dal ledger dal cron)`);
console.log(`   Holds in attesa:    ${totHoldsAttesa} patty ⚠️  (occupano slot reali)`);
console.log(`   Ledger totale:      ${ledgerTot} patty (fonte di verità — include holds pagati + in attesa)`);
console.log(`   Patty reali attesi: ${totOrders} patty (solo orders confermati)\n`);

process.exit(0);
