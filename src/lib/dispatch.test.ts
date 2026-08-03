import { describe, it, expect } from "vitest";
import {
  CAP, emptyLedger, planFirst, planAt, applyPlacement,
  firstFeasibleWindow, freeUpTo, bookableWindows, fmt,
} from "./dispatch";

// Cena: 19:30–22:30 -> 18 finestre da 10 min
const CENA = { startMin: 19 * 60 + 30, endMin: 22 * 60 + 30 };

describe("riempimento e overflow di finestra", () => {
  it("13 patty chiudono la finestra 0 (pronto 19:40)", () => {
    const p = planFirst(emptyLedger(CENA), 13, CENA);
    expect(p.windowIndex).toBe(0);
    expect(fmt(p.readyMin)).toBe("19:40");
    expect(p.tranches).toBe(1);
  });

  it("14 patty sforano: il 14° va alla finestra 1 (pronto 19:50), 2 tranche", () => {
    const p = planFirst(emptyLedger(CENA), 14, CENA);
    expect(p.windowIndex).toBe(1);
    expect(fmt(p.readyMin)).toBe("19:50");
    expect(p.tranches).toBe(2);
  });
});

describe("coda continua e nessuna sovrapposizione", () => {
  it("dopo 13 patty applicati, il successivo parte dalla finestra 1", () => {
    let led = emptyLedger(CENA);
    led = applyPlacement(led, planFirst(led, 13, CENA)); // riempie finestra 0
    const p = planFirst(led, 1, CENA);
    expect(p.windowIndex).toBe(1);
    expect(led[0]).toBe(13);
  });

  it("due ordini in sequenza non riusano le stesse posizioni (priorità a chi è prima)", () => {
    let led = emptyLedger(CENA);
    const a = planFirst(led, 8, CENA); led = applyPlacement(led, a); // 8 in finestra 0
    const b = planFirst(led, 8, CENA); led = applyPlacement(led, b); // 5 in fin.0, 3 in fin.1
    expect(led[0]).toBe(CAP);       // 13: piena
    expect(led[1]).toBe(3);
    expect(b.windowIndex).toBe(1);  // il secondo consegna più tardi del primo
    expect(a.windowIndex).toBe(0);
  });
});

describe("primo disponibile salta le finestre piene", () => {
  it("con finestra 0 piena, il primo disponibile è la finestra 1", () => {
    const led = emptyLedger(CENA);
    for (let i = 0; i < CAP; i++) led[0] = CAP; // finestra 0 piena
    expect(firstFeasibleWindow(led, 3)).toBe(1);
    const p = planFirst(led, 3, CENA);
    expect(p.windowIndex).toBe(1);
    expect(fmt(p.readyMin)).toBe("19:50");
  });
});

describe("orario scelto", () => {
  it("se l'orario scelto ha spazio, viene rispettato", () => {
    const p = planAt(emptyLedger(CENA), 3, 5, CENA); // finestra 5 -> 20:30
    expect(p.ok).toBe(true);
    expect(p.windowIndex).toBe(5);
    expect(fmt(p.readyMin)).toBe("20:30");
  });

  it("se l'orario scelto non ha abbastanza spazio, NON è fattibile (si proporrà alternativa)", () => {
    const led = emptyLedger(CENA);
    led[0] = CAP; led[1] = CAP; // 0 e 1 piene -> entro la finestra 1 non c'è spazio
    const p = planAt(led, 5, 1, CENA);
    expect(p.ok).toBe(false);
    // il fallback "primo disponibile" propone più avanti
    const alt = planFirst(led, 5, CENA);
    expect(alt.windowIndex).toBeGreaterThanOrEqual(2);
  });

  it("orario scelto cuoce vicino al ritiro (riempimento a ritroso)", () => {
    const p = planAt(emptyLedger(CENA), 3, 4, CENA);
    expect(p.cells.every((w) => w <= 4)).toBe(true);
    expect(Math.max(...p.cells)).toBe(4);
  });
});

describe("slot prenotabili e cutoff", () => {
  it("bookableWindows parte dalla prima finestra fattibile", () => {
    const led = emptyLedger(CENA);
    led[0] = CAP; // piena
    const slots = bookableWindows(led, 2);
    expect(slots[0]).toBe(1);
    expect(slots.length).toBe(17); // 18 finestre - la prima piena
  });

  it("ordine troppo grande per il servizio: nessuno slot", () => {
    const led = emptyLedger(CENA); // 18 finestre * 13 = 234 max
    expect(planFirst(led, 235, CENA).ok).toBe(false);
    expect(bookableWindows(led, 235).length).toBe(0);
  });

  it("freeUpTo somma correttamente le posizioni libere", () => {
    const led = emptyLedger(CENA);
    led[0] = 10; led[1] = 13; led[2] = 4;
    expect(freeUpTo(led, 0)).toBe(3);
    expect(freeUpTo(led, 1)).toBe(3);
    expect(freeUpTo(led, 2)).toBe(12);
  });
});
