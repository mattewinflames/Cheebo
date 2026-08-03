/* ============================================================================
   POST /api/stripe-webhook
   ----------------------------------------------------------------------------
   La FONTE DI VERITÀ del pagamento. Mai fidarsi del redirect del browser: solo
   qui, verificata la firma di Stripe, l'ordine diventa reale.
     · checkout.session.completed → crea l'ordine "pagato" e assegna il codice
     · checkout.session.expired   → rilascia lo slot di piastra e lo stock

   ⚠️ Body RAW obbligatorio per la verifica della firma: niente parsing JSON.
   Se sul runtime Vercel corrente `req.body` risultasse già consumato, adattare
   qui la lettura del raw (testare con `stripe listen` che la firma passi).
   ========================================================================== */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type Stripe from "stripe";
import { adminDb, FieldValue } from "./_lib/admin.js";
import { stripe } from "./_lib/stripe.js";
import { HOLDS, SESSIONS, ORDERS, type Hold } from "./_lib/holds.js";
import { serviceFromKey } from "../src/lib/schedule.js";
import { totalWindows, ledgerFromMap, ledgerToMap } from "../src/lib/dispatch.js";

export const config = { api: { bodyParser: false } };

function readRaw(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer | string) => chunks.push(typeof c === "string" ? Buffer.from(c) : c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers["stripe-signature"];
  if (!secret || typeof sig !== "string") return res.status(400).send("firma o secret mancante");

  let event: Stripe.Event;
  try {
    const raw = await readRaw(req);
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    console.error("[webhook] firma non valida", e);
    return res.status(400).send("firma non valida");
  }

  try {
    if (event.type === "checkout.session.completed") {
      await confirm(event.data.object as Stripe.Checkout.Session);
    } else if (event.type === "checkout.session.expired") {
      await release(event.data.object as Stripe.Checkout.Session);
    }
    // altri eventi (payment_intent.*, charge.refunded): accettati e ignorati per ora
    return res.status(200).json({ received: true });
  } catch (e) {
    console.error("[webhook] gestione evento", event.type, e);
    // 500 → Stripe riproverà l'evento
    return res.status(500).send("errore gestione evento");
  }
}

/* Pagamento riuscito: crea l'ordine vero, assegna il codice, chiude l'hold.
   Idempotente: se l'hold è già "pagato" non fa nulla. */
async function confirm(session: Stripe.Checkout.Session): Promise<void> {
  const holdId = session.metadata?.holdId;
  if (!holdId) { console.warn("[webhook] completed senza holdId"); return; }

  const holdRef = adminDb.collection(HOLDS).doc(holdId);

  await adminDb.runTransaction(async (tx) => {
    const holdSnap = await tx.get(holdRef);
    if (!holdSnap.exists) { console.warn("[webhook] hold assente", holdId); return; }
    const hold = holdSnap.data() as Hold;
    if (hold.status === "pagato") return; // già confermato

    const sessRef = adminDb.collection(SESSIONS).doc(hold.serviceKey);
    const sessSnap = await tx.get(sessRef);
    const code = ((sessSnap.data()?.seq as number | undefined) ?? 0) + 1;
    const ricollocare = hold.status === "scaduto"; // pagato dopo il rilascio (non atteso con scadenze allineate)

    const orderRef = adminDb.collection(ORDERS).doc();
    tx.set(orderRef, {
      serviceKey: hold.serviceKey, name: hold.name, items: hold.items, patties: hold.patties,
      windowIndex: hold.windowIndex, readyMin: hold.readyMin, mode: hold.mode, pay: "online",
      total: hold.total, code, phone: hold.phone, channel: "prenotazione",
      status: "nuovo", createdAt: FieldValue.serverTimestamp(), stripeSessionId: session.id,
      ...(ricollocare ? { ricollocare: true } : {}),
    });
    tx.set(sessRef, { seq: code, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.update(holdRef, { status: "pagato", orderId: orderRef.id, code, paidAt: FieldValue.serverTimestamp() });
  });
}

/* Sessione scaduta: restituisce lo slot di piastra e i pezzi di special.
   Idempotente: agisce solo se l'hold è ancora "attesa". */
async function release(session: Stripe.Checkout.Session): Promise<void> {
  const holdId = session.metadata?.holdId;
  if (!holdId) return;

  const holdRef = adminDb.collection(HOLDS).doc(holdId);

  await adminDb.runTransaction(async (tx) => {
    const holdSnap = await tx.get(holdRef);
    if (!holdSnap.exists) return;
    const hold = holdSnap.data() as Hold;
    if (hold.status !== "attesa") return; // già pagato o già rilasciato

    const service = serviceFromKey(hold.serviceKey);
    if (!service) { console.error("[webhook] serviceKey irrisolvibile", hold.serviceKey); return; }
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
