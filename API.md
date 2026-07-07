# API — Auralis SkyShare Backend

URL base: `https://auralis-skyshare-com.onrender.com`

> Questo documento elenca solo gli endpoint che abbiamo effettivamente costruito e testato insieme. Non tutte le funzionalità del piano originale sono state completate — vedi la sezione "Funzionalità non ancora implementate" in fondo.

## Endpoint pubblici (nessun login richiesto)

### `GET /api/health`
Verifica che il server sia vivo.
```json
{"status":"ok","service":"auralis-skyshare-api"}
```

### `GET /api/empty-legs`
Lista dei voli disponibili (solo `PUBLISHED`, futuri).

Filtri opzionali via query string: `fromAirport`, `toAirport`, `dateFrom`, `dateTo`, `maxPrice`, `pax`

### `GET /api/empty-legs/:id`
Dettaglio di un singolo volo.

### `POST /api/bookings`
Crea una prenotazione e una Checkout Session Stripe.

Corpo della richiesta:
```json
{
  "emptyLegId": "...",
  "bookerFirstName": "Anna",
  "bookerLastName": "Rossi",
  "bookerEmail": "anna@example.com",
  "bookerPhone": "+393331234567",
  "bookingType": "FULL",
  "passengers": [
    { "firstName": "Anna", "lastName": "Rossi", "email": "anna@example.com", "phone": "+393331234567" }
  ]
}
```

Risposta:
```json
{ "bookingId": "...", "checkoutUrl": "https://checkout.stripe.com/..." }
```

**Nota:** `bookingType: "SPLIT"` viene salvato ma **non** genera ancora pagamenti realmente divisi tra passeggeri — è una funzionalità rimandata (vedi in fondo).

### `POST /api/contact-requests`
Salva una richiesta di contatto e notifica l'admin via email. Rate limit: 5 richieste ogni 15 minuti per IP.

### `POST /api/webhooks/stripe`
Riceve le conferme di pagamento da Stripe. Non va mai chiamato manualmente — solo Stripe lo invoca, con firma verificata.

## Endpoint protetti (richiedono token Auth0)

### `GET /api/me`
Ritorna il profilo dell'utente autenticato (crea l'utente al primo accesso).

### `GET /api/my/bookings`
Prenotazioni dell'utente corrente (cercate per `customerUserId` o email).

### `GET /api/my/bookings/:id`
Dettaglio di una prenotazione, solo se appartiene all'utente corrente.

## Endpoint operatore (richiedono ruolo `OPERATOR`)

- `POST` / `GET /api/operator/profile`
- `POST` / `GET` / `PUT` / `DELETE /api/operator/aircraft`
- `POST` / `GET` / `PUT` / `DELETE /api/operator/empty-legs`
- `GET /api/operator/bookings`, `GET /api/operator/bookings/:id`

Un operatore può pubblicare voli solo se il proprio profilo ha `status: APPROVED`.

## Endpoint admin (richiedono ruolo `ADMIN`)

- `GET /api/admin/users`
- `GET /api/admin/operators`, `PUT /api/admin/operators/:id/approve`, `PUT /api/admin/operators/:id/reject`
- `GET /api/admin/empty-legs`
- `GET /api/admin/bookings`, `PUT /api/admin/bookings/:id/status`
- `GET /api/admin/contact-requests`, `PUT /api/admin/contact-requests/:id/status`

## Come testare un endpoint manualmente

Per gli endpoint pubblici, basta aprire l'URL nel browser (per `GET`) o usare `curl` (per `POST`):

```bash
curl -X POST https://auralis-skyshare-com.onrender.com/api/contact-requests \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","topic":"Prova","message":"Messaggio di test"}'
```

Per gli endpoint protetti, serve un token Auth0 valido — il modo più semplice è fare login dal sito vero e ispezionare le richieste dalla console del browser (tab "Network").

## Funzionalità non ancora implementate (fasi finali rimandate)

- **Split payment reale su Stripe**: oggi un booking "split" crea comunque un'unica Checkout Session per l'importo totale, non N pagamenti separati per passeggero
- **Voli non confermati con probabilità**: non esiste ancora questo stato nel database
- **Mappa dinamica**: la mappa nella pagina Empty Leg mostra rotte statiche, non collegate ai voli reali
- **Nomi città salvati nel database**: oggi calcolati da una mappa JavaScript fissa nel frontend, non da un campo reale nel database
