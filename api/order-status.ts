/* ============================================================================
   GET /api/order-status?hold_id=...
   ----------------------------------------------------------------------------
   La pagina di esito interroga qui lo stato dell'hold dopo il redirect da Nexi.
   Espone solo il minimo pubblico: stato, codice di ritiro, orario e righe.
   Va interrogata a intervalli finché non è "confermato".

   Accetta anche il vecchio parametro session_id (Stripe) per retrocompatibilità
   durante la transizione — da rimuovere dopo il go-live Nexi.
   ========================================================================== */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "./_lib/admin.js";
import { HOLDS, type Hold } from "./_lib/holds.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "metodo non consentito" });

  const holdId   = req.query.hold_id;
  const sessionId = req.query.session_id; // retrocompatibilità Stripe

  let snap: FirebaseFirestore.QuerySnapshot | FirebaseFirestore.DocumentSnapshot | null = null;
  let hold: Hold | null = null;

  if (typeof holdId === "string" && holdId) {
    // Nexi: hold_id è l'ID diretto del documento
    const doc = await adminDb.collection(HOLDS).doc(holdId).get();
    if (doc.exists) hold = doc.data() as Hold;
  } else if (typeof sessionId === "string" && sessionId) {
    // Stripe (retrocompatibilità): cerca per stripeSessionId
    const q = await adminDb.collection(HOLDS).where("stripeSessionId", "==", sessionId).limit(1).get();
    if (!q.empty) hold = q.docs[0].data() as Hold;
  } else {
    return res.status(400).json({ error: "hold_id mancante" });
  }

  if (!hold) return res.status(404).json({ stato: "sconosciuto" });

  if (hold.status === "pagato") {
    return res.status(200).json({
      stato: "confermato", code: hold.code ?? null, readyMin: hold.readyMin,
      items: hold.items, serviceKey: hold.serviceKey, name: hold.name,
    });
  }
  if (hold.status === "scaduto") return res.status(200).json({ stato: "scaduto" });
  return res.status(200).json({ stato: "in_attesa" });
}
