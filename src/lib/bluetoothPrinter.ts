/**
 * bluetoothPrinter.ts
 * Stampa diretta ESC/POS via WebBluetooth BLE (Chrome Android).
 *
 * Gli UUID sotto coprono i profili più comuni delle termiche BLE:
 *   - Profilo "Custom Serial" (Bisofice, Xprinter, GOOJPRT, ecc.)
 *   - Profilo Nordic UART (fallback)
 *
 * Se la stampante non risponde al primo profilo si prova il secondo.
 * In caso di UUID diversi: usare un BLE scanner (nRF Connect su Android)
 * per rilevare service/characteristic reali e aggiornare PROFILES.
 */

interface BLEProfile {
  serviceUUID: string;
  charUUID: string;
}

import { logBLE } from "./bleLogger.js";

const PROFILES: BLEProfile[] = [
  // Profilo Custom Serial — più comune nelle termiche 58mm cinesi
  { serviceUUID: '000018f0-0000-1000-8000-00805f9b34fb', charUUID: '00002af1-0000-1000-8000-00805f9b34fb' },
  // Nordic UART Service — fallback
  { serviceUUID: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', charUUID: '6e400002-b5a3-f393-e0a9-e50e24dcca9e' },
];

// Byte di controllo ESC/POS
const ESC_INIT   = new Uint8Array([0x1b, 0x40]);           // ESC @ — reset stampante
const FEED_CUT   = new Uint8Array([0x1b, 0x64, 0x04,       // ESC d 4 — avanza 4 righe
                                    0x1d, 0x56, 0x42, 0x00]); // GS V B 0 — taglio parziale

const CHUNK_SIZE = 64; // byte per pacchetto BLE — più piccolo = più robusto su chipset lenti

let cachedDevice: BluetoothDevice | null = null;
let cachedChar:   BluetoothRemoteGATTCharacteristic | null = null;

/** Ritorna true se WebBluetooth è disponibile nel browser corrente. */
export const bluetoothSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'bluetooth' in navigator;

/** Invia un Uint8Array alla caratteristica BLE a chunk, con timeout globale. */
async function writeChunked(
  char: BluetoothRemoteGATTCharacteristic,
  data: Uint8Array,
): Promise<void> {
  const TIMEOUT_MS = 20000; // 20 secondi — la Bisofice Z58-01 è lenta su BLE
  const writePromise = (async () => {
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE);
      if (char.properties.writeWithoutResponse) {
        await char.writeValueWithoutResponse(chunk);
      } else {
        await char.writeValue(chunk);
      }
      await new Promise(r => setTimeout(r, 40)); // 40ms tra chunk — più robusto su chipset lenti
    }
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Timeout stampa: stampante non risponde")), TIMEOUT_MS),
  );

  await Promise.race([writePromise, timeoutPromise]);
}

/** Tenta la connessione con un profilo BLE. */
async function connectWithProfile(
  device: BluetoothDevice,
  profile: BLEProfile,
): Promise<BluetoothRemoteGATTCharacteristic> {
  const server  = await device.gatt!.connect();
  const service = await server.getPrimaryService(profile.serviceUUID);
  return service.getCharacteristic(profile.charUUID);
}

/**
 * Stampa il testo sulla stampante BLE.
 * Alla prima chiamata mostra il dialog di selezione dispositivo;
 * le chiamate successive riusano il dispositivo già accoppiato,
 * riconnettendo automaticamente se la connessione GATT è caduta.
 */
export async function printESCPOS(textContent: string): Promise<void> {
  // Richiedi dispositivo solo se non ancora selezionato
  if (!cachedDevice) {
    await logBLE("info", "Apertura dialog selezione dispositivo BLE");
    cachedDevice = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: PROFILES.map(p => p.serviceUUID),
    });
    await logBLE("info", "Dispositivo selezionato", { deviceName: cachedDevice.name ?? "sconosciuto" });
    cachedChar = null;
  }

  // Se la connessione GATT è caduta (tab in background, schermo spento, ecc.)
  // resetta la char e riconnetti
  if (!cachedDevice.gatt?.connected) {
    await logBLE("warn", "GATT disconnesso — riconnessione in corso", { deviceName: cachedDevice.name ?? "sconosciuto" });
    cachedChar = null;
  }

  // Connetti (o riconnetti) e trova la caratteristica
  if (!cachedChar) {
    await logBLE("info", "Connessione GATT in corso...", { deviceName: cachedDevice.name ?? "sconosciuto" });
    let lastErr: unknown;
    for (const profile of PROFILES) {
      try {
        cachedChar = await connectWithProfile(cachedDevice, profile);
        await logBLE("info", `Profilo BLE trovato: ${profile.serviceUUID.slice(0, 8)}...`, { deviceName: cachedDevice.name ?? "sconosciuto" });
        break;
      } catch (e) {
        await logBLE("warn", `Profilo ${profile.serviceUUID.slice(0, 8)} non compatibile`, { detail: String(e) });
        lastErr = e;
      }
    }
    if (!cachedChar) {
      const errMsg = `Nessun profilo BLE compatibile trovato sulla stampante. Usa nRF Connect per verificare gli UUID.\n${lastErr}`;
      await logBLE("error", "Nessun profilo BLE compatibile", { detail: errMsg, deviceName: cachedDevice.name ?? "sconosciuto" });
      throw new Error(errMsg);
    }
  }

  // Encoder per il testo ASCII
  const encoder  = new TextEncoder();
  const textBytes = encoder.encode(textContent);

  // Pacchetto completo: init + testo + feed/taglio
  const payload = new Uint8Array(
    ESC_INIT.length + textBytes.length + FEED_CUT.length,
  );
  payload.set(ESC_INIT, 0);
  payload.set(textBytes, ESC_INIT.length);
  payload.set(FEED_CUT, ESC_INIT.length + textBytes.length);

  await logBLE("info", `Invio payload ${payload.length} byte alla stampante...`, { deviceName: cachedDevice.name ?? "sconosciuto" });

  // Invia prima un ESC @ (reset) separato per sbloccare eventuali stati inconsistenti
  try { await writeChunked(cachedChar, ESC_INIT); } catch { /* ignora — è solo un reset preventivo */ }
  await new Promise(r => setTimeout(r, 100));

  try {
    await writeChunked(cachedChar, payload);
    await logBLE("info", "Stampa completata con successo", { deviceName: cachedDevice.name ?? "sconosciuto" });
    // Pausa per permettere alla stampante di digerire gli ultimi byte
    // prima di disconnettere — evita inceppamenti su stampe ravvicinate
    await new Promise(r => setTimeout(r, 600));
  } catch (err) {
    await logBLE("error", "Errore durante writeChunked — reset device completo", {
      detail: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
      deviceName: cachedDevice.name ?? "sconosciuto",
    });
    // Reset completo: azzera anche cachedDevice così il prossimo click
    // mostra il dialog di selezione invece di ritentare su un device inconsistente
    cachedChar = null;
    cachedDevice = null;
    throw err;
  } finally {
    // Disconnessione esplicita dopo ogni stampa (successo o errore)
    try { cachedDevice?.gatt?.disconnect(); } catch { /* ignora */ }
    cachedChar = null;
    await logBLE("info", "Disconnessione GATT post-stampa");
  }
}
