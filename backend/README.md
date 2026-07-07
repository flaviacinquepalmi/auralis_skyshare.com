# Backend — Auralis SkyShare

API Node.js + TypeScript + Express per la piattaforma Auralis SkyShare.

## Stack

- **Runtime:** Node.js
- **Framework:** Express 5
- **Linguaggio:** TypeScript
- **ORM:** Prisma 7 (con driver adapter `@prisma/adapter-pg`)
- **Database:** PostgreSQL (Neon)
- **Autenticazione:** Auth0 (validazione JWT via `express-oauth2-jwt-bearer`)
- **Pagamenti:** Stripe Checkout
- **Email:** Resend

## Struttura

```
backend/
├── src/
│   ├── app.ts              # Configurazione Express (middleware, route)
│   ├── server.ts           # Punto di avvio del server
│   ├── config/env.ts       # Lettura e validazione variabili ambiente
│   ├── middleware/
│   │   ├── auth.middleware.ts        # Validazione token Auth0
│   │   ├── syncUser.middleware.ts    # Sincronizza utente Auth0 → database
│   │   ├── requireRole.middleware.ts # Controllo ruoli (OPERATOR, ADMIN)
│   │   └── error.middleware.ts       # Gestione centralizzata errori
│   ├── routes/              # Un file per gruppo di endpoint
│   ├── services/
│   │   └── email.service.ts # Invio email transazionali
│   └── utils/logger.ts      # Logger centralizzato (pino)
├── prisma/
│   ├── schema.prisma         # Modello dati
│   ├── seed.ts                # Dati di prova
│   └── migrations/
├── prisma.config.ts          # Configurazione Prisma 7 (driver adapter, moduleFormat cjs)
└── generated/prisma/         # Client Prisma generato (non modificare a mano)
```

## Sviluppo locale

```bash
npm install
npx prisma generate
npm run dev
```

Il server parte su `http://localhost:4000` (o la porta indicata da `PORT` in `.env`).

Per testare i pagamenti Stripe in locale serve anche:
```bash
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```
Copia il webhook secret temporaneo che mostra in `STRIPE_WEBHOOK_SECRET` dentro `.env` (cambia ad ogni riavvio di `stripe listen`).

## Build e avvio produzione

```bash
npm run build   # compila TypeScript in dist/
npm run start   # avvia node dist/src/server.js
```

Su Render, questi comandi sono già configurati nel Build/Start Command del servizio (vedi `DEPLOYMENT.md`).

## Variabili ambiente

Vedi `ENVIRONMENT_VARIABLES.md` nella root del progetto per l'elenco completo.

## Note su Prisma 7

Questo progetto usa Prisma 7, che introduce alcuni cambiamenti rispetto alle versioni precedenti:
- Il client generato richiede un **driver adapter** esplicito (`@prisma/adapter-pg`), non basta più `new PrismaClient()` da solo
- Il generatore di default produce codice ESM — abbiamo impostato `moduleFormat = "cjs"` nello schema per compatibilità con il resto del progetto (CommonJS)
- La configurazione vive in `prisma.config.ts`, non solo nelle variabili d'ambiente

Se aggiorni Prisma in futuro, verifica che questi dettagli restino validi — sono comportamenti specifici della versione 7 che potrebbero cambiare in release successive.
