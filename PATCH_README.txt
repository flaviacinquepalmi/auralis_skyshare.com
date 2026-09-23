AURALIS SEO/GEO V3 — VISUAL SAFE + URL ROUTING

What changed:
- Same main SPA markup/styles/animations: no redesign.
- /chi-siamo/, /empty-leg/, /prenota/, /contatti/ now open the correct existing SPA section.
- Public navigation uses history.pushState + popstate (browser back/forward works).
- Route copies are generated from the same corrected index source, only their SEO <head> and initial active section differ.
- <base href="/"> keeps all existing images/assets resolving from every route.
- Partner Program and Pilot Program page markup/links removed.
- Journal remains at /journal/ with its existing visual CSS; /blog/ redirects to /journal/.
- SEO metadata, Open Graph, Twitter, schema, sitemap and robots retained.

Safe apply from repository root after extracting this ZIP into seo_patch_v3/:
  bash seo_patch_v3/apply-seo-v3.sh

Then:
  git status
  git diff --stat

Local smoke test (optional):
  python3 -m http.server 8000
then open /, /chi-siamo/, /empty-leg/, /prenota/, /contatti/, /journal/.
