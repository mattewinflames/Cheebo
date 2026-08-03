/* ============================================================================
   CHEEBO · Motore di smistamento PER-FINESTRA  (puro, senza dipendenze)
   ----------------------------------------------------------------------------
   La piastra produce CAP patty ogni finestra da WINDOW_MIN minuti.
   La capacità è tracciata finestra per finestra (un "registro"), così gli slot
   a scelta possono lasciare buchi senza rompere i conti.

   - Primo disponibile -> planFirst: riempie le prime posizioni libere; consegna
     nella finestra dell'ultimo patty (= orario più vicino possibile).
   - Orario scelto T   -> planAt: riempie a ritroso da T (si cuoce vicino al
     ritiro); fattibile se c'è abbastanza spazio nelle finestre <= T.
   ========================================================================== */

export const CAP = 13;
export const WINDOW_MIN = 10;

export interface Service {
  label?: string;
  startMin: number; // minuti da mezzanotte (19:30 -> 1170)
  endMin: number;   // 24:00 -> 1440
}

export type Ledger = number[]; // patty occupati per finestra

export const totalWindows = (s: Service): number =>
  Math.floor((s.endMin - s.startMin) / WINDOW_MIN);

export const emptyLedger = (s: Service): Ledger => new Array(totalWindows(s)).fill(0);

/** Registro finestra→patty: mappa sparsa (com'è su Firestore) → array denso di n celle. */
export const ledgerFromMap = (map: Record<string, number> | undefined, n: number): Ledger => {
  const led = new Array(n).fill(0);
  if (map) for (const [k, v] of Object.entries(map)) { const i = Number(k); if (i >= 0 && i < n) led[i] = v; }
  return led;
};
/** Array denso → mappa sparsa (solo le finestre non vuote), come si salva su Firestore. */
export const ledgerToMap = (led: Ledger): Record<string, number> => {
  const map: Record<string, number> = {};
  led.forEach((v, i) => { if (v > 0) map[String(i)] = v; });
  return map;
};

export const windowStartMin = (s: Service, w: number): number => s.startMin + w * WINDOW_MIN;
export const windowEndMin = (s: Service, w: number): number => windowStartMin(s, w) + WINDOW_MIN;

/** Posizioni libere cumulate dalla finestra 0 fino a T inclusa. */
export function freeUpTo(ledger: Ledger, T: number): number {
  let f = 0;
  for (let w = 0; w <= T && w < ledger.length; w++) f += CAP - ledger[w];
  return f;
}

/** Prima finestra in cui un ordine da `patties` può essere pronto (>= patties posti liberi fino a lì). */
export function firstFeasibleWindow(ledger: Ledger, patties: number): number {
  const n = ledger.length;
  for (let T = 0; T < n; T++) if (freeUpTo(ledger, T) >= patties) return T;
  return -1;
}

export interface Placement {
  ok: boolean;
  windowIndex: number; // finestra di consegna (-1 se non fattibile)
  readyMin: number;    // fine finestra di consegna
  cells: number[];     // finestre occupate, una per patty
  tranches: number;    // numero di finestre distinte attraversate
}

const tranchesOf = (cells: number[]): number => (cells.length ? new Set(cells).size : 1);

/** Primo disponibile: riempie in avanti le prime posizioni libere. */
export function planFirst(ledger: Ledger, patties: number, s: Service): Placement {
  const n = ledger.length;
  if (patties <= 0) {
    return { ok: n > 0, windowIndex: 0, readyMin: windowEndMin(s, 0), cells: [], tranches: 1 };
  }
  const cells: number[] = [];
  for (let w = 0; w < n && cells.length < patties; w++) {
    let free = CAP - ledger[w];
    while (free-- > 0 && cells.length < patties) cells.push(w);
  }
  if (cells.length < patties) return { ok: false, windowIndex: -1, readyMin: -1, cells: [], tranches: 0 };
  const windowIndex = cells[cells.length - 1];
  return { ok: true, windowIndex, readyMin: windowEndMin(s, windowIndex), cells, tranches: tranchesOf(cells) };
}

/** Orario scelto: pronto ENTRO la finestra target. Riempie a ritroso da target. */
export function planAt(ledger: Ledger, patties: number, target: number, s: Service): Placement {
  const n = ledger.length;
  if (target < 0 || target >= n) return { ok: false, windowIndex: -1, readyMin: -1, cells: [], tranches: 0 };
  if (patties <= 0) return { ok: true, windowIndex: target, readyMin: windowEndMin(s, target), cells: [], tranches: 1 };
  if (freeUpTo(ledger, target) < patties) return { ok: false, windowIndex: -1, readyMin: -1, cells: [], tranches: 0 };
  const cells: number[] = [];
  for (let w = target; w >= 0 && cells.length < patties; w--) {
    let free = CAP - ledger[w];
    while (free-- > 0 && cells.length < patties) cells.push(w);
  }
  return { ok: true, windowIndex: target, readyMin: windowEndMin(s, target), cells, tranches: tranchesOf(cells) };
}

/** Applica un piazzamento: ritorna un NUOVO registro aggiornato (immutabile). */
export function applyPlacement(ledger: Ledger, p: Placement): Ledger {
  const next = ledger.slice();
  for (const w of p.cells) next[w] += 1;
  return next;
}

/** Gli orari prenotabili per un ordine da `patties`: dalla prima finestra fattibile in poi. */
export function bookableWindows(ledger: Ledger, patties: number): number[] {
  const ff = firstFeasibleWindow(ledger, patties);
  if (ff < 0) return [];
  const out: number[] = [];
  for (let T = ff; T < ledger.length; T++) out.push(T);
  return out;
}

export const fmt = (min: number): string => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
