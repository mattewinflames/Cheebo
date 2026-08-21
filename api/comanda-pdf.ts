/* ============================================================================
   GET /api/comanda-pdf?orderId=...
   ----------------------------------------------------------------------------
   Genera e scarica la comanda in PDF (80mm) per un ordine.
   Usato dall'AdminCassa al posto di window.print() — aggira il problema
   del formato carta A4 di Chrome.
   ========================================================================== */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import PDFDocument from "pdfkit";
import { adminDb } from "./_lib/admin.js";
import { ORDERS } from "./_lib/holds.js";

const MM = 2.8346; // 1mm in pt

function ora(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
function euroStr(euro: number) {
  return euro.toFixed(2).replace(".", ",") + "€";
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
    items: string[]; total: number; pay: string;
  };

  // --- Dimensioni ---
  const W = 80 * MM;    // 80mm in pt
  const M = 3 * MM;     // margine laterale
  const AREA = W - 2 * M;

  const doc = new PDFDocument({
    size: [W, 999 * MM], // altezza grande: verrà ritagliata
    margins: { top: M, bottom: M, left: M, right: M },
    autoFirstPage: true,
    info: { Title: `Comanda #${o.code ?? "—"}` },
  });

  // Raccogliamo i chunk in memoria
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const y = { v: M }; // cursore verticale
  const down = (mm: number) => { y.v += mm * MM; };

  function dash() {
    doc.moveTo(M, y.v).lineTo(W - M, y.v)
      .dash(2, { space: 2 }).strokeColor("#999").lineWidth(0.5).stroke();
    doc.undash();
    down(4);
  }

  function centerText(text: string, size: number, bold = false) {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
    doc.text(text, M, y.v, { width: AREA, align: "center", lineBreak: false });
    down(size * 0.4 + 1);
  }

  function rowText(left: string, right: string, sizeLeft = 8, sizeRight = 9, bold = false) {
    doc.font("Helvetica").fontSize(sizeLeft).fillColor("#666");
    doc.text(left, M, y.v, { lineBreak: false });
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(sizeRight).fillColor("#000");
    doc.text(right, M, y.v, { width: AREA, align: "right", lineBreak: false });
    down(sizeRight * 0.4 + 2);
    doc.fillColor("#000");
  }

  // --- Logo ---
  // Il logo è un file statico: in Vercel è in /public, non accessibile
  // direttamente dal filesystem della funzione. Lo saltiamo e usiamo solo testo.
  // (Il logo si può aggiungere in futuro embeddando il PNG in base64 nel codice.)

  // --- Intestazione ---
  down(1);
  centerText("CHEEBO", 14, true);
  down(0.5);
  centerText("COMANDA CUCINA", 7);
  down(1);
  dash();

  // --- Codice ritiro ---
  down(1);
  doc.font("Helvetica-Bold").fontSize(48).fillColor("#000");
  doc.text(`#${o.code ?? "—"}`, M, y.v, { width: AREA, align: "center", lineBreak: false });
  down(18);

  // --- Orario ---
  centerText("PRONTO ALLE", 7);
  down(0.5);
  doc.font("Helvetica-Bold").fontSize(22).fillColor("#000");
  doc.text(ora(o.readyMin), M, y.v, { width: AREA, align: "center", lineBreak: false });
  down(9);
  down(2);
  dash();

  // --- Cliente ---
  down(1);
  rowText("Cliente", o.name.toUpperCase(), 8, 10, true);
  if (o.phone) rowText("Tel", o.phone, 8, 9);
  down(1);
  dash();

  // --- Voci ordine ---
  down(1);
  for (const item of o.items) {
    const isExtra = item.startsWith("  ") || item.startsWith("+");
    doc.font(isExtra ? "Helvetica" : "Helvetica-Bold")
      .fontSize(isExtra ? 8 : 10)
      .fillColor(isExtra ? "#444" : "#000");
    const xOff = isExtra ? M + 3 * MM : M;
    doc.text(item.trim(), xOff, y.v, { width: AREA - (isExtra ? 3 * MM : 0), lineBreak: true });
    down(isExtra ? 1.5 : 3);
  }
  down(1);
  dash();

  // --- Totale ---
  down(0.5);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#000");
  doc.text("TOTALE", M, y.v, { lineBreak: false });
  doc.text(euroStr(o.total ?? 0), M, y.v, { width: AREA, align: "right", lineBreak: false });
  down(5);

  doc.font("Helvetica").fontSize(8).fillColor("#555");
  doc.text("Pagamento", M, y.v, { lineBreak: false });
  doc.font("Helvetica-Bold").fillColor("#000");
  doc.text(o.pay === "online" ? "✓ PAGATO" : "IN LOCO", M, y.v, { width: AREA, align: "right", lineBreak: false });
  down(5);
  dash();

  // --- Footer ---
  doc.font("Helvetica").fontSize(7).fillColor("#888");
  doc.text("Bite the East Side · La Rustica", M, y.v, { width: AREA, align: "center", lineBreak: false });
  down(4);

  // Ritaglia la pagina all'altezza effettiva
  const altezza = y.v + M;
  (doc as any).page.size = [W, altezza]; // aggiorna dimensione pagina
  doc.end();

  await new Promise<void>((resolve) => doc.on("end", resolve));

  const pdf = Buffer.concat(chunks);
  const filename = `comanda-${o.code ?? orderId.slice(0, 6)}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdf.length);
  res.status(200).send(pdf);
}
