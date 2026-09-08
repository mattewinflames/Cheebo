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
 *
 * Fix rispetto alla versione precedente:
 * - Mutex isPrinting: blocca stampe parallele (causa "GATT operation already in progress")
 * - Niente disconnessione post-stampa: il GATT rimane connesso tra una stampa e l'altra
 * - Listener gattserverdisconnected: resetta cachedChar quando Android disconnette in background
 * - Retry automatico: se la scrittura fallisce per disconnessione, riconnette e riprova una volta
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
const ESC_INIT = new Uint8Array([0x1b, 0x40]);           // ESC @ — reset stampante
const FEED_CUT = new Uint8Array([0x1b, 0x64, 0x04,       // ESC d 4 — avanza 4 righe
                                  0x1d, 0x56, 0x42, 0x00]); // GS V B 0 — taglio parziale

const CHUNK_SIZE = 64;  // byte per pacchetto BLE
const CHUNK_DELAY = 40; // ms tra chunk

let cachedDevice: BluetoothDevice | null = null;
let cachedChar:   BluetoothRemoteGATTCharacteristic | null = null;
let isPrinting = false; // mutex: blocca stampe parallele

/** Ritorna true se WebBluetooth è disponibile nel browser corrente. */
export const bluetoothSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'bluetooth' in navigator;

/** Invia un Uint8Array alla caratteristica BLE a chunk, con timeout globale. */
async function writeChunked(
  char: BluetoothRemoteGATTCharacteristic,
  data: Uint8Array,
): Promise<void> {
  const TIMEOUT_MS = 20000;
  const writePromise = (async () => {
    for (let i = 0; i < data.length; i += CHUNK_SIZE) {
      const chunk = data.slice(i, i + CHUNK_SIZE);
      if (char.properties.writeWithoutResponse) {
        await char.writeValueWithoutResponse(chunk);
      } else {
        await char.writeValue(chunk);
      }
      await new Promise(r => setTimeout(r, CHUNK_DELAY));
    }
  })();

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Timeout stampa: stampante non risponde")), TIMEOUT_MS),
  );

  await Promise.race([writePromise, timeoutPromise]);
}

/** Tenta la connessione con un profilo BLE e registra il listener di disconnessione. */
async function connectDevice(device: BluetoothDevice): Promise<BluetoothRemoteGATTCharacteristic> {
  let lastErr: unknown;
  for (const profile of PROFILES) {
    try {
      const server  = await device.gatt!.connect();
      const service = await server.getPrimaryService(profile.serviceUUID);
      const char    = await service.getCharacteristic(profile.charUUID);
      await logBLE("info", `Profilo BLE trovato: ${profile.serviceUUID.slice(0, 8)}...`, { deviceName: device.name ?? "sconosciuto" });
      return char;
    } catch (e) {
      await logBLE("warn", `Profilo ${profile.serviceUUID.slice(0, 8)} non compatibile`, { detail: String(e) });
      lastErr = e;
    }
  }
  throw new Error(`Nessun profilo BLE compatibile.\n${lastErr}`);
}

/** Registra il listener di disconnessione sul device (una volta sola). */
function attachDisconnectListener(device: BluetoothDevice): void {
  device.addEventListener('gattserverdisconnected', () => {
    logBLE("warn", "GATT disconnesso dal sistema — char resettata", { deviceName: device.name ?? "sconosciuto" });
    cachedChar = null;
    // NON azzeriamo cachedDevice: al prossimo click riconnette senza dialog
  });
}

/**
 * Stampa il testo sulla stampante BLE.
 * - Prima chiamata: mostra il dialog di selezione dispositivo
 * - Chiamate successive: riusa il device, riconnette automaticamente se necessario
 * - Stampe parallele: la seconda aspetta che la prima finisca (mutex)
 */
export async function printESCPOS(textContent: string, onStatus?: (s: string) => void): Promise<void> {
  const status = (s: string) => { onStatus?.(s); };

  // Mutex: evita "GATT operation already in progress"
  if (isPrinting) {
    await logBLE("warn", "Stampa già in corso — richiesta ignorata");
    throw new Error("Stampa già in corso, attendi che finisca.");
  }
  isPrinting = true;

  try {
    // Seleziona il dispositivo solo alla prima chiamata
    if (!cachedDevice) {
      status("Seleziona la stampante…");
      await logBLE("info", "Apertura dialog selezione dispositivo BLE");
      cachedDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: PROFILES.map(p => p.serviceUUID),
      });
      await logBLE("info", "Dispositivo selezionato", { deviceName: cachedDevice.name ?? "sconosciuto" });
      attachDisconnectListener(cachedDevice);
      cachedChar = null;
    }

    // Connetti se non connesso o se la char è stata resettata dal listener
    if (!cachedDevice.gatt?.connected || !cachedChar) {
      status("Connessione…");
      await logBLE("info", "Connessione GATT in corso...", { deviceName: cachedDevice.name ?? "sconosciuto" });
      try {
        cachedChar = await connectDevice(cachedDevice);
      } catch (e) {
        await logBLE("error", "Connessione GATT fallita", { detail: String(e), deviceName: cachedDevice.name ?? "sconosciuto" });
        cachedChar = null;
        cachedDevice = null;
        throw e;
      }
    }

    // Costruisci il payload
    const encoder   = new TextEncoder();
    const textBytes = encoder.encode(textContent);
    const payload   = new Uint8Array(ESC_INIT.length + textBytes.length + FEED_CUT.length);
    payload.set(ESC_INIT, 0);
    payload.set(textBytes, ESC_INIT.length);
    payload.set(FEED_CUT, ESC_INIT.length + textBytes.length);

    await logBLE("info", `Invio payload ${payload.length} byte...`, { deviceName: cachedDevice.name ?? "sconosciuto" });

    // Reset preventivo ESC @
    try { await writeChunked(cachedChar, ESC_INIT); } catch { /* ignora */ }
    await new Promise(r => setTimeout(r, 100));

    // Stampa — con retry automatico in caso di disconnessione improvvisa
    status("Stampa in corso…");
    try {
      await writeChunked(cachedChar, payload);
      await logBLE("info", "Stampa completata con successo", { deviceName: cachedDevice.name ?? "sconosciuto" });
      await new Promise(r => setTimeout(r, 400));
      status("✓ Stampato");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isDisconnected = msg.includes("disconnected") || msg.includes("GATT Server");

      if (isDisconnected) {
        status("Riconnessione…");
        await logBLE("warn", "GATT disconnesso durante stampa — riconnessione e retry", { deviceName: cachedDevice?.name ?? "sconosciuto" });
        cachedChar = null;
        try {
          cachedChar = await connectDevice(cachedDevice!);
          try { await writeChunked(cachedChar, ESC_INIT); } catch { /* ignora */ }
          await new Promise(r => setTimeout(r, 100));
          status("Stampa in corso…");
          await writeChunked(cachedChar, payload);
          await logBLE("info", "Stampa completata dopo retry", { deviceName: cachedDevice?.name ?? "sconosciuto" });
          await new Promise(r => setTimeout(r, 400));
          status("✓ Stampato");
        } catch (retryErr) {
          await logBLE("error", "Retry fallito — reset completo", {
            detail: retryErr instanceof Error ? `${retryErr.message}\n${retryErr.stack ?? ""}` : String(retryErr),
            deviceName: cachedDevice?.name ?? "sconosciuto",
          });
          cachedChar = null;
          cachedDevice = null;
          throw retryErr;
        }
      } else {
        await logBLE("error", "Errore scrittura BLE — reset completo", {
          detail: err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err),
          deviceName: cachedDevice?.name ?? "sconosciuto",
        });
        cachedChar = null;
        cachedDevice = null;
        throw err;
      }
    }
    // Il GATT rimane connesso — niente disconnect() esplicita
  } finally {
    isPrinting = false;
  }
}
