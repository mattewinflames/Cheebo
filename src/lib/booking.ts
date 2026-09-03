/* ============================================================================
   CHEEBO · Contratto di prenotazione online + risoluzione autoritativa del carrello
   ----------------------------------------------------------------------------
   Questo modulo è PURO (nessun Firebase, nessun DOM): lo usano sia il client —
   per COMPORRE la richiesta — sia la funzione serverless — per RICALCOLARE i
   prezzi dal menù reale. È il cuore della sicurezza del pagamento: il client
   manda solo COSA vuole (id, formato, quantità), mai QUANTO costa. Il totale e
   le righe Stripe si ricostruiscono qui, con gli stessi helper di `menu.ts`,
   partendo dai prezzi che stanno su Firestore. Così un client non può inviare
   `total: 0` e farsi dare la merce.
   ========================================================================== */

import {
  EXTRA, isPanino, isSpecialActive, cartLineOf, specialCartLine,
  cartItemStrings, cartPatties, cartTotal, cartSpecials,
  type MenuItem, type CartLine, type PaninoConfig, type CartReq,
} from "./menu.js";

/* Una riga del carrello come la manda il client: la CONFIGURAZIONE (da menu.ts)
   più la quantità. Nessun prezzo: lo decide il server. */
export type CartReqLine = CartReq & { qty: number };

export interface BookingReq {
  serviceKey: string;
  name: string;
  phone?: string;            // opzionale: non più raccolto lato cliente (#41)
  mode: "first" | "at";
  targetWindow?: number;     // richiesto se mode === "at"
  cart: CartReqLine[];
}

/** Riga per Stripe Checkout: importo in CENTESIMI (Stripe vuole gli interi). */
export interface StripeLine { name: string; amount: number; qty: number }

export interface ResolvedCart {
  lines: CartLine[];                    // righe autoritative (label, price, patty, qty, specialId?)
  items: string[];                      // etichette per la comanda
  total: number;                        // euro (solo prodotti, senza costo servizio)
  totalConServizio: number;             // euro (totale finale da pagare, con costo servizio se attivo)
  serviceCharge: number;               // euro (0 se non attivo)
  patties: number;
  specials: Record<string, number>;
  stripeLineItems: StripeLine[];
}

export type ResolveResult = ResolvedCart | { error: string };
export const isResolveError = (r: ResolveResult): r is { error: string } => "error" in r;

const MAX_QTY_PER_LINE = 99;

/** Ricostruisce il carrello dai prezzi del menù. Non si fida di nulla che venga
 *  dal client tranne la CONFIGURAZIONE (id, formato, tipo, quantità, opzioni). */
export function resolveCart(menu: MenuItem[], serviceKey: string, cart: CartReqLine[], serviceCharge = 0): ResolveResult {
  if (!Array.isArray(cart) || cart.length === 0) return { error: "carrello vuoto" };
  const byId = new Map(menu.map((m) => [m.id, m]));
  const lines: CartLine[] = [];

  for (const req of cart) {
    const q = Number(req.qty);
    if (!Number.isInteger(q) || q <= 0 || q > MAX_QTY_PER_LINE) return { error: `quantità non valida per «${req.itemId}»` };
    const item = byId.get(req.itemId);
    if (!item || !item.active) return { error: `voce non disponibile: «${req.itemId}»` };

    if (req.kind === "special") {
      if (!item.special || !isSpecialActive(item, serviceKey)) return { error: `special non proposto in questa sessione: «${req.itemId}»` };
      lines.push({ ...specialCartLine(item), qty: q });

    } else if (req.kind === "simple") {
      if (isPanino(item.type)) return { error: `«${req.itemId}» è un panino, non una voce semplice` };
      lines.push({ key: item.id, label: item.name, price: item.price ?? 0, patty: 0, qty: q });

    } else { // panino configurato
      if (!isPanino(item.type)) return { error: `«${req.itemId}» non è un panino` };
      if (item.special) return { error: `«${req.itemId}» è uno special: va ordinato come special, senza varianti` };
      if (!(req.format in { singolo: 1, doppio: 1, triplo: 1 })) return { error: `formato non valido: «${req.format}»` };
      const drink = req.type === "menu" && req.drinkId ? byId.get(req.drinkId) : undefined;
      if (req.type === "menu" && req.drinkId && (!drink || drink.type !== "drink" || !drink.active)) return { error: `bibita non valida: «${req.drinkId}»` };
      // extra: il prezzo viene SEMPRE dalla costante EXTRA, mai dal client; gli id ignoti si scartano
      const extras = (req.extras ?? [])
        .map((e) => { const def = EXTRA.find((x) => x.id === e.id); return def && e.q > 0 ? { ...def, q: Math.min(MAX_QTY_PER_LINE, Number(e.q) || 0) } : null; })
        .filter((e): e is NonNullable<typeof e> => e !== null);
      // swaps: solo gli id previsti dal panino (il filtro vero è dentro cartPrice via item.swaps)
      const swaps = (req.swaps ?? []).filter((id) => (item.swaps ?? []).some((s) => s.id === id));
      const cfg: PaninoConfig = { item, format: req.format, type: req.type, drink, extras, removed: req.removed, swaps, sideChoice: req.sideChoice };
      lines.push({ ...cartLineOf(cfg), qty: q });
    }
  }

  const total = cartTotal(lines);
  if (!(total > 0)) return { error: "totale non valido" };
  const charge = Math.round((serviceCharge ?? 0) * 100) / 100; // arrotonda a centesimi
  return {
    lines,
    items: cartItemStrings(lines),
    total,
    totalConServizio: Math.round((total + charge) * 100) / 100,
    serviceCharge: charge,
    patties: cartPatties(lines),
    specials: cartSpecials(lines),
    stripeLineItems: lines.map((l) => ({ name: l.label, amount: Math.round(l.price * 100), qty: l.qty })),
  };
}
