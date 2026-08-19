/**
 * STRESS TEST — LIVELLO 1: motore puro (dispatch.ts)
 * =====================================================
 * Verifica la correttezza del motore in condizioni limite senza toccare
 * Firebase né Vercel. Simula N prenotazioni "concorrenti" applicandole
 * in sequenza sullo stesso registro (worst-case: nessuna retry, massima
 * contesa). Non è un test di throughput: è un test di CORRETTEZZA LOGICA.
 *
 * Uso:
 *   node scripts/stress-motore.mjs
 *
 * Non richiede .env, Firebase o rete: è completamente offline.
 */

import {
  CAP, WINDOW_MIN,
  emptyLedger, planFirst, planAt, applyPlacement,
  totalWindows, windowEndMin, fmt, ledgerFromMap,
} from "../src/lib/dispatch.ts";

// -------------------------------------------------------------------
// Configurazione del test
// -------------------------------------------------------------------
const CENA = { startMin: 19 * 60 + 30, endMin: 22 * 60 + 30, label: "Cena" };
const N_WINDOWS = totalWindows(CENA);
const MAX_PATTY = CAP * N_WINDOWS; // capienza totale della piastra
const SEP = "─".repeat(60);

// -------------------------------------------------------------------
// Helper
// -------------------------------------------------------------------
function ledgerOk(led) {
  return led.every((v) => v >= 0 && v <= CAP);
}
function sommaPatty(led) {
  return led.reduce((a, b) => a + b, 0);
}
function report(titolo, risultati) {
  const ok = risultati.filter((r) => r.ok).length;
  const no = risultati.filter((r) => !r.ok).length;
  const err = risultati.filter((r) => r.errore).length;
  console.log(`\n${SEP}`);
  console.log(`📋 ${titolo}`);
  console.log(`   ✅ Accettate : ${ok}`);
  console.log(`   🔴 Rifiutate : ${no} (piastra piena o target non fattibile)`);
  if (err) console.log(`   ⚠️  Errori    : ${err}`);
  return { ok, no, err };
}

// -------------------------------------------------------------------
// TEST 1: riempimento completo senza buchi
// -------------------------------------------------------------------
console.log("\n" + SEP);
console.log("TEST 1 · Riempimento completo — nessun overflow di finestra");
{
  let led = emptyLedger(CENA);
  const risultati = [];
  // Manda MAX_PATTY prenotazioni da 1 patty ciascuna: devono passare tutte
  for (let i = 0; i < MAX_PATTY; i++) {
    const p = planFirst(led, 1, CENA);
    risultati.push({ ok: p.ok, errore: false });
    if (p.ok) led = applyPlacement(led, p);
  }
  // Una in più deve essere rifiutata
  const extra = planFirst(led, 1, CENA);
  const PASS = risultati.every((r) => r.ok) && !extra.ok && ledgerOk(led);
  const totale = sommaPatty(led);
  console.log(`   Patty prenotati  : ${totale} / ${MAX_PATTY} (attesi ${MAX_PATTY})`);
  console.log(`   Extra rifiutato  : ${!extra.ok ? "✅ sì" : "❌ NO (bug!)"}`);
  console.log(`   Nessun overflow  : ${ledgerOk(led) ? "✅" : "❌ BUG CRITICO"}`);
  console.log(PASS ? "   ⬛ PASS" : "   🔴 FAIL");
}

// -------------------------------------------------------------------
// TEST 2: N prenotazioni miste (1-4 patty) — verifica del totale
// -------------------------------------------------------------------
console.log("\n" + SEP);
console.log("TEST 2 · Prenotazioni miste (1-4 patty) — coerenza del totale");
{
  let led = emptyLedger(CENA);
  const ordini = [];
  let pattyAccettati = 0;
  // Genera ordini da 1 a 4 patty in sequenza ciclica
  for (let i = 0; i < MAX_PATTY * 2; i++) {
    const richiesti = (i % 4) + 1;
    const p = planFirst(led, richiesti, CENA);
    if (p.ok) {
      led = applyPlacement(led, p);
      pattyAccettati += richiesti;
      ordini.push({ richiesti, finestra: p.windowIndex });
    }
  }
  const totale = sommaPatty(led);
  const PASS = totale === pattyAccettati && ledgerOk(led);
  console.log(`   Ordini accettati : ${ordini.length}`);
  console.log(`   Patty nel ledger : ${totale}`);
  console.log(`   Patty contati    : ${pattyAccettati}`);
  console.log(`   Coerenza         : ${totale === pattyAccettati ? "✅" : "❌ BUG CRITICO"}`);
  console.log(`   Nessun overflow  : ${ledgerOk(led) ? "✅" : "❌ BUG CRITICO"}`);
  console.log(PASS ? "   ⬛ PASS" : "   🔴 FAIL");
}

// -------------------------------------------------------------------
// TEST 3: planAt su target saturato ricade su planFirst
// -------------------------------------------------------------------
console.log("\n" + SEP);
console.log("TEST 3 · planAt su target saturato → fallback a planFirst");
{
  let led = emptyLedger(CENA);
  // Satura le prime 3 finestre
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < CAP; j++) {
      const p = planFirst(led, 1, CENA);
      if (p.ok) led = applyPlacement(led, p);
    }
  }
  // Tenta planAt su finestra 1 (saturata): deve fallire
  const pAt = planAt(led, 1, 1, CENA);
  // Fallback a planFirst: deve trovare la 3 (la prima libera dopo le 3 saturate)
  const pFirst = planFirst(led, 1, CENA);
  const PASS = !pAt.ok && pFirst.ok && pFirst.windowIndex === 3;
  console.log(`   planAt su saturata rifiutato : ${!pAt.ok ? "✅" : "❌ BUG"}`);
  console.log(`   planFirst trova finestra 3   : ${pFirst.ok && pFirst.windowIndex === 3 ? "✅" : "❌ BUG"} (→ ${pFirst.ok ? fmt(pFirst.readyMin) : "n/a"})`);
  console.log(PASS ? "   ⬛ PASS" : "   🔴 FAIL");
}

// -------------------------------------------------------------------
// TEST 4: minWindow — nessuno slot passato (scenaro "servizio in corso")
// -------------------------------------------------------------------
console.log("\n" + SEP);
console.log("TEST 4 · minWindow — servizio in corso, le finestre passate si saltano");
{
  const minW = 6; // simuliamo che le prime 6 finestre siano passate (60 min di servizio)
  let led = emptyLedger(CENA);
  let pattyAccettati = 0;
  const risultati = [];
  for (let i = 0; i < 50; i++) {
    const richiesti = (i % 3) + 1;
    const p = planFirst(led, richiesti, CENA, minW);
    risultati.push({ ok: p.ok });
    if (p.ok) {
      // Verifica: nessuna cella deve essere prima di minW
      const slotsOk = p.cells.every((c) => c >= minW);
      if (!slotsOk) {
        console.log(`   ❌ BUG: cella ${Math.min(...p.cells)} < minW ${minW}`);
      }
      led = applyPlacement(led, p);
      pattyAccettati += richiesti;
    }
  }
  const totale = sommaPatty(led);
  // Le prime minW finestre devono essere a 0
  const primaPartePulita = led.slice(0, minW).every((v) => v === 0);
  const PASS = totale === pattyAccettati && ledgerOk(led) && primaPartePulita;
  console.log(`   Patty nel ledger    : ${totale} (attesi: ${pattyAccettati})`);
  console.log(`   Finestre 0-5 vuote  : ${primaPartePulita ? "✅" : "❌ BUG CRITICO"}`);
  console.log(`   Nessun overflow     : ${ledgerOk(led) ? "✅" : "❌ BUG CRITICO"}`);
  console.log(PASS ? "   ⬛ PASS" : "   🔴 FAIL");
}

// -------------------------------------------------------------------
// TEST 5: distribuzione degli slot (visione da managr)
// -------------------------------------------------------------------
console.log("\n" + SEP);
console.log("TEST 5 · Vista distribuzione (utile per capire come si riempie la piastra)");
{
  let led = emptyLedger(CENA);
  // Simula 30 ordini da 2 patty ciascuno
  for (let i = 0; i < 30; i++) {
    const p = planFirst(led, 2, CENA);
    if (p.ok) led = applyPlacement(led, p);
  }
  console.log("   Finestra  Orario       Patty  Liberi  Barra");
  led.forEach((v, i) => {
    const start = fmt(CENA.startMin + i * WINDOW_MIN);
    const end   = fmt(CENA.startMin + (i + 1) * WINDOW_MIN);
    const barra = "█".repeat(v) + "░".repeat(CAP - v);
    console.log(`   [${String(i).padStart(2)}]  ${start}–${end}   ${String(v).padStart(2)}/${CAP}   ${String(CAP - v).padStart(2)}    ${barra}`);
  });
}

console.log("\n" + SEP);
console.log("✅ STRESS TEST MOTORE COMPLETATO\n");
