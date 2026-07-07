# Troubleshooting — Auralis SkyShare

Raccolta di problemi reali incontrati durante lo sviluppo e come li abbiamo risolti. Utile come primo riferimento se qualcosa smette di funzionare.

## "I voli non si caricano" / resta su "Caricamento voli..."

**Cause possibili, in ordine di probabilità:**

1. **Errore JavaScript nel file `index.html`** — apri la Console del browser (F12 → tab "Console"). Se vedi `Uncaught SyntaxError`, c'è un problema di sintassi che blocca l'esecuzione di tutto lo script. Cerca la riga indicata nell'errore.
2. **Il backend Render è "addormentato"** (piano gratuito) — prova ad aprire direttamente `https://auralis-skyshare-com.onrender.com/api/health`; se impiega più di 30-50 secondi a rispondere la prima volta, è normale.
3. **Mismatch di formato dati** — il backend restituisce campi in `camelCase` (es. `fromAirport`); se il frontend cerca `snake_case` (es. `from_airport`), i valori risultano `undefined`. Verifica che i nomi dei campi combacino tra `loadEmptyLegs()` nel frontend e la risposta reale di `/api/empty-legs`.

## Booking pagato su Stripe ma rimasto `PENDING_PAYMENT` nel database

**Causa quasi certa:** il webhook non ha raggiunto il backend. Questo succede se:
- Il test è stato fatto quando `stripe listen` (uso locale) non era attivo, e il webhook di produzione non era ancora configurato
- Il webhook secret su Render (`STRIPE_WEBHOOK_SECRET`) non corrisponde a quello reale della destinazione configurata su Stripe

**Verifica:** Dashboard Stripe → Pagamenti → cerca il pagamento per importo/data. Se risulta "Riuscito" ma il booking non è `CONFIRMED` su Neon, il problema è nel collegamento webhook, non nel pagamento stesso.

**Soluzione:** verificare che esista una destinazione webhook Stripe permanente (non solo quella temporanea di `stripe listen`) puntata a `https://auralis-skyshare-com.onrender.com/api/webhooks/stripe`, con il Signing Secret corretto su Render.

## Errore 404 dopo il pagamento Stripe

**Causa:** il `success_url` della Checkout Session puntava a un percorso che non esiste davvero sul server (es. `/booking-success`), ma il sito è una Single Page Application senza vero routing lato server.

**Soluzione:** il `success_url` deve puntare alla root del sito (`/`) con parametri in query string, es. `?booking=success&session_id={CHECKOUT_SESSION_ID}`, letti poi via JavaScript per mostrare un messaggio di conferma.

## Deploy Render fallisce con "Could not find Prisma Schema"

**Causa:** Render sta facendo il deploy di un commit vecchio (verificabile guardando il messaggio di commit mostrato nei log di build), da prima che lo schema Prisma esistesse nel repository.

**Soluzione:** verificare con `git status` nel Codespace se ci sono commit locali non ancora inviati (`git push origin main`), o commit remoti non ancora scaricati (`git pull`).

## Deploy Render fallisce con errori sui tipi TypeScript (`TS7016`, `Cannot find module 'express'`)

**Causa:** `NODE_ENV=production` fa sì che `npm install` salti le devDependencies, dove risiedono i pacchetti `@types/*`.

**Soluzione:** modificare il Build Command su Render aggiungendo `--include=dev` a `npm install`.

## Deploy Render si avvia ma poi va in crash con `Cannot use 'import.meta' outside a module`

**Causa:** il generatore Prisma 7 (`provider = "prisma-client"`) produce codice ESM per default, incompatibile con un progetto CommonJS.

**Soluzione:** aggiungere `moduleFormat = "cjs"` al blocco `generator client` in `schema.prisma`, poi rigenerare il client con `npx prisma generate`.

## Errore Git "Need to specify how to reconcile divergent branches"

**Causa:** il branch locale e quello remoto hanno commit diversi che l'altro non ha.

**Soluzione:**
```bash
git pull --no-rebase origin main
git push origin main
```
Se emergono conflitti reali durante il pull, vanno risolti manualmente guardando i file segnalati, non ignorati alla cieca.

## Come verificare rapidamente se il problema è nel frontend o nel backend

1. Prova a chiamare direttamente l'endpoint backend (es. `https://auralis-skyshare-com.onrender.com/api/empty-legs`) in una tab separata del browser
2. Se risponde correttamente con i dati giusti → il problema è nel frontend (JavaScript, CORS, o nel modo in cui i dati vengono letti)
3. Se non risponde o dà errore → il problema è nel backend (controlla i log su Render)
