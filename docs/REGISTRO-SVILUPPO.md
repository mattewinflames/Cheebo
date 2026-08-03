# Registro di sviluppo — Cheebo

Cronologia delle modifiche, **dalla più recente alla più vecchia**.
Il contesto architetturale sta nel `README.md`; lo stato di avanzamento in `CHEEBO-RIPRENDI-QUI.md`.

## Come si scrive una voce

````
### #ID — Titolo breve all'infinito o al sostantivo
**Tipo:** fix | feature | refactor | doc · **Stato:** ✅ fatto | ⚠️ parziale
**File:** `percorso/file.ts`, `altro/file.tsx`
**Verifica:** tsc ✓ · test 14/14 ✓ · build ✓

Cosa cambia, in una o due frasi.

**Perché:** la ragione, non la descrizione del diff. Serve al te di fra sei mesi.
**Nota:** rischi, debiti, cose lasciate a metà. (facoltativo)
````

Regole: una voce per modifica coerente (non per file toccato). `#ID` rimanda a
`ISSUES.md`. Il "perché" è la parte che conta — il "cosa" si legge dal diff.

---

## Aperte / da fare

| ID | Priorità | Cosa |
|---|---|---|
| ~~**#14**~~ | ✅ Fatto | Integrare il checkout Stripe. → Backbone lato server in **#40** (Checkout ospitato + hold con scadenza + webhook), cutover client + incasso reale in **#41**. L'ordine online nasce ora solo dal webhook a pagamento confermato. Resta **#15** per la parte fiscale (POS-RT). |
| **#15** | 🔴 Legale | Collegare il POS virtuale (Stripe) al Registratore Telematico sul portale Fatture e Corrispettivi. Obbligo dal 01/01/2026, sanzioni 1.000–4.000 € + sospensione. Da fare all'attivazione di #14. |
| **#16** | 🟠 Modello | `CAP = 13` è una costante in `dispatch.ts`: renderla manopola per servizio, editabile da admin. Serve a dosare quanta piastra impegnare in anticipo rispetto al banco — oggi le prenotazioni possono impegnarla tutta. |
| **#17** | 🟡 Attesa dati | Rimozione ingredienti ("senza cipolla"): lista **per panino**, in attesa dal cliente. Campo per voce editabile da admin, poi UI su Prenotazioni **e** Cassa. Non tocca patty né prezzo. |
| **#18** | 🟡 Prodotto | Cassa: extra non gestiti nel percorso rapido (incidono sul totale, non sui patty). Confermare col cliente se servono. |
| ~~#19~~ | ✅ fatto | ~~Rimuovere `PrenotazioniOld.tsx`~~ — fatto con #32. Resta da valutare il code-splitting: bundle ~760 kB. |
| **#20** | 🔵 Materiali | Allineare demo HTML e PDF alla regola #8/#9 (mostrano ancora "tutti i panini sulla piastra"). |
| **#25** | 🟡 Debito | `xlsx` è fermo alla 0.18.5 su npm (pacchetto non più mantenuto lì) e `npm audit` segnala 2 CVE **high**. Non sfruttabili oggi: si attivano nel **parsing** di file, mentre Cheebo scrive soltanto. ⚠️ La valutazione cambia se un domani si aggiunge l'**importazione** di file Excel: in quel caso passare prima alla versione da `cdn.sheetjs.com` via `overrides`. ExcelJS valutato e scartato (97 pacchetti, 23 MB, comunque non pulito). |
| **#26** | 🔵 Prodotto | Riepilogo di giornata stampabile (HTML → PDF da browser) per l'archivio di fine serata, complementare all'export #23. Proposto, non realizzato. |
| ~~**#30**~~ | ✅ Fatto | Spostare la prenotazione lato server per garantire che i contatori della piastra crescano soltanto. → Endpoint server in **#40**; reso effettivo in **#41** quando il client ha smesso di scrivere e le regole si sono chiuse (sessions/orders → `isAdmin()`). Il cliente non tocca più i contatori. |
| ~~#31~~ | ✅ fatto | ~~Attivare l'enforcement di App Check~~ — fatto il 24/07, vedi #35. |
| **#36** | 🟡 Prodotto | Campi `ingredients` e `swaps` non presenti nell'editor admin: oggi si manutengono solo dal seed. Il cliente non può aggiungere un panino nuovo completo in autonomia. |
| **#37** | 🟡 Prodotto | Gli extra (jalapenos, pickles, bacon…) sono ancora una costante in `menu.ts`: sono l'ultimo pezzo del menù non gestibile dal pannello. |
| **#42** | 🟠 Robustezza | Rilascio degli hold self-healing: oggi dipende solo dal webhook `checkout.session.expired`. Aggiungere lo sweep degli scaduti in `create-booking` (o un cron Vercel) — richiede indice composito `holds(serviceKey, expiresAt)`. Serve anche a gestire il "pagato dopo il rilascio" (ricollocare lo slot nel webhook, campo `ricollocare` già predisposto) se un domani `HOLD_MINUTES` scende sotto i 30'. |
| **#43** | 🟡 Prodotto | Rimborsi: `charge.refunded` è accettato dal webhook ma ignorato. Decidere se marcare l'ordine come rimborsato e se/quando liberare lo slot (il cibo potrebbe essere già in produzione). |
| **#27** | 🟠 Processo | `git init`: il progetto non è sotto controllo di versione. Il registro racconta le modifiche, git le **conserva** — sono due cose diverse. Prerequisito perché la skill `registro` possa lavorare sul diff invece che sulla memoria di sessione. |

---

## 2026-08-03

### #47 — Chiusure: blocco immediato + giorni di chiusura (Fase 1)
**Tipo:** feature · **Stato:** ✅ fatto (verifica tecnica; test regole non rieseguibili qui; #3 orari editabili rimandato)
**File:** `src/lib/settings.ts`, `src/lib/schedule.ts`, `api/create-booking.ts`, `src/pages/Prenotazioni.tsx`, `src/pages/AdminCassa.tsx`, `firestore.rules`, `tests/rules.test.mjs`
**Verifica:** tsc app ✓ · tsc api ✓ · test 60/60 ✓ · build ✓ · nessun leak ✓ · ⚠️ `tests/rules.test.mjs` non rieseguito (emulatore)

Due controlli sulle chiusure, entrambi come "eccezioni" sopra il calendario fisso `SCHEDULE`, senza toccare il motore. In `settings/app` due campi nuovi: `bookingBlocked` (interruttore d'emergenza: sospende subito tutte le nuove prenotazioni) e `closedDays` (date `YYYY-MM-DD` di chiusura programmata). `upcomingSessions` accetta ora `opts { blocked, closedDays }` e filtra di conseguenza (sola UX); il **blocco vero è nel server**: `create-booking` legge `settings/app` via Admin SDK e rifiuta con 409 se le prenotazioni sono sospese o il giorno è chiuso. In **Opzioni**: toggle "Blocca prenotazioni" + gestore date (aggiungi/rimuovi). Il sito cliente, se non ci sono sessioni prenotabili, mostra "prenotazioni non disponibili". Regole: `settings` passa a **lettura pubblica** (il cliente deve sapere se può prenotare), scrittura sempre admin — `dateKey` esportato da `schedule.ts`.

**Perché:** finora si poteva prenotare in qualsiasi giorno, senza modo di segnalare ferie/festivi o un imprevisto. Blocca solo le NUOVE prenotazioni; le già pagate restano e si gestiscono a mano (rimborso da dashboard Stripe) — la gestione automatica è fuori scope (lega a #43).
**Nota:** allineati a `.js` gli import ESM in `create-booking.ts` e `schedule.ts` (coerenza col fix di risoluzione moduli già in produzione). Rimane la **Fase 2 (#3)**: rendere gli orari settimanali (`SCHEDULE`) modificabili e persistenti — refactor del motore che tocca anche il server e le `serviceKey`, da fare a parte con i suoi test.

## 2026-07-28

### #46 — Schermata di conferma: gerarchia + sezione ritiro con Maps
**Tipo:** UX · **Stato:** ✅ fatto (verifica tecnica; resa visiva da confermare a schermo)
**File:** `src/pages/EsitoPagamento.tsx`, `src/lib/firebase.ts`, `.env.example`
**Verifica:** tsc app ✓ · build ✓ · nessun leak ✓

Ridisegnato lo stato "confermato": orario e codice non più impilati e stretti ma in due tessere affiancate con più aria; ordine in una card etichettata; nuova **card ritiro** con indirizzo, microcopy che lega orario+codice+azione ("presentati in cassa alle … e mostra il codice …") e bottone **Come arrivare** che apre Google Maps. Indirizzo e link Maps parametrizzati in `firebase.ts` (`LOCALE_ADDRESS`, `LOCALE_MAPS_URL`, con env `VITE_LOCALE_ADDRESS`/`VITE_LOCALE_MAPS_URL`; il link, se non dato, si costruisce dall'indirizzo).

**Perché:** la vecchia schermata era congestionata e non comunicava l'azione successiva (andare a ritirare). Ora la gerarchia è più leggibile e c'è una chiamata all'azione fisica. Indirizzo/Maps in costanti del locale per coerenza con lo scheletro riconfigurabile.

## 2026-07-27

### #45 — Opzioni utente + flag "Modalità cassa"
**Tipo:** feature · **Stato:** ✅ fatto (verifica tecnica; persistenza richiede il deploy delle regole)
**File:** `src/lib/settings.ts` (nuovo), `src/pages/AdminCassa.tsx`, `firestore.rules`, `tests/rules.test.mjs`
**Verifica:** tsc app ✓ · tsc api ✓ · test 60/60 ✓ · build ✓ · nessun leak ✓ · ⚠️ test regole non rieseguiti (emulatore) · ⚠️ scrittura opzioni operativa solo dopo `firebase deploy --only firestore:rules`

Prima pietra dell'area admin riconfigurabile. Nuovo modulo `settings` che legge/scrive `settings/app` su Firestore (`subscribeSettings` con fallback ai default se il doc manca o la lettura è negata; `saveSettings` con merge). In `AdminCassa` una nuova scheda **Opzioni** (sempre visibile) ospita `OpzioniSection`, contenitore per gli interruttori futuri; la prima opzione è **Modalità cassa**: quando è OFF la scheda **Cassa** sparisce dalla nav e, se eri lì, vieni spostato su Ordini; il resto (Ordini/Incassi/Menu) resta sempre. Regole: `settings` leggibile/scrivibile solo da `isAdmin()`.

**Perché:** la cassa (POS al banco) potrebbe non essere sempre utilizzabile; il flag permette di accenderla/spegnerla senza rimuovere codice. Il default `cassaEnabled: true` non cambia il comportamento odierno. Persistenza su Firestore (non per-browser) perché è una scelta dell'attività, valida su tutti i dispositivi — e base per la futura versione multi-realtà.
**Nota:** in locale la scrittura delle opzioni richiede le regole aggiornate pubblicate (`settings`), altrimenti `saveSettings` fallisce e la sezione mostra l'avviso. La lettura, se negata, ricade sui default senza rompere nulla.

## 2026-07-27

### #44 — Rifiniture: telefono rimosso, special accorpati
**Tipo:** fix + UX · **Stato:** ✅ fatto (verifica tecnica; resa visiva degli special da confermare a schermo)
**File:** `src/pages/Prenotazioni.tsx`, `src/lib/booking.ts`, `api/create-booking.ts`
**Verifica:** tsc app ✓ · tsc api ✓ · test 60/60 ✓ · build ✓ · nessun residuo `phone` nel client ✓

Due sistemazioni post go-live locale:
- **Telefono rimosso.** Era il vero motivo per cui "non si andava avanti": pur essendo marcato facoltativo lato client per il pagamento online, l'endpoint `create-booking` lo rifiutava sotto le 8 cifre (400 "telefono non valido"). Con il pagamento in loco disattivato il campo è obsoleto: tolto dal form, dal gate `ready`, dai payload; reso opzionale in `BookingReq` e nell'endpoint (l'hold salva `phone: ""`). Il ramo loco (fallback cassa) passa `""`.
- **Special accorpati.** Quando gli special attivi sono più d'uno, non più N riquadri ambra separati ma un unico riquadro con la stessa evidenza (header ambra + righe divise da una linea). Estratto `SpecialBody` (corpo condiviso) e aggiunto `SpecialsGroup`. Con un solo special resta la card singola di prima.

**Perché:** il telefono non serve più a nulla (nessun incasso in loco) e bloccava il checkout; l'accorpamento evita il "muro di riquadri" quando ci sono più special nella stessa sessione.

## 2026-07-27

### #41 — Stripe Pass 2: cutover client, pagina di esito, lockdown regole
**Tipo:** feature · **Stato:** ⚠️ parziale (codice completo e verificato; test regole non rieseguibili qui, deploy regole da coordinare)
**File:** `src/pages/Prenotazioni.tsx` (commit → startCheckout + redirect), `src/pages/EsitoPagamento.tsx` (nuovo), `src/main.tsx` (rotte `/pagamento/ok`·`/annullato`), `src/lib/orders.ts` (`startCheckout`), `src/lib/menu.ts` (tipo `CartReq` + `req` su `CartLine`), `src/lib/booking.ts` (`CartReqLine = CartReq & { qty }`), `firestore.rules` (sessions/orders → `isAdmin()`, `holds` server-only), `tests/rules.test.mjs` (riscritto), `vercel.json` (nuovo, rewrite SPA)
**Verifica:** tsc app ✓ · tsc api ✓ · test 60/60 core ✓ · build ✓ · nessun leak server nel bundle ✓ · ⚠️ `tests/rules.test.mjs` NON rieseguito (manca emulatore + Java) · flusso live redirect/pagamento da provare con le chiavi

Il cliente non prenota più con una transazione lato client: `commit()` invia la sola configurazione del carrello (mai i prezzi) a `/api/create-booking` e reindirizza a Stripe. Ogni riga del carrello porta ora un `req` (tipo `CartReq` in `menu.ts`) che il server usa per ricalcolare i prezzi. Dopo il pagamento, `EsitoPagamento` interroga `/api/order-status` finché il webhook conferma, poi mostra codice di ritiro e link WhatsApp. Le regole si chiudono: sessions/orders scrivibili solo da admin (la cassa), `holds` server-only.

**Perché:** completa #14 (incasso reale) e #30 (contatori non più abbassabili dal client), portando a effetto il backbone #40. Un solo tipo di configurazione (`CartReq`) condiviso client/server evita divergenze fra sito e cassa.
**Nota:** ⚠️ le regole vanno pubblicate SOLO insieme a questo client (o dopo): pubblicarle con la vecchia build online rompe le prenotazioni. `tests/rules.test.mjs` è aggiornato ma va rieseguito con l'emulatore. In locale `vercel dev` non inietta `.env.local` nelle funzioni: caricare le env in sessione prima di lanciarlo. Restano aperti: self-healing hold (#42), rimborsi (#43), e soprattutto POS-RT (#15), il vero bloccante legale per la produzione.

## 2026-07-25

### #40 — Stripe (backbone lato server): prenotazione server-side, hold con scadenza, webhook fonte di verità
**Tipo:** feature · **Stato:** ⚠️ parziale (backbone; manca il cutover client — vedi #41)
**File:** `api/create-booking.ts`, `api/stripe-webhook.ts`, `api/order-status.ts`, `api/_lib/{admin,stripe,holds}.ts`, `api/tsconfig.json`, `src/lib/booking.ts` (+ `booking.test.ts`), `src/lib/schedule.ts` (`serviceFromKey`), `src/lib/dispatch.ts` (`ledgerFromMap`/`ledgerToMap`), `src/lib/orders.ts` (usa gli helper condivisi), `.env.example`, `package.json`
**Verifica:** tsc app ✓ · tsc api ✓ (contro stripe 22 · firebase-admin 14 · @vercel/node 5) · test 60/60 (core puro: +17 in `booking.test.ts`) ✓ · build ✓ · nessun leak di `firebase-admin`/secret nel bundle client ✓
**⚠️ NON eseguibile in sandbox:** transazioni Admin SDK, chiamate Stripe reali, verifica della firma del webhook sul runtime Vercel. Da provare con `stripe listen` una volta impostate le chiavi.

Scelte del cliente: **Checkout ospitato** (redirect) + **prenota-e-tieni con scadenza**. Flusso: `POST /api/create-booking` ricalcola il carrello dal menù reale (`resolveCart`, mai il prezzo dal client), in una transazione Admin occupa piastra+stock e scrive un `hold` con `expiresAt`, poi apre la sessione Stripe e torna l'URL. Il webhook è la sola fonte di verità: `checkout.session.completed` crea l'ordine reale e assegna il codice di ritiro (non prima, così gli abbandoni non bruciano numeri); `checkout.session.expired` rilascia lo slot. Gli `hold` stanno in una collezione server-only (il default-deny già la nega ai client). `orders` e il banco restano identici.

**Perché:** è l'assetto che #14 chiedeva ("una scadenza che rilasci lo slot", "conferma dal webhook, mai dal client") e chiude tecnicamente anche #30 (la prenotazione pubblica non passa più dal client, che quindi non può più abbassare un contatore). `HOLD_MINUTES=30` è allineato alla scadenza minima della sessione Stripe per non incappare nel "pagato dopo il rilascio".
**Nota:** additivo e non-bloccante — **non tocca `firestore.rules`**. Il cutover client + il lockdown delle regole (sessions/orders → `isAdmin()`) vanno insieme in **#41**, o si rompono le prenotazioni live. Il body raw del webhook è da confermare col runtime Vercel. Vedi #41 (Pass 2), #42 (self-healing hold), #43 (rimborsi).


**Tipo:** feature · **Stato:** ✅ fatto
**File:** `src/lib/menu.ts`, `src/lib/menu.test.ts`, `src/pages/Prenotazioni.tsx`, `src/pages/AdminCassa.tsx`
**Verifica:** tsc ✓ · test 43/43 (suite menu+dispatch) ✓ · build ✓ · ⚠️ `export.test.ts` non caricata in questo ambiente (vedi nota) · interfaccia mai renderizzata qui

Lo special non passa più dal configuratore dei panini. Nuovo helper
`specialCartLine(item)` in `menu.ts`: riga a prezzo fisso (`solo`), etichetta =
solo il nome, chiave dedicata `id|special`, `specialId` valorizzato; occupa la
piastra solo se `griddle`. Sul sito la `SpecialCard` è ora uno stepper +/− con
tetto ai pezzi rimasti (niente `BurgerCard`). In cassa lo special si batte con un
tocco (`addSpecial`, niente popup), col residuo mostrato e il tasto disabilitato
quando è esaurito o non previsto nella sessione.

**Perché:** richiesta del cliente — lo special è una proposta unica, non un
panino da comporre: né formato, né menu, né extra o sostituzioni. Selezionarlo e
sceglierne la quantità è tutto. Tenerlo nel configuratore imponeva scelte prive
di senso e apriva a varianti che il cliente non vuole gestire.
**Nota:** l'infrastruttura special sottostante (`SpecialConfig`, decremento stock
in transazione in `orders.ts`, `stockOk` nelle regole, config special
nell'editor) è stata implementata **a monte e non è nel registro**: va
ricostruita una voce dedicata (backfill). `cartLineOf` conserva ancora il ramo
`specialId` come rete di sicurezza — oggi percorso morto (nessuno special passa
più di lì), innocuo. Il prezzo `menu` di uno special resta scritto su Firestore
anche a 0 (`saveItem` è in merge) ma è ignorato a runtime.

### #39 — Editor menu: al salvataggio si dice cosa manca, invece di bloccare il tasto
**Tipo:** feature · **Stato:** ✅ fatto
**File:** `src/pages/AdminCassa.tsx`
**Verifica:** tsc ✓ · test 43/43 (suite menu+dispatch) ✓ · build ✓

Il tasto "Salva" non è più disabilitato al buio. Nuovo `mancanzeVoce(item)`
calcola i campi mancanti; al clic, se manca qualcosa lo elenca in chiaro
("Per salvare manca ancora: …") e non salva, altrimenti salva. Vale per ogni
tipo di voce. Per gli special il prezzo menu **non** è richiesto (fuori menù,
#38), mentre lo è **almeno una sessione**: così uno special che non comparirebbe
mai non passa in silenzio.

**Perché:** richiesta del cliente. Un tasto grigio senza spiegazione costringe a
indovinare quale campo manca; e con gli special (dove il prezzo menu non serve) la
vecchia regola `solo>0 && menu>0` avrebbe impedito il salvataggio pure a ragione.
Meglio dire cosa serve.
**Nota:** legata a #38 per la regola del prezzo menu facoltativo sugli special.

## 2026-07-24

### #35 — App Check attivo con enforcement su Firestore
**Tipo:** feature · **Stato:** ✅ fatto
**File:** `src/lib/firebase.ts`, `src/vite-env.d.ts`, `.env.example`
**Verifica:** tsc ✓ · test 42/42 ✓ · build verificata **in entrambe le configurazioni** (con e senza chiave) · **enforcement attivo e confermato in console**

reCAPTCHA v3 registrato, chiave del sito in `VITE_APPCHECK_SITE_KEY`, supporto al
debug token per lo sviluppo (`VITE_APPCHECK_DEBUG=true`). TTL token: 1 giorno.
Enforcement su Cloud Firestore acceso il 24/07.

**Perché:** le regole dicono *cosa* si può scrivere, App Check *chi* può provarci.
Senza, uno script che rispetti le regole alla lettera potrebbe generare mille
prenotazioni formalmente valide e saturare la piastra: le regole non hanno modo
di distinguerlo da mille clienti veri.
**Nota:** ⚠️ **con l'enforcement acceso `seed`, `reset` e `verifica-regole` non
funzionano**: girano da Node, senza token. Vanno lanciati spegnendo
temporaneamente l'enforcement. Sul progetto di produzione: fare tutto il setup
prima e accendere per ultimo.
Il debug token è **per browser e per dispositivo**: il telefono (test via tunnel)
ne richiede uno proprio. In produzione il dominio va aggiunto ai domini
autorizzati di reCAPTCHA, altrimenti il sito non ottiene attestazioni.
Verificato ispezionando il bundle che l'assegnazione del debug token sia
eliminata in build: l'unica occorrenza residua è una lettura interna dell'SDK.

### #34 — Sostituzioni: pane e formaggio vegano
**Tipo:** feature · **Stato:** ✅ fatto
**File:** `src/lib/menu.ts`, `src/pages/Prenotazioni.tsx`, `src/pages/AdminCassa.tsx`, `scripts/seed.mjs`, `src/lib/menu.test.ts`
**Verifica:** tsc ✓ · test 42/42 ✓ · build ✓ · **interfaccia mai renderizzata**

Nuova sezione "Sostituzioni" fra ingredienti ed extra, in entrambe le schermate.
Pane vegano su tutti e 7 i panini, formaggio vegano su Classic, Oklahoma e Crispy.
Entrambe senza sovrapprezzo (confermato dal cliente).

**Perché:** sostituire non è aggiungere. Messe fra gli extra, sul Classic si
sarebbe avuto "American cheese" fra i togliibili e "formaggio vegano" fra le
aggiunte, lasciando all'utente il compito di capire che sono la stessa fetta.
La sequenza ora è leggibile: togli → sostituisci → aggiungi → bevi.
**Nota:** il formaggio vegano è limitato ai tre panini che hanno formaggio non
vegano (lo Smash veg ha già il veg cheddar; Chicken, Pulled Pork e Burgerveg non
hanno formaggio) — interpretazione da confermare col cliente. Il campo `price`
esiste ed è vuoto: se un domani decidessero di farlo pagare basta valorizzarlo
nel seed, senza toccare codice (c'è un test che lo copre).

### #33 — Menù reale: ingredienti per panino e nuovo listino bibite
**Tipo:** feature · **Stato:** ⚠️ seed non ancora eseguito
**File:** `scripts/seed.mjs`
**Verifica:** sintassi ✓ · coerenza ingredienti/descrizioni verificata 7/7 · sovrapprezzi verificati contro il listino · **`npm.cmd run seed` NON ancora lanciato**

Ingredienti togliibili espliciti su tutti i panini (elenco fornito dal cliente il
23/07). Listino bibite rifatto: 10 voci, con `menuSurcharge` esplicito. Le voci
generiche superate ("Soft drink", "Birra", "Acqua") vengono disattivate, non
cancellate: gli ordini storici le referenziano.

**Perché:** fino a qui gli ingredienti erano dedotti dalla descrizione — utile
come ripiego, ma impreciso (sullo Smash veg compariva "Patty plant based" fra i
togliibili). Ora la regola è esplicita: **ciò che non è elencato non è
togliibile** (patty, pollo, maiale, tofu e la salsa BBQ del Pulled Pork).
**Nota:** unica bibita con sovrapprezzo nel menu è la birra artigianale a **+3**,
come da menù stampato ("panino + patatine fritte + soft drink (birra artigianale
+3)") e non +2,50 come darebbe la differenza aritmetica: è il caso per cui esiste
`menuSurcharge` esplicito.
⚠️ Bug mio, corretto dopo la segnalazione: la birra artigianale era finita nella
lista delle voci da disattivare e spariva dai drink. Aggiunta una verifica
incrociata fra voci scritte e voci disattivate.
Il campo `ingredients` **non è nell'editor admin**: il cliente non può ancora
manutenerlo da solo (vedi #36).

### #32 — Bibita del menu a scelta e rimozione ingredienti
**Tipo:** feature · **Stato:** ✅ fatto
**File:** `src/lib/menu.ts`, `src/pages/Prenotazioni.tsx`, `src/pages/AdminCassa.tsx`, `src/lib/menu.test.ts`, `scripts/seed.mjs`
**Verifica:** tsc ✓ · test 36/36 ✓ · build ✓

Sostituito il check sulla birra con la scelta fra tutte le bibite attive,
ordinate per sovrapprezzo. Aggiunta la rimozione degli ingredienti. Introdotto il
tipo `PaninoConfig` con `cartKey`/`cartLabel`/`cartPrice` centralizzati in
`menu.ts`. Gerarchia della scheda riordinata: formato e tipo adiacenti, poi la
composizione, la bibita in fondo.

**Perché:** prima Prenotazioni e Cassa costruivano chiave, etichetta e prezzo
ognuna per conto suo — con bibite e rimozioni si sarebbero disallineate di certo.
Inoltre col vecchio toggle la cassa poteva battere **solo "solo panino"**: i menu
al banco erano impossibili.
**Nota:** rimosso `src/pages/PrenotazioniOld.tsx` (chiude #19), era codice morto.
Le rimozioni non incidono su patty né prezzo. Il sovrapprezzo bibita ha un
fallback automatico (differenza dai 2,50 compresi), così una bibita aggiunta dal
pannello funziona senza configurazione.

## 2026-07-22

### #29 — App Check predisposto (spento finché non configurato)
**Tipo:** feature · **Stato:** ⚠️ da attivare in console
**File:** `src/lib/firebase.ts`, `src/vite-env.d.ts`, `.env.example`
**Verifica:** tsc ✓ · test 22/22 ✓ · build ✓ · **mai attivato**

`initializeAppCheck` con reCAPTCHA v3, condizionato a `VITE_APPCHECK_SITE_KEY`:
senza chiave resta inerte, così lo sviluppo in locale non si blocca.

**Perché:** le regole dicono *cosa* si può scrivere, App Check *chi* può provarci.
La creazione ordini è aperta per necessità: senza App Check un bot può saturare
la piastra con ordini finti.
**Nota:** in console l'enforcement va acceso **dopo** aver verificato che il
traffico legittimo passi, altrimenti il sito smette di funzionare all'istante.

### #28 — Regole Firestore irrobustite e verificate
**Tipo:** fix · **Stato:** ✅ fatto
**File:** `firestore.rules`, `firebase.json` (nuovo), `firestore.indexes.json` (nuovo),
`scripts/verifica-regole.mjs` (nuovo), `tests/rules.test.mjs` (nuovo),
`vite.config.ts`, `vitest.rules.config.ts` (nuovo), `package.json`
**Verifica:** **29/29 sul progetto di test reale** (`npm.cmd run verifica-regole`) · tsc ✓ · test 22/22 ✓ · build ✓

`sessions` non è più scrivibile senza vincoli: forma esatta, indici finestra
ammessi, valori entro la capacità, finestra di servizio immutabile e `seq` che
avanza di **esattamente 1**. Gli ordini sono validati campo per campo, con
`status` obbligatoriamente `nuovo` e `createdAt` pari all'ora del server.

**Perché:** `allow write: if true` su `sessions` significava che chiunque, con la
sola configurazione pubblica presente nel bundle, poteva riempire tutte le
finestre (il locale smette di ricevere prenotazioni senza capire perché) o
azzerarle (overbooking in pieno servizio).
**Nota:** ⚠️ le regole non sanno iterare una mappa, quindi **non impediscono che
un contatore venga abbassato** — una scrittura alla volta, perché `seq` deve
avanzare. Chiusura definitiva: prenotazione lato server (serverless su Vercel
con Admin SDK, **non richiede il piano Blaze**). Vedi #30.
⚠️ Le regole validano `pay` e `total` ma **non impediscono al client di
dichiararsi "pagato online"**: oggi è il comportamento dell'app. Un caso di test
etichettato *[da invertire con Stripe]* lo presidia — con #14 dovrà passare da
"deve" a "non deve".
I test con emulatore (`tests/rules.test.mjs`) esistono ma **non sono eseguibili
su questa macchina**: firebase-tools richiede Java 11+ e qui c'è la 8, usata per
lavoro e da non toccare. Da qui si usa `verifica-regole`, che gira contro il
progetto di test reale e in più prova le regole *pubblicate* invece di simularle.

### #24 — Script di pulizia dell'ambiente
**Tipo:** feature · **Stato:** ⚠️ mai eseguito su Firestore
**File:** `scripts/reset.mjs` (nuovo), `scripts/pulisci-ordini.mjs` (nuovo), `package.json`
**Verifica:** sintassi ✓ (`node --check`) · logica del filtro data provata con dati simulati · **mai lanciato su Firestore reale**

Due comandi: `npm.cmd run reset` cancella tutto senza chiedere nulla (ambiente di test),
`npm.cmd run pulisci-ordini` è la versione prudente, con simulazione di default e filtro
`--prima-di=YYYY-MM-DD`. Entrambi cancellano ordini **e** documenti `sessions`.

**Perché:** l'export ha fatto emergere ordini di prova di giorni prima, che sporcavano i dati
e occupavano slot. Cancellare i soli ordini lasciando il registro della piastra avrebbe
lasciato le finestre occupate da ordini inesistenti: per questo si azzerano entrambi.
**Nota:** cancellazione a blocchi da 450 (Firestore si ferma a 500 operazioni per batch).
Login come admin via `SEED_EMAIL`/`SEED_PASSWORD`: le regole richiedono l'autenticazione per
cancellare ordini. ⚠️ Puntano al progetto reale: quando il locale sarà operativo, `reset`
diventa pericoloso.

### #23 — Export del riepilogo gestionale (CSV / XLSX)
**Tipo:** feature · **Stato:** ✅ fatto
**File:** `src/lib/export.ts` (nuovo), `src/lib/export.test.ts` (nuovo), `src/pages/AdminCassa.tsx`, `package.json`
**Verifica:** tsc ✓ · test 22/22 ✓ · build ✓ · **interfaccia mai renderizzata** (richiede login Firebase)

Pannello in fondo alla scheda Incassi: intervallo di date e scelta del formato.
XLSX con due fogli (Dettaglio + Riepilogo per servizio, importi come numeri sommabili),
CSV con separatore `;`, decimali con la virgola e BOM per Excel italiano.
Colonne: Data, Servizio, Codice, Canale, Metodo, Articoli, Totale.

**Perché:** dal 2026 i controlli incrociano i pagamenti elettronici con i corrispettivi
trasmessi, e i disallineamenti sul metodo di pagamento sono sanzionabili. Cheebo conosce
il `tender` di ogni ordine, quindi l'export diventa lo strumento per verificare la sera
stessa che la chiusura dell'RT corrisponda a quanto incassato.
**Nota:** la colonna patty è stata **deliberatamente esclusa** su richiesta: è una metrica
di cucina, rumore in un documento contabile (resta nelle viste admin). Un test blocca
l'intestazione esatta. Nessun dato personale del cliente nell'export, con test dedicato.
Query di range su un solo campo, sfruttando il `serviceKey` che inizia con la data ISO:
nessun indice composito (cfr. #7). `xlsx` caricato con import dinamico → chunk separato da
429 kB (143 kB gzip) scaricato solo da chi esporta in Excel (verificato in build). Vedi #25.

### #22 — Accesso da mobile per i test: host e tunnel
**Tipo:** fix · **Stato:** ✅ fatto
**File:** `vite.config.ts`
**Verifica:** build ✓ · **confermato sul campo**: test WhatsApp completato da telefono

Aggiunto `server: { host: true, allowedHosts: true }`.

**Perché:** il PC di sviluppo è una macchina aziendale gestita (Windows Enterprise) con
firewall Trend Micro non modificabile: le connessioni in ingresso dal telefono vanno in
`ERR_CONNECTION_TIMED_OUT` e la rete locale non è utilizzabile. I test da mobile passano
quindi da un tunnel (`npx.cmd localtunnel --port 5173`), ma Vite rifiutava l'host `.loca.lt`.
**Nota:** `allowedHosts: true` accetta qualunque host: va bene per il dev server, **non** va
portato in produzione. Su questa macchina i comandi funzionano solo come `npm.cmd`/`npx.cmd`
(PowerShell blocca gli shim `.ps1`).

### #21 — Registro di sviluppo, CLAUDE.md e skill
**Tipo:** doc · **Stato:** ✅ fatto
**File:** `docs/REGISTRO-SVILUPPO.md` (nuovo), `CLAUDE.md` (nuovo), `.claude/skills/registro/SKILL.md` (nuovo)
**Verifica:** non applicabile (documentazione)

Registro delle modifiche con ID, motivazione e stato delle verifiche; `CLAUDE.md` con
convenzioni di progetto e trappole già pagate; skill `registro` che automatizza
l'aggiornamento di registro e documento di ripresa.

**Perché:** il "cosa" si legge dal diff, il "perché" si perde. Il registro cattura anche i
nessi che un diff non vede (es. #4 è una regressione causata da #2) e i rischi lasciati
aperti (#10).
**Nota:** il progetto **non ha ancora un repo git**. Senza, il registro è compilato a mano e
nessuno verifica che corrisponda al codice: `git init` resta il passo zero consigliato.

## 2026-07-16

### #13 — Incassi: "Cassa" al posto di "In loco", con badge unificato
**Tipo:** feature · **Stato:** ✅ fatto
**File:** `src/pages/AdminCassa.tsx`
**Verifica:** tsc ✓ · test 14/14 ✓ · build ✓

La card diventa "Incassato in cassa" (era "Da incassare in loco") e il badge di riga
mostra "Cassa · Contanti" / "Cassa · Carta". Icona dinamica: banconota per i contanti,
carta per la carta, scontrino se il metodo non è noto. Estratto `PagamentoBadge`,
condiviso tra Ordini e Incassi. Colonna Pagamento 158 → 182 px.

**Perché:** "Da incassare" indicava un pagamento in sospeso, ma un ordine battuto in
cassa è già incassato in quel momento. I due badge erano duplicati inline e stavano
divergendo. La larghezza è stata misurata, non stimata: il badge occupa 152 px e
lasciava 3 px per lato.
**Nota:** `pay: "loco"` resta invariato nei dati — cambiate solo le etichette, nessuna
migrazione necessaria.

### #12 — Cassa: menù contestuale del panino
**Tipo:** feature · **Stato:** ⚠️ parziale (extra non gestiti)
**File:** `src/pages/AdminCassa.tsx`
**Verifica:** tsc ✓ · test 14/14 ✓ · build ✓

Toccando un panino si apre un popup: patty per hamburger, tipo (solo panino / menu),
birra al posto del drink. Default Singolo · Solo panino, quindi l'ordine tipico resta
a due tocchi. Sostituisce il selettore formato globale.

**Perché:** col toggle globale la cassa poteva battere **solo "solo panino"** — al banco
i menu erano impossibili. Non era solo una riorganizzazione: sbloccava un caso d'uso
mancante.
**Nota:** chiave di riga `id|formato|tipo|birra|varianti`, ultimo segmento vuoto e
riservato alle rimozioni ingredienti (#17).

### #11 — Prototipo cassa: admin parallelo con modalità registratore
**Tipo:** feature · **Stato:** ⚠️ prototipo, non fiscale
**File:** `src/pages/AdminCassa.tsx` (nuovo), `src/lib/orders.ts`
**Verifica:** tsc ✓ · test 14/14 ✓ · build ✓

Nuova scheda "Cassa" per battere gli ordini al banco: griglia di inserimento rapido,
scontrino laterale, anteprima dal vivo dell'orario di ritiro, contanti/carta, codice
di ritiro. Aggiunti `channel` ("prenotazione" | "banco") e `tender` agli ordini.
Il banco passa dalla stessa `submitBooking`, quindi dallo **stesso registro piastra**.

**Perché:** il banco è l'afflusso principale ma era invisibile al sistema: il registro
rifletteva solo le prenotazioni e gli orari promessi erano ottimistici. Facendo passare
anche il banco, il registro diventa lo stato reale della piastra.
**Nota:** NON emette documenti commerciali né trasmette corrispettivi — lo strato fiscale
va delegato all'RT del locale o a un erogatore accreditato. `Admin.tsx` resta intatto
come versione parallela.

### #10 — Disattivato il pagamento in loco sul sito cliente
**Tipo:** feature · **Stato:** ⚠️ rischio aperto
**File:** `src/lib/orders.ts`, `src/pages/Prenotazioni.tsx`
**Verifica:** tsc ✓ · test 14/14 ✓ · build ✓

Introdotto `PAY_ENABLED: readonly PayMethod[] = ["online"]` come unico interruttore.
Resta solo "Paga ora", preselezionato. `"loco"` resta nel tipo per gli ordini storici.

**Perché:** richiesta del cliente.
**Nota:** ⚠️ **il checkout non esiste ancora.** `commit()` non fa alcun redirect: ogni
ordine viene marcato "Pagato online" senza incassare nulla, e Admin lo conta negli
incassi. Non mettere davanti a clienti veri finché Stripe non è collegato. Punto
d'innesto marcato con un commento in `commit()`. Per riattivare il contante: rimettere
`"loco"` nell'array.

### #9 — Flag "da piastra" editabile per singola voce
**Tipo:** feature · **Stato:** ✅ fatto
**File:** `src/lib/menu.ts`, `src/pages/Admin.tsx`, `scripts/seed.mjs`, `src/lib/menu.test.ts`
**Verifica:** tsc ✓ · test 14/14 ✓ · build ✓

Aggiunto il campo `griddle` a `MenuItem` e lo switch "Da piastra (smash)" nell'editor
menù. Default acceso in sezione Smashburgers, spento in Burgers.

**Perché:** un hamburger temporaneo deve poter essere marcato da piastra senza un deploy.
La regola era una lista fissa nel codice.
**Nota:** retrocompatibile — le voci senza il campo ricadono su `GRIDDLE_IDS`
(classic/oklahoma/crispy), quindi nessuna migrazione dati necessaria.

### #8 — Solo Classic, Oklahoma e Crispy occupano la piastra
**Tipo:** feature · **Stato:** ✅ fatto
**File:** `src/lib/menu.ts`, `src/pages/Prenotazioni.tsx`, `src/pages/Admin.tsx`, `src/lib/menu.test.ts` (nuovo)
**Verifica:** tsc ✓ · test 14/14 ✓ · build ✓

`griddlePatty(item, formato)` restituisce i patty solo per i tre panini da piastra,
0 per tutto il resto. Rimossi i guard `patties === 0`, che trattavano un ordine senza
piastra come "niente da mostrare" facendolo risultare a piastra piena. La vista
occupazione piastra in admin filtra `patty > 0`.

**Perché:** regola di dominio corretta dal cliente: gli altri panini sono ordinabili
senza limiti.

### #7 — Ordini a volte non visibili nella scheda admin
**Tipo:** fix · **Stato:** ✅ fatto
**File:** `src/lib/orders.ts`, `src/pages/Admin.tsx`
**Verifica:** tsc ✓ · test 11/11 ✓ · build ✓

`subscribeOrders` usava `where(serviceKey) + orderBy(createdAt)`, che **richiede un
indice composito**: se l'indice non è pronto la query fallisce, e senza gestore d'errore
falliva in silenzio lasciando la lista vuota. Ora query a campo singolo + ordinamento
lato client (fallback su `code`), `onError` su entrambe le sottoscrizioni e banner rosso
in admin.

**Perché:** segnalato come "a volte l'ordine non arriva a schermo", associato a "primo
disponibile". La scrittura è però identica nei due percorsi: la correlazione era casuale,
il problema era in lettura.
**Nota:** l'indice composito `orders(serviceKey, createdAt)` non serve più. Le regole
richiedono admin autenticato: se la sessione scade, ora il banner lo dice.

### #6 — Avvisi React Router v7 in console
**Tipo:** fix · **Stato:** ✅ fatto
**File:** `src/main.tsx`
**Verifica:** tsc ✓ · build ✓

Attivati i future flag: `v7_relativeSplatPath` nelle opzioni di `createBrowserRouter`,
`v7_startTransition` come prop di `<RouterProvider>`.

**Perché:** silenziare l'avviso e anticipare il comportamento di v7.
**Nota:** in react-router 6.30.4 i due flag stanno in punti diversi. Metterli entrambi
sul router fa passare Vite ma non `tsc`.

### #5 — Cestino rosso sul panino già ordinato
**Tipo:** feature · **Stato:** ✅ fatto
**File:** `src/pages/Prenotazioni.tsx`

Riaprendo un panino già a carrello compare il pill "già N nell'ordine" e un cestino
rosso nel footer, con "Aggiungi" ristretto.

**Perché:** richiesta cliente.
**Nota:** riaprendo, il configuratore riparte dai default, quindi il cestino colpisce la
variante esatta se combacia, altrimenti l'unica presente. Con più varianti dello stesso
panino la gestione fine resta nel riepilogo carrello.

### #4 — Font non-Inter dentro i pannelli
**Tipo:** fix · **Stato:** ✅ fatto
**File:** `src/pages/Prenotazioni.tsx`

Aggiunta la regola globale `body{font-family:'Inter',…}`.

**Perché:** **regressione introdotta da #2.** Il font era impostato inline solo sul `div`
radice; spostando i pannelli in un portal su `document.body` sono usciti da quel nodo e
sono ricaduti sul font di default del browser.

### #3 — Impossibile togliere un articolo dal carrello
**Tipo:** feature · **Stato:** ✅ fatto
**File:** `src/pages/Prenotazioni.tsx`

Pannello "Il tuo ordine" apribile dal cestino nella barra: quantità modificabili e, a
quantità 1, il "−" diventa cestino ed elimina la riga.

**Perché:** un panino aggiunto per errore non era più rimovibile.

### #2 — Header e footer "in rilievo" sopra il velo
**Tipo:** fix · **Stato:** ✅ fatto
**File:** `src/pages/Prenotazioni.tsx`

Velo e pannello spostati su `document.body` via `createPortal`, più blocco dello scroll
di sfondo.

**Perché:** velo e pannello erano dentro un wrapper con `position:relative; z-index:1`,
che crea uno stacking context: restavano intrappolati a livello 1 mentre header (z-5) e
barra (z-40) stavano fuori, quindi sopra il velo. Alzare lo z-index non bastava.
**Nota:** ha causato #4.

### #1 — Versione di lucide-react inesistente
**Tipo:** fix · **Stato:** ✅ fatto
**File:** `package.json`

`"lucide-react": "^1.20.0"` → `"0.383.0"`.

**Perché:** lucide non ha mai avuto una 1.x: install e build fallivano.

---

## Materiali non-codice (2026-07-16)

| Artefatto | Note |
|---|---|
| `cheebo-demo-mobile.html` | Demo standalone del percorso cliente, senza build né Firebase. Menù mock: **non allineata** alla regola #8/#9. |
| `Cheebo-Presentazione.pdf` | 9 pagine. Narrazione su WhatsApp (non telefonate). Il diagramma di pag. 4 riflette la regola vecchia ("tutti i panini") → da aggiornare dopo #8. La nota "la capacità si imposta sul tuo locale" sarà vera solo dopo #16. |

---

## Storico precedente

Il lavoro anteriore a questo registro è riassunto in `CHEEBO-RIPRENDI-QUI.md`
(fasi 1–3, motore di smistamento, seed del menù, bot WhatsApp).
