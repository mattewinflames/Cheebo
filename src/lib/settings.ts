/* ============================================================================
   CHEEBO · Impostazioni dell'attività (settings/app su Firestore)
   ----------------------------------------------------------------------------
   Opzioni che valgono per il locale su TUTTI i dispositivi (non per-browser).
   Le legge e scrive solo l'admin (vedi firestore.rules -> match /settings).
   Pensato per crescere: è il punto unico dove aggiungere futuri interruttori
   quando Cheebo diventerà uno scheletro riconfigurabile per più attività.
   ========================================================================== */
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { db } from "./firebase";

export interface AppSettings {
  /** Abilita la scheda Cassa (POS al banco) nell'area admin. */
  cassaEnabled: boolean;
}

/** Valori usati quando il documento non esiste ancora o non è leggibile.
 *  cassaEnabled = true: non cambia il comportamento attuale finché non lo tocchi. */
export const DEFAULT_SETTINGS: AppSettings = {
  cassaEnabled: true,
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
