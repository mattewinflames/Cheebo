import { describe, it, expect } from "vitest";
import { griddlePatty, occupiesGriddle, cartPatties, type CartLine } from "./menu";

describe("piastra: il flag `griddle` decide chi occupa la piastra", () => {
  it("flag esplicito true/false ha la precedenza sull'id", () => {
    expect(occupiesGriddle({ id: "qualsiasi", griddle: true })).toBe(true);
    expect(occupiesGriddle({ id: "classic", griddle: false })).toBe(false); // override dell'id storico
    expect(griddlePatty({ id: "tempo1", griddle: true }, "doppio")).toBe(2);
    expect(griddlePatty({ id: "tempo1", griddle: true }, "triplo")).toBe(3);
    expect(griddlePatty({ id: "tempo2", griddle: false }, "triplo")).toBe(0);
  });

  it("senza flag: fallback sui tre smash storici (voci pre-esistenti)", () => {
    expect(occupiesGriddle({ id: "classic" })).toBe(true);
    expect(occupiesGriddle({ id: "oklahoma" })).toBe(true);
    expect(occupiesGriddle({ id: "crispy" })).toBe(true);
    expect(occupiesGriddle({ id: "chicken" })).toBe(false);
    expect(griddlePatty({ id: "classic" }, "singolo")).toBe(1);
    expect(griddlePatty({ id: "burgerveg" }, "doppio")).toBe(0);
  });

  it("cartPatties somma solo la capacità di piastra, non gli altri articoli", () => {
    const lines: CartLine[] = [
      { key: "a", label: "Classic doppio", price: 8, patty: 2, qty: 2 }, // 4 sulla piastra
      { key: "b", label: "Chicken", price: 9, patty: 0, qty: 3 },        // 0 (non da piastra)
      { key: "c", label: "Patatine fritte", price: 3.5, patty: 0, qty: 1 }, // 0 (side)
    ];
    expect(cartPatties(lines)).toBe(4);
  });
});

/* ------------------------------------------------------------------------- */

import { ingredientsOf, menuDrinkSurcharge, cartKey, cartLabel, cartPrice, type MenuItem, type PaninoConfig } from "./menu";

const panino = (o: Partial<MenuItem> = {}): MenuItem => ({
  id: "classic", type: "smash", name: "Classic", active: true, order: 1,
  desc: "American cheese, cipolla, insalata, pomodoro, salsa Cheebo",
  solo: 6, menu: 11.5, ...o,
});
const bibita = (o: Partial<MenuItem> = {}): MenuItem => ({
  id: "soft", type: "drink", name: "Soft drink", active: true, order: 15, price: 2.5, ...o,
});

describe("ingredienti togliibili", () => {
  it("usa il campo esplicito quando c'è", () => {
    expect(ingredientsOf(panino({ ingredients: ["cipolla", "bacon"] }))).toEqual(["cipolla", "bacon"]);
  });
  it("altrimenti li ricava dalla descrizione, che è già un elenco", () => {
    expect(ingredientsOf(panino())).toEqual(["American cheese", "cipolla", "insalata", "pomodoro", "salsa Cheebo"]);
  });
  it("non esplode senza descrizione", () => {
    expect(ingredientsOf({ })).toEqual([]);
  });
});

describe("sovrapprezzo della bibita nel menu", () => {
  it("il valore esplicito ha la precedenza", () => {
    expect(menuDrinkSurcharge(bibita({ price: 5, menuSurcharge: 3 }))).toBe(3);
  });
  it("altrimenti è la differenza con la bibita compresa", () => {
    expect(menuDrinkSurcharge(bibita({ price: 3.5 }))).toBe(1);
  });
  it("una bibita più economica non genera sconto", () => {
    expect(menuDrinkSurcharge(bibita({ id: "acqua", price: 1.5 }))).toBe(0);
  });
});

describe("configurazione del panino · chiave, etichetta, prezzo", () => {
  const base: PaninoConfig = { item: panino(), format: "singolo", type: "panino" };

  it("stesso prodotto = stessa chiave, a prescindere dall'ordine di scelta", () => {
    const a: PaninoConfig = { ...base, extras: [{ id: "bacon", name: "Bacon", price: 1.5, q: 1 }, { id: "pickles", name: "Pickles", price: 1, q: 2 }], removed: ["pomodoro", "cipolla"] };
    const b: PaninoConfig = { ...base, extras: [{ id: "pickles", name: "Pickles", price: 1, q: 2 }, { id: "bacon", name: "Bacon", price: 1.5, q: 1 }], removed: ["cipolla", "pomodoro"] };
    expect(cartKey(a)).toBe(cartKey(b));
  });

  it("rimozioni diverse restano righe distinte", () => {
    expect(cartKey({ ...base, removed: ["cipolla"] })).not.toBe(cartKey({ ...base, removed: ["pomodoro"] }));
    expect(cartKey({ ...base, removed: ["cipolla"] })).not.toBe(cartKey(base));
  });

  it("bibite diverse nel menu restano righe distinte", () => {
    const conSoft: PaninoConfig = { ...base, type: "menu", drink: bibita() };
    const conBirra: PaninoConfig = { ...base, type: "menu", drink: bibita({ id: "birrac", name: "Birra artigianale", price: 5 }) };
    expect(cartKey(conSoft)).not.toBe(cartKey(conBirra));
  });

  it("la bibita non compare nella chiave se non è un menu", () => {
    expect(cartKey({ ...base, drink: bibita() })).toBe(cartKey(base));
  });

  it("l'etichetta è leggibile in comanda", () => {
    const c: PaninoConfig = {
      item: panino(), format: "doppio", type: "menu",
      drink: bibita({ id: "birrac", name: "Birra artigianale", price: 5, menuSurcharge: 3 }),
      extras: [{ id: "bacon", name: "Bacon", price: 1.5, q: 1 }],
      removed: ["cipolla"],
    };
    expect(cartLabel(c)).toBe("Classic doppio · menu con birra artigianale + bacon · senza cipolla");
  });

  it("il prezzo somma formato, sovrapprezzo bibita ed extra", () => {
    const c: PaninoConfig = {
      item: panino(), format: "doppio", type: "menu",           // 11,50 + 2
      drink: bibita({ price: 5, menuSurcharge: 3 }),            // + 3
      extras: [{ id: "bacon", name: "Bacon", price: 1.5, q: 2 }], // + 3
    };
    expect(cartPrice(c)).toBe(19.5);
  });

  it("togliere ingredienti non cambia il prezzo", () => {
    expect(cartPrice({ ...base, removed: ["cipolla", "pomodoro"] })).toBe(cartPrice(base));
  });

  it("la bibita non incide se non è un menu", () => {
    expect(cartPrice({ ...base, drink: bibita({ price: 5, menuSurcharge: 3 }) })).toBe(6);
  });
});

describe("sostituzioni (pane / formaggio vegano)", () => {
  const conSwaps = panino({
    swaps: [{ id: "panevegano", name: "Pane vegano" }, { id: "formvegano", name: "Formaggio vegano" }],
  });
  const base: PaninoConfig = { item: conSwaps, format: "singolo", type: "panino" };

  it("scelte diverse restano righe distinte", () => {
    expect(cartKey({ ...base, swaps: ["panevegano"] })).not.toBe(cartKey(base));
    expect(cartKey({ ...base, swaps: ["panevegano"] })).not.toBe(cartKey({ ...base, swaps: ["formvegano"] }));
  });

  it("l'ordine di selezione non conta", () => {
    expect(cartKey({ ...base, swaps: ["formvegano", "panevegano"] }))
      .toBe(cartKey({ ...base, swaps: ["panevegano", "formvegano"] }));
  });

  it("una sostituzione non prevista dal panino viene ignorata", () => {
    expect(cartKey({ ...base, swaps: ["inesistente"] })).toBe(cartKey(base));
    expect(cartPrice({ ...base, swaps: ["inesistente"] })).toBe(cartPrice(base));
  });

  it("senza prezzo non costano nulla", () => {
    expect(cartPrice({ ...base, swaps: ["panevegano", "formvegano"] })).toBe(cartPrice(base));
  });

  it("se un domani avranno un prezzo, si somma", () => {
    const aPagamento = panino({ swaps: [{ id: "panevegano", name: "Pane vegano", price: 1.5 }] });
    expect(cartPrice({ item: aPagamento, format: "singolo", type: "panino", swaps: ["panevegano"] })).toBe(7.5);
  });

  it("compaiono in comanda", () => {
    expect(cartLabel({ ...base, swaps: ["panevegano"], removed: ["Cipolla"] }))
      .toBe("Classic singolo · con pane vegano · senza cipolla");
  });
});
