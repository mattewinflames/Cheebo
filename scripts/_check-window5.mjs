import { readFileSync } from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function loadEnvFile(path) {
  try {
    const lines = readFileSync(path, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}
loadEnvFile('.env');
loadEnvFile('.env.local');

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) });
const db = getFirestore();

const SERVICE_KEY = '2026-09-19-Cena';
const START_MIN = 1170;
const CAP = 13;
const CAP_OVERFLOW = 18;
const WINDOW_MIN = 10;

const fmt = m => String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
const fmtTs = ts => ts?.toDate?.().toLocaleTimeString('it-IT') ?? '?';

// Leggi tutti gli holds pagati (hanno il createdAt reale della prenotazione)
const holdsSnap = await db.collection('holds')
  .where('serviceKey', '==', SERVICE_KEY)
  .where('status', '==', 'pagato')
  .get();

// Leggi tutti gli ordini
const ordersSnap = await db.collection('orders')
  .where('serviceKey', '==', SERVICE_KEY)
  .get();

// Mappa ordine per nome (per incrociare con holds)
const ordersByName = {};
for (const d of ordersSnap.docs) {
  const o = d.data();
  ordersByName[o.name] = { ...o, id: d.id };
}

// Raccoglie tutti gli holds con createdAt
const holds = holdsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
holds.sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));

console.log('\n=== SEQUENZA TEMPORALE COMPLETA (holds pagati, ordinati per orario prenotazione) ===\n');
console.log('Ora prenotaz.  Nome                  Patty  windowIndex  Finestra        Mode');
console.log('─'.repeat(80));

// Simula il ledger ricostruendo l'ordine di arrivo
const ledger = new Array(27).fill(0); // abbondante

for (const h of holds) {
  const wi = h.windowIndex;
  const createdAt = fmtTs(h.createdAt);
  const finestra = fmt(START_MIN + wi * WINDOW_MIN) + '-' + fmt(START_MIN + (wi+1) * WINDOW_MIN);
  const cells = Array.isArray(h.cells) ? h.cells : [];
  
  // Aggiorna ledger simulato
  if (cells.length > 0) {
    for (const w of cells) ledger[w]++;
  } else {
    // fallback: metti tutti i patty nell'ultima finestra (approssimazione)
    ledger[wi] += h.patties;
  }

  console.log(
    createdAt.padEnd(15),
    h.name.padEnd(22),
    String(h.patties).padEnd(7),
    String(wi).padEnd(13),
    finestra.padEnd(16),
    h.mode
  );
}

console.log('\n=== STATO LEDGER PER FINESTRA (ricostruito dagli holds pagati) ===\n');
for (let wi = 0; wi < 15; wi++) {
  const used = ledger[wi];
  if (used === 0) continue;
  const start = fmt(START_MIN + wi * WINDOW_MIN);
  const end = fmt(START_MIN + (wi+1) * WINDOW_MIN);
  const bar = '█'.repeat(Math.min(used, CAP_OVERFLOW));
  const overflow = used > CAP ? ` ⚠️  OVERFLOW ${used - CAP} oltre CAP` : '';
  const overflowHard = used > CAP_OVERFLOW ? ` 🔴 OLTRE CAP_OVERFLOW!` : '';
  console.log(`wi:${String(wi).padEnd(3)} ${start}-${end}  ${String(used).padEnd(3)}/13  ${bar}${overflow}${overflowHard}`);
}

console.log('\n=== DETTAGLIO FINESTRA wi:5 (20:20-20:30) ===\n');
const wi5holds = holds.filter(h => h.windowIndex === 5);
for (const h of wi5holds) {
  console.log(`  ${fmtTs(h.createdAt)}  ${h.name.padEnd(22)} patty:${h.patties}  cells:${JSON.stringify(h.cells ?? 'assente')}  mode:${h.mode}`);
}
