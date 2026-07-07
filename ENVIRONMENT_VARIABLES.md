# Variabili Ambiente — Auralis SkyShare

Questo documento elenca **tutte** le variabili d'ambiente usate dal progetto: cosa fanno, dove trovarle, e dove vanno inserite.

> ⚠️ Nota di trasparenza: questo elenco riflette esattamente le variabili che abbiamo effettivamente configurato e testato insieme durante lo sviluppo. Se in futuro aggiungi nuove funzionalità (es. lo split payment reale su Stripe), potrebbero servire nuove variabili non ancora presenti qui.

## Dove vivono i valori reali

- **In locale (Codespace):** `backend/.env` — file mai committato su Git
- **In produzione (Render):** pannello **Environment** del Web Service, su dashboard.render.com
- **Nel frontend:** i valori pubblici (Auth0 Client ID, Domain, ecc.) sono scritti direttamente dentro `index.html` — non essendo un progetto con build step, non usiamo un file `.env` per il frontend

`backend/.env.example` contiene solo i **nomi** delle variabili, senza valori — serve da promemoria, va committato su Git.

---

## Variabili del Backend

| Variabile | A cosa serve | Dove trovarla |
|---|---|---|
| `PORT` | Porta su cui il server ascolta in locale | Fissa a `4000` in sviluppo; in produzione Render la fornisce automaticamente |
| `NODE_ENV` | `development` in locale, `production` su Render | Impostata manualmente |
| `FRONTEND_URL` | Dominio del frontend, usato per CORS e per i redirect di Stripe | `http://localhost:5173` in locale (valore storico, non più realmente usato dato che il frontend è HTML statico); `https://auralis-skyshare-com.vercel.app` in produzione |
| `DATABASE_URL` | Connessione al database PostgreSQL | Dashboard Neon → progetto → Connection Details |
| `AUTH0_DOMAIN` | Dominio del tenant Auth0 | Dashboard Auth0 → Applications → Auralis SkyShare Frontend → Settings |
| `AUTH0_AUDIENCE` | Identificatore della API Auth0 | Dashboard Auth0 → Applications → APIs → Auralis SkyShare API |
| `AUTH0_ISSUER_BASE_URL` | Domain con `https://` davanti e `/` alla fine | Costruito a mano da `AUTH0_DOMAIN` |
| `STRIPE_SECRET_KEY` | Chiave segreta per creare Checkout Session | Dashboard Stripe → Sviluppatori/Workbench → API keys (modalità test: inizia con `sk_test_`) |
| `STRIPE_WEBHOOK_SECRET` | Verifica che gli eventi webhook vengano davvero da Stripe | Dashboard Stripe → Workbench → Webhooks → la tua destinazione → Signing Secret. **Attenzione**: `stripe listen` (uso locale) genera un secret diverso e temporaneo ogni volta che lo riavvii; quello di produzione (su Render) è invece permanente, legato alla destinazione webhook creata in FASE 17 |
| `RESEND_API_KEY` | Invio email transazionali | Dashboard Resend → API Keys |
| `EMAIL_FROM` | Indirizzo mittente delle email | `onboarding@resend.dev` (dominio di test Resend, condiviso) — valido solo per email verso il tuo indirizzo di registrazione Resend |
| `ADMIN_EMAIL` | Dove arrivano le notifiche admin (nuove richieste di contatto, ecc.) | Il tuo indirizzo Gmail |

## Valori pubblici scritti direttamente in `index.html` (frontend)

Questi **non sono segreti** — sono pensati per stare visibili nel codice del browser:

| Costante | Valore |
|---|---|
| `AUTH0_DOMAIN` | Stesso dominio Auth0 di cui sopra |
| `AUTH0_CLIENT_ID` | Dashboard Auth0 → Applications → Auralis SkyShare Frontend → Settings → Client ID |
| `AUTH0_AUDIENCE` | Stesso audience di cui sopra |
| `API_BASE_URL` | `https://auralis-skyshare-com.onrender.com` (URL pubblico del backend) |

## Cosa NON deve mai stare nel frontend

- `STRIPE_SECRET_KEY`
- `DATABASE_URL`
- `RESEND_API_KEY`
- Qualsiasi cosa contenente la parola "secret" o "private"

Se vedi uno di questi valori dentro `index.html`, è un errore grave da correggere subito.
