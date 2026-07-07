# Deployment — Auralis SkyShare

Guida su come è strutturato il deploy e come rifarlo o aggiornarlo in futuro.

> ⚠️ Le istruzioni "dove cliccare" su Render/Vercel/Stripe/Neon/Auth0 riflettono le interfacce di questi servizi al momento dello sviluppo. Potrebbero essere leggermente cambiate — se qualcosa non corrisponde, cerca l'equivalente più recente nell'interfaccia reale.

## Architettura del deploy

```
Frontend (index.html, statico)  →  Vercel
Backend (Node.js/TypeScript)    →  Render
Database (PostgreSQL)           →  Neon
Autenticazione                  →  Auth0
Pagamenti                       →  Stripe
Email                           →  Resend
```

Ogni push sul branch `main` di GitHub triggera automaticamente un nuovo deploy sia su Render che su Vercel — non serve fare nulla di manuale per gli aggiornamenti normali.

## Backend — Render

- **Servizio:** Web Service, piano Free
- **Root Directory:** `backend`
- **Build Command:**
  ```
  npm install --include=dev && npx prisma generate && npx prisma migrate deploy && npm run build
  ```
  Nota: `--include=dev` è necessario perché senza, con `NODE_ENV=production`, npm salta le devDependencies (che contengono i tipi TypeScript necessari per compilare).
- **Start Command:** `npm run start` (che esegue `node dist/src/server.js`)
- **URL pubblico:** `https://auralis-skyshare-com.onrender.com`

### Limite del piano gratuito
Il servizio "si addormenta" dopo un periodo di inattività. La prima richiesta dopo l'inattività può richiedere fino a 50 secondi o più prima di rispondere. Non è un errore, è un comportamento noto del piano gratuito Render.

## Frontend — Vercel

- **Root Directory:** `./` (il file `index.html` sta nella root del repo)
- **Framework Preset:** Other (nessun framework, HTML statico)
- **Build Command:** nessuno (non serve, è HTML puro)
- **URL pubblico:** `https://auralis-skyshare-com.vercel.app`

## Database — Neon

- Progetto: `auralis-skyshare`
- Database: `neondb`
- Le migration si applicano automaticamente ad ogni deploy Render tramite `npx prisma migrate deploy` nel Build Command — non serve farlo manualmente

## Come rifare un deploy manuale

**Render:** Dashboard → il tuo servizio → pulsante "Manual Deploy" → "Deploy latest commit"

**Vercel:** Dashboard → il tuo progetto → tab "Deployments" → i tre puntini sull'ultimo deploy → "Redeploy" (oppure semplicemente fai un nuovo push su GitHub)

## Webhook Stripe in produzione

Configurato su Dashboard Stripe → Workbench → Webhooks, puntato a:
```
https://auralis-skyshare-com.onrender.com/api/webhooks/stripe
```
con l'evento `checkout.session.completed`. Il Signing Secret di questa destinazione è salvato in `STRIPE_WEBHOOK_SECRET` su Render.

**Importante:** questo è diverso dal comando `stripe listen` usato in sviluppo locale, che genera un secret temporaneo diverso ogni volta — quello di produzione è permanente e non dipende dal Codespace acceso.

## Come testare che tutto funzioni dopo un deploy

1. `https://auralis-skyshare-com.onrender.com/api/health` → deve rispondere `{"status":"ok","service":"auralis-skyshare-api"}`
2. `https://auralis-skyshare-com.vercel.app` → il sito deve caricarsi e mostrare i voli nella pagina "Empty Leg"
3. Un test di prenotazione completo (vedi `TROUBLESHOOTING.md` e `API.md` per i dettagli)
