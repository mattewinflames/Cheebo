/**
 * STRESS TEST — LIVELLO 3: load test infrastruttura (k6)
 * =======================================================
 * Simula N utenti che navigano il flusso FINO a create-booking
 * (senza completare il pagamento Stripe). Misura latenza, throughput
 * ed errori dell'infrastruttura Vercel sotto carico.
 *
 * QUANDO usarlo: non al lancio (non necessario per Cheebo). Utile se
 * il locale cresce e vuoi verificare i limiti del piano Vercel prima
 * di un evento/promozione con forte afflusso atteso.
 *
 * PRE-REQUISITI:
 *   - k6 installato: https://k6.io/docs/get-started/installation/
 *   - Target: l'URL di produzione o staging (NON localhost)
 *   - Le variabili d'ambiente passate via -e
 *
 * Uso:
 *   k6 run \
 *     -e TARGET_URL=https://cheebo-iota.vercel.app \
 *     -e SERVICE_KEY=2026-08-15-Cena \
 *     scripts/stress-k6.js
 *
 * Scenari predefiniti:
 *   - "normale"  : 5 utenti per 1 minuto (picco serale realistico)
 *   - "stress"   : rampa fino a 30 utenti in 2 minuti
 *   - "spike"    : picco improvviso 50 utenti per 10 secondi
 *
 * Modifica le soglie (thresholds) in base ai tuoi obiettivi di SLA.
 *
 * ⚠️  ATTENZIONE: questo script colpisce l'API reale e crea hold reali
 *   su Firestore. Usa una serviceKey futura (non prenotabile davvero)
 *   oppure un ambiente di staging separato. Dopo il test, ripulisci
 *   la collezione holds/sessions con il pannello Firebase Console.
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// -------------------------------------------------------------------
// Metriche custom
// -------------------------------------------------------------------
const erroriRate       = new Rate("errori");
const latenzaBooking   = new Trend("latenza_create_booking", true);
const pienaRate        = new Rate("piastra_piena");

// -------------------------------------------------------------------
// Configurazione scenari
// -------------------------------------------------------------------
export const options = {
  scenarios: {
    normale: {
      executor:    "constant-vus",
      vus:         5,
      duration:    "1m",
      gracefulStop: "10s",
    },
    stress: {
      executor:    "ramping-vus",
      startVUs:    0,
      stages: [
        { duration: "30s", target: 10 },
        { duration: "1m",  target: 30 },
        { duration: "30s", target: 0  },
      ],
      gracefulRampDown: "10s",
      startTime:   "1m10s", // parte dopo "normale"
    },
    spike: {
      executor:    "constant-vus",
      vus:         50,
      duration:    "10s",
      startTime:   "3m",   // parte dopo "stress"
    },
  },
  thresholds: {
    // SLA: 95% delle richieste risponde in meno di 3 secondi
    "latenza_create_booking": ["p(95)<3000"],
    // Tasso di errori 5xx sotto il 2%
    "errori":                  ["rate<0.02"],
    // Piastra al completo (409) è atteso: non è un errore
    "http_req_failed":         ["rate<0.05"],
  },
};

// -------------------------------------------------------------------
// Payload (Classic smashburger, 2 patty)
// -------------------------------------------------------------------
const TARGET_URL  = __ENV.TARGET_URL  ?? "https://cheebo-iota.vercel.app";
const SERVICE_KEY = __ENV.SERVICE_KEY ?? "2026-12-01-Cena"; // data futura di default

const payload = JSON.stringify({
  serviceKey: SERVICE_KEY,
  name:       `K6-${Math.random().toString(36).slice(2, 6)}`,
  phone:      "",
  mode:       "first",
  cart: [
    { itemId: "classic", kind: "panino", formatId: "solo", qty: 2, removes: [], swaps: [] },
  ],
});

const params = {
  headers: { "Content-Type": "application/json" },
  timeout: "15s",
};

// -------------------------------------------------------------------
// Funzione eseguita da ogni VU (virtual user)
// -------------------------------------------------------------------
export default function () {
  const res = http.post(`${TARGET_URL}/api/create-booking`, payload, params);

  latenzaBooking.add(res.timings.duration);

  const isOk     = res.status === 200;
  const isPiena  = res.status === 409;
  const isErrore = res.status >= 500 || res.status === 0;

  pienaRate.add(isPiena);
  erroriRate.add(isErrore);

  check(res, {
    "risposta ricevuta":            (r) => r.status !== 0,
    "accettata o gestita (non 5xx)":(r) => r.status < 500,
    "se 200: ha url Stripe":        (r) => r.status !== 200 || (r.json("url") ?? "").startsWith("https://checkout.stripe.com"),
  });

  // Pausa realistica tra le richieste (simula il tempo di compilazione del form)
  sleep(Math.random() * 2 + 1); // 1-3 secondi
}

export function handleSummary(data) {
  return {
    stdout: `
═══════════════════════════════════════════════════════════
  CHEEBO LOAD TEST — RIEPILOGO
═══════════════════════════════════════════════════════════
  Richieste totali       : ${data.metrics.http_reqs.values.count}
  Durata test            : ${Math.round(data.state.testRunDurationMs / 1000)}s
  Throughput             : ${data.metrics.http_reqs.values.rate.toFixed(2)} req/s

  Latenza p50            : ${Math.round(data.metrics.latenza_create_booking?.values?.["p(50)"] ?? 0)}ms
  Latenza p95            : ${Math.round(data.metrics.latenza_create_booking?.values?.["p(95)"] ?? 0)}ms
  Latenza p99            : ${Math.round(data.metrics.latenza_create_booking?.values?.["p(99)"] ?? 0)}ms

  Errori 5xx             : ${((data.metrics.errori?.values?.rate ?? 0) * 100).toFixed(1)}%
  Piastra al completo    : ${((data.metrics.piastra_piena?.values?.rate ?? 0) * 100).toFixed(1)}%
═══════════════════════════════════════════════════════════
`,
  };
}
