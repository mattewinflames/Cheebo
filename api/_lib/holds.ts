/* ============================================================================
   CHEEBO · Hold di prenotazione (collezione server-only `holds`)
   ----------------------------------------------------------------------------
   Un hold è la PRENOTAZIONE PROVVISORIA che tiene lo slot di piastra (e i pezzi
   di special) mentre il cliente è sul Checkout Nexi XPay. Vive solo lato server:
   nessun client la legge o la scrive (default-deny delle regole).

   Ciclo di vita:
     attesa  → creato da /api/create-booking, occupa ledger+stock, ha `expiresAt`
     pagato  → il webhook nexi-webhook (AUTHORIZED/EXECUTED) crea l'ordine vero
     scaduto → il webhook nexi-webhook (CANCELED/DECLINED/FAILED) rilascia slot

   ⚠️ `HOLD_MINUTES` è allineato alla durata tipica della sessione HPP Nexi.
   A differenza di Stripe (scadenza esplicita), Nexi invia CANCELED quando il
   cliente abbandona la pagina di pagamento.
   ========================================================================== */
import { Timestamp, FieldValue } from "./admin.js";

export const HOLD_MINUTES = 30;
export const HOLDS = "holds";
export const SESSIONS = "sessions";
export const ORDERS = "orders";
export const MENU = "menu";

/** Minuti oltre i quali un hold ancora in "attesa" è considerato abbandonato
 *  (il cliente ha chiuso la pagina di pagamento senza pagare né annullare).
 *  Deve superare HOLD_MINUTES: con 15 si liberavano hold ancora validi e chi
 *  pagava dopo 15 minuti otteneva un ordine non contato sulla piastra. */
export const STALE_MINUTES = HOLD_MINUTES + 5;

/** Pagamento arrivato DOPO che l'hold era stato rilasciato ("scaduto"): le sue
 *  celle e i suoi special erano stati restituiti. Patch (merge) per la sessione
 *  che li rioccupa, così l'ordine torna a pesare sulla piastra. Può portare una
 *  fascia oltre 13: è la verità (l'ordine è pagato) e il pannello la segnala. */
export function reoccupyPatch(hold: { cells?: number[]; specials?: Record<string, number> }): Record<string, unknown> {
  const ledger: Record<string, FirebaseFirestore.FieldValue> = {};
  const count = new Map<number, number>();
  for (const w of hold.cells ?? []) if (Number.isInteger(w) && w >= 0) count.set(w, (count.get(w) ?? 0) + 1);
  for (const [w, n] of count) ledger[String(w)] = FieldValue.increment(n);
  const stock: Record<string, FirebaseFirestore.FieldValue> = {};
  for (const [id, q] of Object.entries(hold.specials ?? {})) if (q > 0) stock[id] = FieldValue.increment(-q);
  return { ...(count.size ? { ledger } : {}), ...(Object.keys(stock).length ? { stock } : {}) };
}

/** L'hold in attesa è abbandonato? Stesso criterio del cron release-stale-holds. */
export function isStaleHold(createdAt: unknown, nowMs: number = Date.now()): boolean {
  const ms = createdAt && typeof (createdAt as { toMillis?: unknown }).toMillis === "function"
    ? (createdAt as Timestamp).toMillis() : NaN;
  return Number.isFinite(ms) && ms < nowMs - STALE_MINUTES * 60_000;
}

export type HoldStatus = "attesa" | "pagato" | "scaduto";

export interface Hold {
  serviceKey: string;
  cells: number[];                     // finestre piastra occupate (per rilasciarle)
  specials: Record<string, number>;    // pezzi di special impegnati, per id
  patties: number;
  windowIndex: number;
  readyMin: number;
  mode: "first" | "at";
  name: string;
  phone: string;
  items: string[];
  total: number;
  serviceCharge: number;
  status: HoldStatus;
  // Campi Nexi XPay
  nexiOrderId?: string;               // holdRef.id.slice(0,18) — chiave per trovare l'hold dal webhook
  nexiSecurityToken?: string;         // token per validare autenticità della notifica Nexi
  nexiCorrelationId?: string;         // UUID della richiesta HPP (per debug)
  nexiOperationId?: string;           // ID operazione Nexi (dopo conferma pagamento)
  orderId?: string;
  code?: number;
  expiresAt: Timestamp;
  createdAt?: unknown;
  condizioni?: string;                // versione delle condizioni di vendita accettate
}
