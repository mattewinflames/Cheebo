/* ============================================================================
   CHEEBO · Impostazioni dell'attività (settings/app su Firestore)
   ----------------------------------------------------------------------------
   Opzioni che valgono per il locale su TUTTI i dispositivi (non per-browser).
   Le scrive solo l'admin; la lettura è pubblica, perché il sito cliente deve
   sapere se le prenotazioni sono bloccate o quali giorni sono chiusi (vedi
   firestore.rules -> match /settings).
   Pensato per crescere: è il punto unico dove aggiungere futuri interruttori
   quando Cheebo diventerà uno scheletro riconfigurabile per più attività.
   ========================================================================== */
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import { SCHEDULE } from "./schedule";

export interface AppSettings {
  /** Abilita la scheda Cassa (POS al banco) nell'area admin. */
  cassaEnabled: boolean;
  /** Blocco immediato: se true, nessuna nuova prenotazione online è accettata
   *  (imprevisti — cuoco assente, guasto). Non tocca le prenotazioni già pagate. */
  bookingBlocked: boolean;
  /** Giorni di chiusura programmata: date "YYYY-MM-DD" in cui non si prenota
   *  (ferie, festivi). Vale solo per le NUOVE prenotazioni. */
  closedDays: string[];
  /** Costo fisso aggiunto a ogni prenotazione online (in euro, es. 0.50).
   *  Appare come "Costo servizio di prenotazione" nel riepilogo e nella comanda. */
  costoServizio: number;
  /** Se false, il costo servizio non viene applicato anche se costoServizio > 0. */
  costoServizioAttivo: boolean;
  /** Se true, le prenotazioni online sono accettate solo quando il negozio è chiuso.
   *  Disabilitare quando l'app fungerà da registratore di cassa. */
  onlyClosedBooking: boolean;
  /** Orari di blocco prenotazioni per giorno della settimana (0=Dom…6=Sab).
   *  Ogni entry ha i servizi di quel giorno con il rispettivo orario di blocco.
   *  Precompilato con gli orari reali di schedule.ts; modificabile dall'admin
   *  per ogni giorno in modo persistente. */
  onlyClosedSchedule: Record<number, { label: string; start: string; end: string }[]>;
}

/** Valori usati quando il documento non esiste ancora o non è leggibile.
 *  Tutti "aperti": non cambiano il comportamento attuale finché non li tocchi. */
export const DEFAULT_SETTINGS: AppSettings = {
  cassaEnabled: true,
  bookingBlocked: false,
  closedDays: [],
  costoServizio: 0,
  costoServizioAttivo: false,
  onlyClosedBooking: false,
  onlyClosedSchedule: Object.fromEntries(
    Object.entries(SCHEDULE)
      .filter(([, defs]) => defs.length > 0)
      .map(([dow, defs]) => [
        Number(dow),
        defs.map((d) => ({ label: d.label, start: d.start, end: d.end === "24:00" ? "23:59" : d.end })),
      ]),
  ) as Record<number, { label: string; start: string; end: string }[]>,
};

const ref = () => doc(db, "settings", "app");

/** Ascolta le impostazioni in tempo reale. Se il documento manca o la lettura
 *  fallisce (permessi/offline), ricade sui default senza bloccare la UI. */
export function subscribeSettings(cb: (s: AppSettings) => void): () => void {
  return onSnapshot(
    ref(),
    (snap) => cb(snap.exists() ? { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<AppSettings>) } : DEFAULT_SETTINGS),
    () => cb(DEFAULT_SETTINGS),
  );
}

/** Aggiorna una o più impostazioni (merge). Richiede un admin loggato. */
export async function saveSettings(patch: Partial<AppSettings>): Promise<void> {
  await setDoc(ref(), patch, { merge: true });
}
