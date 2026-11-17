/* audit-ordini.mjs
   Analisi a tappeto di ordini, hold e piastra. Di default NON scrive nulla.

   Uso:
     node scripts/audit-ordini.mjs                    # dal 1° ottobre 2026 a oggi
     node scripts/audit-ordini.mjs --dal 2026-11-01   # da una data
     node scripts/audit-ordini.mjs --fix              # applica le sole correzioni sicure

   Controlli (ogni anomalia ha un codice):
     PASSATO     ordine con orario di ritiro già trascorso al momento della prenotazione
     IN_SERVIZIO ordine online fatto mentre il locale era aperto (pausa "solo fuori orario")
     FORMATO     Burger (Chicken, Pulled Pork, Burgerveg) in doppio/triplo: prodotto inesistente, +2/+4 € pagati
     RICOLLOCA   pagato dopo il rilascio dell'hold: i suoi patty non erano sulla piastra
     CELLE       numero di celle piastra diverso dai patty dell'ordine
     PIASTRA     piastra della sessione diversa da ordini + pagamenti in corso
     HOLD        hold in attesa da oltre 35 minuti, o pagato senza ordine
     DUPLICATO   stesso nome e stessi prodotti nella stessa sessione a meno di 10 minuti
     PAGAMENTO   ordine online senza riferimento di pagamento (Nexi/Stripe)
     RITIRO      orario di ritiro fuori dall'orario del servizio

   --fix corregge SOLO ciò che è sicuro e non tocca gli ordini:
     · HOLD in attesa bloccati → "scaduto" (restituisce gli special, come il job automatico)
     · PIASTRA delle sessioni da OGGI in poi → ricostruita da ordini + pagamenti in corso
       (stessa logica del pulsante Riconcilia, in transazione)
   Le anomalie degli ordini passati (PASSATO, IN_SERVIZIO, FORMATO, DUPLICATO…) si
   riportano soltanto: eventuali rimborsi sono una decisione del locale.

   Produce anche audit-ordini.json (stessa cartella) con l'elenco completo.
*/
import { readFileSync, writeFileSync } from "fs";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, FieldPath } from "firebase-admin/firestore";

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

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const DAL = arg("--dal") ?? "2026-10-01";
const FIX = args.includes("--fix");

/* ── orari del locale (copia di src/lib/schedule.ts) ── */
const SCHEDULE = {
  0: [{ label: "Cena", start: "19:30", end: "22:30" }],
  1: [],
  2: [{ label: "Pranzo", start: "12:30", end: "14:30" }, { label: "Cena", start: "19:30", end: "22:30" }],
  3: [{ label: "Pranzo", start: "12:30", end: "14:30" }, { label: "Cena", start: "19:30", end: "22:30" }],
  4: [{ label: "Pranzo", start: "12:30", end: "14:30" }, { label: "Cena", start: "19:30", end: "22:30" }],
  5: [{ label: "Pranzo", start: "12:30", end: "14:30" }, { label: "Cena", start: "19:30", end: "24:00" }],
  6: [{ label: "Cena", start: "19:30", end: "24:00" }],
};
const toMin = (hm) => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
const endMin = (e) => (e === "24:00" ? 1440 : toMin(e));
const fmtMin = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const STALE_MIN = 35;

/* ── ora di Roma di un Timestamp ── */
const RF = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function rome(ts) {
  const d = ts?.toDate ? ts.toDate() : null;
  if (!d) return null;
  const p = {}; for (const { type, value } of RF.formatToParts(d)) if (type !== "literal") p[type] = value;
  const date = `${p.year}-${p.month}-${p.day}`;
  const dow = new Date(Number(p.year), Number(p.month) - 1, Number(p.day)).getDay();
  return { date, min: Number(p.hour) * 60 + Number(p.minute), dow, label: `${p.day}/${p.month} ${p.hour}:${p.minute}` };
}
const oggi = rome({ toDate: () => new Date() }).date;
const serviceOf = (key) => {
  const m = key?.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
  if (!m) return null;
  const dow = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
  const def = (SCHEDULE[dow] ?? []).find((d) => d.label === m[4]);
  return def ? { date: `${m[1]}-${m[2]}-${m[3]}`, start: toMin(def.start), end: endMin(def.end) } : null;
};
const openAt = (r) => (SCHEDULE[r.dow] ?? []).find((d) => r.min >= toMin(d.start) && r.min < endMin(d.end));

/* ── dati ── */
console.log(`\n🔎  AUDIT ORDINI — dal ${DAL} ${FIX ? "(con --fix)" : "(sola lettura)"}\n`);
const [ordersSnap, holdsSnap, sessSnap, menuSnap] = await Promise.all([
  db.collection("orders").where("serviceKey", ">=", DAL).get(),
  db.collection("holds").where("serviceKey", ">=", DAL).get(),
  db.collection("sessions").where(FieldPath.documentId(), ">=", DAL).get(),
  db.collection("menu").get(),
]);
const orders = ordersSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
const holds = holdsSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
const holdByOrder = new Map(holds.filter((h) => h.orderId).map((h) => [h.orderId, h]));
console.log(`Letti: ${orders.length} ordini, ${holds.length} hold, ${sessSnap.size} sessioni.\n`);

const burgers = menuSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((m) => m.type === "burger");
console.log("Burgers nel menu: " + burgers.map((b) => `${b.name}${b.singleFormatOnly ? " (formato unico)" : " (⚠️ formati attivi)"}`).join(", ") + "\n");
const burgerRe = new RegExp(`^(?:(\\d+)\\s*[×x]\\s*)?(${burgers.map((b) => b.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "chicken|pulled pork|burgerveg"})\\s+(doppio|triplo)\\b`, "i");

const anomalie = [];
const add = (codice, o, dettaglio, extra = {}) => anomalie.push({
  codice, serviceKey: o.serviceKey, ordine: o.id, code: o.code ?? null, nome: o.name ?? "", dettaglio, ...extra,
});
const isOnline = (o) => o.channel !== "banco";

for (const o of orders) {
  const svc = serviceOf(o.serviceKey);
  const creato = rome(o.createdAt);
  const hold = holdByOrder.get(o.id);
  const holdCreato = rome(hold?.createdAt);

  // PASSATO: alla prenotazione (hold) o al pagamento (ordine) il ritiro era già trascorso
  if (svc && typeof o.readyMin === "number") {
    const quando = holdCreato ?? creato;
    if (quando && quando.date === svc.date && quando.min > o.readyMin)
      add("PASSATO", o, `ritiro ${fmtMin(o.readyMin)} ma prenotato alle ${fmtMin(quando.min)}${holdCreato && creato && creato.min !== holdCreato.min ? ` (pagato alle ${fmtMin(creato.min)})` : ""}`, { ritardoMin: quando.min - o.readyMin });
    else if (holdCreato && creato && creato.date === svc.date && creato.min > o.readyMin)
      add("PASSATO", o, `prenotato alle ${fmtMin(holdCreato.min)} per le ${fmtMin(o.readyMin)}, ma pagato solo alle ${fmtMin(creato.min)}`, { ritardoMin: creato.min - o.readyMin, pagamentoLento: true });
    if (o.readyMin < svc.start || o.readyMin > svc.end + 10)
      add("RITIRO", o, `ritiro alle ${fmtMin(o.readyMin)}, servizio ${fmtMin(svc.start)}–${fmtMin(svc.end)}`);
  }

  // IN_SERVIZIO: ordine online fatto a locale aperto
  if (isOnline(o)) {
    const quando = holdCreato ?? creato;
    const aperto = quando && openAt(quando);
    if (aperto) add("IN_SERVIZIO", o, `prenotato ${quando.label}, locale aperto (${aperto.label} ${aperto.start}–${aperto.end})${o.serviceKey?.startsWith(quando.date) ? " per il servizio in corso" : ""}`);
  }

  // FORMATO: Burger doppio/triplo
  for (const raw of o.items ?? []) {
    const m = String(raw).match(burgerRe);
    if (m) {
      const qty = m[1] ? parseInt(m[1], 10) : 1;
      const extra = (m[3].toLowerCase() === "triplo" ? 4 : 2) * qty;
      add("FORMATO", o, `«${raw}»: pagati ${extra.toFixed(2)} € in più`, { sovrapprezzo: extra });
    }
  }

  if (o.ricollocare) add("RICOLLOCA", o, `pagato dopo il rilascio dell'hold: ${o.patties ?? 0} patty non contati sulla piastra`);
  if (Array.isArray(o.cells) && o.cells.length > 0 && o.cells.length !== (o.patties ?? 0))
    add("CELLE", o, `${o.cells.length} celle per ${o.patties} patty`);
  if (isOnline(o) && o.pay === "online" && !o.nexiOperationId && !o.stripeSessionId)
    add("PAGAMENTO", o, "ordine online senza riferimento di pagamento");
}

// DUPLICATO
const perChiave = new Map();
for (const o of orders) {
  const k = `${o.serviceKey}|${String(o.name ?? "").trim().toLowerCase()}|${(o.items ?? []).join("§")}`;
  (perChiave.get(k) ?? perChiave.set(k, []).get(k)).push(o);
}
for (const gruppo of perChiave.values()) {
  if (gruppo.length < 2) continue;
  gruppo.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
  for (let i = 1; i < gruppo.length; i++) {
    const dt = ((gruppo[i].createdAt?.toMillis?.() ?? 0) - (gruppo[i - 1].createdAt?.toMillis?.() ?? 0)) / 60000;
    if (dt <= 10) add("DUPLICATO", gruppo[i], `uguale all'ordine #${gruppo[i - 1].code} di ${dt.toFixed(1)} minuti prima`, { totale: gruppo[i].total });
  }
}

// HOLD
const nowMs = Date.now();
const holdBloccati = holds.filter((h) => h.status === "attesa" && (h.createdAt?.toMillis?.() ?? nowMs) < nowMs - STALE_MIN * 60000);
for (const h of holdBloccati) anomalie.push({ codice: "HOLD", serviceKey: h.serviceKey, hold: h.id, nome: h.name ?? "", dettaglio: `in attesa dal ${rome(h.createdAt)?.label}: ${(h.cells ?? []).length} patty tenuti sulla piastra` });
const orderIds = new Set(orders.map((o) => o.id));
for (const h of holds.filter((h) => h.status === "pagato" && (!h.orderId || !orderIds.has(h.orderId))))
  anomalie.push({ codice: "HOLD", serviceKey: h.serviceKey, hold: h.id, nome: h.name ?? "", dettaglio: "pagato ma senza ordine" });

// PIASTRA per sessione
const piastra = [];
for (const s of sessSnap.docs) {
  const key = s.id;
  const ledger = s.data().ledger ?? {};
  const segnati = Object.values(ledger).reduce((a, v) => a + (Number(v) || 0), 0);
  const ord = orders.filter((o) => o.serviceKey === key).reduce((a, o) => a + (o.patties ?? 0), 0);
  const inCorso = holds.filter((h) => h.serviceKey === key && h.status === "attesa" && !holdBloccati.includes(h))
    .reduce((a, h) => a + (h.cells ?? []).length, 0);
  const reali = ord + inCorso;
  if (segnati !== reali) {
    const futura = key.slice(0, 10) >= oggi;
    piastra.push({ key, segnati, reali, futura });
    anomalie.push({ codice: "PIASTRA", serviceKey: key, dettaglio: `piastra ${segnati} patty, ordini ${ord}${inCorso ? ` + ${inCorso} in pagamento` : ""} = ${reali} (${segnati > reali ? `${segnati - reali} fantasma` : `${reali - segnati} non contati`})${futura ? " — CORREGGIBILE" : ""}` });
  }
}

/* ── report ── */
const ORDINE = ["PASSATO", "IN_SERVIZIO", "FORMATO", "RICOLLOCA", "PIASTRA", "HOLD", "DUPLICATO", "CELLE", "PAGAMENTO", "RITIRO"];
const conta = Object.fromEntries(ORDINE.map((c) => [c, anomalie.filter((a) => a.codice === c).length]));
console.log("RIEPILOGO");
for (const c of ORDINE) console.log(`  ${c.padEnd(12)} ${String(conta[c]).padStart(4)}`);
const sovra = anomalie.filter((a) => a.codice === "FORMATO").reduce((s, a) => s + a.sovrapprezzo, 0);
if (sovra) console.log(`\n  Sovrapprezzo Burger doppi/tripli: ${sovra.toFixed(2)} € in totale`);

for (const c of ORDINE) {
  const lista = anomalie.filter((a) => a.codice === c);
  if (!lista.length) continue;
  console.log(`\n── ${c} (${lista.length}) ──`);
  for (const a of lista.slice(0, 40)) console.log(`  ${a.serviceKey}  ${a.code ? `#${a.code} ` : ""}${a.nome}  ${a.dettaglio}`);
  if (lista.length > 40) console.log(`  … e altri ${lista.length - 40} (vedi audit-ordini.json)`);
}

// andamento per settimana: quando sono comparse PASSATO e IN_SERVIZIO?
const settimana = (key) => { const d = new Date(key.slice(0, 10)); const lun = new Date(d); lun.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return lun.toISOString().slice(0, 10); };
const perSett = {};
for (const o of orders) { const w = settimana(o.serviceKey); perSett[w] ??= { ordini: 0, PASSATO: 0, IN_SERVIZIO: 0, FORMATO: 0, RICOLLOCA: 0 }; perSett[w].ordini++; }
for (const a of anomalie) if (a.ordine && perSett[settimana(a.serviceKey)] && a.codice in perSett[settimana(a.serviceKey)]) perSett[settimana(a.serviceKey)][a.codice]++;
console.log("\n── PER SETTIMANA (lunedì) ──\n  settimana    ordini  passato  in_serv  formato  ricolloca");
for (const [w, v] of Object.entries(perSett).sort()) console.log(`  ${w}  ${String(v.ordini).padStart(6)}  ${String(v.PASSATO).padStart(7)}  ${String(v.IN_SERVIZIO).padStart(7)}  ${String(v.FORMATO).padStart(7)}  ${String(v.RICOLLOCA).padStart(9)}`);

writeFileSync("audit-ordini.json", JSON.stringify({ dal: DAL, generato: new Date().toISOString(), conta, perSettimana: perSett, anomalie }, null, 2));
console.log("\nElenco completo: audit-ordini.json");

/* ── correzioni sicure ── */
if (!FIX) {
  const corr = holdBloccati.length + piastra.filter((p) => p.futura).length;
  console.log(corr ? `\nCorrezioni sicure disponibili: ${holdBloccati.length} hold bloccati, ${piastra.filter((p) => p.futura).length} piastre da oggi in poi. Rilancia con --fix.\n` : "\nNessuna correzione sicura da applicare.\n");
  process.exit(0);
}

console.log("\n🔧  CORREZIONI");
for (const h of holdBloccati) {
  await db.runTransaction(async (tx) => {
    const f = await tx.get(h.ref);
    if (f.data()?.status !== "attesa") return;
    tx.update(h.ref, { status: "scaduto", releasedAt: FieldValue.serverTimestamp() });
    const sp = f.data().specials ?? {};
    if (Object.keys(sp).length) tx.set(db.collection("sessions").doc(h.serviceKey),
      { stock: Object.fromEntries(Object.entries(sp).map(([id, q]) => [id, FieldValue.increment(q)])) }, { merge: true });
  });
  console.log(`  ✓ hold ${h.id} (${h.serviceKey}) → scaduto`);
}
for (const p of piastra.filter((x) => x.futura)) {
  const sessRef = db.collection("sessions").doc(p.key);
  await db.runTransaction(async (tx) => {
    const [os, hs] = await Promise.all([
      tx.get(db.collection("orders").where("serviceKey", "==", p.key)),
      tx.get(db.collection("holds").where("serviceKey", "==", p.key).where("status", "==", "attesa")),
    ]);
    const led = {};
    const add = (w, n = 1) => { if (Number.isInteger(w) && w >= 0) led[w] = (led[w] ?? 0) + n; };
    for (const d of os.docs) {
      const o = d.data();
      if (!(o.patties > 0)) continue;
      if (Array.isArray(o.cells) && o.cells.length === o.patties) o.cells.forEach((w) => add(Number(w)));
      else if (typeof o.windowIndex === "number") add(o.windowIndex, o.patties);
    }
    for (const d of hs.docs) {
      const h = d.data();
      if ((h.createdAt?.toMillis?.() ?? 0) < Date.now() - STALE_MIN * 60000) continue;
      (h.cells ?? []).forEach((w) => add(Number(w)));
    }
    const ledger = Object.fromEntries(Object.entries(led).map(([w, n]) => [String(w), n]));
    tx.update(sessRef, { ledger, updatedAt: FieldValue.serverTimestamp() });
  });
  console.log(`  ✓ piastra ${p.key}: ${p.segnati} → ${p.reali} patty`);
}
console.log("\n✅  Fatto. Gli ordini non sono stati modificati.\n");
