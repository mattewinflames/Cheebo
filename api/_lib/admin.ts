/* Firebase Admin SDK per le funzioni serverless (Vercel, runtime Node).
   L'Admin SDK BYPASSA le regole Firestore: è il solo che può creare ordini
   "pagati" e scrivere gli hold. Non richiede il piano Blaze — parla con
   Firestore via service account, non tramite Cloud Functions. */
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

function initAdmin(): App {
  const existing = getApps();
  if (existing.length) return existing[0];
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT mancante nelle variabili d'ambiente");
  const svc = JSON.parse(raw) as { private_key?: string };
  // In env i \n della chiave privata arrivano come stringa: vanno ripristinati.
  if (typeof svc.private_key === "string") svc.private_key = svc.private_key.replace(/\\n/g, "\n");
  return initializeApp({ credential: cert(svc as Parameters<typeof cert>[0]) });
}

export const adminDb = getFirestore(initAdmin());
export { FieldValue, Timestamp };
