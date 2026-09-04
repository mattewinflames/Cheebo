/* ============================================================================
   GET /api/release-stale-holds
   ----------------------------------------------------------------------------
   Cron job Vercel: rilascia automaticamente gli holds in stato "attesa"
   più vecchi di STALE_MINUTES minuti.

   Questi holds corrispondono a clienti che hanno abbandonato la HPP Nexi
   senza pagare né annullare esplicitamente. Nexi non invia webhook per i
   timeout HPP, quindi gli slot restano occupati finché non vengono rilasciati.

   Eseguito ogni 5 minuti da Vercel Cron (vedi vercel.json).
   Protetto da CRON_SECRET per evitare chiamate non autorizzate.
   ========================================================================== */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb, FieldValue } from "./_lib/admin.js";
import { HOLDS, SESSIONS } from "./_lib/holds.js";
import { serviceFromKey } from "../src/lib/schedule.js";
import { totalWindows, ledgerFromMap, ledgerToMap } from "../src/lib/dispatch.js";

/** Minuti oltre i quali un hold in attesa è considerato abbandonato. */
const STALE_MINUTES = 15;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel invia l'header Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: "Non autorizzato" });
    }
  }

  const cutoff = new Date(Date.now() - STALE_MINUTES * 60 * 1000);

  let released = 0;
  let errors = 0;

  try {
    const staleSnap = await adminDb
      .collection(HOLDS)
      .where("status", "==", "attesa")
      .where("createdAt", "<", cutoff)
      .get();

    console.log(`[release-stale-holds] holds stale trovati: ${staleSnap.size}`);

    for (const doc of staleSnap.docs) {
      try {
        await releaseHold(doc.id);
        released++;
        console.log(`[release-stale-holds] rilasciato: ${doc.id} (${doc.data().name}, ${doc.data().serviceKey})`);
      } catch (e) {
        errors++;
        console.error(`[release-stale-holds] errore su ${doc.id}:`, e);
      }
    }
  } catch (e) {
    console.error("[release-stale-holds] query fallita:", e);
    return res.status(500).json({ error: "Query fallita" });
  }

  console.log(`[release-stale-holds] completato: ${released} rilasciati, ${errors} errori`);
  return res.status(200).json({ released, errors, cutoff: cutoff.toISOString() });
}

/** Rilascia un hold abbandonato: libera la piastra e lo marca come scaduto.
 *  Copia esatta della funzione release() in nexi-webhook.ts — idempotente. */
async function releaseHold(holdId: string): Promise<void> {
  const holdRef = adminDb.collection(HOLDS).doc(holdId);

  await adminDb.runTransaction(async (tx) => {
    const holdSnap = await tx.get(holdRef);
    if (!holdSnap.exists) return;
    const hold = holdSnap.data() as {
      status: string; serviceKey: string; cells: number[];
      specials?: Record<string, number>; name?: string;
    };
    if (hold.status !== "attesa") return; // già rilasciato o pagato nel frattempo

    const service = serviceFromKey(hold.serviceKey);
    if (!service) {
      console.error("[release-stale-holds] serviceKey irrisolvibile:", hold.serviceKey);
      // Marca comunque come scaduto per non ritentare all'infinito
      tx.update(holdRef, { status: "scaduto", releasedAt: FieldValue.serverTimestamp() });
      return;
    }

    const sessRef = adminDb.collection(SESSIONS).doc(hold.serviceKey);
    const sessSnap = await tx.get(sessRef);
    const n = totalWindows(service);
    const led = ledgerFromMap(
      sessSnap.data()?.ledger as Record<string, number> | undefined, n
    );
    const stock: Record<string, number> = {
      ...((sessSnap.data()?.stock as Record<string, number> | undefined) ?? {}),
    };

    for (const w of hold.cells ?? []) led[w] = Math.max(0, led[w] - 1);
    for (const [id, qty] of Object.entries(hold.specials ?? {})) {
      stock[id] = (stock[id] ?? 0) + qty;
    }

    tx.set(
      sessRef,
      { ledger: ledgerToMap(led), stock, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    tx.update(holdRef, { status: "scaduto", releasedAt: FieldValue.serverTimestamp() });
  });
}
