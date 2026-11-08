/* fix-special-patty.mjs
   Correzione UNA TANTUM dopo l'introduzione dei "patty per pezzo" negli special.

   Prima ogni pezzo di special contava 1 patty sulla piastra, anche se il panino
   ne ha 2 (es. Big Bruce). Gli ordini già presi hanno quindi salvato patty e
   celle in difetto. Questo script, per le sessioni da OGGI in poi:
     · legge dal menu gli special da piastra con patty per pezzo > 1;
     · trova gli ordini che li contengono, riconoscendoli dall'etichetta
       (es. "Big Bruce", "2× Big Bruce");
     · aggiunge a ogni ordine i patty mancanti, nella sua finestra di ritiro:
       aggiorna patties e cells dell'ordine e il registro piastra della sessione,
       nella stessa transazione.

   Quali ordini tocca: solo quelli creati PRIMA della correzione nel codice
   (riconoscibili perché non hanno il campo `specials`, che gli ordini nuovi
   salvano) e non ancora corretti (campo `specialPattyFixed`). Si può quindi
   rilanciare senza rischio di contare due volte.

   Uso:
     node scripts/fix-special-patty.mjs            # anteprima, non scrive nulla
     node scripts/fix-special-patty.mjs --apply    # applica
*/
import { readFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

function loadEnvFile(path) {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* ignora */ }
}
loadEnvFile(".env");
loadEnvFile(".env.local");

const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!sa) { console.error("❌  FIREBASE_SERVICE_ACCOUNT non trovata in .env.local"); process.exit(1); }
if (!getApps().length) initializeApp({ credential: cert(JSON.parse(sa)) });
const db = getFirestore();

const APPLY = process.argv.includes("--apply");
const GRIDDLE_IDS = new Set(["classic", "oklahoma", "crispy"]);   // come in src/lib/menu.ts
const occupiesGriddle = (it) => it.griddle ?? GRIDDLE_IDS.has(it.id);

const d = new Date();
const oggi = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

console.log(`\n🍔  CORREZIONE PATTY SPECIAL — sessioni da ${oggi} ${APPLY ? "(APPLICA)" : "(anteprima)"}\n`);

// 1. special da piastra con più di un patty per pezzo
const menuSnap = await db.collection("menu").get();
const extraPerNome = new Map();   // nome special → patty in più per pezzo
for (const doc of menuSnap.docs) {
  const it = { id: doc.id, ...doc.data() };
  if (!it.special || !occupiesGriddle(it)) continue;
  const p = Math.max(1, Math.min(5, Math.round(it.special.patty ?? 1)));
  if (p > 1) extraPerNome.set(String(it.name).trim(), p - 1);
}
if (!extraPerNome.size) {
  console.log("Nessuno special con più di 1 patty per pezzo nel menu. Imposta prima \"Patty per pezzo\" in admin.\n");
  process.exit(0);
}
for (const [n, e] of extraPerNome) console.log(`  · ${n}: ${e + 1} patty per pezzo (+${e} rispetto a prima)`);
console.log();

// 2. ordini delle sessioni da oggi in poi
const ordersSnap = await db.collection("orders").where("serviceKey", ">=", oggi).get();
const QTY_RE = /^(\d+)\s*[×x]\s*/;
let daCorreggere = 0, pattyAggiunti = 0;

for (const doc of ordersSnap.docs) {
  const o = doc.data();
  if (o.specialPattyFixed || o.specials) continue;     // già corretto o creato col codice nuovo
  let extra = 0;
  for (const raw of o.items ?? []) {
    const m = String(raw).match(QTY_RE);
    const qty = m ? parseInt(m[1], 10) : 1;
    const nome = (m ? String(raw).slice(m[0].length) : String(raw)).trim();
    const e = extraPerNome.get(nome);
    if (e) extra += qty * e;
  }
  if (extra === 0) continue;
  if (typeof o.windowIndex !== "number") { console.log(`  ⚠️  ${doc.id} senza finestra di ritiro: saltato`); continue; }

  daCorreggere++; pattyAggiunti += extra;
  console.log(`  #${o.code ?? "?"} ${o.name ?? ""} — ${o.serviceKey}, ritiro finestra ${o.windowIndex}: patty ${o.patties} → ${o.patties + extra}`);

  if (APPLY) {
    const sessRef = db.collection("sessions").doc(o.serviceKey);
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      const f = fresh.data();
      if (!f || f.specialPattyFixed || f.specials) return;      // rilettura: nessun doppio conteggio
      // ordini vecchi senza celle salvate: si lasciano senza (il Riconcilia li
      // conta nella finestra di ritiro con i patty aggiornati); se ci sono, si
      // aggiungono quelle mancanti così restano una per patty
      const patch = { patties: (f.patties ?? 0) + extra, specialPattyFixed: true };
      if (Array.isArray(f.cells) && f.cells.length > 0) patch.cells = [...f.cells, ...Array(extra).fill(f.windowIndex)];
      tx.update(doc.ref, patch);
      tx.set(sessRef, { ledger: { [String(f.windowIndex)]: FieldValue.increment(extra) }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
  }
}

console.log(`\n${daCorreggere ? `${daCorreggere} ordini, +${pattyAggiunti} patty in totale.` : "Nessun ordine da correggere."}`);
if (daCorreggere && !APPLY) console.log("Anteprima: nulla è stato scritto. Rilancia con --apply per applicare.");
if (daCorreggere && APPLY) console.log("✅  Applicato. Controlla il pannello piastra in admin.");
console.log();
