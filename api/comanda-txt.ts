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

/** Converte i caratteri non-ASCII più comuni in equivalenti ASCII sicuri per ESC/POS. */
function toASCII(text: string): string {
  return text
    .replace(/\u2122/g, "TM")       // ™
    .replace(/\u00AE/g, "(R)")      // ®
    .replace(/\u00A9/g, "(C)")      // ©
    .replace(/\u00D7/g, "x")        // ×
    .replace(/\u00F7/g, "/")        // ÷
    .replace(/[\u00E0\u00E1\u00E2\u00E3\u00E4\u00E5\u00C0\u00C1\u00C2\u00C3\u00C4\u00C5]/g, "a")
    .replace(/[\u00E8\u00E9\u00EA\u00EB\u00C8\u00C9\u00CA\u00CB]/g, "e")
    .replace(/[\u00EC\u00ED\u00EE\u00EF\u00CC\u00CD\u00CE\u00CF]/g, "i")
    .replace(/[\u00F2\u00F3\u00F4\u00F5\u00F6\u00D2\u00D3\u00D4\u00D5\u00D6]/g, "o")
    .replace(/[\u00F9\u00FA\u00FB\u00FC\u00D9\u00DA\u00DB\u00DC]/g, "u")
    .replace(/[\u00FD\u00FF\u00DD]/g, "y")
    .replace(/[\u00F1\u00D1]/g, "n")
    .replace(/[\u00E7\u00C7]/g, "c")
    .replace(/\u20AC/g, "EUR")      // €
    .replace(/[\u2013\u2014]/g, "-") // – —
    .replace(/[\u2018\u2019]/g, "'") // ' '
    .replace(/[\u201C\u201D]/g, '"') // " "
    .replace(/[^\x00-\x7F]/g, "?"); // qualsiasi altro non-ASCII → ?
}

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
    "", "", "", "", // spazio per molletta
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

  for (const item of o.items.map(toASCII)) {
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
