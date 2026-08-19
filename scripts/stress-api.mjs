/**
 * STRESS TEST — LIVELLO 2: transazioni Firestore via API reale
 * =============================================================
 * Lancia N prenotazioni simultanee contro l'API locale (vercel dev)
 * e verifica che:
 *   1. Il ledger su Firestore non superi mai CAP patty per finestra.
 *   2. Le transazioni in contesa non producano race condition.
 *   3. Il totale di patty accettati corrisponda a quanto c'è su Firestore.
 *   4. Le risposte "piastra al completo" arrivino al momento giusto.
 *
 * ⚠️  PRE-REQUISITI:
 *   - `vercel dev` in ascolto su http://localhost:3000
 *   - `stripe listen --forward-to localhost:3000/api/stripe-webhook` attivo
 *   - Ambiente: il .env punta a UN PROGETTO DI TEST, mai la produzione
 *   - Lo script usa solo la serviceKey di OGGI per il giorno/servizio attuale
 *
 * ⚠️  ATTENZIONE: crea hold reali su Firestore. Dopo il test,
 *   verifica la collezione `sessions` e `holds` e lancia `npm run reset`
 *   se vuoi ripulire (solo su ambiente di test!).
 *
 * Uso:
 *   node --env-file=.env scripts/stress-api.mjs [N_RICHIESTE] [PATTY_PER_ORDINE] [CONCORRENZA]
 *
 * Esempi:
 *   node --env-file=.env scripts/stress-api.mjs          # 20 richieste, 2 patty, 5 concurrent
 *   node --env-file=.env scripts/stress-api.mjs 50 3 10  # 50 richieste, 3 patty, 10 concurrent
 */

import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

// -------------------------------------------------------------------
// Configurazione
// -------------------------------------------------------------------
const API_URL      = process.env.STRESS_API_URL ?? "http://localhost:3000";
const N_RICHIESTE  = Number(process.argv[2] ?? 20);
const PATTY_ORD    = Number(process.argv[3] ?? 2);
const CONCORRENZA  = Number(process.argv[4] ?? 5);
const CAP          = 13;
const SEP          = "─".repeat(60);

// Calcola la serviceKey per OGGI (stesso formato del codice)
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function serviceKeyOggi() {
  const now = new Date();
  const ora = now.getHours() * 60 + now.getMinutes();
  // Tenta "Cena" (19:30-22:30) poi "Pranzo" (12:30-14:30)
  const SERVIZI = [
    { label: "Cena",   startMin: 19 * 60 + 30, endMin: 22 * 60 + 30 },
    { label: "Pranzo", startMin: 12 * 60 + 30, endMin: 14 * 60 + 30 },
  ];
  // Usa il prossimo servizio non ancora finito
  const s = SERVIZI.find((sv) => ora < sv.endMin) ?? SERVIZI[0];
  return `${dateKey(now)}-${s.label}`;
}

// -------------------------------------------------------------------
// Init Firebase (solo per leggere il ledger finale)
// -------------------------------------------------------------------
const fbApp = initializeApp({
  apiKey:        process.env.VITE_FB_API_KEY,
  authDomain:    process.env.VITE_FB_AUTH_DOMAIN,
  projectId:     process.env.VITE_FB_PROJECT_ID,
  storageBucket: process.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FB_SENDER_ID,
  appId:         process.env.VITE_FB_APP_ID,
});
const db   = getFirestore(fbApp);
const auth = getAuth(fbApp);

// -------------------------------------------------------------------
// Payload di test (panino Classic, no extras, no rimozioni)
// -------------------------------------------------------------------
function makePayload(serviceKey) {
  return {
    serviceKey,
    name: `StressTest-${Math.random().toString(36).slice(2, 6)}`,
    phone: "",
    mode: "first",
    cart: [
      { itemId: "classic", kind: "panino", formatId: "solo", qty: PATTY_ORD, removes: [], swaps: [] },
    ],
  };
}

// -------------------------------------------------------------------
// Singola richiesta con timeout
// -------------------------------------------------------------------
async function prenota(serviceKey, idx) {
  const start = Date.now();
  try {
    const res = await fetch(`${API_URL}/api/create-booking`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(makePayload(serviceKey)),
      signal:  AbortSignal.timeout(15_000),
    });
    const body = await res.json();
    const ms = Date.now() - start;
    return { idx, status: res.status, ok: res.ok, body, ms };
  } catch (e) {
    return { idx, status: 0, ok: false, body: { error: String(e) }, ms: Date.now() - start };
  }
}

// -------------------------------------------------------------------
// Esecuzione a ondate (pool di concorrenza)
// -------------------------------------------------------------------
async function runPool(serviceKey) {
  const risultati = [];
  const queue = Array.from({ length: N_RICHIESTE }, (_, i) => i);
  while (queue.length > 0) {
    const batch = queue.splice(0, CONCORRENZA);
    const wave = await Promise.all(batch.map((i) => prenota(serviceKey, i)));
    risultati.push(...wave);
    process.stdout.write(".");
  }
  console.log();
  return risultati;
}

// -------------------------------------------------------------------
// Lettura ledger reale da Firestore
// -------------------------------------------------------------------
async function leggiLedger(serviceKey) {
  const snap = await getDoc(doc(db, "sessions", serviceKey));
  if (!snap.exists()) return null;
  const data = snap.data();
  const ledgerMap = data.ledger ?? {};
  return ledgerMap;
}

// -------------------------------------------------------------------
// MAIN
// -------------------------------------------------------------------
console.log(SEP);
console.log("🔥 STRESS TEST API — Livello 2");
console.log(SEP);

// Verifica che vercel dev sia attivo
try {
  await fetch(`${API_URL}/`, { signal: AbortSignal.timeout(3_000) });
} catch {
  console.error(`\n❌ Impossibile raggiungere ${API_URL}`);
  console.error("   Assicurati che `vercel dev` sia in ascolto e riprova.\n");
  process.exit(1);
}

// Login per leggere Firestore
try {
  await signInWithEmailAndPassword(auth, process.env.SEED_EMAIL, process.env.SEED_PASSWORD);
} catch (e) {
  console.error(`\n❌ Login Firebase fallito: ${e.message}`);
  console.error("   Controlla SEED_EMAIL/SEED_PASSWORD nel .env\n");
  process.exit(1);
}

const serviceKey = serviceKeyOggi();
console.log(`\n   API           : ${API_URL}`);
console.log(`   ServiceKey    : ${serviceKey}`);
console.log(`   Richieste     : ${N_RICHIESTE}`);
console.log(`   Patty/ordine  : ${PATTY_ORD}`);
console.log(`   Concorrenza   : ${CONCORRENZA} simultanee`);
console.log(`   Capienza max  : ${CAP} patty/finestra\n`);
console.log("   Lancio richieste...");

const t0 = Date.now();
const risultati = await runPool(serviceKey);
const totaleMs = Date.now() - t0;

// -------------------------------------------------------------------
// Analisi risultati
// -------------------------------------------------------------------
const accettate  = risultati.filter((r) => r.status === 200);
const piene      = risultati.filter((r) => r.status === 409 && r.body?.error?.includes("completo"));
const sospese    = risultati.filter((r) => r.status === 409 && !r.body?.error?.includes("completo"));
const errori     = risultati.filter((r) => r.status === 500 || r.status === 502 || r.status === 0);
const altro      = risultati.filter((r) => ![200, 409, 500, 502, 0].includes(r.status));

const msValori = risultati.map((r) => r.ms);
const msMedia  = Math.round(msValori.reduce((a, b) => a + b, 0) / msValori.length);
const msMax    = Math.max(...msValori);
const msMin    = Math.min(...msValori);

console.log(`\n${SEP}`);
console.log("📊 RISULTATI");
console.log(`   ✅ Accettate          : ${accettate.length}`);
console.log(`   🔴 Piastra al completo: ${piene.length}`);
console.log(`   🟡 Altre 409          : ${sospese.length} ${sospese.length ? "(sessione chiusa/sospesa)" : ""}`);
console.log(`   ❌ Errori 5xx/timeout : ${errori.length}`);
if (altro.length) console.log(`   ❓ Altro             : ${altro.length}`);
console.log(`\n   Tempo totale : ${totaleMs}ms`);
console.log(`   Latenza      : min ${msMin}ms · media ${msMedia}ms · max ${msMax}ms`);
console.log(`   Throughput   : ${(N_RICHIESTE / (totaleMs / 1000)).toFixed(1)} req/s`);

// Patty attesi in base alle accettate
const pattyAttesi = accettate.length * PATTY_ORD;

// -------------------------------------------------------------------
// Verifica ledger reale
// -------------------------------------------------------------------
console.log(`\n${SEP}`);
console.log("🔍 VERIFICA LEDGER SU FIRESTORE");
const ledgerMap = await leggiLedger(serviceKey);

if (!ledgerMap) {
  console.log("   ⚠️  Sessione non trovata su Firestore (nessuna prenotazione andata a segno?)");
} else {
  const voci = Object.entries(ledgerMap).map(([k, v]) => ({ finestra: Number(k), patty: v }));
  const totalePatty = voci.reduce((a, b) => a + b.patty, 0);
  const overflow    = voci.filter((v) => v.patty > CAP);
  const contigenza  = Math.abs(totalePatty - pattyAttesi);

  console.log(`   Patty su Firestore : ${totalePatty}`);
  console.log(`   Patty attesi       : ${pattyAttesi}`);
  console.log(`   Delta              : ${contigenza === 0 ? "0 ✅" : `${contigenza} ⚠️`}`);
  console.log(`   Overflow finestre  : ${overflow.length === 0 ? "nessuno ✅" : `❌ BUG CRITICO: finestre ${overflow.map((v) => v.finestra).join(", ")}`}`);

  if (voci.length > 0) {
    console.log("\n   Distribuzione per finestra:");
    const WINDOW_MIN = 10;
    const startMin   = 19 * 60 + 30; // Cena (adatta se usi Pranzo)
    voci.sort((a, b) => a.finestra - b.finestra).forEach(({ finestra, patty }) => {
      const s = startMin + finestra * WINDOW_MIN;
      const hh = String(Math.floor(s / 60)).padStart(2, "0");
      const mm = String(s % 60).padStart(2, "0");
      const barra = "█".repeat(patty) + "░".repeat(Math.max(0, CAP - patty));
      console.log(`   [${String(finestra).padStart(2)}] ${hh}:${mm}  ${String(patty).padStart(2)}/${CAP}  ${barra}`);
    });
  }

  // Verdetto finale
  console.log(`\n${SEP}`);
  if (overflow.length === 0 && contigenza === 0 && errori.length === 0) {
    console.log("✅ STRESS TEST SUPERATO — nessuna race condition, ledger coerente\n");
  } else if (overflow.length > 0) {
    console.log("🔴 FAIL — overflow di finestra rilevato: race condition nelle transazioni!\n");
  } else if (contigenza > 0) {
    console.log(`⚠️  ATTENZIONE — delta di ${contigenza} patty: possibile retry Firestore o errori di rete\n`);
  } else {
    console.log(`⚠️  COMPLETATO CON ${errori.length} ERRORI — controlla i log di vercel dev\n`);
  }
}

// Mostra errori in dettaglio se ci sono
if (errori.length > 0) {
  console.log("Dettaglio errori:");
  errori.slice(0, 5).forEach((e) => console.log(`  [${e.idx}] status=${e.status} ms=${e.ms} body=${JSON.stringify(e.body)}`));
  if (errori.length > 5) console.log(`  ... e altri ${errori.length - 5}`);
}

process.exit(0);
