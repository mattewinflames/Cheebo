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
      const val = trimmed.slice(idx + 1).trim().replace(/^[\"']|[\"']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}
loadEnvFile('.env');
loadEnvFile('.env.local');
const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) });
const db = getFirestore();
const q = await db.collection('orders')
  .where('serviceKey', '==', '2026-09-19-Cena')
  .get();
for (const d of q.docs) {
  const o = d.data();
  if (['Sebastian', 'Carlo', 'GIORGIA', 'Luca'].includes(o.name)) {
    console.log(o.name, '| windowIndex:', o.windowIndex, '| cells:', JSON.stringify(o.cells ?? 'ASSENTE'));
  }
}
