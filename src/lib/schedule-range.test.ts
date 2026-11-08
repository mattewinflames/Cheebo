import { describe, it, expect } from "vitest";
import { sessionsBetween, formatServiceKey, isPastServiceKey } from "./schedule";

// domenica 8 novembre 2026, ore 16:30
const NOW = new Date(2026, 10, 8, 16, 30);

describe("special su periodi lunghi", () => {
  it("una settimana intera segue gli orari: lunedì chiuso, pranzo solo mar–ven", () => {
    expect(sessionsBetween("2026-11-08", "2026-11-14", ["Pranzo", "Cena"], NOW)).toEqual([
      "2026-11-08-Cena",
      "2026-11-10-Pranzo", "2026-11-10-Cena",
      "2026-11-11-Pranzo", "2026-11-11-Cena",
      "2026-11-12-Pranzo", "2026-11-12-Cena",
      "2026-11-13-Pranzo", "2026-11-13-Cena",
      "2026-11-14-Cena",
    ]);
  });

  it("tutto il resto di novembre, solo cene: 19 sessioni", () => {
    const k = sessionsBetween("2026-11-08", "2026-11-30", ["Cena"], NOW);
    expect(k[0]).toBe("2026-11-08-Cena");
    expect(k[k.length - 1]).toBe("2026-11-29-Cena");   // il 30 è lunedì: chiuso
    expect(k).toHaveLength(19);
  });

  it("salta i giorni passati e i servizi di oggi già finiti", () => {
    expect(sessionsBetween("2026-11-01", "2026-11-08", ["Cena"], NOW)).toEqual(["2026-11-08-Cena"]);
    expect(sessionsBetween("2026-11-08", "2026-11-08", ["Cena"], new Date(2026, 10, 8, 23, 0))).toEqual([]);
  });

  it("formatta la chiave in modo leggibile e riconosce le sessioni passate", () => {
    expect(formatServiceKey("2026-11-10-Cena")).toBe("Mar 10/11 · Cena");
    expect(isPastServiceKey("2026-11-07-Cena", NOW)).toBe(true);
    expect(isPastServiceKey("2026-11-08-Cena", NOW)).toBe(false);
  });
});

import { compareServiceKeys, SERVICE_LABELS } from "./schedule";
describe("ordine dei servizi", () => {
  it("Pranzo viene prima di Cena, nello stesso giorno e nei pulsanti", () => {
    expect(SERVICE_LABELS).toEqual(["Pranzo", "Cena"]);
    expect(["2026-11-12-Cena", "2026-11-10-Cena", "2026-11-12-Pranzo"].sort(compareServiceKeys))
      .toEqual(["2026-11-10-Cena", "2026-11-12-Pranzo", "2026-11-12-Cena"]);
  });
});
