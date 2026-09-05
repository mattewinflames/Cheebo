# Cheebo — Punto di ripresa

> Fotografia dello stato **attuale**. Per la storia delle modifiche: `REGISTRO-SVILUPPO.md`.
> Aggiornato: 5 settembre 2026 — fine sessione.

---

## 🔴 BUG CRITICO DA FIXARE SUBITO (#66)

**File:** `api/create-booking.ts`
**Riga:**
```typescript
if (!plan.ok) plan = planFirst(led, resolved.patties, service, minW);
```

**Problema:** quando la finestra scelta dal cliente è piena, il fallback a `planFirst` riparte da zero invece che dalla finestra successiva. Il cliente non viene avvisato dell'orario reale assegnato. In produzione ha causato 23 patty su una finestra da 13.

**Fix concordata (Opzione B):**
1. `create-booking.ts`: nel fallback passare `targetWindow + 1` come `minW` a `planFirst`
2. Restituire `assignedReadyMin` nel response (oltre al `readyMin` esistente)
3. `Prenotazioni.tsx`: intercettare `assignedReadyMin !== requestedReadyMin` e mostrare avviso prima del pagamento Nexi

**Per implementare serve:** caricare `api/create-booking.ts` e `src/pages/Prenotazioni.tsx` completi (usare `notepad` o copia diretta — i file allegati risultano vuoti in questa chat).

---

## ⚠️ Da sapere prima di toccare qualsiasi cosa

1. **Sistema LIVE** — pagamenti Nexi in produzione attivi. Modifiche a `create-booking.ts` e `nexi-webhook.ts` vanno testate in locale prima del push.
2. **`_dev_tmp.bat` contiene il service account** — non committarlo mai (è in `.gitignore`).
3. **Vercel piano Hobby** — cron job gestiti da GitHub Actions (`.github/workflows/release-stale-holds.yml`), non da Vercel.
4. **`CRON_SECRET`** va impostato sia su Vercel che su GitHub Secrets.
5. **Indice Firestore** già creato: `holds(status ASC, createdAt ASC)` — necessario per `release-stale-holds`.
6. **Log BLE temporanei** su Firestore (collection `logs`) — da rimuovere quando il problema BLE è stabilizzato.

---

## Stato attuale

| Pezzo | Stato |
|---|---|
| Pagamento Nexi XPay (live) | ✅ live |
| Admin: ordini, piastra, menu, opzioni | ✅ funzionante |
| Admin: Incassi con range date | ✅ funzionante |
| Admin: Stats dashboard | ✅ funzionante |
| Stampa BLE Bisofice Z58-01 | ✅ funzionante (Chrome Android) |
| Self-healing holds (GitHub Actions cron) | ✅ attivo ogni 5 min |
| Blocco prenotazioni per-dow | ✅ configurabile |
| Box patatine nel menu | ✅ funzionante |
| Categoria salse + singleFormatOnly | ✅ seedata |
| Checkbox non rimborsabile | ✅ presente |
| **Overflow piastra (#66)** | 🔴 **BUG CRITICO** — da fixare |
| Log BLE su Firestore | ⚠️ temporaneo — da rimuovere |
| Collegamento Framer (CNAME ordina.cheebo.it) | ⏳ in attesa webmaster |
| POS–RT fiscale | ❌ non collegato |

---

## Prossimi passi in ordine di priorità

1. **Fix #66** — overflow piastra in `create-booking.ts` (vedi sezione rossa sopra)
2. **Rimuovere log BLE** — `src/lib/bleLogger.ts`, import in `bluetoothPrinter.ts` e `AdminCassa.tsx`, regola `logs` in `firestore.rules`, collection `logs` su Firestore
3. **Collegamento Framer** — bottone → URL Vercel + CNAME `ordina` su Aruba → dominio su Vercel → `og:url` in `index.html`
4. **POS–RT** — prerequisito: commercialista censisce software RT sul portale AdE. API candidata: Effatta.
5. **Pulizia post-migrazione** — rimuovere `api/stripe-webhook.ts` e variabili Stripe da Vercel

---

## Credenziali e dati fiscali

- **CHEEBO S.R.L.** · P.IVA / CF: `17821961004` · REA: 1744240
- **Indirizzo:** Via Aretusa 6, 00155 Roma (RM) · PEC: cheebo@pec.it
- **Nexi:** Codice Commerciante `025818980` · Terminale `75512367`
- **Repo:** `github.com/mattewinflames/Cheebo` (pubblico)
- **Vercel:** `cheebo-iota.vercel.app` · dominio custom: `ordina.cheebo.it` (⏳)

---

## Comandi

```powershell
.\dev.bat                                              # avvia vercel dev (:3000)
npx tsc --noEmit                                       # verifica TypeScript app
node node_modules/typescript/bin/tsc -p api/tsconfig.json  # verifica TypeScript API
npm.cmd run seed                                       # popola menu su Firestore
npm.cmd run reset                                      # ⚠️ cancella dati

# Script DB (usano firebase-admin + .env.local):
node scripts/audit-db.mjs
node scripts/inspect-session.mjs <serviceKey>          # es: 2026-09-05-Cena
node scripts/cleanup-db.mjs

# Git
Set-Alias git "$env:USERPROFILE\Downloads\PortableGit\cmd\git.exe"
git add .
git commit -m "..."
git push
```

---

## Trappole già pagate

- **`_dev_tmp.bat` → non committare** — contiene service account Firebase
- **Vercel Hobby non supporta cron `*/5 * * * *`** — usare GitHub Actions
- **GitHub push protection** — blocca file con service account JSON
- **Import ESM in `api/` richiedono `.js`** (NodeNext)
- **Firestore rifiuta `undefined`** — usare spread condizionale
- **`Set-Content -Encoding UTF8` aggiunge BOM** — usare Python per JSON
- **`lucide-react` resta a `0.383.0`**
- **File allegati alla chat risultano vuoti** — usare `notepad` o copia diretta
- **`useState` non può essere chiamato dentro IIFE nel JSX** — violazione regole hook React
