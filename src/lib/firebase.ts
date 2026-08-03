import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FB_SENDER_ID,
  appId: import.meta.env.VITE_FB_APP_ID,
};

export const app = initializeApp(firebaseConfig);

/* ----------------------------------------------------------------------------
   App Check — verifica che le richieste arrivino davvero da questa app.
   Le regole dicono COSA si può scrivere, App Check dice CHI può provarci:
   insieme fermano i bot che potrebbero saturare la piastra di ordini finti.

   Si accende da solo quando `VITE_APPCHECK_SITE_KEY` è valorizzata; senza
   chiave resta inerte, così chi lavora in locale non è obbligato a configurarlo.

   IN LOCALE: reCAPTCHA non funziona su localhost, serve un debug token.
     1. lascia `VITE_APPCHECK_DEBUG=true` nel .env di sviluppo
     2. avvia, apri la console del browser e copia il token che Firebase stampa
     3. Console Firebase → App Check → app web → menu ⋮ → "Gestisci token di
        debug" → incolla (scade dopo il periodo impostato, va rigenerato)
   Il token vale SOLO per quel browser: non finisce nel bundle di produzione,
   perché `import.meta.env.DEV` è falso in build.
   ---------------------------------------------------------------------------- */
declare global {
  // eslint-disable-next-line no-var
  var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined;
}

const appCheckKey = import.meta.env.VITE_APPCHECK_SITE_KEY;

if (appCheckKey) {
  // va impostato PRIMA di initializeAppCheck, altrimenti viene ignorato.
  // VITE_APPCHECK_DEBUG:
  //   "true"  -> token di debug casuale, stampato in console (va registrato a
  //              ogni reset dello storage: scomodo).
  //   <uuid>  -> token di debug FISSO: registralo UNA volta sola nella console
  //              (App Check -> Apps -> ... -> Manage debug tokens) e non cambia
  //              più. Vale solo in dev: in build `import.meta.env.DEV` è falso.
  const debug = import.meta.env.VITE_APPCHECK_DEBUG;
  if (import.meta.env.DEV && debug && debug !== "false") {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = debug === "true" ? true : debug;
  }
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    // non blocca l'app: se App Check non parte, a fermare gli abusi restano le
    // regole Firestore. L'errore va però visto, non ingoiato.
    console.error("[Cheebo] App Check non inizializzato:", e);
  }
} else if (import.meta.env.PROD) {
  console.warn("[Cheebo] App Check non attivo: manca VITE_APPCHECK_SITE_KEY.");
}

export const db = getFirestore(app);
export const auth = getAuth(app);
export const LOCALE_PHONE: string = import.meta.env.VITE_LOCALE_PHONE ?? "39XXXXXXXXXX";

/** Indirizzo del locale e link "come arrivare". Parametrizzabili per attività:
 *  se non imposti VITE_LOCALE_MAPS_URL, il percorso Google Maps viene costruito
 *  dall'indirizzo. Per puntare a una scheda luogo specifica, valorizza l'URL. */
export const LOCALE_ADDRESS: string = import.meta.env.VITE_LOCALE_ADDRESS ?? "Via Aretusa, 6, 00155 Roma RM";
export const LOCALE_MAPS_URL: string =
  import.meta.env.VITE_LOCALE_MAPS_URL ??
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(LOCALE_ADDRESS)}`;
