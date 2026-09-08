/* ble-logs.mjs
   Legge i log BLE dalla collection `logs` su Firestore e li formatta
   per analisi del flusso di connessione/stampa.

   Uso:
     node scripts/ble-logs.mjs              # ultimi 50 log
     node scripts/ble-logs.mjs --n 200      # ultimi 200 log
     node scripts/ble-logs.mjs --session 2026-09-08-Cena   # filtro sessione
     node scripts/ble-logs.mjs --level error               # solo errori
     node scripts/ble-logs.mjs --since "2026-09-08 19:00"  # da una certa ora
*/
import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

// ── Env ──
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
  } catch { /* ignora */ }
}
loadEnvFile(".env");
loadEnvFile(".env.local");

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) { console.error("❌  FIREBASE_SERVICE_ACCOUNT non trovata in .env.local"); process.exit(1); }
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) });
const db = getFirestore();

// ── Args ──
const args = process.argv.slice(2);
const get = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const n        = parseInt(get("--n") ?? "50", 10);
const session  = get("--session");
const level    = get("--level");
const sinceStr = get("--since");

// ── Colori ANSI ──
const C = {
  reset:  "\x1b[0m",
  dim:    "\x1b[2m",
  bold:   "\x1b[1m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  green:  "\x1b[32m",
  blue:   "\x1b[34m",
  cyan:   "\x1b[36m",
  gray:   "\x1b[90m",
};

function colorLevel(l) {
  if (l === "error") return `${C.red}${C.bold}ERROR${C.reset}`;
  if (l === "warn")  return `${C.yellow}WARN ${C.reset}`;
  if (l === "info")  return `${C.green}INFO ${C.reset}`;
  return `${C.gray}${l.padEnd(5)}${C.reset}`;
}

function fmtTs(ts) {
  if (!ts) return "??:??:??";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit" });
}

// ── Query ──
let q = db.collection("logs").orderBy("ts", "desc").limit(n);
if (sinceStr) {
  const since = new Date(sinceStr.replace(" ", "T") + ":00+02:00");
  q = q.where("ts", ">=", Timestamp.fromDate(since));
}
if (session) q = q.where("session", "==", session);
if (level)   q = q.where("level", "==", level);

const snap = await q.get();
if (snap.empty) {
  console.log(`${C.yellow}Nessun log trovato con i filtri applicati.${C.reset}`);
  process.exit(0);
}

// Ordina cronologicamente (la query torna desc)
const docs = snap.docs.reverse();

console.log(`\n${C.bold}${C.cyan}📡  BLE LOGS — ${docs.length} eventi${C.reset}\n`);

let prevDate = "";
let prevTs   = null;

for (const doc of docs) {
  const d = doc.data();
  const date = fmtDate(d.ts);
  const time = fmtTs(d.ts);

  // Separatore giornaliero
  if (date !== prevDate) {
    console.log(`\n${C.dim}──── ${date} ────${C.reset}`);
    prevDate = date;
  }

  // Delta tempo tra eventi consecutivi
  let delta = "";
  if (prevTs && d.ts) {
    const prev = prevTs.toDate ? prevTs.toDate() : new Date(prevTs);
    const curr = d.ts.toDate   ? d.ts.toDate()   : new Date(d.ts);
    const ms   = curr - prev;
    if (ms > 0) {
      delta = ms >= 1000
        ? `${C.dim}+${(ms / 1000).toFixed(1)}s${C.reset}`
        : `${C.dim}+${ms}ms${C.reset}`;
    }
  }
  prevTs = d.ts;

  // Riga principale
  const device = d.deviceName ? `${C.cyan}[${d.deviceName}]${C.reset} ` : "";
  const sess   = d.session    ? `${C.gray}(${d.session})${C.reset} ` : "";
  console.log(`${C.gray}${time}${C.reset} ${colorLevel(d.level ?? "info")} ${device}${d.message ?? ""}  ${delta} ${sess}`);

  // Dettaglio (se presente)
  if (d.detail) {
    const lines = String(d.detail).split("\n").slice(0, 5); // max 5 righe
    for (const l of lines) {
      console.log(`         ${C.dim}${l}${C.reset}`);
    }
  }
}

// ── Riepilogo ──
const counts = { error: 0, warn: 0, info: 0 };
for (const doc of docs) {
  const l = doc.data().level ?? "info";
  counts[l] = (counts[l] ?? 0) + 1;
}

console.log(`\n${C.bold}Riepilogo:${C.reset}  ${C.green}${counts.info} info${C.reset}  ${C.yellow}${counts.warn} warn${C.reset}  ${C.red}${counts.error} error${C.reset}\n`);

// Se ci sono errori, li stampa separatamente in evidenza
const errors = docs.filter(d => d.data().level === "error");
if (errors.length) {
  console.log(`${C.red}${C.bold}🔴  ERRORI RILEVATI:${C.reset}`);
  for (const doc of errors) {
    const d = doc.data();
    console.log(`  ${C.gray}${fmtTs(d.ts)}${C.reset}  ${d.message ?? ""}`);
    if (d.detail) console.log(`    ${C.dim}${String(d.detail).split("\n")[0]}${C.reset}`);
  }
  console.log();
}
