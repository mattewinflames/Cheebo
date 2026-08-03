/* ============================================================================
   CHEEBO · Orari, sessione corrente e sessioni future
   ========================================================================== */

import type { Service } from "./dispatch.js";

export interface ServiceDef { label: string; start: string; end: string } // end "24:00" ammesso

// getDay(): 0 = Domenica ... 6 = Sabato
export const SCHEDULE: Record<number, ServiceDef[]> = {
  0: [{ label: "Cena", start: "19:30", end: "22:30" }],
  1: [],
  2: [{ label: "Pranzo", start: "12:30", end: "14:30" }, { label: "Cena", start: "19:30", end: "22:30" }],
  3: [{ label: "Pranzo", start: "12:30", end: "14:30" }, { label: "Cena", start: "19:30", end: "22:30" }],
  4: [{ label: "Pranzo", start: "12:30", end: "14:30" }, { label: "Cena", start: "19:30", end: "22:30" }],
  5: [{ label: "Pranzo", start: "12:30", end: "14:30" }, { label: "Cena", start: "19:30", end: "24:00" }],
  6: [{ label: "Cena", start: "19:30", end: "24:00" }],
};

export const BOOKING_DAYS_AHEAD = 7;

export const toMin = (hm: string): number => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};
const endToMin = (end: string): number => (end === "24:00" ? 1440 : toMin(end));
export const dateKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface ActiveSession extends Service {
  serviceKey: string;
  label: string;
}

/** Servizio attivo ORA (o null se chiuso / tra due servizi). */
export function resolveService(now: Date = new Date()): ActiveSession | null {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (const d of SCHEDULE[now.getDay()] ?? []) {
    const startMin = toMin(d.start);
    const endMin = endToMin(d.end);
    if (nowMin >= startMin && nowMin < endMin)
      return { serviceKey: `${dateKey(now)}-${d.label}`, label: d.label, startMin, endMin };
  }
  return null;
}

export interface UpcomingSession extends ActiveSession {
  dayLabel: string; // "Oggi" / "Domani" / "Lun 16"
  dateLabel: string;
}

/** Ricava il servizio (orari) da un serviceKey `YYYY-MM-DD-Label`. Autoritativo:
 *  gli orari vengono dal calendario, MAI da ciò che manda il client. Ritorna
 *  null se il giorno non ha quel servizio (chiave inventata o servizio inesistente). */
export function serviceFromKey(serviceKey: string): Service | null {
  const m = serviceKey.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
  if (!m) return null;
  const [, y, mo, d, label] = m;
  const day = new Date(Number(y), Number(mo) - 1, Number(d)).getDay();
  const def = (SCHEDULE[day] ?? []).find((s) => s.label === label);
  if (!def) return null;
  return { startMin: toMin(def.start), endMin: endToMin(def.end), label: def.label };
}

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

/** Sessioni prenotabili: il resto di oggi + i prossimi giorni, fino a
 *  BOOKING_DAYS_AHEAD. Con `opts` si applicano le chiusure (#47): se `blocked`
 *  non è prenotabile nulla; i giorni in `closedDays` (date "YYYY-MM-DD") sono
 *  esclusi. Filtro di sola UX: il blocco vero è nel server (create-booking). */
export function upcomingSessions(
  now: Date = new Date(),
  daysAhead = BOOKING_DAYS_AHEAD,
  opts: { blocked?: boolean; closedDays?: string[] } = {},
): UpcomingSession[] {
  if (opts.blocked) return [];
  const closed = new Set(opts.closedDays ?? []);
  const out: UpcomingSession[] = [];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  for (let off = 0; off <= daysAhead; off++) {
    const d = new Date(now);
    d.setDate(now.getDate() + off);
    if (closed.has(dateKey(d))) continue; // giorno di chiusura: salta tutti i suoi servizi
    const defs = SCHEDULE[d.getDay()] ?? [];
    for (const def of defs) {
      const startMin = toMin(def.start);
      const endMin = endToMin(def.end);
      if (off === 0 && nowMin >= endMin) continue; // servizio già finito oggi
      const dayLabel = off === 0 ? "Oggi" : off === 1 ? "Domani" : `${WEEKDAYS[d.getDay()]} ${d.getDate()}`;
      out.push({
        serviceKey: `${dateKey(d)}-${def.label}`,
        label: def.label, startMin, endMin,
        dayLabel, dateLabel: `${WEEKDAYS[d.getDay()]} ${d.getDate()}`,
      });
    }
  }
  return out;
}
