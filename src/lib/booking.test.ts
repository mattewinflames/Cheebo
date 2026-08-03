import { describe, it, expect } from "vitest";
import { resolveCart, isResolveError, type CartReqLine } from "./booking";
import { serviceFromKey } from "./schedule";
import { ledgerFromMap, ledgerToMap } from "./dispatch";
import type { MenuItem } from "./menu";

const KEY = "2026-07-30-Cena"; // 30/07/2026 è giovedì → ha una Cena 19:30–22:30

const menu: MenuItem[] = [
  { id: "classic", type: "smash", name: "Classic", active: true, order: 1, solo: 6, menu: 11.5, griddle: true,
    swaps: [{ id: "panevegano", name: "Pane vegano" }] },
  { id: "cola",   type: "drink", name: "Cola", active: true, order: 20, price: 3.5 }, // +1,00 nel menu
  { id: "acqua",  type: "drink", name: "Acqua", active: true, order: 21, price: 2.0 }, // compresa
  { id: "patatine", type: "side", name: "Patatine", active: true, order: 30, price: 3 },
  { id: "lobster", type: "smash", name: "Lobster Roll", active: true, order: 2, solo: 22, menu: 27,
    special: { serviceKeys: [KEY], stock: 70 } },
  { id: "spento", type: "side", name: "Spento", active: false, order: 40, price: 5 },
];

const ok = (r: ReturnType<typeof resolveCart>) => { if (isResolveError(r)) throw new Error(r.error); return r; };

describe("resolveCart · prezzo ricostruito dal menù (mai dal client)", () => {
  it("panino menu con formato, bibita, extra e sostituzione: prezzo autoritativo", () => {
    const cart: CartReqLine[] = [
      { kind: "panino", itemId: "classic", format: "doppio", type: "menu", drinkId: "cola",
        extras: [{ id: "bacon", q: 1 }], swaps: ["panevegano"], qty: 2 },
    ];
    const r = ok(resolveCart(menu, KEY, cart));
    // 11,5 (menu) + 2 (doppio) + 1,0 (cola nel menu) + 1,5 (bacon) + 0 (pane vegano) = 16,0
    expect(r.lines[0].price).toBe(16);
    expect(r.lines[0].patty).toBe(2);         // classic è da piastra, doppio = 2 patty
    expect(r.total).toBe(32);
    expect(r.patties).toBe(4);
    expect(r.stripeLineItems[0]).toEqual({ name: r.lines[0].label, amount: 1600, qty: 2 });
  });

  it("scarta gli extra sconosciuti e le sostituzioni non previste dal panino", () => {
    const r = ok(resolveCart(menu, KEY, [
      { kind: "panino", itemId: "classic", format: "singolo", type: "panino",
        extras: [{ id: "oro_massiccio", q: 5 }], swaps: ["inesistente"], qty: 1 },
    ]));
    expect(r.lines[0].price).toBe(6);         // solo il prezzo base: niente extra fantasma
  });

  it("lo special usa il prezzo `solo` ed è legato alla sessione", () => {
    const r = ok(resolveCart(menu, KEY, [{ kind: "special", itemId: "lobster", qty: 3 }]));
    expect(r.lines[0].price).toBe(22);
    expect(r.lines[0].specialId).toBe("lobster");
    expect(r.specials).toEqual({ lobster: 3 });
    expect(r.patties).toBe(0);
  });

  it("una voce semplice prende il prezzo della voce", () => {
    const r = ok(resolveCart(menu, KEY, [{ kind: "simple", itemId: "patatine", qty: 2 }]));
    expect(r.total).toBe(6);
    expect(r.patties).toBe(0);
  });
});

describe("resolveCart · rifiuti", () => {
  const bad = (cart: CartReqLine[], key = KEY) => {
    const r = resolveCart(menu, key, cart);
    expect(isResolveError(r)).toBe(true);
  };
  it("carrello vuoto", () => bad([]));
  it("voce inesistente", () => bad([{ kind: "simple", itemId: "boh", qty: 1 }]));
  it("voce disattivata", () => bad([{ kind: "simple", itemId: "spento", qty: 1 }]));
  it("quantità non valida", () => bad([{ kind: "simple", itemId: "patatine", qty: 0 }]));
  it("special fuori sessione", () => bad([{ kind: "special", itemId: "lobster", qty: 1 }], "2026-08-01-Cena"));
  it("special ordinato come panino", () => bad([{ kind: "panino", itemId: "lobster", format: "singolo", type: "panino", qty: 1 }]));
  it("panino ordinato come voce semplice", () => bad([{ kind: "simple", itemId: "classic", qty: 1 }]));
});

describe("serviceFromKey · orari dal calendario, non dal client", () => {
  it("chiave valida → orari del servizio", () => {
    expect(serviceFromKey(KEY)).toEqual({ startMin: 19 * 60 + 30, endMin: 22 * 60 + 30, label: "Cena" });
  });
  it("sabato la Cena arriva a mezzanotte", () => {
    expect(serviceFromKey("2026-08-01-Cena")?.endMin).toBe(1440); // 01/08/2026 è sabato
  });
  it("formato non valido → null", () => {
    expect(serviceFromKey("non-una-chiave")).toBeNull();
  });
  it("servizio inesistente quel giorno → null", () => {
    expect(serviceFromKey("2026-08-03-Pranzo")).toBeNull(); // 03/08/2026 è lunedì: chiuso
  });
});

describe("ledger · andata e ritorno mappa↔array", () => {
  it("mappa sparsa → array denso e viceversa", () => {
    expect(ledgerFromMap({ "2": 3, "5": 1 }, 6)).toEqual([0, 0, 3, 0, 0, 1]);
    expect(ledgerToMap([0, 0, 3, 0, 0, 1])).toEqual({ "2": 3, "5": 1 });
  });
  it("indici fuori range vengono ignorati", () => {
    expect(ledgerFromMap({ "9": 4 }, 3)).toEqual([0, 0, 0]);
  });
});
