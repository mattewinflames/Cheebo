/* ============================================================================
   POST /api/nexi-webhook
   ----------------------------------------------------------------------------
   La FONTE DI VERITÀ del pagamento lato Nexi. Nexi invia una notifica POST
   server-to-server al `notificationUrl` specificato in create-booking.
   
   Autenticazione: confronto del `securityToken` ricevuto con quello salvato
   sull'hold al momento della creazione della sessione HPP. È l'equivalente
   della firma HMAC di Stripe, ma con un token condiviso invece di HMAC-SHA256.

   Gestione eventi (operationResult):
     · AUTHORIZED / EXECUTED → pagamento riuscito → crea ordine, assegna codice
     · CANCELED / DECLINED / FAILED / THREEDS_FAILED / DENIED_BY_RISK 
       → pagamento fallito/abbandonato → rilascia slot piastra e stock special

   ⚠️ Nexi non verifica l'esito della notifica e non riprova in caso di errore:
   rispondere sempre 200 dopo aver loggato, per evitare di bloccare Nexi.
   In caso di errore interno, logghiamo e rispondiamo 200 lo stesso
   (l'idempotenza delle funzioni confirm/release ci protegge dai doppi invii).
   ========================================================================== */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb, FieldValue } from "./_lib/admin.js";
import { HOLDS, SESSIONS, ORDERS, type Hold } from "./_lib/holds.js";
import { serviceFromKey } from "../src/lib/schedule.js";
import { totalWindows, ledgerFromMap, ledgerToMap } from "../src/lib/dispatch.js";

// Esiti che indicano pagamento riuscito
const ESITI_OK = new Set(["AUTHORIZED", "EXECUTED"]);
// Esiti che indicano pagamento fallito/abbandonato → rilascio slot
const ESITI_KO = new Set(["CANCELED", "DECLINED", "FAILED", "THREEDS_FAILED", "DENIED_BY_RISK"]);

export const config = { api: { bodyParser: true } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const body = req.body as {
    securityToken?: string;
    operation?: {
      orderId?: string;       // nexiOrderId (holdRef.id troncato a 18 char)
      operationResult?: string;
      operationId?: string;
      operationAmount?: string;
      operationCurrency?: string;
    };
    additionalData?: Record<string, unknown>;
  };

  const { securityToken, operation } = body;
  const nexiOrderId = operation?.orderId;
  const operationResult = operation?.operationResult ?? "";

  if (!nexiOrderId || !securityToken) {
    console.warn("[nexi-webhook] payload incompleto", body);
    return res.status(200).json({ received: true }); // non punire Nexi per payload inattesi
  }

  // Trova l'hold tramite nexiOrderId (campo indicizzabile).
  // nexiOrderId = holdRef.id.slice(0,18) → query su campo salvato nell'hold.
  let holdId: string | null = null;
  let savedToken: string | null = null;
  try {
    const q = await adminDb.collection(HOLDS)
      .where("nexiOrderId", "==", nexiOrderId)
      .limit(1)
      .get();
    if (!q.empty) {
      holdId = q.docs[0].id;
      savedToken = q.docs[0].data().nexiSecurityToken ?? null;
    }
  } catch (e) {
    console.error("[nexi-webhook] query hold", e);
    return res.status(200).json({ received: true });
  }

  if (!holdId) {
    console.warn("[nexi-webhook] hold non trovato per nexiOrderId", nexiOrderId);
    return res.status(200).json({ received: true });
  }

  // Verifica del securityToken — equivalente della firma HMAC di Stripe.
  if (savedToken && securityToken !== savedToken) {
    console.error("[nexi-webhook] securityToken non valido per hold", holdId);
    return res.status(200).json({ received: true }); // non rivelare dettagli al chiamante
  }

  try {
    if (ESITI_OK.has(operationResult)) {
      await confirm(holdId, operation?.operationId ?? "");
    } else if (ESITI_KO.has(operationResult)) {
      await release(holdId);
    } else {
      // PENDING, THREEDS_VALIDATED e altri stati intermedi: ignoriamo,
      // arriverà una notifica successiva con l'esito definitivo.
      console.log("[nexi-webhook] esito intermedio ignorato", operationResult, holdId);
    }
  } catch (e) {
    console.error("[nexi-webhook] gestione esito", operationResult, holdId, e);
    // Rispondiamo 200 lo stesso: Nexi non ritenterà comunque, e le funzioni
    // confirm/release sono idempotenti se chiamate di nuovo.
  }

  return res.status(200).json({ received: true });
}

/* Pagamento riuscito: crea l'ordine vero, assegna il codice, chiude l'hold.
   Idempotente: se l'hold è già "pagato" non fa nulla. */
async function confirm(holdId: string, nexiOperationId: string): Promise<void> {
  const holdRef = adminDb.collection(HOLDS).doc(holdId);

  await adminDb.runTransaction(async (tx) => {
    const holdSnap = await tx.get(holdRef);
    if (!holdSnap.exists) { console.warn("[nexi-webhook] hold assente", holdId); return; }
    const hold = holdSnap.data() as Hold;
    if (hold.status === "pagato") return; // già confermato (doppia notifica)

    const sessRef = adminDb.collection(SESSIONS).doc(hold.serviceKey);
    const sessSnap = await tx.get(sessRef);
    const code = ((sessSnap.data()?.seq as number | undefined) ?? 0) + 1;
    const ricollocare = hold.status === "scaduto";

    const orderRef = adminDb.collection(ORDERS).doc();
    tx.set(orderRef, {
      serviceKey: hold.serviceKey, name: hold.name, items: hold.items, patties: hold.patties,
      windowIndex: hold.windowIndex, readyMin: hold.readyMin, mode: hold.mode, pay: "online",
      total: hold.total, code, phone: hold.phone, channel: "prenotazione",
      status: "nuovo", createdAt: FieldValue.serverTimestamp(),
      nexiOperationId,
      ...(ricollocare ? { ricollocare: true } : {}),
    });
    tx.set(sessRef, { seq: code, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.update(holdRef, {
      status: "pagato", orderId: orderRef.id, code,
      paidAt: FieldValue.serverTimestamp(),
      nexiOperationId,
    });
  });
}

/* Pagamento fallito/abbandonato: restituisce slot piastra e stock special.
   Idempotente: agisce solo se l'hold è ancora "attesa". */
async function release(holdId: string): Promise<void> {
  const holdRef = adminDb.collection(HOLDS).doc(holdId);

  await adminDb.runTransaction(async (tx) => {
    const holdSnap = await tx.get(holdRef);
    if (!holdSnap.exists) return;
    const hold = holdSnap.data() as Hold;
    if (hold.status !== "attesa") return; // già pagato o già rilasciato

    const service = serviceFromKey(hold.serviceKey);
    if (!service) { console.error("[nexi-webhook] serviceKey irrisolvibile", hold.serviceKey); return; }

    const sessRef = adminDb.collection(SESSIONS).doc(hold.serviceKey);
    const sessSnap = await tx.get(sessRef);
    const n = totalWindows(service);
    const led = ledgerFromMap(sessSnap.data()?.ledger as Record<string, number> | undefined, n);
    const stock: Record<string, number> = { ...((sessSnap.data()?.stock as Record<string, number> | undefined) ?? {}) };

    for (const w of hold.cells) led[w] = Math.max(0, led[w] - 1);
    for (const [id, qty] of Object.entries(hold.specials ?? {})) stock[id] = (stock[id] ?? 0) + qty;

    tx.set(sessRef, { ledger: ledgerToMap(led), stock, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.update(holdRef, { status: "scaduto", releasedAt: FieldValue.serverTimestamp() });
  });
}
