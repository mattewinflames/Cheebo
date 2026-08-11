/* ============================================================================
   POST /api/create-booking
   ----------------------------------------------------------------------------
   Sposta la prenotazione LATO SERVER (chiude #30). In una transazione Admin:
   valida lo special, pianifica lo slot, occupa ledger+stock e crea un HOLD con
   scadenza. Poi apre una sessione di Stripe Checkout e restituisce l'URL.
   Il codice di ritiro NON si assegna qui: lo assegna il webhook a pagamento
   avvenuto, così gli abbandoni non bruciano numeri di ritiro.
   Nulla del prezzo arriva dal client: `resolveCart` lo ricalcola dal menù.
   ========================================================================== */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb, FieldValue, Timestamp } from "./_lib/admin.js";
import { stripe } from "./_lib/stripe.js";
import { HOLD_MINUTES, HOLDS, SESSIONS, MENU, type Hold } from "./_lib/holds.js";
import { resolveCart, isResolveError, type BookingReq } from "../src/lib/booking.js";
import { serviceFromKey, upcomingSessions, minWindowNow } from "../src/lib/schedule.js";
import { totalWindows, planFirst, planAt, ledgerFromMap, ledgerToMap, type Placement } from "../src/lib/dispatch.js";
import type { MenuItem } from "../src/lib/menu.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "metodo non consentito" });

  const body = (req.body ?? {}) as Partial<BookingReq>;
  const { serviceKey, name, phone, mode, targetWindow, cart } = body;

  if (typeof serviceKey !== "string") return res.status(400).json({ error: "serviceKey mancante" });
  if (typeof name !== "string" || !name.trim() || name.length > 60) return res.status(400).json({ error: "nome non valido" });
  if (mode !== "first" && mode !== "at") return res.status(400).json({ error: "modalità non valida" });
  if (mode === "at" && typeof targetWindow !== "number") return res.status(400).json({ error: "finestra mancante" });
  if (!Array.isArray(cart)) return res.status(400).json({ error: "carrello mancante" });

  const service = serviceFromKey(serviceKey);
  if (!service) return res.status(400).json({ error: "sessione inesistente" });

  // Autorità sul tempo e sulle chiusure (#47/#50). Il server è l'ultima parola:
  // la sessione dev'essere tra quelle REALMENTE prenotabili adesso — questo
  // esclude in un colpo date passate, fuori range, servizi già finiti e giorni
  // chiusi. Il blocco totale mantiene un messaggio dedicato.
  const now = new Date();
  const settingsSnap = await adminDb.collection("settings").doc("app").get();
  const settings = settingsSnap.data() ?? {};
  if (settings.bookingBlocked === true)
    return res.status(409).json({ error: "prenotazioni sospese" });
  const closedDays = Array.isArray(settings.closedDays) ? (settings.closedDays as string[]) : [];
  const prenotabili = upcomingSessions(now, undefined, { closedDays });
  if (!prenotabili.some((u) => u.serviceKey === serviceKey))
    return res.status(409).json({ error: "sessione non prenotabile" });

  // Menù reale → ricalcolo autoritativo del carrello (prezzi, patty, special).
  const menuSnap = await adminDb.collection(MENU).get();
  const menu = menuSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as MenuItem[];
  const byId = new Map(menu.map((m) => [m.id, m] as const));

  const resolved = resolveCart(menu, serviceKey, cart);
  if (isResolveError(resolved)) return res.status(400).json({ error: resolved.error });

  const n = totalWindows(service);
  const minW = minWindowNow(serviceKey, service, now);
  const sessRef = adminDb.collection(SESSIONS).doc(serviceKey);
  const holdRef = adminDb.collection(HOLDS).doc();

  type TxOut =
    | { ok: true; windowIndex: number; readyMin: number }
    | { ok: false; status: number; error: string; itemId?: string; left?: number };

  const specialBase = (id: string): number => byId.get(id)?.special?.stock ?? 0;

  let out: TxOut;
  try {
    out = await adminDb.runTransaction<TxOut>(async (tx) => {
      const snap = await tx.get(sessRef);
      const data = snap.exists ? snap.data() : undefined;
      const led = ledgerFromMap(data?.ledger as Record<string, number> | undefined, n);
      const stock: Record<string, number> = { ...((data?.stock as Record<string, number> | undefined) ?? {}) };

      // Disponibilità special ricontrollata sul registro reale (non sul client).
      for (const [id, qty] of Object.entries(resolved.specials)) {
        const remaining = stock[id] ?? specialBase(id);
        if (remaining < qty) return { ok: false, status: 409, error: "special esaurito", itemId: id, left: remaining };
      }

      let plan: Placement;
      if (mode === "at" && typeof targetWindow === "number") {
        plan = planAt(led, resolved.patties, targetWindow, service, minW);
        if (!plan.ok) plan = planFirst(led, resolved.patties, service, minW);
      } else {
        plan = planFirst(led, resolved.patties, service, minW);
      }
      if (!plan.ok) return { ok: false, status: 409, error: "piastra al completo" };

      for (const w of plan.cells) led[w] += 1;
      for (const [id, qty] of Object.entries(resolved.specials)) stock[id] = (stock[id] ?? specialBase(id)) - qty;

      tx.set(sessRef, {
        label: service.label ?? "", startMin: service.startMin, endMin: service.endMin,
        ledger: ledgerToMap(led), stock, updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const hold: Hold = {
        serviceKey, cells: plan.cells, specials: resolved.specials, patties: resolved.patties,
        windowIndex: plan.windowIndex, readyMin: plan.readyMin, mode: mode as "first" | "at",
        name: name.trim(), phone: typeof phone === "string" ? phone.replace(/\D/g, "") : "", items: resolved.items, total: resolved.total,
        status: "attesa", expiresAt: Timestamp.fromMillis(Date.now() + HOLD_MINUTES * 60_000),
        createdAt: FieldValue.serverTimestamp(),
      };
      tx.set(holdRef, hold);
      return { ok: true, windowIndex: plan.windowIndex, readyMin: plan.readyMin };
    });
  } catch (e) {
    console.error("[create-booking] transazione", e);
    return res.status(500).json({ error: "errore interno" });
  }

  if (!out.ok) return res.status(out.status).json({ error: out.error, itemId: out.itemId, left: out.left });

  // Sessione Stripe. La conferma vera arriva dal webhook, non dal redirect.
  const appUrl = process.env.APP_URL ?? `https://${req.headers.host ?? ""}`;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: resolved.stripeLineItems.map((li) => ({
        price_data: { currency: "eur", unit_amount: li.amount, product_data: { name: li.name } },
        quantity: li.qty,
      })),
      success_url: `${appUrl}/pagamento/ok?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/pagamento/annullato?hold=${holdRef.id}`,
      expires_at: Math.floor(Date.now() / 1000) + HOLD_MINUTES * 60,
      metadata: { holdId: holdRef.id, serviceKey },
    });
    await holdRef.update({ stripeSessionId: session.id });
    return res.status(200).json({ url: session.url, holdId: holdRef.id });
  } catch (e) {
    // La sessione non è partita: l'hold resta appeso e verrà rilasciato alla
    // scadenza. Meglio così che tenere il cliente su un checkout inesistente.
    console.error("[create-booking] stripe", e);
    return res.status(502).json({ error: "pagamento non avviabile, riprova" });
  }
}
