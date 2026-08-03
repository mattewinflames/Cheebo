/* ============================================================================
   CHEEBO · Hold di prenotazione (collezione server-only `holds`)
   ----------------------------------------------------------------------------
   Un hold è la PRENOTAZIONE PROVVISORIA che tiene lo slot di piastra (e i pezzi
   di special) mentre il cliente è sul Checkout Stripe. Vive solo lato server:
   nessun client la legge o la scrive (default-deny delle regole).

   Ciclo di vita:
     attesa  → creato da /api/create-booking, occupa ledger+stock, ha `expiresAt`
     pagato  → il webhook `checkout.session.completed` crea l'ordine vero e lo chiude
     scaduto → il webhook `checkout.session.expired` rilascia ledger+stock

   ⚠️ `HOLD_MINUTES` è allineato alla scadenza della sessione Stripe (minimo 30').
   Tenerlo uguale evita il caso "pagato dopo il rilascio": Stripe non lascia
   completare una sessione scaduta, e noi non rilasciamo prima della scadenza.
   Abbassarlo sotto i 30' reintroduce quel caso (vedi backlog).
   ========================================================================== */
import { Timestamp } from "./admin";

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
  stripeSessionId?: string;
  orderId?: string;
  code?: number;
  expiresAt: Timestamp;
  createdAt?: unknown;
}
