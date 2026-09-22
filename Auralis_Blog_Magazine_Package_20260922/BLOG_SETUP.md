# Auralis Blog — istruzioni rapide

## File da caricare su GitHub
Carica l'intera cartella `blog/` nella root del repository, accanto a `index.html`.

Struttura:

blog/
  index.html
  assets/
    blog.css
    blog.js
  cosa-sono-empty-leg/
    index.html
  _template-articolo/
    index.html

## Pubblicare un nuovo articolo
1. Duplica `blog/_template-articolo/`.
2. Rinomina la cartella con uno slug SEO, ad esempio `quanto-costa-empty-leg`.
3. Modifica il suo `index.html`.
4. Sostituisci tutti i placeholder tra parentesi quadre.
5. Aggiorna il JSON-LD Article (`headline`, `description`, `datePublished`, `dateModified`, `mainEntityOfPage`).
6. Aggiungi una card/link nella homepage `blog/index.html`.
7. Aggiungi il nuovo URL alla sitemap principale.

## Regola URL
Usa sempre:
`/blog/nome-articolo/`

Non usare query string o file `.html` visibili nell'URL.

## Formato editoriale consigliato
- H1 = query principale.
- Risposta diretta entro le prime 100 parole.
- 3–5 H2.
- 600–1.000 parole massimo per le guide brevi.
- Fonti reali in fondo quando l'articolo contiene dati o affermazioni verificabili.
- `dateModified` aggiornato quando cambi informazioni sostanziali.

## Immagini
Il template usa `/jetinterior.jpg` perché è già nella root del repository.
Per un articolo specifico puoi creare:
`/assets/blog/nome-immagine.jpg`
oppure usare un asset già presente nel sito.

## Newsletter
Il form sulla homepage invia a:
`/api/newsletter/subscribe`
Va collegato al backend Render/Resend prima di renderlo operativo.
