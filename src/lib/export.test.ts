import { describe, it, expect } from "vitest";
import { buildRows, summarize, toCSV } from "./export";
import type { Order } from "./orders";

const ord = (p: Partial<Order>): Order => ({
  id: "x", serviceKey: "2026-07-22-Cena", name: "Tizio", items: ["Classic singolo"],
  patties: 1, windowIndex: 0, readyMin: 1180, mode: "first", pay: "loco",
  total: 6, code: 1, phone: "", status: "nuovo", ...p,
});

describe("export · righe di dettaglio", () => {
  it("scompone il serviceKey in data e servizio", () => {
    const [r] = buildRows([ord({ serviceKey: "2026-07-22-Cena" })]);
    expect(r.data).toBe("2026-07-22");
    expect(r.servizio).toBe("Cena");
  });

  it("etichetta canale e metodo di pagamento", () => {
    const rows = buildRows([
      ord({ pay: "online" }),
      ord({ pay: "loco", channel: "banco", tender: "contanti" }),
      ord({ pay: "loco", channel: "banco", tender: "carta" }),
    ]);
    expect(rows.map((r) => r.metodo)).toEqual(["Online", "Contanti", "Carta"]);
    expect(rows.map((r) => r.canale)).toEqual(["Prenotazione", "Banco", "Banco"]);
  });

  it("non espone dati personali del cliente", () => {
    const [r] = buildRows([ord({ name: "Mario Rossi", phone: "3331234567" })]);
    const dump = JSON.stringify(r);
    expect(dump).not.toContain("Mario Rossi");
    expect(dump).not.toContain("3331234567");
  });
});

describe("export · riepilogo per servizio", () => {
  it("somma per metodo e raggruppa per sessione", () => {
    const s = summarize([
      ord({ serviceKey: "2026-07-22-Cena", pay: "online", total: 10 }),
      ord({ serviceKey: "2026-07-22-Cena", pay: "loco", tender: "contanti", total: 6 }),
      ord({ serviceKey: "2026-07-22-Cena", pay: "loco", tender: "carta", total: 4 }),
      ord({ serviceKey: "2026-07-23-Pranzo", pay: "loco", tender: "contanti", total: 8 }),
    ]);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ data: "2026-07-22", servizio: "Cena", ordini: 3, online: 10, contanti: 6, carta: 4, totale: 20 });
    expect(s[1]).toMatchObject({ data: "2026-07-23", servizio: "Pranzo", ordini: 1, contanti: 8, totale: 8 });
  });
});

describe("export · CSV per Excel italiano", () => {
  it("ha esattamente le colonne previste, senza dati di produzione", () => {
    const header = toCSV(buildRows([ord({})])).replace("\uFEFF", "").split("\r\n")[0];
    expect(header).toBe("Data;Servizio;Codice;Canale;Metodo;Articoli;Totale €");
    expect(header.toLowerCase()).not.toContain("patty");
  });

  it("usa BOM, separatore ; e decimali con la virgola", () => {
    const csv = toCSV(buildRows([ord({ total: 12.5 })]));
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain(";");
    expect(csv).toContain("12,50");
    expect(csv).not.toContain("12.50");
  });

  it("protegge i campi che contengono il separatore", () => {
    const csv = toCSV(buildRows([ord({ items: ["Classic; doppio"] })]));
    expect(csv).toContain('"Classic; doppio"');
  });

  it("raddoppia le virgolette interne", () => {
    const csv = toCSV(buildRows([ord({ items: ['Panino "speciale"'] })]));
    expect(csv).toContain('"Panino ""speciale"""');
  });
});
