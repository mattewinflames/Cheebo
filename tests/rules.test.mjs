/* ============================================================================
   CHEEBO · Test delle regole Firestore
   ----------------------------------------------------------------------------
   Richiedono l'emulatore Firestore (scarica un jar da Google al primo avvio).

   Uso:  npm.cmd run test:rules

   ⚠️ AGGIORNATO per il lockdown #41 (il client non scrive più: prenota via
   server). NON è stato possibile rieseguirlo nell'ambiente di sviluppo (manca
   l'emulatore + Java 11+): va rilanciato su una macchina che li ha.

   Verificano due cose insieme: che le scritture LEGITTIME (oggi solo quelle
   della cassa admin) continuino a passare, e che quelle non autorizzate o
   malformate vengano respinte.
   ========================================================================== */

import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, deleteDoc, collection, addDoc, serverTimestamp } from "firebase/firestore";

let env;
const KEY = "2026-07-22-Cena";

/* Sessione valida come la scrive la cassa */
const sessione = (seq, ledger = { 0: 2 }) => ({
  label: "Cena", startMin: 1170, endMin: 1350,
  ledger, seq, updatedAt: serverTimestamp(),
});

/* Ordine valido come lo scrive la cassa */
const ordine = (over = {}) => ({
  serviceKey: KEY, name: "Marco", items: ["Classic singolo"], patties: 1,
  windowIndex: 0, readyMin: 1180, mode: "first", pay: "loco", total: 6,
  code: 1, phone: "", channel: "banco", status: "nuovo",
  createdAt: serverTimestamp(), ...over,
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "cheebo-rules-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});
afterAll(async () => { await env?.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const anon = () => env.unauthenticatedContext().firestore();
const admin = () => env.authenticatedContext("admin").firestore();
const seed = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));

/* ------------------------------------------------------------------- MENU */

describe("menu", () => {
  it("chiunque può leggerlo (serve al sito cliente)", async () => {
    await seed((db) => setDoc(doc(db, "menu/classic"), { name: "Classic", active: true }));
    await assertSucceeds(getDoc(doc(anon(), "menu/classic")));
  });
  it("un anonimo non può modificarlo", async () => {
    await assertFails(setDoc(doc(anon(), "menu/classic"), { name: "Gratis", solo: 0 }));
  });
  it("l'admin può modificarlo", async () => {
    await assertSucceeds(setDoc(doc(admin(), "menu/classic"), { name: "Classic", solo: 6 }));
  });
});

/* --------------------------------------------------------------- SESSIONS
   Da #41 il registro lo scrive solo la cassa (admin): il cliente prenota via
   server (Admin SDK, che bypassa le regole). */

describe("sessions · registro della piastra", () => {
  it("un anonimo NON può creare il registro (passa dal server)", async () => {
    await assertFails(setDoc(doc(anon(), "sessions", KEY), sessione(1)));
  });

  it("un anonimo NON può aggiornarlo", async () => {
    await seed((db) => setDoc(doc(db, "sessions", KEY), sessione(1)));
    await assertFails(setDoc(doc(anon(), "sessions", KEY), sessione(2, { 0: 3 })));
  });

  it("la cassa crea la sessione con seq = 1", async () => {
    await assertSucceeds(setDoc(doc(admin(), "sessions", KEY), sessione(1)));
  });

  it("rifiuta una sessione che parte da un seq diverso da 1", async () => {
    await assertFails(setDoc(doc(admin(), "sessions", KEY), sessione(99)));
  });

  it("la prenotazione successiva avanza seq di esattamente 1", async () => {
    await seed((db) => setDoc(doc(db, "sessions", KEY), sessione(1)));
    await assertSucceeds(setDoc(doc(admin(), "sessions", KEY), sessione(2, { 0: 3 })));
  });

  it("rifiuta un salto del contatore (scritture in blocco)", async () => {
    await seed((db) => setDoc(doc(db, "sessions", KEY), sessione(1)));
    await assertFails(setDoc(doc(admin(), "sessions", KEY), sessione(50)));
  });

  it("rifiuta un contatore che torna indietro", async () => {
    await seed((db) => setDoc(doc(db, "sessions", KEY), sessione(5)));
    await assertFails(setDoc(doc(admin(), "sessions", KEY), sessione(2)));
  });

  it("rifiuta valori oltre la capacità della piastra", async () => {
    await assertFails(setDoc(doc(admin(), "sessions", KEY), sessione(1, { 0: 99 })));
  });

  it("rifiuta indici di finestra inventati", async () => {
    await assertFails(setDoc(doc(admin(), "sessions", KEY), sessione(1, { pippo: 3 })));
  });

  it("rifiuta campi estranei iniettati nel documento", async () => {
    await assertFails(setDoc(doc(admin(), "sessions", KEY), { ...sessione(1), backdoor: true }));
  });

  it("non si può spostare la finestra di servizio dopo la creazione", async () => {
    await seed((db) => setDoc(doc(db, "sessions", KEY), sessione(1)));
    await assertFails(setDoc(doc(admin(), "sessions", KEY), { ...sessione(2), startMin: 0, endMin: 1440 }));
  });

  it("rifiuta una data di aggiornamento falsificata", async () => {
    await assertFails(setDoc(doc(admin(), "sessions", KEY), { ...sessione(1), updatedAt: new Date(2000, 0, 1) }));
  });

  it("un anonimo non può cancellare il registro", async () => {
    await seed((db) => setDoc(doc(db, "sessions", KEY), sessione(1)));
    await assertFails(deleteDoc(doc(anon(), "sessions", KEY)));
  });

  it("l'admin può azzerare il registro", async () => {
    await seed((db) => setDoc(doc(db, "sessions", KEY), sessione(1)));
    await assertSucceeds(deleteDoc(doc(admin(), "sessions", KEY)));
  });
});

/* ----------------------------------------------------------------- ORDERS
   Da #41 gli ordini della clientela nascono lato server dopo il pagamento.
   L'unica scrittura client diretta è quella della cassa (admin). */

describe("orders", () => {
  it("un anonimo NON può creare un ordine (passa dal server)", async () => {
    await assertFails(addDoc(collection(anon(), "orders"), ordine({ channel: "prenotazione" })));
  });

  it("la cassa crea un ordine ben formato", async () => {
    await assertSucceeds(addDoc(collection(admin(), "orders"), ordine()));
  });

  it("accetta l'ordine da cassa con il metodo di incasso", async () => {
    await assertSucceeds(addDoc(collection(admin(), "orders"), ordine({ tender: "contanti" })));
  });

  it("rifiuta un ordine senza nome", async () => {
    await assertFails(addDoc(collection(admin(), "orders"), ordine({ name: "" })));
  });

  it("rifiuta un carrello vuoto", async () => {
    await assertFails(addDoc(collection(admin(), "orders"), ordine({ items: [] })));
  });

  it("rifiuta un totale negativo", async () => {
    await assertFails(addDoc(collection(admin(), "orders"), ordine({ total: -50 })));
  });

  it("rifiuta uno stato diverso da 'nuovo'", async () => {
    await assertFails(addDoc(collection(admin(), "orders"), ordine({ status: "consegnato" })));
  });

  it("rifiuta un metodo di pagamento inventato", async () => {
    await assertFails(addDoc(collection(admin(), "orders"), ordine({ pay: "gratis" })));
  });

  it("rifiuta un canale inventato", async () => {
    await assertFails(addDoc(collection(admin(), "orders"), ordine({ channel: "chissà" })));
  });

  it("rifiuta campi estranei", async () => {
    await assertFails(addDoc(collection(admin(), "orders"), ordine({ sconto: 100 })));
  });

  it("rifiuta una data di creazione falsificata", async () => {
    await assertFails(addDoc(collection(admin(), "orders"), ordine({ createdAt: new Date(2000, 0, 1) })));
  });

  it("un anonimo non può leggere gli ordini", async () => {
    await seed((db) => setDoc(doc(db, "orders/x1"), ordine()));
    await assertFails(getDoc(doc(anon(), "orders/x1")));
  });

  it("un anonimo non può modificare un ordine", async () => {
    await seed((db) => setDoc(doc(db, "orders/x1"), ordine()));
    await assertFails(setDoc(doc(anon(), "orders/x1"), ordine({ status: "consegnato" })));
  });

  it("l'admin legge e aggiorna", async () => {
    await seed((db) => setDoc(doc(db, "orders/x1"), ordine()));
    await assertSucceeds(getDoc(doc(admin(), "orders/x1")));
    await assertSucceeds(setDoc(doc(admin(), "orders/x1"), ordine({ status: "consegnato" })));
  });

  /* Invertito rispetto al pre-Stripe: il buco "il client si dichiara pagato
     online" è chiuso. Ora un anonimo non può proprio creare ordini: quelli
     online li scrive solo il webhook lato server. */
  it("un anonimo non può creare un ordine 'pagato online'", async () => {
    await assertFails(addDoc(collection(anon(), "orders"), ordine({ channel: "prenotazione", pay: "online", total: 0 })));
  });
});

/* ------------------------------------------------------------------ HOLDS
   Prenotazioni provvisorie a scadenza (#40): server-only, nessun accesso
   client — nemmeno all'admin loggato. */

describe("holds · server-only", () => {
  it("un anonimo non può leggerli", async () => {
    await seed((db) => setDoc(doc(db, "holds/h1"), { serviceKey: KEY, status: "attesa" }));
    await assertFails(getDoc(doc(anon(), "holds/h1")));
  });
  it("un anonimo non può scriverli", async () => {
    await assertFails(setDoc(doc(anon(), "holds/h1"), { serviceKey: KEY, status: "attesa" }));
  });
  it("nemmeno l'admin loggato può scriverli (li tocca solo il server)", async () => {
    await assertFails(setDoc(doc(admin(), "holds/h1"), { serviceKey: KEY, status: "attesa" }));
  });
});

/* --------------------------------------------------------------- SETTINGS
   Impostazioni dell'attività: solo l'admin legge e scrive. */

describe("settings · lettura pubblica, scrittura admin", () => {
  it("chiunque può leggerle (il cliente deve sapere se può prenotare)", async () => {
    await seed((db) => setDoc(doc(db, "settings/app"), { cassaEnabled: true }));
    await assertSucceeds(getDoc(doc(anon(), "settings/app")));
  });
  it("un anonimo non può scriverle", async () => {
    await assertFails(setDoc(doc(anon(), "settings/app"), { bookingBlocked: true }));
  });
  it("l'admin legge e scrive", async () => {
    await assertSucceeds(setDoc(doc(admin(), "settings/app"), { cassaEnabled: false }));
    await assertSucceeds(getDoc(doc(admin(), "settings/app")));
  });
});
