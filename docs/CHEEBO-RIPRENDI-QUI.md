# Cheebo — Punto di ripresa

> Fotografia dello stato **attuale**. Per la storia delle modifiche: `docs/REGISTRO-SVILUPPO.md`.
> Aggiornato: 22 agosto 2026.

---

## ⚠️ Da sapere prima di toccare qualsiasi cosa

**1. Il pagamento online usa NEXI XPay HPP** (non più Stripe). Il cliente prenota
passando dal server (`POST /api/create-booking`), viene rediretto alla Hosted Payment
Page Nexi, e l'ordine compare in cassa **solo** dopo la conferma del **webhook**
(`/api/nexi-webhook`). La pagina `/pagamento/ok?hold_id=...` fa polling di
`/api/order-status?hold_id=...` finché il webhook conferma, poi mostra codice di
ritiro. Stripe è rimosso dal flusso — i file `stripe-webhook.ts` e `stripe.ts` sono
ancora nel repo ma non più in uso (da rimuovere dopo il go-live).

**2. Il sistema è LIVE su Vercel** (`cheebo-iota.vercel.app`) con pagamenti Nexi in
**sandbox** (test). Le credenziali live Nexi arriveranno dal cliente per il go-live
finale. Per passare in produzione: aggiornare `NEXI_API_KEY` con la chiave live e
impostare `NEXI_ENV=production` su Vercel — nessun file da toccare.

**3. `dev.bat` usa un batch temporaneo** (`_dev_tmp.bat`, generato al volo e rimosso
automaticamente) per caricare le env server in `vercel dev`. `VITE_*` sono escluse
(le legge Vite direttamente dal file). Il problema storico: nessun flag o variabile
PowerShell viene ereditato da `vercel dev` su Windows — solo il batch `cmd /c` con
`SET` nativo funziona.

**4. Le regole Firestore live potrebbero non essere allineate a `firestore.rules`.**
Pubblicarle con `firebase deploy --only firestore:rules` (o dalla console) prima
di ogni go-live. Le regole si pubblicano **con** il client, mai prima (con una vecchia
build online si romperebbero le prenotazioni).

**5. App Check in locale è SPENTO** (enforcement off). In produzione va acceso.
I 403 App Check in locale sono rumore innocuo.

**6. POS–RT (#15) non collegato.** Obbligo fiscale. La cassa e gli export non sono
fiscali: nessun documento commerciale, nessuna trasmissione corrispettivi.

**7. `scripts/reset.mjs` punta al progetto Firestore impostato in `.env`.** Verifica
sempre `Select-String -Path .env -Pattern "VITE_FB_PROJECT_ID"` prima di lanciarlo.

**8. Lo stress test va su produzione** (Vercel), non in locale. `dev.bat` non
funziona per le API per via delle env. Lo stress test usa `$env:STRESS_DATE` per
la data — impostare una data entro 7 giorni (nel range di `BOOKING_DAYS_AHEAD`).

---

## Cos'è

Sistema di prenotazioni e ordini per **Cheebo — Bite the East Side** (La Rustica,
Roma, Via Aretusa 6, 00155). Sito vetrina su Framer (`www.cheebo.it`); questa è
l'app ordine-e-ritiro, da collegare come canale dedicato.

- **Cliente** (`/` → `src/pages/Prenotazioni.tsx`): sfoglia il menù, compone i
  panini, sceglie l'orario di ritiro, paga con Nexi XPay, riceve codice di ritiro
  e conferma.
- **Admin** (`/admin` → `src/pages/AdminCassa.tsx`): schede **Ordini · Incassi ·
  Menu · Opzioni** (+ Cassa se `cassaEnabled`). Footer "Built by MattewInFlames
  Studio" con link a landing in costruzione.

**Stack:** Vite + React 18 + TypeScript + Firebase (Firestore + Auth) + Nexi XPay.
Funzioni serverless su Vercel. Repo: `github.com/mattewinflames/Cheebo` (pubblico).

---

## Architettura pagamento (Nexi XPay)

Flusso: `create-booking` → transazione Firestore (hold) → `POST /orders/hpp` Nexi
→ redirect cliente → webhook `nexi-webhook` → ordine reale + codice ritiro.

**File chiave:**
- `api/_lib/nexi.ts` — client Nexi (URL sandbox/live da `NEXI_ENV`)
- `api/create-booking.ts` — crea hold + sessione HPP, restituisce `hostedPage` URL
- `api/nexi-webhook.ts` — riceve notifiche Nexi; `AUTHORIZED/EXECUTED` → confirm;
  `CANCELED/DECLINED/FAILED` → release hold
- `api/order-status.ts` — polling: accetta `hold_id` (Nexi) e `session_id` (retro)
- `api/_lib/holds.ts` — tipo `Hold` con campi `nexiOrderId`, `nexiSecurityToken`

**Autenticazione webhook:** confronto `securityToken` salvato sull'hold vs quello
ricevuto nella notifica (analogo HMAC-SHA256 di Stripe).

**Variabili env server:**
- `NEXI_API_KEY` — chiave API XPay (sandbox o live)
- `NEXI_ENV` — vuoto/assente = sandbox; `production` = live
- `FIREBASE_SERVICE_ACCOUNT` — service account JSON su una riga
- `APP_URL` — base pubblica per i redirect (`https://cheebo-iota.vercel.app`)

---

## Il motore: capacità della piastra

`src/lib/dispatch.ts` — puro e coperto da **66 test**. Non toccarlo senza capire
perché i test falliscono.

- La piastra fa **max 13 patty per finestra da 10 minuti** (`CAP`, `WINDOW_MIN`).
- **Solo i panini con flag `griddle` occupano la piastra.**
- `planFirst`/`planAt`/`firstFeasibleWindow`/`bookableWindows` accettano `minWindow`
  (default 0): non usano finestre già trascorse se il servizio è in corso oggi.
  `minWindowNow(serviceKey, service, now)` calcola questo valore in `schedule.ts`.
- Il server è l'**autorità sul tempo**: la sessione deve essere in
  `upcomingSessions(now, …, {closedDays})` — un check unico per date passate,
  fuori range, servizi finiti e giorni chiusi.

---

## Costo servizio di prenotazione

Importo fisso per ordine, configurabile dall'admin in **Opzioni** (toggle + campo €).
Salvato in `settings/app` come `costoServizio` (number, euro) e `costoServizioAttivo`
(boolean). Il server lo legge da Firestore in `create-booking` e lo passa a
`resolveCart` come `serviceCharge`. `booking.ts` restituisce `total` (solo prodotti)
e `totalConServizio` (finale). Il cliente vede la voce separata nel riepilogo.

---

## Comanda cucina (.txt)

`GET /api/comanda-txt?order_id=...` — genera `comanda-N.txt` plain ASCII 32 colonne
(58mm, font ESC/POS standard). Word-wrap corretto: le righe lunghe si spezzano solo
tra parole. Stampante scelta: **Bisofice Z58-01** (58mm, ESC/POS, Bluetooth+USB+LAN).
Il bottone "Stampa comanda" in AdminCassa scarica il file direttamente.

---

## Stampa comanda — stato e prossimi passi

Il flusso attuale (download `.txt` + stampa manuale) è la base. Per la stampa
**automatica** senza click — quando il tablet e la stampante saranno in loco — serve
un bridge locale (script Node su un dispositivo fisso) che ascolta Firestore e invia
comandi ESC/POS alla stampante via LAN o Bluetooth. Da implementare quando il
modello operativo del locale è definito (tablet Android + stampante sulla stessa rete).

---

## Stato dei pezzi

| Pezzo | Stato |
|---|---|
| Percorso cliente completo | ✅ funzionante |
| Pagamento Nexi XPay (sandbox) | ✅ funzionante end-to-end |
| Migrazione a Nexi live | ⏳ in attesa chiavi live dal cliente |
| Admin: ordini, piastra, incassi, menù, opzioni | ✅ funzionante |
| Scheda Cassa (POS al banco) | ✅ prototipo, non fiscale (#15) |
| Special a disponibilità limitata | ✅ funzionante |
| Costo servizio di prenotazione | ✅ configurabile da Opzioni |
| Comanda cucina .txt 58mm | ✅ funzionante (word-wrap corretto) |
| Stress test piastra | ✅ superato (20 req simultanee, 0 overflow) |
| Footer "Built by MattewInFlames Studio" | ✅ presente in Prenotazioni |
| Menù reale su Firestore (`cheeboroma-prod`) | ✅ seedato |
| Regole Firestore | ✅ scritte; da (ri)deployare a ogni modifica |
| App Check | ⚠️ enforcement spento in locale; da accendere in produzione |
| Repo Git | ✅ `mattewinflames/Cheebo` (pubblico) |
| Collegamento Framer (bottone + sottodominio) | ⏳ comunicazione inviata al webmaster |
| Go-live Nexi live | ⏳ da fare (chiavi live + `NEXI_ENV=production`) |
| POS–RT (#15) | ❌ non collegato (obbligo fiscale) |

---

## Comandi

```powershell
.\dev.bat                          # carica env server e avvia vercel dev (:3000)
npm.cmd run build                  # tsc --noEmit + vite build
npm.cmd test                       # 66 test core (dispatch, booking, menu)
npm.cmd run seed                   # popola il menù su Firestore
npm.cmd run reset                  # ⚠️ cancella dati (verifica VITE_FB_PROJECT_ID prima)
npm.cmd run stress:motore          # stress test motore offline (5 test)
npm.cmd run stress:api             # stress test API su produzione (impostare $env:STRESS_DATE)
npm.cmd run stress:cleanup         # rimuove sessione di test da Firestore
npm.cmd run stress:check           # verifica stato post-cleanup

# tsc delle funzioni serverless (NodeNext):
node node_modules/typescript/bin/tsc -p api/tsconfig.json

# Git (PortableGit, alias da rifare a ogni terminale):
Set-Alias git "$env:USERPROFILE\Downloads\PortableGit\cmd\git.exe"
git -c http.proxy= -c https.proxy= push   # se su hotspot (no proxy aziendale)
```

---

## Configurazione (`.env.local` + `.env`, mai committare)

- `VITE_FB_*` — credenziali Firebase (nel bundle, pubbliche)
- `VITE_LOCALE_PHONE` — WhatsApp del locale, internazionale senza `+`
- `VITE_LOCALE_ADDRESS` / `VITE_LOCALE_MAPS_URL` — indirizzo e link Maps
- `VITE_APPCHECK_SITE_KEY` — chiave reCAPTCHA del sito (mai la segreta)
- `VITE_APPCHECK_DEBUG` — `false` in dev
- `SEED_EMAIL` / `SEED_PASSWORD` — admin per gli script
- `NEXI_API_KEY` — chiave API Nexi XPay (sandbox o live)
- `NEXI_ENV` — vuoto = sandbox; `production` = live
- `FIREBASE_SERVICE_ACCOUNT` — service account JSON su una riga (solo server)
- `APP_URL` — base pubblica per i redirect Nexi

Funzioni Usa-Prod / Usa-Test (da ridefinire a ogni terminale):
copiano le coppie `.env.prod`+`.env.local.prod` o `.env.test`+`.env.local.test`
in `.env`+`.env.local`. Verifica sempre con:
```powershell
Select-String -Path .env -Pattern "VITE_FB_PROJECT_ID"
```

---

## Prossimi passi

1. **Go-live Nexi live** (quando il cliente ha le chiavi):
   - Aggiornare `NEXI_API_KEY` con chiave live su Vercel
   - Aggiungere `NEXI_ENV=production` su Vercel
   - Configurare `notificationUrl` nel back office Nexi live →
     `https://cheebo-iota.vercel.app/api/nexi-webhook`
   - Redeploy Vercel → test con panino prova da 0,50€ → rimuovere panino test
2. **Collegamento Framer** (webmaster): bottone → URL Vercel + CNAME `ordina`
   su Aruba → aggiungere `ordina.cheebo.it` su Vercel → aggiornare `og:url`
   e `og:image` in `index.html`.
3. **Pulizia post-migrazione**: rimuovere `api/stripe-webhook.ts` e
   `api/_lib/stripe.ts` + variabili Stripe da Vercel.
4. **Stampa automatica**: bridge Node locale (ascolta Firestore → ESC/POS via
   LAN/Bluetooth) quando tablet e stampante sono in loco.
5. **POS–RT (#15)**: portale Fatture e Corrispettivi.
6. **Backlog motore**: #16 CAP per servizio; #42 self-healing hold; #43 rimborsi.

---

## Trappole già pagate (non ripeterle)

- **`vercel dev` su Windows non eredita env alle funzioni `/api`.** Nessun flag
  PowerShell funziona. Solo `cmd /c batch.bat` con `SET` nativo. Lo fa `dev.bat`.
- **Lo stress test va su produzione**, non in locale (stesso motivo delle env).
  Usare `$env:STRESS_DATE` con data entro 7 giorni e pulire dopo con `stress:cleanup`.
- **Proxy aziendale blocca Git/Node**: usare hotspot + `git -c http.proxy= push`.
- **`Set-Content -Encoding UTF8` in PowerShell aggiunge BOM** che rompe il parsing
  JSON di Vite (`package.json`, `postcss.config.json`). Usare Python per scrivere
  JSON senza BOM: `json.dump(...); f.write('\n')`.
- **Import ESM in `api/` richiedono estensione `.js`** (NodeNext). Anche quando
  importi un `.ts`, scrivi `.js` nell'import.
- **`minWindow` nel motore**: le funzioni di piazzamento non usano slot prima di
  `minWindow`. `minWindowNow` lo calcola da `schedule.ts`. Il server usa
  `upcomingSessions` come check temporale principale.
- **Firestore rifiuta `undefined`**: includi i campi opzionali solo se valorizzati.
- **`lucide-react` resta a `0.383.0`**.
- **Segreti fuori dal repo**: `.env*` in `.gitignore` (tranne `.env.example`).
  Se un segreto finisce in un commit o zip, va rigenerato.
- **`service account` Firebase prod**: è la chiave più delicata — non includerla
  in zip da condividere. Usare `git archive --format=zip -o ../cheebo.zip HEAD`.
- **Cassa ed export non sono fiscali**: non chiamarli "chiusura", "scontrino", "RT".
