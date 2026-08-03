/* ============================================================================
   CHEEBO · Data layer ordini (Firestore, registro per-finestra)
   ----------------------------------------------------------------------------
   sessions/{serviceKey} = { label, startMin, endMin, ledger:{idx:used}, updatedAt }
   orders/{id}           = { serviceKey, name, items[], patties, windowIndex,
                             readyMin, mode, pay, status, createdAt }

   La prenotazione è TRANSAZIONALE: legge il registro, pianifica lo slot,
   scrive ordine + aggiorna il registro in un colpo solo -> niente
   sovrapposizioni, la priorità di chi è prima è garantita dalla transazione.
   (Il soft-hold della Fase 5 si innesta qui, come prenotazione a scadenza.)
   ========================================================================== */

import {
  collection, doc, onSnapshot, query, where,
  runTransaction, updateDoc, serverTimestamp, getDocs, writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Service } from "./dispatch";
import { totalWindows, planFirst, planAt, ledgerFromMap, ledgerToMap, type Placement } from "./dispatch";
import type { BookingReq } from "./booking";

export type OrderStatus = "nuovo" | "in_consegna" | "consegnato";
export type PayMethod = "loco" | "online";

/* Metodi di pagamento attivi sul sito cliente.
   Su richiesta del cliente il pagamento in loco è disattivato: si paga solo online.
   Per riattivarlo basta rimettere "loco" in questo array — il resto del codice si adegua.
   Il tipo PayMethod mantiene "loco" perché gli ordini storici su Firestore lo usano. */
export const PAY_ENABLED: readonly PayMethod[] = ["online"];
export const PAY_DEFAULT: PayMethod | null = PAY_ENABLED.length === 1 ? PAY_ENABLED[0] : null;
export type BookingMode = "first" | "at";

/* Canale di provenienza dell'ordine. Entrambi consumano LO STESSO registro di
   piastra: è questo che rende la capacità reale invece che una stima.
   Gli ordini storici non hanno il campo -> si assumono "prenotazione". */
export type OrderChannel = "prenotazione" | "banco";
/* Come è stato incassato al banco. NB: NON ha valore fiscale — il documento
   commerciale resta in carico al registratore telematico del locale. */
export type Tender = "contanti" | "carta";

export interface Order {
  id: string;
  serviceKey: string;
  name: string;
  items: string[];
  patties: number;
  windowIndex: number;
  readyMin: number;
  mode: BookingMode;
  pay: PayMethod;
  total: number;
  code: number;
  phone: string;
  status: OrderStatus;
  channel?: OrderChannel;
  tender?: Tender;
}

export interface BookingInput {
  serviceKey: string;
  service: Service;
  name: string;
  items: string[];
  patties: number;
  mode: BookingMode;
  targetWindow?: number; // richiesto se mode === "at"
  pay: PayMethod;
  total: number;
  phone: string;
  channel?: OrderChannel;
  tender?: Tender;
  /** pezzi di special impegnati, per id voce di menù (da `cartSpecials`) */
  specials?: Record<string, number>;
}

export type BookingResult =
  | { ok: true; windowIndex: number; readyMin: number; tranches: number; proposedDifferent: boolean; code: number }
  | { ok: false; reason: "full" }
  /** uno special non è più disponibile: `left` è quanto ne resta davvero */
  | { ok: false; reason: "special"; itemId: string; left?: number };

/** Prenota in transazione. Ritorna lo slot assegnato (o full). */
export async function submitBooking(input: BookingInput): Promise<BookingResult> {
  const n = totalWindows(input.service);
  const sRef = doc(db, "sessions", input.serviceKey);
  const oRef = doc(collection(db, "orders"));

  const richiesti = Object.entries(input.specials ?? {}).filter(([, q]) => q > 0);

  return runTransaction(db, async (tx) => {
    // --- LETTURE (Firestore le vuole tutte prima delle scritture) ---
    const snap = await tx.get(sRef);
    const data = snap.exists() ? snap.data() : undefined;
    const led = ledgerFromMap(data?.ledger as Record<string, number> | undefined, n);

    /* Stock degli special: il valore di partenza si legge dal MENÙ, non da ciò
       che manda il browser. È il punto che impedisce a un client di dichiarare
       "ne restano 9999": il menù è scrivibile solo dall'admin. */
    const stockCorrente = (data?.stock as Record<string, number> | undefined) ?? {};
    const stockNuovo: Record<string, number> = { ...stockCorrente };

    for (const [itemId, q] of richiesti) {
      const mSnap = await tx.get(doc(db, "menu", itemId));
      const sp = mSnap.exists() ? (mSnap.data().special as { serviceKeys?: string[]; stock?: number } | undefined) : undefined;

      // non è uno special, o non è proposto in questa sessione
      if (!sp || !(sp.serviceKeys ?? []).includes(input.serviceKey))
        return { ok: false, reason: "special", itemId } as BookingResult;

      const rimasti = stockCorrente[itemId] ?? sp.stock ?? 0;
      if (rimasti < q) return { ok: false, reason: "special", itemId, left: rimasti } as BookingResult;
      stockNuovo[itemId] = rimasti - q;
    }

    let plan: Placement;
    let proposedDifferent = false;
    if (input.mode === "at" && input.targetWindow != null) {
      plan = planAt(led, input.patties, input.targetWindow, input.service);
      if (!plan.ok) { plan = planFirst(led, input.patties, input.service); proposedDifferent = true; }
    } else {
      plan = planFirst(led, input.patties, input.service);
    }
    if (!plan.ok) return { ok: false, reason: "full" } as BookingResult;

    // codice di ritiro: progressivo per servizio (atomico nella transazione)
    const code = ((data?.seq as number) ?? 0) + 1;

    // aggiorna il registro
    for (const w of plan.cells) led[w] += 1;
    const ledgerUpdate = ledgerToMap(led);

    tx.set(sRef, {
      label: input.service.label ?? "", startMin: input.service.startMin, endMin: input.service.endMin,
      ledger: ledgerUpdate, seq: code, updatedAt: serverTimestamp(),
      ...(Object.keys(stockNuovo).length ? { stock: stockNuovo } : {}),
    }, { merge: true });

    tx.set(oRef, {
      serviceKey: input.serviceKey, name: input.name, items: input.items, patties: input.patties,
      windowIndex: plan.windowIndex, readyMin: plan.readyMin, mode: input.mode, pay: input.pay,
      total: input.total, code, phone: input.phone,
      channel: input.channel ?? "prenotazione",
      ...(input.tender ? { tender: input.tender } : {}),
      status: "nuovo" as OrderStatus, createdAt: serverTimestamp(),
    });

    return { ok: true, windowIndex: plan.windowIndex, readyMin: plan.readyMin, tranches: plan.tranches, proposedDifferent, code };
  });
}

/** Registro della sessione in tempo reale (per il cliente: calcola gli slot liberi).
 *  Il secondo argomento del callback porta lo stock degli special, che vive nello
 *  stesso documento: così non serve una seconda sottoscrizione. */
export function subscribeLedger(
  serviceKey: string,
  n: number,
  cb: (ledger: number[], stock: Record<string, number>) => void,
  onError?: (e: Error) => void,
): () => void {
  return onSnapshot(
    doc(db, "sessions", serviceKey),
    (snap) => {
      const d = snap.exists() ? snap.data() : undefined;
      cb(ledgerFromMap(d?.ledger as Record<string, number> | undefined, n),
         (d?.stock as Record<string, number> | undefined) ?? {});
    },
    (err) => { console.error("[Cheebo] subscribeLedger", err); onError?.(err as Error); },
  );
}

/** Ordini di una sessione in tempo reale (per l'admin).
 *  Query a CAMPO SINGOLO (serviceKey) + ordinamento lato client: così non serve
 *  alcun indice composito (fonte tipica di "la lista resta vuota" in produzione)
 *  e nessun ordine resta nascosto se `createdAt` è ancora pending.
 *  `onError` fa EMERGERE eventuali problemi (permessi, rete) invece di ingoiarli. */
export function subscribeOrders(
  serviceKey: string,
  cb: (orders: Order[]) => void,
  onError?: (e: Error) => void,
): () => void {
  const q = query(collection(db, "orders"), where("serviceKey", "==", serviceKey));
  return onSnapshot(
    q,
    (snap) => {
      const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as (Order & { createdAt?: { toMillis?: () => number } })[];
      orders.sort((a, b) => {
        const ta = a.createdAt?.toMillis?.() ?? 0;
        const tb = b.createdAt?.toMillis?.() ?? 0;
        return ta !== tb ? ta - tb : (a.code ?? 0) - (b.code ?? 0);
      });
      cb(orders as Order[]);
    },
    (err) => { console.error("[Cheebo] subscribeOrders", err); onError?.(err as Error); },
  );
}

export async function setStatus(id: string, status: OrderStatus): Promise<void> {
  await updateDoc(doc(db, "orders", id), { status });
}

/* ----------------------------------------------------------------------------
   SOLO TEST — azzera una sessione: cancella tutti gli ordini e svuota il
   registro della piastra. Da RIMUOVERE in produzione (vedi pulsante "Pulisci").
   ---------------------------------------------------------------------------- */
export async function clearSession(serviceKey: string): Promise<number> {
  const snap = await getDocs(query(collection(db, "orders"), where("serviceKey", "==", serviceKey)));
  const batch = writeBatch(db);
  snap.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, "sessions", serviceKey)); // azzera il registro -> piastra vuota
  await batch.commit();
  return snap.size;
}

/* ----------------------------------------------------------------------------
   Checkout online (#41): la prenotazione del CLIENTE passa dal server, non più
   da una transazione lato client. Manda la configurazione a /api/create-booking
   (che ricalcola i prezzi, occupa lo slot con un hold e apre Stripe) e torna
   l'URL a cui reindirizzare. La conferma vera arriva dal webhook, non da qui.
   ---------------------------------------------------------------------------- */
export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string; itemId?: string; left?: number };

export async function startCheckout(req: BookingReq): Promise<CheckoutResult> {
  try {
    const r = await fetch("/api/create-booking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    const data = await r.json().catch(() => ({} as Record<string, unknown>));
    if (r.ok && typeof data?.url === "string") return { ok: true, url: data.url };
    return {
      ok: false,
      error: typeof data?.error === "string" ? data.error : "Errore imprevisto",
      itemId: typeof data?.itemId === "string" ? data.itemId : undefined,
      left: typeof data?.left === "number" ? data.left : undefined,
    };
  } catch {
    return { ok: false, error: "Errore di connessione" };
  }
}

