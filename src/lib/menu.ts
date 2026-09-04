/* ============================================================================
   CHEEBO · Struttura del menu (fissa) + helper
   ----------------------------------------------------------------------------
   TUTTE le voci (panini, sides, dolci, drinks) vivono su Firestore (./menuStore).
   Qui resta solo la STRUTTURA che non cambia: formati, extra, regola patty.
   ========================================================================== */

export type FormatId = "singolo" | "doppio" | "triplo";

export const FORMATS: Record<FormatId, { label: string; surcharge: number; patty: number }> = {
  singolo: { label: "Singolo", surcharge: 0, patty: 1 },
  doppio:  { label: "Doppio",  surcharge: 2, patty: 2 },
  triplo:  { label: "Triplo",  surcharge: 4, patty: 3 },
};
/** Valore della bibita compresa nel menu: le bibite che costano di più
 *  generano un sovrapprezzo pari alla differenza (salvo `menuSurcharge`). */
export const MENU_DRINK_INCLUDED = 2.5;

// Extra fissi (add-on del configuratore, non gestiti da Firestore)
export interface ExtraItem { id: string; name: string; price: number }
export const EXTRA: ExtraItem[] = [
  { id: "jalapenos", name: "Jalapenos", price: 1.0 },
  { id: "pickles",   name: "Pickles",   price: 1.0 },
  { id: "coleslaw",  name: "Coleslaw",  price: 1.0 },
  { id: "bacon",     name: "Bacon",     price: 1.5 },
  { id: "amcheese",  name: "American cheese", price: 1.5 },
];

// ---- Voce di menu (Firestore) ----
export type MenuType = "smash" | "burger" | "side" | "dolce" | "drink" | "salsa";
export const isPanino = (t: MenuType): boolean => t === "smash" || t === "burger";

export interface MenuItem {
  id: string;
  type: MenuType;
  name: string;
  active: boolean;
  order: number;
  // panini (smash | burger)
  desc?: string;
  solo?: number;
  menu?: number;
  veg?: boolean;
  griddle?: boolean; // occupa la piastra (13/10min). Se assente -> fallback su GRIDDLE_IDS
  allergens?: number[];
  /** Ingredienti togliibili. Se assente si ricava da `desc`, che è già scritta
   *  come elenco separato da virgole. */
  ingredients?: string[];
  /** Sostituzioni disponibili su questo panino (es. pane vegano). Sono
   *  alternative a un componente esistente, non aggiunte: per questo stanno
   *  in una sezione a sé e non fra gli extra. */
  swaps?: SwapOption[];
  /** Se true, il panino esiste solo nel formato singolo — non mostrare il formato nell'etichetta. */
  singleFormatOnly?: boolean;
  /** Proposta speciale a disponibilità limitata (vedi SpecialConfig). */
  special?: SpecialConfig;
  // voci semplici (side | dolce | drink)
  price?: number;
  /** Solo drink: sovrapprezzo se scelta dentro un menu. Se assente si ricava
   *  dalla differenza con MENU_DRINK_INCLUDED. */
  menuSurcharge?: number;
}

export type CartType = "panino" | "menu";

export function paninoPrice(p: { solo?: number; menu?: number }, format: FormatId, type: CartType, drinkSurcharge = 0): number {
  const base = (type === "menu" ? p.menu : p.solo) ?? 0;
  return base + FORMATS[format].surcharge + (type === "menu" ? drinkSurcharge : 0);
}

/** Ingredienti togliibili di un panino. Finché il cliente non fornisce l'elenco
 *  puntuale, si ricavano dalla descrizione, che è già un elenco di ingredienti
 *  separati da virgole. */
export const ingredientsOf = (item: { ingredients?: string[]; desc?: string }): string[] =>
  item.ingredients ?? (item.desc ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** Sovrapprezzo di una bibita scelta dentro un menu. */
export const menuDrinkSurcharge = (d: { menuSurcharge?: number; price?: number }): number =>
  d.menuSurcharge ?? Math.max(0, (d.price ?? 0) - MENU_DRINK_INCLUDED);
export const formatPatty = (format: FormatId): number => FORMATS[format].patty;

/* ----------------------------------------------------------------------------
   PIASTRA: un panino occupa la piastra (13 patty / 10 min) se il suo flag
   `griddle` è true. Il flag è editabile per voce dal pannello admin, così un
   hamburger temporaneo può essere marcato "da piastra" o no.
   Per le voci già esistenti che non hanno ancora il flag, si usa come fallback
   l'elenco storico dei tre smash di base.
   ---------------------------------------------------------------------------- */
export const GRIDDLE_IDS: ReadonlySet<string> = new Set(["classic", "oklahoma", "crispy"]);
export const occupiesGriddle = (item: { id: string; griddle?: boolean }): boolean =>
  item.griddle ?? GRIDDLE_IDS.has(item.id);
/** Patty che occupano la piastra per una riga configurata: 0 se non è un panino da piastra. */
export const griddlePatty = (item: { id: string; griddle?: boolean }, format: FormatId): number =>
  occupiesGriddle(item) ? FORMATS[format].patty : 0;

/** Sostituzione di un componente del panino (pane, formaggio…). */
export interface SwapOption { id: string; name: string; price?: number }

/* ----------------------------------------------------------------------------
   SPECIAL — proposta a disponibilità limitata, valida per sessioni precise.
   Lo stock è PER SESSIONE: ogni servizio riparte dal valore dichiarato qui e
   non si trascina (il cliente conferma che di norma si esaurisce in serata).
   Il conteggio residuo NON vive qui ma in `sessions/{serviceKey}.stock`, così
   il decremento avviene nella stessa transazione che riserva la piastra: è
   quello che impedisce di vendere 71 pezzi su 70.
   ---------------------------------------------------------------------------- */
export interface SpecialConfig {
  /** sessioni in cui è attivo, es. ["2026-07-30-Cena"] */
  serviceKeys: string[];
  /** pezzi disponibili per ogni sessione */
  stock: number;
}

/** Lo special è proposto in questa sessione? */
export const isSpecialActive = (item: MenuItem, serviceKey: string): boolean =>
  !!item.special && item.special.serviceKeys.includes(serviceKey);

/** Pezzi ancora disponibili, dato il registro della sessione. */
export function specialLeft(item: MenuItem, stock: Record<string, number> | undefined, serviceKey: string): number {
  if (!isSpecialActive(item, serviceKey)) return 0;
  const usati = stock?.[item.id];
  return usati === undefined ? item.special!.stock : Math.max(0, usati);
}

/** Soglia sotto la quale l'interfaccia passa al rosso ("ultimi pezzi"). */
export const SPECIAL_LOW = 10;

/** Configurazione serializzabile di una riga di carrello, per il ricalcolo
 *  autoritativo lato server (booking.ts la estende con la quantità). Porta COSA
 *  si vuole (id, formato, opzioni), MAI il prezzo: quello lo decide il server
 *  leggendo il menù. È ciò che il client invia a /api/create-booking (#40/#41). */
export type CartReq =
  | { kind: "panino"; itemId: string; format: FormatId; type: CartType; drinkId?: string; extras?: { id: string; q: number }[]; removed?: string[]; swaps?: string[]; sideChoice?: "normali" | "dolci" }
  | { kind: "special"; itemId: string }
  | { kind: "simple"; itemId: string };

export interface CartLine {
  key: string; label: string; price: number; patty: number; qty: number;
  /** se valorizzato, ogni unità consuma un pezzo dello stock di quello special */
  specialId?: string;
  /** configurazione da rimandare al server per ricalcolare il prezzo (#41) */
  req?: CartReq;
}

/** Pezzi di special impegnati dal carrello, per id. */
export function cartSpecials(lines: CartLine[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of lines) if (l.specialId && l.qty > 0) out[l.specialId] = (out[l.specialId] ?? 0) + l.qty;
  return out;
}

/* ----------------------------------------------------------------------------
   Configurazione di un panino: usata sia dal sito cliente sia dalla cassa.
   Chiave, etichetta e prezzo si costruiscono QUI e solo qui, così le due
   schermate non possono divergere.
   ---------------------------------------------------------------------------- */
export interface PaninoConfig {
  item: MenuItem;
  format: FormatId;
  type: CartType;
  /** bibita scelta nel menu (solo se type === "menu") */
  drink?: MenuItem;
  /** extra a pagamento, con quantità */
  extras?: { id: string; name: string; price: number; q: number }[];
  /** ingredienti tolti: non incidono su prezzo né patty */
  removed?: string[];
  /** id delle sostituzioni scelte, fra quelle previste dal panino */
  swaps?: string[];
  /** scelta del side nel menu: "normali" (default, nessun sovrapprezzo) o "dolci" (+1€) */
  sideChoice?: "normali" | "dolci";
}

/** Sovrapprezzo patate dolci nel menu. */
export const SIDE_DOLCI_SURCHARGE = 1.0;

const sig = (c: PaninoConfig) => ({
  ex: (c.extras ?? []).filter((e) => e.q > 0).sort((a, b) => a.id.localeCompare(b.id)),
  rm: [...(c.removed ?? [])].sort(),
  sw: (c.item.swaps ?? []).filter((s) => (c.swaps ?? []).includes(s.id)).sort((a, b) => a.id.localeCompare(b.id)),
});

/** Due righe con la stessa chiave sono lo stesso prodotto: si sommano. */
export function cartKey(c: PaninoConfig): string {
  const { ex, rm, sw } = sig(c);
  const drink = c.type === "menu" && c.drink ? c.drink.id : "";
  const side = c.type === "menu" ? (c.sideChoice ?? "normali") : "";
  return [c.item.id, c.format, c.type, drink,
          ex.map((e) => `${e.id}x${e.q}`).join(","), rm.join(","),
          sw.map((s) => s.id).join(","), side].join("|");
}

/** Etichetta leggibile in comanda. */
export function cartLabel(c: PaninoConfig): string {
  const { ex, rm, sw } = sig(c);
  let s = c.item.singleFormatOnly
    ? c.item.name
    : `${c.item.name} ${FORMATS[c.format].label.toLowerCase()}`;
  if (c.type === "menu") {
    s += ` · menu${c.drink ? ` con ${c.drink.name.toLowerCase()}` : ""}`;
    if (c.sideChoice === "dolci") s += " · patate dolci";
  }
  if (sw.length) s += " · con " + sw.map((x) => x.name.toLowerCase()).join(", ");
  if (ex.length) s += " + " + ex.map((e) => (e.q > 1 ? `${e.q}× ` : "") + e.name.toLowerCase()).join(", ");
  if (rm.length) s += " · senza " + rm.map((r) => r.toLowerCase()).join(", ");
  return s;
}

export function cartPrice(c: PaninoConfig): number {
  const surch = c.type === "menu" && c.drink ? menuDrinkSurcharge(c.drink) : 0;
  const ex = (c.extras ?? []).reduce((s, e) => s + e.price * e.q, 0);
  const sw = sig(c).sw.reduce((s, x) => s + (x.price ?? 0), 0);
  const side = c.type === "menu" && c.sideChoice === "dolci" ? SIDE_DOLCI_SURCHARGE : 0;
  return paninoPrice(c.item, c.format, c.type, surch) + ex + sw + side;
}

/** Riga di carrello pronta, con i patty già calcolati sulla regola piastra. */
export const cartLineOf = (c: PaninoConfig): Omit<CartLine, "qty"> => ({
  key: cartKey(c), label: cartLabel(c), price: cartPrice(c),
  patty: griddlePatty(c.item, c.format),
  ...(c.item.special ? { specialId: c.item.id } : {}),
  req: {
    kind: "panino", itemId: c.item.id, format: c.format, type: c.type,
    ...(c.type === "menu" && c.drink ? { drinkId: c.drink.id } : {}),
    ...(c.extras && c.extras.some((e) => e.q > 0) ? { extras: c.extras.filter((e) => e.q > 0).map((e) => ({ id: e.id, q: e.q })) } : {}),
    ...(c.removed && c.removed.length ? { removed: c.removed } : {}),
    ...(c.swaps && c.swaps.length ? { swaps: c.swaps } : {}),
    ...(c.type === "menu" && c.sideChoice ? { sideChoice: c.sideChoice } : {}),
  },
});

/* ----------------------------------------------------------------------------
   Riga di carrello di uno SPECIAL. Lo special vive "fuori menù": niente
   formato, tipo, extra o sostituzioni — si aggiunge e basta, a prezzo fisso.
   Il prezzo è il `solo` (l'unico che ha senso su una voce senza versione menu);
   occupa la piastra soltanto se marcato `griddle`, esattamente come un panino.
   Chiave dedicata (`id|special`) così non si confonde mai con una riga
   configurata dello stesso id.
   ---------------------------------------------------------------------------- */
export const specialCartLine = (item: MenuItem): Omit<CartLine, "qty"> => ({
  key: `${item.id}|special`,
  label: item.name,
  price: item.solo ?? 0,
  patty: griddlePatty(item, "singolo"),
  specialId: item.id,
  req: { kind: "special", itemId: item.id },
});

export const cartPatties = (lines: CartLine[]): number => lines.reduce((s, l) => s + l.patty * l.qty, 0);
export const cartTotal = (lines: CartLine[]): number => lines.reduce((s, l) => s + l.price * l.qty, 0);
export const cartItemStrings = (lines: CartLine[]): string[] =>
  lines.filter((l) => l.qty > 0).map((l) => (l.qty > 1 ? `${l.qty}× ${l.label}` : l.label));
export const euro = (n: number): string => (Number(n) || 0).toFixed(2).replace(".", ",") + "€";
