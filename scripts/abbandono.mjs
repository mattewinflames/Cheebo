/* abbandono.mjs
   Calcola il tasso di abbandono (holds scaduti / holds totali) per sessione.
   Utile per capire quanti clienti iniziano la prenotazione ma non completano
   il pagamento, e in quali sessioni il fenomeno è più marcato.

   Uso: node scripts/abbandono.mjs
        node scripts/abbandono.mjs --from 2026-09-05
        node scripts/abbandono.mjs --session 2026-09-08-Cena
*/
import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

function loadEnvFile(path) {
  try {
    const lines = readFileSync(path, "utf8").split("\n");
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const idx = t.indexOf("=");
      if (idx === -1) continue;
      const key = t.slice(0, idx).trim();
      const val = t.slice(idx + 1).trim().replace(/^[\"']|[\"']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { }
}
loadEnvFile(".env");
loadEnvFile(".env.local");

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) { console.error("❌  FIREBASE_SERVICE_ACCOUNT non trovata"); process.exit(1); }
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) });
const db = getFirestore();

const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const fromFilter  = get("--from");
const sessFilter  = get("--session");

// ── Colori ANSI ──
const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  blue: "\x1b[34m", gray: "\x1b[90m", cyan: "\x1b[36m",
};

function pct(n, tot) {
  if (tot === 0) return "—";
  return (n / tot * 100).toFixed(1) + "%";
}

function colorPct(n, tot) {
  if (tot === 0) return C.gray + "—" + C.reset;
  const p = n / tot * 100;
  const color = p >= 30 ? C.red : p >= 15 ? C.yellow : C.green;
  return color + p.toFixed(1) + "%" + C.reset;
}

// Leggi tutti gli holds reali (settembre+)
let q = db.collection("holds");
const snap = await q.get();

// Raggruppa per sessione
const sessioni = new Map();
for (const doc of snap.docs) {
  const h = doc.data();
  const sk = h.serviceKey ?? "sconosciuta";

  // Filtri
  if (sessFilter && sk !== sessFilter) continue;
  if (fromFilter && sk.slice(0, 10) < fromFilter) continue;
  if (sk < "2026-09-01") continue; // ignora test

  if (!sessioni.has(sk)) sessioni.set(sk, { pagati: 0, scaduti: 0, attesa: 0, totale: 0, pattyAbbandonati: 0 });
  const s = sessioni.get(sk);
  s.totale++;
  if (h.status === "pagato") s.pagati++;
  else if (h.status === "scaduto") { s.scaduti++; s.pattyAbbandonati += h.patties ?? 0; }
  else if (h.status === "attesa") s.attesa++;
}

if (sessioni.size === 0) {
  console.log(`${C.yellow}Nessuna sessione trovata con i filtri applicati.${C.reset}`);
  process.exit(0);
}

// Ordina per data sessione
const sorted = [...sessioni.entries()].sort((a, b) => a[0].localeCompare(b[0]));

console.log(`\n${C.bold}${C.cyan}📊  TASSO DI ABBANDONO PER SESSIONE${C.reset}\n`);

const colW = [22, 8, 8, 8, 10, 14];
const header = [
  "Sessione".padEnd(colW[0]),
  "Totale".padStart(colW[1]),
  "Pagati".padStart(colW[2]),
  "Scaduti".padStart(colW[3]),
  "Abbandono".padStart(colW[4]),
  "Patty persi".padStart(colW[5]),
];
console.log(C.dim + header.join("  ") + C.reset);
console.log(C.dim + "─".repeat(colW.reduce((a,b)=>a+b,0) + colW.length*2) + C.reset);

let totTotale = 0, totPagati = 0, totScaduti = 0, totPatty = 0;

for (const [sk, s] of sorted) {
  totTotale += s.totale;
  totPagati += s.pagati;
  totScaduti += s.scaduti;
  totPatty += s.pattyAbbandonati;

  const row = [
    sk.padEnd(colW[0]),
    String(s.totale).padStart(colW[1]),
    String(s.pagati).padStart(colW[2]),
    String(s.scaduti).padStart(colW[3]),
    colorPct(s.scaduti, s.totale).padStart(colW[4] + 10), // +10 per escape codes
    String(s.pattyAbbandonati).padStart(colW[5]),
  ];
  console.log(row.join("  "));
}

console.log(C.dim + "─".repeat(colW.reduce((a,b)=>a+b,0) + colW.length*2) + C.reset);
const totRow = [
  "TOTALE".padEnd(colW[0]),
  String(totTotale).padStart(colW[1]),
  String(totPagati).padStart(colW[2]),
  String(totScaduti).padStart(colW[3]),
  colorPct(totScaduti, totTotale).padStart(colW[4] + 10),
  String(totPatty).padStart(colW[5]),
];
console.log(C.bold + totRow.join("  ") + C.reset);

console.log(`\n${C.bold}Interpretazione:${C.reset}`);
const globalPct = totScaduti / totTotale * 100;
if (globalPct < 10) console.log(`  ${C.green}✅  Tasso basso (${globalPct.toFixed(1)}%) — la maggior parte dei clienti completa il pagamento${C.reset}`);
else if (globalPct < 25) console.log(`  ${C.yellow}⚠️   Tasso moderato (${globalPct.toFixed(1)}%) — qualche abbandono, nella norma per pagamenti online${C.reset}`);
else console.log(`  ${C.red}🔴  Tasso alto (${globalPct.toFixed(1)}%) — molti clienti abbandonano prima del pagamento${C.reset}`);
console.log(`  ${C.gray}Patty "bloccati" da holds abbandonati: ${totPatty} totali${C.reset}\n`);
