/* ============================================================================
   CHEEBO · Verifica delle regole Firestore SUL PROGETTO DI TEST
   ----------------------------------------------------------------------------
   Alternativa all'emulatore (che richiede Java 11+): esegue la stessa batteria
   di controlli contro il Firestore reale del progetto di TEST, usando l'SDK
   client — quindi passando davvero dalle regole pubblicate.

   PRIMA DI LANCIARLO: le regole devono essere già pubblicate sul progetto
   (Console Firebase -> Firestore -> Regole -> incolla firestore.rules -> Pubblica).

   Uso:  npm.cmd run verifica-regole

   ⚠️ SOLO SUL PROGETTO DI TEST. Scrive e cancella documenti veri: usa una
   sessione fittizia (2099-01-01-Test) e ripulisce tutto alla fine, ma non va
   puntato sulla produzione.
   ========================================================================== */

import { initializeApp } from "firebase/app";
import {
  getFirestore, doc, setDoc, getDoc, deleteDoc, updateDoc,
  collection, addDoc, getDocs, query, where, serverTimestamp,
} from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { setLogLevel } from "firebase/app";

// le scritture respinte sono il risultato ATTESO: non sporcare l'output
setLogLevel("silent");

const cfg = {
  apiKey: process.env.VITE_FB_API_KEY,
  authDomain: process.env.VITE_FB_AUTH_DOMAIN,
  projectId: process.env.VITE_FB_PROJECT_ID,
  storageBucket: process.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FB_SENDER_ID,
  appId: process.env.VITE_FB_APP_ID,
};

// due contesti separati: uno anonimo (il sito pubblico), uno admin (gestionale)
const dbAnon = getFirestore(initializeApp(cfg, "anon"));
const appAdmin = initializeApp(cfg, "admin");
const dbAdmin = getFirestore(appAdmin);
await signInWithEmailAndPassword(getAuth(appAdmin), process.env.SEED_EMAIL, process.env.SEED_PASSWORD);

const KEY = "2099-01-01-Test"; // sessione fittizia, lontana da qualsiasi dato reale
const SREF = () => doc(dbAnon, "sessions", KEY);

const sessione = (seq, ledger = { 0: 2 }, over = {}) => ({
  label: "Test", startMin: 1170, endMin: 1350,
  ledger, seq, updatedAt: serverTimestamp(), ...over,
});
const ordine = (over = {}) => ({
  serviceKey: KEY, name: "VerificaRegole", items: ["Classic singolo"], patties: 1,
  windowIndex: 0, readyMin: 1180, mode: "first", pay: "loco", total: 6,
  code: 1, phone: "", channel: "prenotazione", status: "nuovo",
  createdAt: serverTimestamp(), ...over,
});

let passati = 0, falliti = 0;
const creati = [];

/** L'operazione DEVE riuscire: se viene respinta, la regola è troppo stretta
 *  e romperebbe le prenotazioni vere. */
async function deve(nome, fn) {
  try { await fn(); console.log(`  ✓ ${nome}`); passati++; }
  catch (e) { console.log(`  ✗ ${nome}\n      respinta ma doveva passare: ${e.code ?? e.message}`); falliti++; }
}
/** L'operazione DEVE essere respinta: se passa, c'è un buco. */
async function nonDeve(nome, fn) {
  try { await fn(); console.log(`  ✗ ${nome}\n      PASSATA ma doveva essere respinta — buco nelle regole`); falliti++; }
  catch (e) {
    if (e.code === "permission-denied") { console.log(`  ✓ ${nome}`); passati++; }
    else { console.log(`  ✗ ${nome}\n      respinta per un altro motivo: ${e.code ?? e.message}`); falliti++; }
  }
}

console.log(`\nProgetto: ${cfg.projectId}`);
console.log("Le regole devono essere già pubblicate sulla console.\n");

/* ------------------------------------------------------------------- MENU */
console.log("MENU");
await deve("chiunque può leggere il menù", () => getDocs(collection(dbAnon, "menu")));
await nonDeve("un anonimo non può modificarlo", () => setDoc(doc(dbAnon, "menu/zzz-verifica-regole"), { name: "Gratis", solo: 0 }));
await deve("l'admin può modificarlo", () => setDoc(doc(dbAdmin, "menu/zzz-verifica-regole"), { name: "Test", solo: 1, active: false }));

/* --------------------------------------------------------------- SESSIONS */
console.log("\nSESSIONS · registro della piastra");
await deleteDoc(doc(dbAdmin, "sessions", KEY)).catch(() => {}); // partenza pulita

await deve("la prima prenotazione crea la sessione con seq = 1", () => setDoc(SREF(), sessione(1)));
await nonDeve("rifiuta un salto del contatore", () => setDoc(SREF(), sessione(50)));
await deve("la prenotazione successiva avanza seq di 1", () => setDoc(SREF(), sessione(2, { 0: 3 })));
await nonDeve("rifiuta un contatore che torna indietro", () => setDoc(SREF(), sessione(1)));
await nonDeve("rifiuta valori oltre la capacità della piastra", () => setDoc(SREF(), sessione(3, { 0: 99 })));
await nonDeve("rifiuta indici di finestra inventati", () => setDoc(SREF(), sessione(3, { pippo: 1 })));
await nonDeve("rifiuta campi estranei", () => setDoc(SREF(), sessione(3, { 0: 3 }, { backdoor: true })));
await nonDeve("non si può spostare la finestra di servizio", () => setDoc(SREF(), sessione(3, { 0: 3 }, { startMin: 0, endMin: 1440 })));
await nonDeve("rifiuta una data di aggiornamento falsificata", () => setDoc(SREF(), sessione(3, { 0: 3 }, { updatedAt: new Date(2000, 0, 1) })));
await deve("una prenotazione legittima passa ancora", () => setDoc(SREF(), sessione(3, { 0: 4 })));
await nonDeve("un anonimo non può cancellare il registro", () => deleteDoc(SREF()));

/* --- stock degli special (vive nel documento sessione) --- */
await nonDeve("rifiuta uno stock non intero", () => setDoc(SREF(), sessione(4, { 0: 4 }, { stock: { lobster: 12.5 } })));
await nonDeve("rifiuta uno stock negativo", () => setDoc(SREF(), sessione(4, { 0: 4 }, { stock: { lobster: -3 } })));
await nonDeve("rifiuta uno stock oltre il massimo previsto (200)", () => setDoc(SREF(), sessione(4, { 0: 4 }, { stock: { lobster: 9999 } })));
await deve("accetta uno stock valido", () => setDoc(SREF(), sessione(4, { 0: 4 }, { stock: { lobster: 24 } })));

/* ----------------------------------------------------------------- ORDERS */
console.log("\nORDERS");
await deve("chiunque può creare un ordine ben formato", async () => {
  const r = await addDoc(collection(dbAnon, "orders"), ordine()); creati.push(r.id);
});
await deve("accetta l'ordine da cassa con il metodo di incasso", async () => {
  const r = await addDoc(collection(dbAnon, "orders"), ordine({ channel: "banco", tender: "contanti" })); creati.push(r.id);
});
await nonDeve("rifiuta un ordine senza nome", () => addDoc(collection(dbAnon, "orders"), ordine({ name: "" })));
await nonDeve("rifiuta un carrello vuoto", () => addDoc(collection(dbAnon, "orders"), ordine({ items: [] })));
await nonDeve("rifiuta un totale negativo", () => addDoc(collection(dbAnon, "orders"), ordine({ total: -50 })));
await nonDeve("rifiuta uno stato diverso da 'nuovo'", () => addDoc(collection(dbAnon, "orders"), ordine({ status: "consegnato" })));
await nonDeve("rifiuta un metodo di pagamento inventato", () => addDoc(collection(dbAnon, "orders"), ordine({ pay: "gratis" })));
await nonDeve("rifiuta un canale inventato", () => addDoc(collection(dbAnon, "orders"), ordine({ channel: "chissa" })));
await nonDeve("rifiuta campi estranei", () => addDoc(collection(dbAnon, "orders"), ordine({ sconto: 100 })));
await nonDeve("rifiuta una data di creazione falsificata", () => addDoc(collection(dbAnon, "orders"), ordine({ createdAt: new Date(2000, 0, 1) })));

if (creati.length) {
  await nonDeve("un anonimo non può leggere gli ordini", () => getDoc(doc(dbAnon, "orders", creati[0])));
  await nonDeve("un anonimo non può modificarli", () => updateDoc(doc(dbAnon, "orders", creati[0]), { status: "consegnato" }));
  await deve("l'admin legge", () => getDoc(doc(dbAdmin, "orders", creati[0])));
  await deve("l'admin aggiorna lo stato", () => updateDoc(doc(dbAdmin, "orders", creati[0]), { status: "consegnato" }));
}

// Buco noto: oggi il client dichiara da solo di aver pagato online.
// Quando arriverà Stripe, questo caso dovrà diventare `nonDeve`.
await deve("[da invertire con Stripe] il client può dichiararsi 'pagato online'", async () => {
  const r = await addDoc(collection(dbAnon, "orders"), ordine({ pay: "online", total: 0 })); creati.push(r.id);
});

/* --------------------------------------------------------------- pulizia */
console.log("\nPulizia dei dati di prova…");
await deleteDoc(doc(dbAdmin, "menu/zzz-verifica-regole")).catch(() => {});
await deleteDoc(doc(dbAdmin, "sessions", KEY)).catch(() => {});
const resti = await getDocs(query(collection(dbAdmin, "orders"), where("serviceKey", "==", KEY)));
for (const d of resti.docs) await deleteDoc(d.ref);
console.log(`  rimossi ${resti.size} ordini di prova, la sessione e la voce di menù.`);

console.log(`\n${"─".repeat(46)}`);
console.log(`Esito: ${passati} superati, ${falliti} falliti`);
console.log(falliti === 0
  ? "Le regole si comportano come previsto."
  : "⚠️ Controlla i casi con ✗ prima di procedere.");
process.exit(falliti === 0 ? 0 : 1);
