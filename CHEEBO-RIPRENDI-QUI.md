# Cheebo — Punto di ripresa

> Fotografia dello stato **attuale**. Per la storia delle modifiche c'è `docs/REGISTRO-SVILUPPO.md`.
> Aggiornato: 3 agosto 2026.

---

## ⚠️ Da sapere prima di toccare qualsiasi cosa

**1. Il pagamento online funziona davvero, end-to-end (Stripe).** Il cliente
prenota passando dal server (`commit()` → `POST /api/create-booking`), viene
rediretto a **Stripe Checkout**, e l'ordine compare in cassa **solo** dopo la
conferma del **webhook** (`/api/stripe-webhook`). La pagina `/pagamento/ok` fa
polling di `/api/order-status` finché il webhook conferma, poi mostra codice di
ritiro, indirizzo con "Come arrivare" e conferma WhatsApp. In locale gira in
**test mode** (carta `4242 4242 4242 4242`). Provato con successo end-to-end.

**2. Questo repo/progetto è Cheebo in PRODUZIONE (istanza reale), non lo
scheletro.** Lo scheletro riutilizzabile è un lavoro **separato e successivo**
(vedi `docs/CHEEBO-SCHELETRO.md` e `docs/PROMPT-SCHELETRO.md`, quando esisteranno
nel repo). Qui il codice si usa così com'è.

**3. Il grande blocco aperto è il GO-LIVE su Vercel.** Prima di essere online
davvero servono, in produzione: chiavi **Stripe LIVE** (non test) + webhook di
produzione col suo `whsec_`; env di produzione su Vercel; dominio autorizzato in
**reCAPTCHA/App Check**; `APP_URL` di produzione; **deploy delle regole**
Firestore. Vedi "Prossimi passi".

**4. Le regole Firestore live potrebbero non essere allineate a `firestore.rules`.**
In sviluppo, con App Check spento, il menù carica ma il **ledger admin
(`subscribeLedger` su `sessions`) dà permission-denied**: è il segnale che le
regole pubblicate sul progetto sono più vecchie di quelle nel file. Va fatto
`firebase deploy --only firestore:rules` (e verificato). ⚠️ Le regole del lockdown
si pubblicano **insieme** a questo client, mai prima: con una vecchia build online
si romperebbero le prenotazioni.

**5. App Check in locale è tenuto SPENTO (enforcement off) per sviluppare.** Su
localhost reCAPTCHA v3 non ha un dominio valido e il debug token è fragile
(`403 exchangeDebugToken`): per lavorare si tiene l'enforcement disattivato dalla
console (App Check → API → Cloud Firestore). **In produzione va ACCESO**, dove
gira su dominio reale. I 403 App Check che vedi in locale, con enforcement off,
sono rumore innocuo.

**6. POS–RT (#15) non collegato.** Obbligo fiscale dal 01/01/2026, da fare sul
portale Fatture e Corrispettivi. La cassa e gli export **non sono fiscali**:
nessun documento commerciale, nessuna trasmissione corrispettivi.

**7. `scripts/reset.mjs` punta al progetto reale e cancella dati.** Innocuo finché
sono dati di prova, pericoloso quando il locale sarà operativo.

**8. In locale `vercel dev` non inietta `.env.local` nelle funzioni `/api`.** Si
caricano le variabili nella sessione della shell **prima** di avviarlo: lo fa
`dev.bat` / `dev-with-env.ps1` (che saltano di proposito le `VITE_`, lette da Vite
dal file). E il webhook locale richiede `stripe listen` attivo in una finestra a
parte, altrimenti la conferma non arriva e la pagina di esito resta in attesa.

---

## Cos'è

Sistema di prenotazioni e ordini per **Cheebo — Bite the East Side** (La Rustica,
Roma). Il sito vetrina è su Framer (`www.cheebo.it`); questa è l'app di
ordine-e-ritiro, da collegare come canale dedicato.

- **Cliente** (`/` → `src/pages/Prenotazioni.tsx`): sfoglia il menù, compone i
  panini, sceglie l'orario di ritiro, paga con Stripe, riceve codice di ritiro,
  indirizzo e conferma WhatsApp (`src/pages/EsitoPagamento.tsx`).
- **Admin** (`/admin` → `src/pages/AdminCassa.tsx`): schede **Cassa · Ordini ·
  Incassi · Menu · Opzioni**. La scheda Cassa (POS al banco) si può accendere/
  spegnere dalla scheda **Opzioni** (flag `cassaEnabled` in `settings/app`).

**Stack:** Vite + React 18 + TypeScript + Firebase (Firestore + Auth) + Stripe.
Funzioni serverless su Vercel. Repo: `github.com/mattewinflames/Cheebo` (pubblico).

---

## Il motore: capacità della piastra

`src/lib/dispatch.ts` — puro e coperto da test. Non toccarlo senza capire perché
i test falliscono.

- La piastra fa **max 13 patty per finestra da 10 minuti** (`CAP`).
- **Solo i panini con flag `griddle` occupano la piastra** (default: Classic,
  Oklahoma, Crispy). Editabile per voce dalla scheda Menu. Il resto è ordinabile
  senza limiti.
- Un ordine con **0 patty è legittimo** e vede tutti gli orari.
- Un ordine è pronto nella finestra del suo **ultimo** patty; se non ci sta, slitta.
- Ogni servizio è una piastra a sé: il registro riparte da zero.

**Limite noto (#16):** `CAP` è unico per tutti i servizi e assume che i 13 patty
siano tutti per le prenotazioni. Ma il **banco è l'afflusso principale** e consuma
la stessa piastra: va reso una manopola per servizio prima che le prenotazioni
crescano.

---

## Composizione del panino

Chiave, etichetta e prezzo si costruiscono **solo** in `src/lib/menu.ts`
(`PaninoConfig` → `cartKey` / `cartLabel` / `cartPrice`). È ciò che tiene allineati
sito cliente e cassa: non duplicare quella logica nelle pagine. Ogni riga porta
inoltre un `req` (tipo `CartReq`) con la **sola configurazione** — è ciò che il
client invia al server, che ricalcola i prezzi (`resolveCart` in `booking.ts`).

Gerarchia della scheda: Formato (= patty) e Tipo (panino / menu); ingredienti da
togliere; sostituzioni (pane/formaggio vegano, senza sovrapprezzo); extra a
pagamento; bibita compresa se menu. Ciò che non è in `ingredients` non è
togliibile. Unica bibita con sovrapprezzo: birra artigianale +3.

---

## Special (fuori menù)

Proposta a disponibilità limitata per sessioni precise. Vive **fuori menù**:
prezzo fisso (`solo`), niente formato/menu/extra. Riga costruita solo con
`specialCartLine()` (chiave `id|special`). Stock **per sessione** in
`sessions/{serviceKey}.stock`, decrementato nella stessa transazione che riserva
la piastra, col valore letto dal menù. In `EsitoPagamento`/`Prenotazioni`: se gli
special attivi sono **più di uno**, sono accorpati in un unico riquadro (#44).

---

## Pagamento Stripe

**Checkout ospitato** (redirect) + **prenota-e-tieni con scadenza**.

1. Il client chiama `POST /api/create-booking` mandando **solo la configurazione**
   del carrello (id, formato, quantità), **mai i prezzi**.
2. Il server ricalcola dal menù reale (`resolveCart`, puro e testato), in una
   transazione Admin occupa piastra+stock e scrive un **hold** con `expiresAt`
   nella collezione server-only `holds`. Apre la sessione Stripe e torna l'`url`.
3. Il **webhook** è la sola fonte di verità: `checkout.session.completed` crea
   l'ordine reale e il codice di ritiro; `checkout.session.expired` rilascia lo
   slot. Il redirect del browser non conferma niente.
4. La pagina di esito interroga `GET /api/order-status?session_id=…` (il client
   non può leggere `orders`).

Punti fermi: `orders` e il **banco restano identici** (l'online è un percorso a
parte); il codice di ritiro si assegna **a pagamento avvenuto**, non all'hold;
`HOLD_MINUTES = 30` è allineato alla scadenza minima Stripe, non abbassarlo senza
gestire il ricollocamento (#42). Rilascio hold oggi solo via webhook `expired`
(self-healing in #42); rimborsi ignorati (#43). Il **telefono cliente è stato
rimosso** (#44): non più raccolto né richiesto.

Env server (mai `VITE_`): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`FIREBASE_SERVICE_ACCOUNT` (JSON su una riga), `APP_URL`.

---

## Opzioni dell'attività

`settings/app` su Firestore (`src/lib/settings.ts`), letto/scritto solo
dall'admin. Oggi un solo flag: **`cassaEnabled`** (accende/spegne la scheda Cassa).
È il contenitore per opzioni future. In locale la **scrittura** delle opzioni
richiede le regole aggiornate pubblicate (`match /settings`), altrimenti fallisce
e la sezione mostra un avviso; la lettura, se negata, ricade sui default.

---

## Stato dei pezzi

| Pezzo | Stato |
|---|---|
| Percorso cliente completo | funzionante |
| Pagamento online (Stripe) | **funzionante end-to-end in locale (test mode)** |
| Schermata di conferma (codice, indirizzo+Maps, WhatsApp) | funzionante (#46) |
| Conferma WhatsApp | funzionante, testata su telefono reale |
| Admin: ordini, piastra, incassi, menù | funzionante |
| Scheda Cassa (ordini al banco) | prototipo, **non fiscale** (#15); accendibile da Opzioni (#45) |
| Special a disponibilità limitata | funzionante, fuori menù; accorpati se >1 (#44) |
| Menù reale su Firestore | **seed eseguito, menù popolato** |
| Regole Firestore | scritte per il lockdown; **da (ri)deployare e verificare** (vedi rischio #4) |
| App Check | in locale **enforcement spento** per sviluppo; in produzione **da accendere** |
| Repo Git | **su GitHub** (`mattewinflames/Cheebo`, pubblico) |
| Go-live su Vercel | **da fare** (Stripe live, env prod, reCAPTCHA, APP_URL, deploy regole) |
| Collegamento al sito Framer | da fare (bottone + sottodominio) |

---

## Comandi

Su questa macchina (Windows Enterprise gestita) gli shim `.ps1` sono bloccati: si
usa `npm.cmd` / `npx.cmd`, e i binari nativi per gli strumenti CLI.

```
.\dev.bat                    # carica le env server in sessione e avvia `vercel dev` (:3000)
npm.cmd run build            # type-check + build
npm.cmd run test             # test unitari (src/**/*.test.ts)
npm.cmd run seed             # popola il menù        (richiede enforcement App Check spento)
npm.cmd run reset            # cancella dati         (richiede enforcement spento) ⚠️ distruttivo
npm.cmd run verifica-regole  # prova le regole       (richiede enforcement spento)
npx.cmd tsc -p api/tsconfig.json   # type-check delle funzioni serverless /api
```

Webhook Stripe in locale (finestra a parte, altrimenti la conferma non arriva):

```
& "C:\Users\08300794\bin\stripe.exe" listen --forward-to localhost:3000/api/stripe-webhook
```

Git in questa sessione (PortableGit, alias da rifare a ogni terminale):

```
Set-Alias git "$env:USERPROFILE\Downloads\PortableGit\cmd\git.exe"
git add . ; git commit -m "..." ; git push
```

`test:rules` (emulatore) non gira qui: richiede Java 11+ (sulla macchina c'è la 8,
da non toccare). I test delle regole (`tests/rules.test.mjs`) sono aggiornati ma
**vanno rieseguiti** dove c'è l'emulatore.

---

## Configurazione (`.env.local`, mai committare)

- `VITE_FB_*` / `VITE_FIREBASE_*` — credenziali Firebase (pubbliche, nel bundle)
- `VITE_LOCALE_PHONE` — WhatsApp del locale, internazionale **senza `+`**
- `VITE_LOCALE_ADDRESS` / `VITE_LOCALE_MAPS_URL` — indirizzo e link "come arrivare" (#46)
- `VITE_APPCHECK_SITE_KEY` — chiave **del sito** reCAPTCHA (mai la segreta)
- `VITE_APPCHECK_DEBUG` — in dev: `false` (o un UUID di debug token registrato)
- `SEED_EMAIL` / `SEED_PASSWORD` — admin usato dagli script
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — Stripe (solo server)
- `FIREBASE_SERVICE_ACCOUNT` — service account JSON su una riga (solo server)
- `APP_URL` — base pubblica per i redirect di Checkout (senza slash finale)

Template completo in `.env.example` (versionato, solo placeholder).

---

## Prossimi passi

1. **Deploy delle regole** e verifica del ledger admin (rischio #4):
   `firebase deploy --only firestore:rules`, poi controlla che `subscribeLedger`
   non dia più permission-denied.
2. **Go-live su Vercel** (l'app resta staccata dal sito finché non colleghi il
   bottone, quindi si può preparare tutto in anticipo):
   a. env di produzione su Vercel (tutte quelle sopra, versione reale);
   b. **Stripe in modalità LIVE**: chiavi live + webhook di produzione verso
      `https://<dominio>/api/stripe-webhook`, col suo nuovo `whsec_`;
   c. `APP_URL` = dominio di produzione;
   d. **reCAPTCHA/App Check**: aggiungi il dominio di produzione tra quelli
      autorizzati della site key, e **accendi l'enforcement**;
   e. deploy e giro end-to-end sull'URL `…vercel.app`.
3. **Collegamento al sito Framer** (ultimo miglio, reversibile):
   - subito: un bottone su Framer verso l'URL `…vercel.app` per validare;
   - poi: sottodominio `ordina.cheebo.it` → Vercel. DNS su **Aruba**: aggiungere
     **solo** un record CNAME `ordina` → il target che indica Vercel, senza
     toccare il root/`www` (Framer) né gli MX (email). Collegare "Pickup in Store".
4. **POS–RT (#15)**, contestuale ai pagamenti live.
5. **README + registro**: tenere allineati (README aggiornato in questa sessione).
6. Backlog motore: **#16** `CAP` come manopola per servizio; **#42** self-healing
   hold; **#43** rimborsi.

Backlog completo e motivazioni: `docs/REGISTRO-SVILUPPO.md`.

---

## Trappole già pagate (non ripeterle)

- **App Check su localhost è fragile**: il debug token non combacia facilmente e
  `vercel dev` non passa `VITE_APPCHECK_DEBUG` a Vite in modo affidabile. In
  sviluppo tieni l'enforcement spento; combatterci non avvicina la produzione.
- **`vercel dev` e `.env.local`**: le funzioni non lo leggono; carica le env in
  sessione prima (lo fa `dev.bat`). E `stripe listen` dev'essere attivo o la
  conferma non arriva.
- **Il rewrite SPA in `vercel.json`** deve escludere `api/`, gli asset e i moduli
  di Vite (`@`, `src/`, `node_modules/`, file con estensione), o sotto `vercel dev`
  affama il dev server e vedi 404 su `@react-refresh`/`main.tsx`.
- **Firestore rifiuta `undefined`**: includi i campi opzionali solo se valorizzati.
- **Mai `orderBy` + `where` su campi diversi** senza indice composito.
- **Le sottoscrizioni vogliono `onError`**: senza, falliscono in silenzio.
- **`lucide-react` resta a `0.383.0`**.
- **Cassa ed export non sono fiscali**: non chiamarli "chiusura", "scontrino" o
  "rapporto Z".
- **Segreti fuori dal repo**: `.env*` è in `.gitignore` (tranne `.env.example`);
  la service account sta solo in `.env.local`. Se un segreto finisce in un commit,
  va rigenerato.
