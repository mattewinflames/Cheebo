/* ============================================================================
   GET /api/comanda-pdf?order_id=...
   ----------------------------------------------------------------------------
   Genera la comanda come file .txt plain ASCII per stampa termica 58mm.
   32 caratteri per riga (area utile ~48mm con font standard ESC/POS).
   Nessuna dipendenza esterna — solo stringhe.
   ========================================================================== */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "./_lib/admin.js";
import { ORDERS } from "./_lib/holds.js";

const W = 32; // caratteri per riga su 58mm

function fmtOra(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function fmtEuro(euro: number) {
  return `${euro.toFixed(2)} EUR`;
}
function ctr(text: string) {
  return text.slice(0, W).padStart(Math.floor((W + text.length) / 2)).padEnd(W);
}
function lr(left: string, right: string) {
  const spazio = W - left.length - right.length;
  return left + " ".repeat(Math.max(1, spazio)) + right;
}
function dash() { return "-".repeat(W); }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const orderId = req.query.order_id;
  if (typeof orderId !== "string" || !orderId)
    return res.status(400).json({ error: "order_id mancante" });

  const snap = await adminDb.collection(ORDERS).doc(orderId).get();
  if (!snap.exists) return res.status(404).json({ error: "ordine non trovato" });

  const o = snap.data() as {
    code?: number; name: string; phone?: string; readyMin: number;
    items: string[]; total: number; serviceCharge?: number; pay: string;
    serviceKey?: string; createdAt?: { toDate?: () => Date };
  };

  // Data dal serviceKey (YYYY-MM-DD-Label) → GG/MM/YYYY
  const dataServizio = (() => {
    const m = (o.serviceKey ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
  })();
  // Ora di ricezione dal Timestamp Firestore
  const oraRicezione = (() => {
    const d = o.createdAt?.toDate?.();
    if (!d) return "";
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  })();

  const righe: string[] = [
    ctr("*** CHEEBO ***"),
    ctr("COMANDA CUCINA"),
    dash(),
    ...(dataServizio ? [lr("Data:", dataServizio)] : []),
    ...(oraRicezione ? [lr("Ora:", oraRicezione)] : []),
    dash(),
    ctr(`#${String(o.code ?? "?").padStart(3, "0")}`),
    ctr(`PRONTO ALLE  ${fmtOra(o.readyMin)}`),
    dash(),
    lr("Cliente:", (o.name ?? "").toUpperCase().slice(0, W - 9)),
  ];

  if (o.phone) righe.push(lr("Tel:", o.phone.slice(0, W - 5)));

  righe.push(dash());

  // Word-wrap: spezza solo tra parole, mai a metà
  function wrap(text: string, maxLen: number, indent = ""): string[] {
    const words = text.trim().split(" ");
    const righe: string[] = [];
    let riga = indent;
    for (const w of words) {
      if (riga.length + (riga === indent ? 0 : 1) + w.length > maxLen) {
        if (riga.trim()) righe.push(riga);
        riga = indent + w;
      } else {
        riga += (riga === indent ? "" : " ") + w;
      }
    }
    if (riga.trim()) righe.push(riga);
    return righe;
  }

  for (const item of o.items) {
    const isExtra = item.startsWith("  ") || item.startsWith("+");
    const indent = isExtra ? "      " : "  ";
    for (const riga of wrap(item, W, indent)) {
      righe.push(riga);
    }
    if (!isExtra) righe.push(""); // riga vuota tra voci principali per leggibilità
  }

  righe.push(
    dash(),
    lr("TOTALE", fmtEuro(o.total ?? 0)),
  );
  if (o.serviceCharge && o.serviceCharge > 0) {
    righe.push(lr("  Costo servizio", fmtEuro(o.serviceCharge)));
    const prodotti = Math.round(((o.total ?? 0) - o.serviceCharge) * 100) / 100;
    righe.push(lr("  Prodotti", fmtEuro(prodotti)));
  }
  righe.push(
    lr("Pagamento", o.pay === "online" ? "PAGATO" : "IN LOCO"),
    dash(),
    ctr("Bite the East Side"),
    ctr("La Rustica - Roma"),
    "",
    "",
  );

  const txt = righe.join("\n");
  const filename = `comanda-${o.code ?? orderId.slice(0, 6)}.txt`;

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", Buffer.byteLength(txt, "utf-8"));
  res.status(200).send(txt);
}
