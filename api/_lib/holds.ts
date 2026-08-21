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
import { Timestamp } from "./admin.js";

export const HOLD_MINUTES = 30;
export const HOLDS = "holds";
export const SESSIONS = "sessions";
export const ORDERS = "orders";
export const MENU = "menu";

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
}
