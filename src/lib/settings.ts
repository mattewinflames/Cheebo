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

export interface AppSettings {
  /** Abilita la scheda Cassa (POS al banco) nell'area admin. */
  cassaEnabled: boolean;
  /** Blocco immediato: se true, nessuna nuova prenotazione online è accettata
   *  (imprevisti — cuoco assente, guasto). Non tocca le prenotazioni già pagate. */
  bookingBlocked: boolean;
  /** Giorni di chiusura programmata: date "YYYY-MM-DD" in cui non si prenota
   *  (ferie, festivi). Vale solo per le NUOVE prenotazioni. */
  closedDays: string[];
}

/** Valori usati quando il documento non esiste ancora o non è leggibile.
 *  Tutti "aperti": non cambiano il comportamento attuale finché non li tocchi. */
export const DEFAULT_SETTINGS: AppSettings = {
  cassaEnabled: true,
  bookingBlocked: false,
  closedDays: [],
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
