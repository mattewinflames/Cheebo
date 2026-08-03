# Cheebo — gestionale prenotazioni

Web app per le prenotazioni di un burger restaurant: pagina cliente (`/`) e gestionale admin (`/admin`), con motore di smistamento **13 patty / 10 minuti** per finestra.

Stack: Vite + React + TypeScript + Firebase (Firestore + Auth).

---

## Cosa c'è dentro

```
src/lib/        motore e data layer (cuore del sistema)
  dispatch.ts   motore per-finestra (puro, testato)
  dispatch.test.ts   suite di test degli scenari critici
  schedule.ts   orari, sessione corrente, sessioni future (7 gg)
  menu.ts       struttura fissa (formati, extra) + helper
  menuStore.ts  menu su Firestore (CRUD)
  orders.ts     prenotazione transazionale + stream realtime
  firebase.ts   init da variabili d'ambiente
  whatsapp.ts   messaggio e link wa.me
src/pages/
  Prenotazioni.tsx   pagina cliente
  Admin.tsx          gestionale (login + Ordini + Menu)
firestore.rules    regole di sicurezza
scripts/seed.mjs   popola il menu
```

---

## 1. Installazione

```bash
npm install
```

## 2. Test del motore (il punto nevralgico)

Non serve Firebase: il motore è puro.

```bash
npm test
```

Devono passare tutti gli scenari: overflow 13→14, primo disponibile che salta le finestre piene, orario scelto rispettato o alternativa proposta, nessuna sovrapposizione, cutoff.

## 3. Firebase (ambiente di test)

1. Crea un progetto su <https://console.firebase.google.com> (es. `cheebo-test`).
2. **Firestore Database** → crea database (modalità produzione va bene).
3. **Authentication** → abilita **Email/Password** → aggiungi un utente (sarà l'admin).
4. **Regole**: incolla il contenuto di `firestore.rules` e pubblica.
5. Copia la config (Impostazioni progetto → SDK config) in un file `.env`:

```bash
cp .env.example .env
# compila le VITE_FB_* e VITE_LOCALE_PHONE
```

6. Popola il menu:

```bash
node --env-file=.env scripts/seed.mjs
```

## 4. Avvio in locale

```bash
npm run dev
```

- Cliente:  <http://localhost:5173/>
- Admin:    <http://localhost:5173/admin>  (login con l'utente creato al punto 3.3)

## 5. La prova end-to-end

1. Apri **due finestre**: una su `/`, una su `/admin`.
2. Sull'admin scegli la sessione (es. *Oggi · Cena*).
3. Dal cliente fai una prenotazione per la stessa sessione.
4. L'ordine deve **comparire da solo** nell'admin (realtime), nello slot calcolato, e il box piastra deve aggiornarsi.
5. Verifica gli scenari: riempi una finestra a 13 patty e controlla che il successivo slitti; prova "orario scelto" su una finestra piena e controlla che venga proposta l'alternativa.

## 6. Build

```bash
npm run build      # type-check + build di produzione
```

---

## Note

- **Pagamenti**: il flusso prevede *in loco* (attivo) e *Nexi* (Fase 4: serverless + webhook, da aggiungere).
- **Soft-hold** dello slot (priorità di chi prenota prima): Fase 5, si innesta in `orders.ts`.
- **Sicurezza**: per l'MVP la scrittura su `sessions` è aperta; in seguito si sposta l'aggiornamento del registro in una Cloud Function.
- **Due ambienti**: questo repo è il *test*. Per la produzione, un secondo progetto Firebase + un secondo progetto Vercel con le proprie variabili (e numero WhatsApp reale solo lì).
