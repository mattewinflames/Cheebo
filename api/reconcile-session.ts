/* ============================================================================
   POST /api/reconcile-session
   ----------------------------------------------------------------------------
   Ricostruisce il registro piastra (ledger) di una sessione da ciò che la
   occupa DAVVERO, eliminando i "patty fantasma":
     · ordini della sessione (online e banco) → le loro `cells`
     · hold in "attesa" (pagamento in corso)   → le loro `cells`
       (anche se scaduti: li libererà il cron, che scala esattamente quelle celle)
   Gli ordini al banco registrati prima che si salvassero le `cells` non dicono
   in quali finestre sono stati cotti: si contano tutti nella finestra di ritiro
   (stessa convenzione del pannello piastra) e si segnalano come `stimati`.

   Body: { serviceKey: string, dryRun?: boolean }
     dryRun = true → calcola e restituisce il confronto, NON scrive nulla.
   Auth: Authorization: Bearer <Firebase ID token>  oppure  Bearer <CRON_SECRET>

   Tutto avviene in una transazione: se nel frattempo entra una prenotazione
   (che riscrive il documento sessione) la riconciliazione si ripete da capo.
   Ordini e hold restano intatti: si riscrive solo il campo `ledger`.
   ========================================================================== */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb, adminAuth } from "./_lib/admin.js";
import { HOLDS, SESSIONS, ORDERS } from "./_lib/holds.js";

type Result = {
  before: number[]; after: number[];
  beforeTotal: number; afterTotal: number;
  orders: number; pendingHolds: number; estimated: number;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/, "");
  const cronSecret = process.env.CRON_SECRET;
  const isCron = !!cronSecret && bearer === cronSecret;
  if (!isCron) {
    try { await adminAuth.verifyIdToken(bearer); }
    catch { return res.status(401).json({ error: "Non autorizzato." }); }
  }

  const { serviceKey, dryRun } = (req.body ?? {}) as { serviceKey?: string; dryRun?: boolean };
  if (typeof serviceKey !== "string" || !/^\d{4}-\d{2}-\d{2}-.+$/.test(serviceKey))
    return res.status(400).json({ error: "Servizio non valido." });

  const sessRef = adminDb.collection(SESSIONS).doc(serviceKey);
  const ordersQ = adminDb.collection(ORDERS).where("serviceKey", "==", serviceKey);
  const pendingQ = adminDb.collection(HOLDS).where("serviceKey", "==", serviceKey).where("status", "==", "attesa");

  try {
    const out = await adminDb.runTransaction<Result>(async (tx) => {
      const [sessSnap, ordersSnap, pendingSnap] = await Promise.all([tx.get(sessRef), tx.get(ordersQ), tx.get(pendingQ)]);

      const current = (sessSnap.data()?.ledger ?? {}) as Record<string, number>;
      const add = (m: Map<number, number>, w: number, q = 1) => {
        if (Number.isInteger(w) && w >= 0) m.set(w, (m.get(w) ?? 0) + q);
      };

      const next = new Map<number, number>();
      let estimated = 0;
      for (const d of ordersSnap.docs) {
        const o = d.data() as { cells?: unknown; patties?: number; windowIndex?: number };
        const patties = typeof o.patties === "number" ? o.patties : 0;
        if (patties <= 0) continue;
        if (Array.isArray(o.cells) && o.cells.length > 0) {
          for (const w of o.cells) add(next, Number(w));
        } else if (typeof o.windowIndex === "number") {
          add(next, o.windowIndex, patties);
          estimated++;
        }
      }
      for (const d of pendingSnap.docs) {
        const cells = (d.data() as { cells?: unknown }).cells;
        if (Array.isArray(cells)) for (const w of cells) add(next, Number(w));
      }

      // Confronto per finestra (array densi sulla finestra più alta coinvolta)
      const keys = [...Object.keys(current).map(Number), ...next.keys()].filter((k) => Number.isInteger(k) && k >= 0);
      const len = keys.length ? Math.max(...keys) + 1 : 0;
      const before = Array.from({ length: len }, (_, i) => Number(current[String(i)] ?? 0));
      const after = Array.from({ length: len }, (_, i) => next.get(i) ?? 0);

      if (!dryRun && sessSnap.exists) {
        const ledger: Record<string, number> = {};
        after.forEach((v, i) => { if (v > 0) ledger[String(i)] = v; });
        // update sostituisce l'intero campo ledger (un merge lascerebbe le chiavi vecchie)
        tx.update(sessRef, { ledger, updatedAt: new Date() });
      }

      return {
        before, after,
        beforeTotal: before.reduce((s, v) => s + v, 0),
        afterTotal: after.reduce((s, v) => s + v, 0),
        orders: ordersSnap.size, pendingHolds: pendingSnap.size, estimated,
      };
    });

    return res.status(200).json({ ok: true, serviceKey, applied: !dryRun, ...out });
  } catch (e) {
    console.error("[reconcile-session]", e);
    return res.status(500).json({ error: "Riconciliazione non riuscita, riprova." });
  }
}
