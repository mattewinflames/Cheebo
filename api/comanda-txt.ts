/* ============================================================================
   GET /api/comanda-txt?order_id=...
   ----------------------------------------------------------------------------
   Genera la comanda come file .txt plain ASCII per stampa termica 58mm.
   32 caratteri per riga (area utile ~48mm con font standard ESC/POS).
   Formato allineato alla comanda fisica della cassa (raggruppamento per
   categoria, quantità davanti, * per aggiunte, # per rimozioni).
   ========================================================================== */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "./_lib/admin.js";
import { ORDERS } from "./_lib/holds.js";

const W = 32;

function fmtOra(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function fmtEuro(euro: number) {
  return `${euro.toFixed(2)} EUR`;
}
function lr(left: string, right: string) {
  const spazio = W - left.length - right.length;
  return left + " ".repeat(Math.max(1, spazio)) + right;
}
function dash() { return "-".repeat(W); }

/** Converte i caratteri non-ASCII più comuni in equivalenti ASCII sicuri per ESC/POS. */
function toASCII(text: string): string {
  return text
    .replace(/\u2122/g, "TM")
    .replace(/\u00AE/g, "(R)")
    .replace(/\u00A9/g, "(C)")
    .replace(/\u00B7/g, "-")
    .replace(/\u2022/g, "-")
    .replace(/\u00D7/g, "x")
    .replace(/[\u00E0\u00E1\u00E2\u00E3\u00E4\u00E5\u00C0\u00C1\u00C2\u00C3\u00C4\u00C5]/g, "a")
    .replace(/[\u00E8\u00E9\u00EA\u00EB\u00C8\u00C9\u00CA\u00CB]/g, "e")
    .replace(/[\u00EC\u00ED\u00EE\u00EF\u00CC\u00CD\u00CE\u00CF]/g, "i")
    .replace(/[\u00F2\u00F3\u00F4\u00F5\u00F6\u00D2\u00D3\u00D4\u00D5\u00D6]/g, "o")
    .replace(/[\u00F9\u00FA\u00FB\u00FC\u00D9\u00DA\u00DB\u00DC]/g, "u")
    .replace(/[\u00FD\u00FF\u00DD]/g, "y")
    .replace(/[\u00F1\u00D1]/g, "n")
    .replace(/[\u00E7\u00C7]/g, "c")
    .replace(/\u20AC/g, "EUR")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x00-\x7F]/g, " ");
}

// Mappa prefisso nome → categoria comanda (ordine di stampa)
// La chiave è il prefisso lowercase dell'item (prima del " ·" o " +")
const CATEGORIA_ORDER = ["SMASHBURGER", "BURGER", "CONTORNI", "SALSE", "DOLCI", "DRINKS"] as const;
type Categoria = typeof CATEGORIA_ORDER[number];

function categoriaItem(nome: string): Categoria {
  const n = nome.toLowerCase().replace(/^\d+[×x]\s*/, "").trim();
  if (n.startsWith("classic") || n.startsWith("oklahoma") || n.startsWith("crispy") || n.startsWith("smash veg")) return "SMASHBURGER";
  if (n.startsWith("chicken") || n.startsWith("pulled pork") || n.startsWith("burgerveg")) return "BURGER";
  if (n.startsWith("tender") || n.startsWith("patatine") || n.startsWith("polpette") || n.startsWith("box patatine")) return "CONTORNI";
  if (n.startsWith("salsa") || n.startsWith("ketchup") || n.startsWith("maionese") || n.startsWith("honey mustard") || n.startsWith("bbq") || n.startsWith("agrodolce") || n.startsWith("curry")) return "SALSE";
  if (n.startsWith("nutellone") || n.startsWith("cookies") || n.startsWith("cinnamon")) return "DOLCI";
  // drink: coca, fanta, 7up, the, acqua, iced tea, birra, ecc.
  return "DRINKS";
}

/** Word-wrap: spezza solo tra parole, mai a metà */
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

/**
 * Parsa una riga item nel formato salvato da resolveCart.
 * Esempi:
 *   "Classic singolo"
 *   "Crispy doppio · menu con coca-cola · senza cipolla, pickles"
 *   "2× Tender di pollo"
 *   "Classic singolo + bacon, pickles"
 *
 * Restituisce:
 *   { qty, nome, extras: string[], rimozioni: string[] }
 *
 * - extras    → parti dopo "·" che NON iniziano con "senza" → riga "* TESTO"
 * - rimozioni → parti dopo "senza"                         → riga "# NO TESTO"
 */
function parseItem(raw: string): { qty: number; nome: string; extras: string[]; rimozioni: string[] } {
  // Estrai quantità PRIMA di toASCII (il simbolo × è U+00D7, toASCII lo converte in "x")
  const qtyMatch = raw.match(/^(\d+)[×x]\s*/i);
  const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
  const rest = toASCII(qtyMatch ? raw.slice(qtyMatch[0].length) : raw);

  // Split per " · " (separatore di resolveCart) → toASCII lo converte in " - "
  const parti = rest.split(/\s+-\s+/).map(p => p.trim()).filter(Boolean);
  const nome = parti[0] ?? rest.trim();
  const extras: string[] = [];
  const rimozioni: string[] = [];

  for (let i = 1; i < parti.length; i++) {
    const p = parti[i];
    const senzaMatch = p.match(/^senza\s+(.+)/i);
    if (senzaMatch) {
      // "senza cipolla, pickles" → ["NO CIPOLLA", "NO PICKLES"]
      const voci = senzaMatch[1].split(/,\s*/);
      for (const v of voci) rimozioni.push("NO " + v.trim().toUpperCase());
    } else {
      extras.push(p.toUpperCase());
    }
  }

  return { qty, nome, extras, rimozioni };
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

  // Data servizio: "2026-09-05-Cena" → "5-set-2026"
  const MESI = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"];
  const dataServizio = (() => {
    const m = (o.serviceKey ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return "";
    const giorno = parseInt(m[3], 10);
    const mese = MESI[parseInt(m[2], 10) - 1] ?? m[2];
    return `${giorno}-${mese}-${m[1]}`;
  })();

  // Ora ricezione dal Timestamp Firestore (es. "23.05")
  const oraRicezione = (() => {
    const d = o.createdAt?.toDate?.();
    if (!d) return "";
    return d.toLocaleTimeString("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hour12: false }).replace(":", ".");
  })();

  // Raggruppa items per categoria
  const gruppi = new Map<Categoria, { qty: number; nome: string; extras: string[]; rimozioni: string[] }[]>();
  for (const cat of CATEGORIA_ORDER) gruppi.set(cat, []);

  for (const raw of o.items) {
    const parsed = parseItem(raw);
    const cat = categoriaItem(parsed.nome);
    gruppi.get(cat)!.push(parsed);
  }

  // Costruzione righe
  const righe: string[] = [
    "",
    "",
    "",
    "",                               // spazio molletta
    "CHEEBO",                         // intestazione
    "",
    "- COMANDA -",
    ...(o.code != null ? [`Ordine:${o.code}`] : []),
    `Data:${dataServizio}`,
    ...(oraRicezione ? [`Ora:${oraRicezione}`] : []),
    dash(),
  ];

  // Sezioni per categoria
  let hasContent = false;
  for (const cat of CATEGORIA_ORDER) {
    const items = gruppi.get(cat)!;
    if (items.length === 0) continue;
    hasContent = true;
    righe.push(cat);                  // intestazione categoria (es. "SMASHBURGER")
    for (const { qty, nome, extras, rimozioni } of items) {
      const qtyStr = String(qty);
      const nomeUp = nome.toUpperCase();
      // Prima riga: "1  CLASSIC SINGOLO" (qty + 2 spazi + nome)
      const prefixLen = qtyStr.length + 2;
      const nomeLines = wrap(nomeUp, W - prefixLen);
      righe.push(qtyStr + "  " + (nomeLines[0] ?? ""));
      for (let i = 1; i < nomeLines.length; i++) righe.push(" ".repeat(prefixLen) + nomeLines[i]);
      // Extra: "   * TESTO"
      for (const ex of extras) {
        for (const r of wrap(ex, W - 4, "   * ")) righe.push(r);
      }
      // Rimozioni: "   # NO CIPOLLA"
      if (rimozioni.length > 0) {
        // Raggruppa tutte le rimozioni su una riga se ci stanno, altrimenti separa
        const tutte = rimozioni.join(" ");
        for (const r of wrap(tutte, W - 4, "   # ")) righe.push(r);
      }
    }
    righe.push(""); // spazio tra categorie
  }

  if (!hasContent) righe.push("(nessun prodotto)");

  righe.push(
    dash(),
    lr("Cliente:", (o.name ?? "").toUpperCase().slice(0, W - 9)),
    ...(o.phone ? [lr("Tel:", o.phone.slice(0, W - 5))] : []),
    lr("Pagamento:", o.pay === "online" ? "PAGATO" : "IN LOCO"),
    dash(),
    lr("TOTALE:", fmtEuro(o.total ?? 0)),
    ...(o.serviceCharge && o.serviceCharge > 0 ? [
      lr("  Costo servizio:", fmtEuro(o.serviceCharge)),
      lr("  Prodotti:", fmtEuro(Math.round(((o.total ?? 0) - o.serviceCharge) * 100) / 100)),
    ] : []),
    dash(),
    `PRONTO ALLE ${fmtOra(o.readyMin)}`,
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
