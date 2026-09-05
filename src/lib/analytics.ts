/**
 * analytics.ts — Logica di calcolo per la dashboard Stats.
 *
 * Funzioni pure, nessuna dipendenza React, nessuna query Firestore.
 * Riceve gli ordini già caricati e restituisce strutture pronte per la UI.
 *
 * Formato items (da cartLabel):
 *   "Classic doppio · menu con coca-cola · patate dolci + bacon · senza cipolla"
 *   "2× Tender di pollo"
 *   "Salsa Cheebo"
 *   "Patatine fritte"
 */

import type { Order } from "./orders";

/* ─────────────────────────────── COSTANTI ────────────────────────────────── */

const FORMATO_RE = /\b(singolo|doppio|triplo)\b/i;
const QTY_RE = /^(\d+)[×x]\s+/;
const MENU_RE = /·\s*menu\b/i;
const DRINK_RE = /·\s*menu con (.+?)(?:\s*·|$)/i;
const PATATE_DOLCI_RE = /·\s*patate dolci\b/i;
const EXTRA_RE = /\+\s*(.+?)(?:\s*·|$)/;
const SENZA_RE = /·\s*senza\s+(.+?)(?:\s*·|$)/;
const CON_RE = /·\s*con\s+(.+?)(?:\s*·|$)/;

/** Nomi di item che NON sono panini ma appaiono nella stessa lista. */
const NON_PANINI = new Set([
  "tender di pollo", "patatine fritte", "patate dolci", "patatine",
  "nutellone", "cookies", "polpette di trippa",
  "coca-cola", "coca-cola zero", "fanta", "sprite", "acqua naturale",
  "iced tea artigianale", "birra artigianale",
  "salsa cheebo", "salsa agrodolce piccante", "ketchup heinz",
  "maionese heinz", "honey mustard heinz", "bbq heinz",
  "agrodolce heinz", "curry mango heinz",
]);

const SALSE = new Set([
  "salsa cheebo", "salsa agrodolce piccante", "ketchup heinz",
  "maionese heinz", "honey mustard heinz", "bbq heinz",
  "agrodolce heinz", "curry mango heinz",
]);

/* ─────────────────────────────── DATE UTILS ──────────────────────────────── */

/** Restituisce "YYYY-MM-DD" da un Date senza problemi di timezone. */
export function localISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Aggiunge `days` giorni a una stringa "YYYY-MM-DD". */
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return localISODate(d);
}

/** Differenza in giorni tra due "YYYY-MM-DD" (to - from, inclusivo). */
export function daySpan(from: string, to: string): number {
  const ms = new Date(to + "T12:00:00").getTime() - new Date(from + "T12:00:00").getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** Calcola il periodo precedente equivalente. */
export function prevPeriod(from: string, to: string): { from: string; to: string } {
  const span = daySpan(from, to);
  return {
    from: addDays(from, -span),
    to:   addDays(from, -1),
  };
}

/* ─────────────────────────────── PARSER ITEMS ────────────────────────────── */

export interface ParsedItem {
  rawName: string;       // nome pulito (senza qty, senza modificatori)
  qty: number;
  isPanino: boolean;
  isMenu: boolean;
  isSalsa: boolean;
  isSide: boolean;       // side non-panino (patatine, tender, dolci…)
  drink?: string;        // bibita nel menu
  sideChoice?: "normali" | "dolci";
  extras: string[];      // es. ["bacon", "cheddar"]
  swaps: string[];       // sostituzioni (con X)
  removed: string[];     // senza X
  formato?: string;      // singolo | doppio | triplo
}

export function parseItem(raw: string): ParsedItem {
  // Gestisci quantità prefissata "2× "
  const qtyMatch = raw.match(QTY_RE);
  const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
  const text = qtyMatch ? raw.slice(qtyMatch[0].length) : raw;

  // Nome base = prima parte prima di "·"
  const namePart = text.split("·")[0].trim();
  const rawName = namePart;
  const lower = rawName.toLowerCase();

  const isPanino = !NON_PANINI.has(lower) && (
    FORMATO_RE.test(lower) ||
    lower.includes("smash") || lower.includes("burger") ||
    lower.includes("chicken") || lower.includes("pulled") || lower.includes("burgerveg")
  );
  const isSalsa = SALSE.has(lower);
  const isSide = !isPanino && !isSalsa && (
    lower.includes("patatine") || lower.includes("patate") ||
    lower.includes("tender") || lower.includes("nutellone") ||
    lower.includes("cookies") || lower.includes("polpette")
  );
  const isMenu = MENU_RE.test(text);
  const sideChoice: "normali" | "dolci" | undefined =
    isMenu ? (PATATE_DOLCI_RE.test(text) ? "dolci" : "normali") : undefined;

  const drinkMatch = text.match(DRINK_RE);
  const drink = drinkMatch
    ? drinkMatch[1].split("·")[0].replace(/patate dolci/i, "").trim()
    : undefined;

  const extraMatch = text.match(EXTRA_RE);
  const extras = extraMatch
    ? extraMatch[1].split(",").map(s => s.trim().replace(/^\d+[×x]\s*/, "")).filter(Boolean)
    : [];

  const conMatch = text.match(CON_RE);
  const swaps = conMatch && !DRINK_RE.test("· con " + conMatch[1])
    ? conMatch[1].split(",").map(s => s.trim()).filter(Boolean)
    : [];

  const senzaMatch = text.match(SENZA_RE);
  const removed = senzaMatch
    ? senzaMatch[1].split(",").map(s => s.trim()).filter(Boolean)
    : [];

  const formatoMatch = lower.match(FORMATO_RE);
  const formato = formatoMatch ? formatoMatch[1].toLowerCase() : undefined;

  return { rawName, qty, isPanino, isMenu, isSalsa, isSide, drink, sideChoice, extras, swaps, removed, formato };
}

/* ─────────────────────────────── VALIDITÀ ────────────────────────────────── */

/**
 * Tutti gli ordini con status "nuovo", "in_consegna" o "consegnato" sono validi.
 * Nel modello attuale non esiste "cancellato" o "rimborsato".
 */
export function isValidAnalyticsOrder(o: Order): boolean {
  return !!o.total && o.total > 0;
}

/* ─────────────────────────────── TIPI OUTPUT ─────────────────────────────── */

export interface RankedItem { name: string; qty: number; pct: number }

export interface DayPoint {
  date: string;       // "YYYY-MM-DD"
  label: string;      // "30 ago"
  fat: number;
  ord: number;
  avg: number;
  prevFat?: number;   // stesso giorno settimana precedente se disponibile
}

export interface SlotPoint { label: string; count: number; pct: number }

export interface DowPoint {
  label: string;      // "Lun"
  fat: number;
  ord: number;
  avg: number;
  prevFat?: number;   // stesso giorno della settimana nel periodo precedente
  prevOrd?: number;
}

export interface Analytics {
  // Metadati
  ordini: number;
  fatturato: number;
  scontrinoMedio: number;
  quotaMenu: number;          // 0–1

  // Confronto periodo precedente (undefined se non ci sono dati)
  prevOrdini?: number;
  prevFatturato?: number;
  prevScontrinoMedio?: number;
  prevQuotaMenu?: number;

  // Prodotti
  topPanini: RankedItem[];
  topExtras: RankedItem[];
  topSalse: RankedItem[];
  topBibite: RankedItem[];

  // Patatine (solo menu)
  menuTot: number;            // ordini-menu totali
  pateDolciCount: number;

  // Orari
  slotRitiro: SlotPoint[];
  oraPunta: string | null;    // "20:00"
  fasciaPunta: string | null; // "19:30–20:30 (47%)"

  // Giorno settimana
  byDow: DowPoint[];

  // Trend giornaliero
  trend: DayPoint[];
}

/* ─────────────────────────────── CALCOLO ─────────────────────────────── */

const MESI = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"];
const DOW_SHORT = ["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
const DOW_ORDER = [1,2,3,4,5,6,0]; // Lun→Dom

function fmtMin(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2,"0")}:${String(min % 60).padStart(2,"0")}`;
}

function dateLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return `${d.getDate()} ${MESI[d.getMonth()]}`;
}

function ranked(map: Map<string, number>, total: number, n = 5): RankedItem[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, qty]) => ({ name, qty, pct: total > 0 ? qty / total : 0 }));
}

function aggregateOrders(orders: Order[]) {
  const valid = orders.filter(isValidAnalyticsOrder);

  const fatturato = valid.reduce((s, o) => s + (o.total ?? 0), 0);
  const ordini    = valid.length;
  const scontrinoMedio = ordini > 0 ? fatturato / ordini : 0;

  const panini  = new Map<string, number>();
  const extras  = new Map<string, number>();
  const salse   = new Map<string, number>();
  const bibite  = new Map<string, number>();
  const slots   = new Map<number, number>();
  const dowFat  = new Map<number, number>();
  const dowOrd  = new Map<number, number>();
  const dayFat  = new Map<string, number>();
  const dayOrd  = new Map<string, number>();

  let menuOrdini = 0, menuTot = 0, pateDolci = 0;

  for (const o of valid) {
    const dateKey = o.serviceKey.slice(0, 10);
    const dow = new Date(dateKey + "T12:00:00").getDay();

    dayFat.set(dateKey, (dayFat.get(dateKey) ?? 0) + (o.total ?? 0));
    dayOrd.set(dateKey, (dayOrd.get(dateKey) ?? 0) + 1);
    dowFat.set(dow, (dowFat.get(dow) ?? 0) + (o.total ?? 0));
    dowOrd.set(dow, (dowOrd.get(dow) ?? 0) + 1);

    if (o.readyMin) {
      const slot = Math.floor(o.readyMin / 10) * 10;
      slots.set(slot, (slots.get(slot) ?? 0) + 1);
    }

    let hasMenu = false;
    for (const raw of o.items ?? []) {
      const p = parseItem(raw);
      const n = p.qty;

      if (p.isPanino) {
        const key = p.rawName;
        panini.set(key, (panini.get(key) ?? 0) + n);
        if (p.isMenu) { hasMenu = true; menuTot += n; if (p.sideChoice === "dolci") pateDolci += n; }
        if (p.drink) {
          const d = p.drink.trim();
          if (d) bibite.set(d, (bibite.get(d) ?? 0) + n);
        }
        for (const ex of p.extras) extras.set(ex, (extras.get(ex) ?? 0) + n);
      }
      if (p.isSalsa) salse.set(p.rawName, (salse.get(p.rawName) ?? 0) + n);
      // Extra da items non-panino (es. "+ bacon" standalone — raro ma possibile)
      for (const ex of p.extras) extras.set(ex, (extras.get(ex) ?? 0) + n);
    }
    if (hasMenu) menuOrdini++;
  }

  return { fatturato, ordini, scontrinoMedio, menuOrdini, menuTot, pateDolci,
           panini, extras, salse, bibite, slots, dowFat, dowOrd, dayFat, dayOrd };
}

export function computeAnalytics(
  orders: Order[],
  prevOrders: Order[],
  from: string,
  to: string,
): Analytics {
  const cur  = aggregateOrders(orders);
  const prev = aggregateOrders(prevOrders);

  // ── Slot orari ──
  const slotEntries = [...cur.slots.entries()].sort((a, b) => a[0] - b[0]);
  const totalSlot = slotEntries.reduce((s, [, c]) => s + c, 0);
  const slotRitiro: SlotPoint[] = slotEntries.map(([min, count]) => ({
    label: fmtMin(min),
    count,
    pct: totalSlot > 0 ? count / totalSlot : 0,
  }));

  const puntaEntry = slotEntries.reduce<[number,number] | null>(
    (best, e) => (!best || e[1] > best[1] ? e : best), null
  );
  const oraPunta = puntaEntry ? fmtMin(puntaEntry[0]) : null;

  // Fascia di un'ora con più ordini
  let bestFasciaStart = 0, bestFasciaCount = 0;
  for (const [min] of slotEntries) {
    const fasciaCount = slotEntries
      .filter(([m]) => m >= min && m < min + 60)
      .reduce((s, [, c]) => s + c, 0);
    if (fasciaCount > bestFasciaCount) { bestFasciaCount = fasciaCount; bestFasciaStart = min; }
  }
  const fasciaPunta = bestFasciaCount > 0
    ? `${fmtMin(bestFasciaStart)}–${fmtMin(bestFasciaStart + 60)} (${Math.round(bestFasciaCount / totalSlot * 100)}%)`
    : null;

  // ── Giorno settimana ──
  const byDow: DowPoint[] = DOW_ORDER.map(d => ({
    label: DOW_SHORT[d],
    fat: Math.round((cur.dowFat.get(d) ?? 0) * 100) / 100,
    ord: cur.dowOrd.get(d) ?? 0,
    avg: (cur.dowOrd.get(d) ?? 0) > 0
      ? Math.round((cur.dowFat.get(d) ?? 0) / (cur.dowOrd.get(d) ?? 1) * 100) / 100
      : 0,
    prevFat: prev.ordini > 0 ? Math.round((prev.dowFat.get(d) ?? 0) * 100) / 100 : undefined,
    prevOrd: prev.ordini > 0 ? (prev.dowOrd.get(d) ?? 0) : undefined,
  }));

  // ── Trend giornaliero ──
  // Genera tutti i giorni nel range
  const trend: DayPoint[] = [];
  let cursor = from;
  while (cursor <= to) {
    const fat = Math.round((cur.dayFat.get(cursor) ?? 0) * 100) / 100;
    const ord = cur.dayOrd.get(cursor) ?? 0;
    trend.push({
      date: cursor,
      label: dateLabel(cursor),
      fat,
      ord,
      avg: ord > 0 ? Math.round(fat / ord * 100) / 100 : 0,
    });
    cursor = addDays(cursor, 1);
  }

  const pctMenu = (o: typeof cur) => o.ordini > 0 ? o.menuOrdini / o.ordini : 0;

  return {
    ordini:         cur.ordini,
    fatturato:      Math.round(cur.fatturato * 100) / 100,
    scontrinoMedio: Math.round(cur.scontrinoMedio * 100) / 100,
    quotaMenu:      pctMenu(cur),

    prevOrdini:         prev.ordini > 0 ? prev.ordini : undefined,
    prevFatturato:      prev.ordini > 0 ? Math.round(prev.fatturato * 100) / 100 : undefined,
    prevScontrinoMedio: prev.ordini > 0 ? Math.round(prev.scontrinoMedio * 100) / 100 : undefined,
    prevQuotaMenu:      prev.ordini > 0 ? pctMenu(prev) : undefined,

    topPanini: ranked(cur.panini, cur.ordini, 8),
    topExtras: ranked(cur.extras, cur.ordini),
    topSalse:  ranked(cur.salse,  cur.ordini),
    topBibite: ranked(cur.bibite, cur.ordini),

    menuTot:        cur.menuTot,
    pateDolciCount: cur.pateDolci,

    slotRitiro,
    oraPunta,
    fasciaPunta,
    byDow,
    trend,
  };
}
