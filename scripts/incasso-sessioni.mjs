/* incasso-sessioni.mjs
   Tabella dettagliata incasso per sessione: ordini, incasso, scontrino medio,
   patty totali, quota menù. Utile per confrontare serate e pranzi.

   Uso: node scripts/incasso-sessioni.mjs
        node scripts/incasso-sessioni.mjs --from 2026-09-05
        node scripts/incasso-sessioni.mjs --type Cena
        node scripts/incasso-sessioni.mjs --type Pranzo
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
const fromFilter = get("--from");
const typeFilter = get("--type"); // "Cena" o "Pranzo"

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m",
  blue: "\x1b[34m", gray: "\x1b[90m", cyan: "\x1b[36m",
};

function euro(n) { return n.toFixed(2) + "€"; }

const snap = await db.collection("orders").get();

const sessioni = new Map();
for (const doc of snap.docs) {
  const o = doc.data();
  const sk = o.serviceKey ?? "sconosciuta";

  if (sk < "2026-09-01") continue;
  if (fromFilter && sk.slice(0, 10) < fromFilter) continue;
  if (typeFilter && !sk.endsWith(typeFilter)) continue;
  if (o.pay !== "online") continue; // solo pagati online

  if (!sessioni.has(sk)) sessioni.set(sk, {
    ordini: 0, incasso: 0, patty: 0, conMenu: 0, scontrini: [],
  });
  const s = sessioni.get(sk);
  s.ordini++;
  s.incasso += o.total ?? 0;
  s.patty += o.patties ?? 0;
  s.scontrini.push(o.total ?? 0);
  // Conta ordini con almeno un menù (items contiene "menu con")
  if ((o.items ?? []).some(i => i.toLowerCase().includes("menu con"))) s.conMenu++;
}

if (sessioni.size === 0) {
  console.log(`${C.yellow}Nessuna sessione trovata.${C.reset}`);
  process.exit(0);
}

const sorted = [...sessioni.entries()].sort((a, b) => a[0].localeCompare(b[0]));

console.log(`\n${C.bold}${C.cyan}💰  INCASSO PER SESSIONE${C.reset}\n`);

const header = [
  "Sessione".padEnd(24),
  "Ordini".padStart(7),
  "Incasso".padStart(10),
  "Scontr.medio".padStart(13),
  "Patty".padStart(6),
  "Con menù".padStart(9),
];
console.log(C.dim + header.join("  ") + C.reset);
console.log(C.dim + "─".repeat(75) + C.reset);

let totOrdini = 0, totIncasso = 0, totPatty = 0, totMenu = 0;
let miglioreIncasso = { sk: "", val: 0 };
let miglioreMedia = { sk: "", val: 0 };

for (const [sk, s] of sorted) {
  totOrdini += s.ordini;
  totIncasso += s.incasso;
  totPatty += s.patty;
  totMenu += s.conMenu;

  const media = s.ordini > 0 ? s.incasso / s.ordini : 0;
  const quotaMenu = s.ordini > 0 ? Math.round(s.conMenu / s.ordini * 100) : 0;

  if (s.incasso > miglioreIncasso.val) miglioreIncasso = { sk, val: s.incasso };
  if (media > miglioreMedia.val) miglioreMedia = { sk, val: media };

  // Tipo sessione (Cena/Pranzo) — evidenzia Cena in blu
  const tipo = sk.includes("Cena") ? C.blue : C.gray;

  const row = [
    (tipo + sk + C.reset).padEnd(24 + 10),
    String(s.ordini).padStart(7),
    euro(s.incasso).padStart(10),
    euro(media).padStart(13),
    String(s.patty).padStart(6),
    `${quotaMenu}%`.padStart(9),
  ];
  console.log(row.join("  "));
}

console.log(C.dim + "─".repeat(75) + C.reset);

const totMedia = totOrdini > 0 ? totIncasso / totOrdini : 0;
const totQuotaMenu = totOrdini > 0 ? Math.round(totMenu / totOrdini * 100) : 0;
const totRow = [
  (C.bold + "TOTALE").padEnd(24 + C.bold.length),
  String(totOrdini).padStart(7),
  euro(totIncasso).padStart(10),
  euro(totMedia).padStart(13),
  String(totPatty).padStart(6),
  `${totQuotaMenu}%`.padStart(9),
];
console.log(totRow.join("  ") + C.reset);

console.log(`\n${C.bold}Highlights:${C.reset}`);
console.log(`  ${C.green}💰  Sessione con più incasso: ${miglioreIncasso.sk} (${euro(miglioreIncasso.val)})${C.reset}`);
console.log(`  ${C.blue}🍔  Scontrino medio più alto: ${miglioreMedia.sk} (${euro(miglioreMedia.val)})${C.reset}`);
console.log(`  ${C.gray}📊  Totale patty lavorati: ${totPatty}${C.reset}`);
console.log(`  ${C.gray}🥤  Quota menù complessiva: ${totQuotaMenu}%${C.reset}\n`);
