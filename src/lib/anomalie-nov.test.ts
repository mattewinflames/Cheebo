import { describe, it, expect } from "vitest";
import { romeNow, isOnlyClosedPause, minWindowNow } from "./schedule";
import { hasFormats } from "./menu";
import { resolveCart } from "./booking";
import type { MenuItem } from "./menu";

// martedì 17 novembre 2026, 19:52 a Roma (CET, UTC+1) = 18:52 UTC
const ISTANTE = new Date(Date.UTC(2026, 10, 17, 18, 52, 0));
const CENA = { startMin: 19 * 60 + 30, endMin: 22 * 60 + 30 };

describe("ora di Roma sul server", () => {
  it("romeNow dà l'ora di Roma qualunque sia il fuso della macchina", () => {
    const r = romeNow(ISTANTE);
    expect([r.getHours(), r.getMinutes(), r.getDate()]).toEqual([19, 52, 17]);
  });

  it("con l'ora legale (ottobre) la differenza è di 2 ore", () => {
    const r = romeNow(new Date(Date.UTC(2026, 9, 10, 17, 52, 0)));   // 19:52 CEST
    expect([r.getHours(), r.getMinutes()]).toEqual([19, 52]);
  });

  it("alle 19:52 le fasce 19:40 e 19:50 sono già passate (prima il server le accettava)", () => {
    const now = romeNow(ISTANTE);
    expect(minWindowNow("2026-11-17-Cena", CENA, now)).toBe(2);   // finestre 0 e 1 scartate
  });
});

describe("pausa solo fuori orario", () => {
  const settings = { onlyClosedBooking: true, onlyClosedSchedule: { 2: [{ start: "19:30", end: "22:30" }] } };
  it("alle 19:52 di martedì è in pausa fino alle 22:30", () => {
    expect(isOnlyClosedPause(settings, romeNow(ISTANTE))).toEqual({ paused: true, until: "22:30" });
  });
  it("prima dell'apertura e con l'opzione spenta non è in pausa", () => {
    expect(isOnlyClosedPause(settings, new Date(2026, 10, 17, 18, 0)).paused).toBe(false);
    expect(isOnlyClosedPause({ ...settings, onlyClosedBooking: false }, romeNow(ISTANTE)).paused).toBe(false);
  });
});

describe("formato unico per i Burgers", () => {
  const chicken = { id: "chicken", type: "burger", name: "Chicken", solo: 9, menu: 14.5, active: true, order: 5 } as MenuItem;
  const classic = { id: "classic", type: "smash", name: "Classic", solo: 6, menu: 11.5, active: true, order: 0, griddle: true } as MenuItem;
  it("solo gli smash hanno i formati", () => {
    expect(hasFormats(classic)).toBe(true);
    expect(hasFormats(chicken)).toBe(false);
    expect(hasFormats({ ...classic, singleFormatOnly: true })).toBe(false);
  });
  it("un 'Chicken triplo' mandato dal client diventa Chicken a 9€", () => {
    const r = resolveCart([chicken], "2026-11-17-Cena", [{ kind: "panino", itemId: "chicken", format: "triplo", type: "panino", qty: 1 } as never]);
    if ("error" in r) throw new Error(r.error);
    expect(r.items).toEqual(["Chicken"]);
    expect(r.total).toBe(9);
  });
  it("il Classic triplo resta triplo a +4€", () => {
    const r = resolveCart([classic], "2026-11-17-Cena", [{ kind: "panino", itemId: "classic", format: "triplo", type: "panino", qty: 1 } as never]);
    if ("error" in r) throw new Error(r.error);
    expect(r.items).toEqual(["Classic triplo"]);
    expect(r.total).toBe(10);
  });
});
