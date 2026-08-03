/* ============================================================================
   CHEEBO · Export del riepilogo gestionale
   ----------------------------------------------------------------------------
   ⚠️ DOCUMENTO GESTIONALE, PRIVO DI VALORE FISCALE.
   Questo export NON è una chiusura fiscale e non sostituisce il registratore
   telematico: serve a riconciliare quanto incassato (contanti / carta / online)
   con la chiusura giornaliera dell'RT, dove i corrispettivi vengono trasmessi
   in forma aggregata insieme alle modalità di pagamento.

   Nessun dato personale dei clienti (nome, telefono) finisce nell'export: per
   riconciliare gli incassi non serve, e il codice di ritiro basta a risalire
   all'ordine.
   ========================================================================== */

import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";
import type { Order } from "./orders";

/* ---------------------------------------------------------------- modello */

export interface ExportRow {
  data: string;        // ISO, ordinabile e inequivocabile
  servizio: string;    // Pranzo | Cena
  codice: number;      // codice di ritiro
  canale: string;      // Banco | Prenotazione
  metodo: string;      // Contanti | Carta | Online
  articoli: string;
  totale: number;
}

export interface SummaryRow {
  data: string;
  servizio: string;
  ordini: number;
  contanti: number;
  carta: number;
  online: number;
  totale: number;
}

const COLS: (keyof ExportRow)[] = ["data", "servizio", "codice", "canale", "metodo", "articoli", "totale"];
const HEAD = ["Data", "Servizio", "Codice", "Canale", "Metodo", "Articoli", "Totale €"];
const SUM_HEAD = ["Data", "Servizio", "Ordini", "Contanti €", "Carta €", "Online €", "Totale €"];

/** `2026-07-22-Cena` → data e servizio. Il serviceKey inizia con la data ISO. */
const splitKey = (k: string) => ({ data: k.slice(0, 10), servizio: k.slice(11) || "—" });

const metodoOf = (o: Order): string =>
  o.pay === "online" ? "Online" : o.tender === "carta" ? "Carta" : o.tender === "contanti" ? "Contanti" : "Cassa";

/* ------------------------------------------------------------- lettura DB */

/**
 * Ordini in un intervallo di date (estremi inclusi, formato `YYYY-MM-DD`).
 * Query di RANGE su un solo campo: usa l'indice automatico e non richiede
 * indici compositi (cfr. bug #7). Ordinamento fatto lato client.
 */
export async function fetchOrdersRange(from: string, to: string): Promise<Order[]> {
  const q = query(
    collection(db, "orders"),
    where("serviceKey", ">=", from),
    where("serviceKey", "<=", to + "\uf8ff"),
  );
  const snap = await getDocs(q);
  const out = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Order[];
  return out.sort((a, b) =>
    a.serviceKey !== b.serviceKey ? a.serviceKey.localeCompare(b.serviceKey) : (a.code ?? 0) - (b.code ?? 0),
  );
}

/* --------------------------------------------------------- trasformazioni */

export function buildRows(orders: Order[]): ExportRow[] {
  return orders.map((o) => {
    const { data, servizio } = splitKey(o.serviceKey);
    return {
      data,
      servizio,
      codice: o.code ?? 0,
      canale: o.channel === "banco" ? "Banco" : "Prenotazione",
      metodo: metodoOf(o),
      articoli: (o.items ?? []).join(" | "),
      totale: o.total ?? 0,
    };
  });
}

/** Un riepilogo per servizio: è la riga da confrontare con la chiusura dell'RT. */
export function summarize(orders: Order[]): SummaryRow[] {
  const acc = new Map<string, SummaryRow>();
  for (const o of orders) {
    const { data, servizio } = splitKey(o.serviceKey);
    const r = acc.get(o.serviceKey) ?? { data, servizio, ordini: 0, contanti: 0, carta: 0, online: 0, totale: 0 };
    const t = o.total ?? 0;
    r.ordini += 1;
    r.totale += t;
    if (o.pay === "online") r.online += t;
    else if (o.tender === "carta") r.carta += t;
    else r.contanti += t;
    acc.set(o.serviceKey, r);
  }
  return [...acc.values()].sort((a, b) => (a.data + a.servizio).localeCompare(b.data + b.servizio));
}

/* --------------------------------------------------------------- download */

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* -------------------------------------------------------------------- CSV */

/** Excel italiano: separatore `;`, decimali con la virgola, UTF-8 con BOM. */
const cell = (v: string | number): string => {
  if (typeof v === "number") return v.toFixed(2).replace(".", ",");
  const s = String(v ?? "");
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(rows: ExportRow[]): string {
  const lines = [HEAD.join(";"), ...rows.map((r) => COLS.map((c) => cell(r[c] as string | number)).join(";"))];
  return "\uFEFF" + lines.join("\r\n"); // BOM: senza, accenti ed € escono corrotti
}

export function downloadCSV(rows: ExportRow[], filename: string) {
  saveBlob(new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8" }), filename + ".csv");
}

/* ------------------------------------------------------------------- XLSX */

/**
 * Due fogli — Dettaglio e Riepilogo — con i numeri come numeri veri, quindi
 * sommabili e usabili in tabella pivot. La libreria viene caricata solo qui,
 * con import dinamico: chi esporta in CSV non se la porta nel bundle.
 */
export async function downloadXLSX(rows: ExportRow[], summary: SummaryRow[], filename: string) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();

  const det = XLSX.utils.aoa_to_sheet([
    HEAD,
    ...rows.map((r) => [r.data, r.servizio, r.codice, r.canale, r.metodo, r.articoli, r.totale]),
  ]);
  det["!cols"] = [{ wch: 11 }, { wch: 9 }, { wch: 8 }, { wch: 13 }, { wch: 10 }, { wch: 56 }, { wch: 11 }];
  XLSX.utils.book_append_sheet(wb, det, "Dettaglio");

  const totale = summary.reduce(
    (a, r) => ({ ordini: a.ordini + r.ordini, contanti: a.contanti + r.contanti, carta: a.carta + r.carta, online: a.online + r.online, totale: a.totale + r.totale }),
    { ordini: 0, contanti: 0, carta: 0, online: 0, totale: 0 },
  );
  const rie = XLSX.utils.aoa_to_sheet([
    ["Riepilogo gestionale — documento privo di valore fiscale"],
    ["La chiusura fiscale resta a carico del registratore telematico."],
    [],
    SUM_HEAD,
    ...summary.map((r) => [r.data, r.servizio, r.ordini, r.contanti, r.carta, r.online, r.totale]),
    [],
    ["TOTALE", "", totale.ordini, totale.contanti, totale.carta, totale.online, totale.totale],
  ]);
  rie["!cols"] = [{ wch: 11 }, { wch: 9 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, rie, "Riepilogo");

  XLSX.writeFile(wb, filename + ".xlsx");
}
