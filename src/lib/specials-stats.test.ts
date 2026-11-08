import { describe, it, expect } from "vitest";
import { computeSpecialStats } from "./analytics";
import type { Order } from "./orders";

const o = (p: Partial<Order>): Order => ({
  id: "x", serviceKey: "2026-11-08-Cena", name: "n", items: [], patties: 0, windowIndex: 0, readyMin: 0,
  mode: "first", pay: "online", total: 10, code: 1, phone: "", status: "nuovo", ...p,
} as Order);

const SP = [
  { id: "bigbruce", name: "Big Bruce", price: 15 },
  { id: "bbveg", name: "Big Bruce Vegetariano", price: 15, veg: true },
];

describe("statistiche special", () => {
  it("riconosce gli ordini vecchi dall'etichetta, senza confondere i nomi simili", () => {
    const r = computeSpecialStats([
      o({ items: ["Big Bruce", "Crispy doppio · menu con coca-cola"] }),
      o({ items: ["2× Big Bruce Vegetariano"] }),
      o({ items: ["3× Big Bruce"], serviceKey: "2026-11-10-Pranzo" }),
    ], SP);
    expect(r.map((s) => [s.id, s.qty])).toEqual([["bigbruce", 4], ["bbveg", 2]]);
    expect(r[0].servizi).toBe(2);
    expect(r[0].best).toEqual({ serviceKey: "2026-11-10-Pranzo", qty: 3 });
    expect(r[0].incassoStimato).toBe(60);
  });

  it("negli ordini nuovi usa il campo specials (e non conta due volte l'etichetta)", () => {
    const r = computeSpecialStats([o({ items: ["2× Big Bruce"], specials: { bigbruce: 2 } })], SP);
    expect(r).toHaveLength(1);
    expect(r[0].qty).toBe(2);
  });

  it("ignora gli ordini a totale zero e i panini normali", () => {
    expect(computeSpecialStats([o({ items: ["Big Bruce"], total: 0 }), o({ items: ["Classic singolo"] })], SP)).toEqual([]);
  });
});
