/* ============================================================================
   CHEEBO · Dati legali del venditore e versione delle condizioni di vendita.
   Sono gli unici dati da compilare: la pagina /condizioni li legge da qui.
   Finché un campo obbligatorio è vuoto, la pagina mostra "da completare".
   ⚠️ I testi vanno fatti rivedere da un legale prima della pubblicazione.
   ========================================================================== */
import { LOCALE_ADDRESS, LOCALE_PHONE } from "./firebase";

/** Telefono del locale (stesso numero WhatsApp di VITE_LOCALE_PHONE), formattato "+39 …". */
const telefono = /^39\d{6,}$/.test(LOCALE_PHONE) ? `+39 ${LOCALE_PHONE.slice(2)}` : "";

export const LEGAL = {
  ragioneSociale: "CHEEBO S.R.L.",
  sedeLegale: "Via Aretusa 6, 00155 Roma (RM)",
  puntoRitiro: LOCALE_ADDRESS,        // stesso indirizzo mostrato nel sito (VITE_LOCALE_ADDRESS)
  piva: "17821961004",                // coincide con il codice fiscale
  rea: "RM-1744240",
  email: "cheeboroma@gmail.com",      // email ordinaria (se vuota, i contatti mostrano la PEC)
  pec: "cheebo@pec.it",
  telefono,                           // per annullamenti e reclami (anche WhatsApp)
};

/** Data di entrata in vigore della versione attuale delle condizioni. */
export const CONDIZIONI_VERSIONE = "2026-11-18";

/** Minuti prima dell'apertura del servizio entro cui l'ordine è annullabile con rimborso. */
export const ANNULLAMENTO_MINUTI = 30;

const OBBLIGATORI = ["ragioneSociale", "sedeLegale", "puntoRitiro", "piva", "telefono"] as const;
export const legalMancanti = (): string[] => [
  ...OBBLIGATORI.filter((k) => !LEGAL[k].trim()),
  ...(LEGAL.email.trim() || LEGAL.pec.trim() ? [] : ["email"]),
];
