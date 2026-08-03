/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FB_API_KEY: string;
  readonly VITE_FB_AUTH_DOMAIN: string;
  readonly VITE_FB_PROJECT_ID: string;
  readonly VITE_FB_STORAGE_BUCKET: string;
  readonly VITE_FB_SENDER_ID: string;
  readonly VITE_FB_APP_ID: string;
  readonly VITE_LOCALE_PHONE: string;
  /** Chiave reCAPTCHA v3 per App Check. Se assente, App Check resta spento. */
  readonly VITE_APPCHECK_SITE_KEY?: string;
  /** "true" in sviluppo per usare il debug token invece di reCAPTCHA. */
  readonly VITE_APPCHECK_DEBUG?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
