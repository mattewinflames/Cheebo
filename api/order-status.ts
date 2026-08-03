/* ============================================================================
   GET /api/order-status?session_id=cs_...
   ----------------------------------------------------------------------------
   La pagina di esito (dopo il redirect da Stripe) NON può leggere `orders` (le
   regole la riservano all'admin), quindi interroga qui lo stato dell'hold via
   id di sessione Stripe. Espone solo il minimo pubblico: stato, codice di
   ritiro, orario e righe. Va interrogata a intervalli finché non è "confermato".
   ========================================================================== */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "./_lib/admin";
import { HOLDS, type Hold } from "./_lib/holds";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "metodo non consentito" });

  const sessionId = req.query.session_id;
  if (typeof sessionId !== "string" || !sessionId) return res.status(400).json({ error: "session_id mancante" });

  const snap = await adminDb.collection(HOLDS).where("stripeSessionId", "==", sessionId).limit(1).get();
  if (snap.empty) return res.status(404).json({ stato: "sconosciuto" });

  const hold = snap.docs[0].data() as Hold;
  if (hold.status === "pagato") {
    return res.status(200).json({
      stato: "confermato", code: hold.code ?? null, readyMin: hold.readyMin,
      items: hold.items, serviceKey: hold.serviceKey, name: hold.name,
    });
  }
  if (hold.status === "scaduto") return res.status(200).json({ stato: "scaduto" });
  return res.status(200).json({ stato: "in_attesa" });
}
