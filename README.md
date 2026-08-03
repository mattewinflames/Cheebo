# Cheebo — prenotazioni, ordini e pagamento

Web app di **ordine-e-ritiro** per Cheebo (smashburgeria a Roma): il cliente
compone il suo ordine, sceglie una fascia di ritiro, **paga online** e riceve un
codice di ritiro; il personale gestisce ordini, cassa, incassi e menù da un
pannello admin. Cuore del sistema è un motore di capacità della piastra
(**13 patty per finestra da 10 minuti**) che rende i tempi di ritiro affidabili e
impedisce l'overbooking.

**Stack:** Vite · React 18 · TypeScript · Firebase (Firestore + Auth) · Stripe ·
funzioni serverless su Vercel.

---

## Cosa fa

**Cliente** (`/`) — sfoglia il menù, configura i panini (formato, menu con bibita,
extra, rimozioni, sostituzioni), aggiunge special a disponibilità limitata,
sceglie l'orario di ritiro, **paga con Stripe Checkout** e ottiene codice di
ritiro, indirizzo con "come arrivare" e conferma via WhatsApp.

**Admin** (`/admin`) — pannello a schede:
- **Cassa** — POS per battere gli ordini al banco (attivabile/disattivabile dalle Opzioni).
- **Ordini** — coda in tempo reale e occupazione della piastra.
- **Incassi** — riepilogo con export CSV/XLSX.
- **Menu** — editor dei prodotti (prezzi, formati, extra, flag piastra, special).
- **Opzioni** — impostazioni dell'attività (es. modalità cassa).

> La cassa e gli export **non sono documenti fiscali**: nessuna trasmissione di
> corrispettivi. Il collegamento al registratore telematico (POS-RT) è un lavoro a parte.

---

## Come funziona il pagamento

Il client non invia mai i prezzi, solo la **configurazione** del carrello. Il
server è l'unico a fissare prezzi e capacità, e la conferma arriva dal webhook,
non dal redirect del browser:

1. `POST /api/create-booking` — ricalcola dal menù reale, in transazione occupa
   piastra e stock, crea un **hold** con scadenza, apre Stripe Checkout, torna l'URL.
2. redirect a Stripe → pagamento → redirect a `/pagamento/ok?session_id=…`.
3. `POST /api/stripe-webhook` (**sola fonte di verità**): su
   `checkout.session.completed` crea l'ordine e il codice di ritiro; su
   `checkout.session.expired` rilascia lo slot.
4. La pagina di esito fa polling di `GET /api/order-status` finché il webhook conferma.

---

## Struttura del progetto

```
src/
  lib/            dominio e accesso dati
    dispatch.ts     motore piastra (puro, testato)
    schedule.ts     calendario dei servizi e sessioni prenotabili
    menu.ts         modello prodotto, configuratore, carrello
    booking.ts      resolveCart: ricalcolo autoritativo lato server (puro, testato)
    orders.ts       prenotazione/stream Firestore + startCheckout
    menuStore.ts    CRUD del menù
    settings.ts     impostazioni dell'attività (settings/app)
    export.ts       report incassi
    firebase.ts     init Firebase + costanti del locale
    whatsapp.ts     messaggio e link wa.me
  pages/
    Prenotazioni.tsx    sito cliente
    AdminCassa.tsx      pannello admin a schede
    EsitoPagamento.tsx  esito del pagamento con polling
  main.tsx          router (/, /admin, /pagamento/ok, /pagamento/annullato)
api/                funzioni serverless (Vercel + Firebase Admin + Stripe)
  create-booking.ts  order-status.ts  stripe-webhook.ts
  _lib/              admin.ts  stripe.ts  holds.ts
scripts/            seed / reset / verifica-regole (girano da Node)
firestore.rules     regole di sicurezza
tests/rules.test.mjs test delle regole (richiede l'emulatore Firestore)
```

---

## Sviluppo in locale

### Prerequisiti
- Node.js e npm
- Un progetto Firebase (Firestore + Authentication email/password + App Check)
- Stripe CLI (per il webhook in locale) e Vercel CLI (per servire le funzioni `/api`)

### 1. Installazione
```
npm install
```

### 2. Variabili d'ambiente
Copia il template e compila con i valori del tuo progetto:
```
cp .env.example .env.local
```
Le `VITE_*` sono pubbliche (finiscono nel bundle client). `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT` e `APP_URL` sono **solo server**.

### 3. Firebase
1. Firestore Database (modalità produzione).
2. Authentication → Email/Password → crea l'utente admin.
3. Pubblica le regole: `firebase deploy --only firestore:rules`.
4. Popola il menù: `npm run seed` (richiede l'enforcement App Check temporaneamente spento).

### 4. Avvio
Le funzioni `/api` sono servite da `vercel dev`, non dal dev server di Vite. Su
Windows è comodo `dev.bat`, che carica le env server in sessione e avvia Vercel:
```
vercel dev            # serve app + funzioni su http://localhost:3000
```
In una finestra separata, l'inoltro del webhook Stripe:
```
stripe listen --forward-to localhost:3000/api/stripe-webhook
```
Prova il flusso con la carta di test `4242 4242 4242 4242`.

> Nota: `vercel dev` non inietta `.env.local` nelle funzioni serverless — vanno
> caricate nell'ambiente della shell prima dell'avvio (`dev.bat` lo fa).

---

## Test e build

```
npm test        # test unitari del dominio (non serve Firebase: il motore è puro)
npm run build   # type-check + build di produzione
```

Il type-check delle funzioni serverless è separato:
```
npx tsc -p api/tsconfig.json
```
I test delle regole (`tests/rules.test.mjs`) richiedono l'emulatore Firestore
(`npm run test:rules`, serve Java 11+).

---

## Deploy in produzione (Vercel)

1. Collega il repo a un progetto Vercel; imposta le **env di produzione**.
2. **Stripe in modalità live**: chiavi live e webhook di produzione verso
   `https://<dominio>/api/stripe-webhook` (con il suo `whsec_`).
3. `APP_URL` = dominio di produzione.
4. **App Check**: aggiungi il dominio di produzione tra quelli autorizzati della
   site key reCAPTCHA e attiva l'enforcement.
5. Pubblica le **regole** Firestore aggiornate.
6. Deploy e verifica un giro completo prenotazione → pagamento → ordine in cassa.

---

## Sicurezza

- I segreti (`.env`, `.env.local`, service account) **non sono versionati**
  (`.gitignore`); nel repo c'è solo `.env.example` con i placeholder.
- Le scritture del cliente passano **solo dal server** (Admin SDK): le regole
  Firestore riservano `sessions`/`orders` all'admin e `holds` è server-only.
- Il prezzo è sempre ricalcolato lato server dal menù reale, mai fidandosi del client.
