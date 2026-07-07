# Auralis SkyShare

Piattaforma per voli privati empty-leg / sky sharing.

## Struttura del progetto

```
auralis-skyshare/
├── index.html       ← frontend (statico, nessun build step)
├── backend/         ← API Node.js + TypeScript
├── ENVIRONMENT_VARIABLES.md
├── DEPLOYMENT.md
├── API.md
├── TROUBLESHOOTING.md
├── .gitignore
├── .env.example
└── README.md
```

## Stato del progetto

- [x] Frontend collegato al backend reale
- [x] Backend Node.js + TypeScript deployato
- [x] Database PostgreSQL (Neon)
- [x] Autenticazione (Auth0)
- [x] Pagamenti (Stripe Checkout) — con webhook in produzione autonomo
- [x] Email automatiche (Resend)
- [x] Deploy frontend (Vercel) — `auralis-skyshare-com.vercel.app`
- [x] Deploy backend (Render) — `auralis-skyshare-com.onrender.com`
- [x] Area utente base
- [x] Area operatore base
- [x] Area admin base
- [ ] Split payment reale su Stripe (rimandato, vedi API.md)
- [ ] Voli non confermati con probabilità (rimandato)
- [ ] Mappa dinamica con voli reali (rimandato)
- [ ] Nomi città salvati nel database invece che calcolati (rimandato)

## Documentazione

- `ENVIRONMENT_VARIABLES.md` — tutte le variabili ambiente, cosa fanno, dove trovarle
- `DEPLOYMENT.md` — come funziona il deploy, come rifarlo
- `API.md` — elenco degli endpoint backend
- `TROUBLESHOOTING.md` — problemi reali già incontrati e come risolverli
- `backend/README.md` — dettagli tecnici del backend

## Come contribuire (per ora, solo tu)

Non serve Linux locale: puoi lavorare da GitHub Codespaces direttamente nel browser, oppure con GitHub Desktop se preferisci un'interfaccia grafica.
