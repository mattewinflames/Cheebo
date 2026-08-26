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

const CHUNK_SIZE = 128; // byte per pacchetto BLE (conservativo, sicuro su tutti i chipset)

let cachedDevice: BluetoothDevice | null = null;
let cachedChar:   BluetoothRemoteGATTCharacteristic | null = null;

/** Ritorna true se WebBluetooth è disponibile nel browser corrente. */
export const bluetoothSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'bluetooth' in navigator;

/** Invia un Uint8Array alla caratteristica BLE a chunk. */
async function writeChunked(
  char: BluetoothRemoteGATTCharacteristic,
  data: Uint8Array,
): Promise<void> {
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.slice(i, i + CHUNK_SIZE);
    // writeValueWithoutResponse è più veloce; se non supportato cade su writeValue
    if (char.properties.writeWithoutResponse) {
      await char.writeValueWithoutResponse(chunk);
    } else {
      await char.writeValue(chunk);
    }
    // Piccola pausa tra chunk per non saturare il buffer BLE
    await new Promise(r => setTimeout(r, 20));
  }
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
 * le chiamate successive riusano il dispositivo già accoppiato.
 */
export async function printESCPOS(textContent: string): Promise<void> {
  // Richiedi dispositivo solo se non già accoppiato o disconnesso
  if (!cachedDevice || !cachedDevice.gatt?.connected) {
    cachedDevice = await navigator.bluetooth.requestDevice({
      // Mostra tutti i dispositivi BLE nelle vicinanze:
      // l'operatore selezionerà la Bisofice Z58-01 dall'elenco.
      // Alternativa più restrittiva: filters: [{ name: 'Bisofice Z58-01' }]
      acceptAllDevices: true,
      optionalServices: PROFILES.map(p => p.serviceUUID),
    });
    cachedChar = null; // resetta la char se cambia device
  }

  // Connetti (o riconnetti se perso) e trova la caratteristica
  if (!cachedChar) {
    let lastErr: unknown;
    for (const profile of PROFILES) {
      try {
        cachedChar = await connectWithProfile(cachedDevice, profile);
        break; // profilo trovato
      } catch (e) {
        lastErr = e;
      }
    }
    if (!cachedChar) {
      throw new Error(
        `Nessun profilo BLE compatibile trovato sulla stampante. ` +
        `Usa nRF Connect per verificare gli UUID.\n${lastErr}`,
      );
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

  await writeChunked(cachedChar, payload);
}
