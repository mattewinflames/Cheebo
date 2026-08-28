/**
 * bleLogger.ts — LOG TEMPORANEO per troubleshooting stampa BLE.
 * ⚠️  DA RIMUOVERE dopo aver risolto i problemi di stampa.
 *
 * Scrive su Firestore → collection `logs` → documento `ble_{timestamp}`.
 * Leggibile dalla Firebase Console in tempo reale.
 * Non blocca mai il flusso principale: tutti gli errori di scrittura vengono
 * ignorati silenziosamente (è un tool di debug, non produzione).
 */

import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

export type BLELogLevel = "info" | "warn" | "error";

export interface BLELogEntry {
  level: BLELogLevel;
  msg: string;
  detail?: string;       // stack trace o dettaglio extra
  deviceName?: string;   // nome dispositivo BLE se disponibile
  ua: string;            // userAgent del browser/tablet
  clientTs: string;      // ISO timestamp client — usa questo per ordinare
  ts: unknown;           // serverTimestamp Firestore (con latenza)
}

/**
 * Logga un evento BLE su Firestore e su console.
 * Non lancia mai eccezioni.
 */
export async function logBLE(
  level: BLELogLevel,
  msg: string,
  opts?: { detail?: string; deviceName?: string },
): Promise<void> {
  // Console sempre — utile se qualcuno ha i DevTools aperti
  const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  consoleFn(`[BLE ${level.toUpperCase()}] ${msg}`, opts?.detail ?? "");

  // Firestore — fire-and-forget, mai blocca il flusso
  try {
    const entry: BLELogEntry = {
      level,
      msg,
      detail: opts?.detail,
      deviceName: opts?.deviceName,
      ua: navigator.userAgent,
      clientTs: new Date().toISOString(), // timestamp client — preciso, ordinabile
      ts: serverTimestamp(),              // timestamp server — per riferimento
    };
    // Rimuove i campi undefined (Firestore non li accetta)
    const clean = Object.fromEntries(
      Object.entries(entry).filter(([, v]) => v !== undefined),
    );
    // ID documento: timestamp ISO + random suffix → ordinamento naturale nella console Firebase
    const docId = `${new Date().toISOString().replace(/[:.]/g, "-")}_${Math.random().toString(36).slice(2, 7)}`;
    await setDoc(doc(collection(db, "logs"), docId), clean);
  } catch {
    // Ignora silenziosamente — il log non deve mai rompere la stampa
  }
}
