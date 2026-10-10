/* ============================================================================
   POST /api/reconcile-session
   ----------------------------------------------------------------------------
   Ricalcola il ledger di una sessione dagli holds PAGATI e lo riscrive su
   Firestore, rimuovendo i "patty fantasma" lasciati da holds scaduti/abbandonati
   che non hanno liberato correttamente i patty.

   Body: { serviceKey: string }
   Auth: header Authorization: Bearer <Firebase ID token>
         oppure: Bearer <CRON_SECRET> (per uso da script/GitHub Actions)

   ⚠️  Sovrascrive il ledger in produzione — usare solo a sessione non attiva
       o quando si è certi che non ci siano hold pendenti in corso.
   ========================================================================== */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb, adminAuth } from "./_lib/admin.js";
import { HOLDS, SESSIONS } from "./_lib/holds.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  // Auth: accetta CRON_SECRET oppure Firebase ID token
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/, "");
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && bearer === cronSecret;

  if (!isCron) {
    // Prova a validare come Firebase ID token
    try {
      await adminAuth.verifyIdToken(bearer);
    } catch {
      return res.status(401).json({ error: "Non autorizzato." });
    }
  }

  const { serviceKey } = (req.body ?? {}) as { serviceKey?: string };
  if (typeof serviceKey !== "string" || !serviceKey) {
    return res.status(400).json({ error: "serviceKey mancante." });
  }

  // 1. Leggi tutti gli holds PAGATI per questa sessione
  const holdsSnap = await adminDb.collection(HOLDS)
    .where("serviceKey", "==", serviceKey)
    .where("status", "==", "pagato")
    .get();

  // 2. Ricostruisci il ledger sommando le cells di ogni hold pagato
  const ledgerMap: Record<string, number> = {};
  let totalPatty = 0;

  for (const doc of holdsSnap.docs) {
    const hold = doc.data() as { cells?: number[]; patties?: number };
    const cells = Array.isArray(hold.cells) ? hold.cells : [];
    for (const w of cells) {
      ledgerMap[String(w)] = (ledgerMap[String(w)] ?? 0) + 1;
    }
    totalPatty += hold.patties ?? 0;
  }

  // 3. Leggi il ledger attuale
  const sessRef = adminDb.collection(SESSIONS).doc(serviceKey);
  const sessSnap = await sessRef.get();
  const currentData = sessSnap.exists ? (sessSnap.data() ?? {}) : {};
  const currentLedger = (currentData.ledger ?? {}) as Record<string, number>;
  const currentTotal = Object.values(currentLedger).reduce((s, v) => s + Number(v), 0);

  // 4. Sovrascrivi con il ledger ricalcolato
  await sessRef.set({ ...currentData, ledger: ledgerMap, updatedAt: new Date() });

  return res.status(200).json({
    ok: true,
    serviceKey,
    holdsProcessed: holdsSnap.size,
    before: currentTotal,
    after: totalPatty,
    delta: currentTotal - totalPatty,
    ledger: ledgerMap,
  });
}
