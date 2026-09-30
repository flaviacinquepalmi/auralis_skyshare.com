"""Regenerate public route copies from current app; preserve each route's SEO head."""
from pathlib import Path
import re
root = Path(__file__).resolve().parents[1]
source = (root / 'index.html').read_text()
# Keep SEO-only head entries of each route; share style, scripts, markup and functionality.
seo = re.compile(r'<(?:title\b[^>]*>.*?</title>|meta\b(?=[^>]*(?:name="(?:description|robots|twitter:[^"]+)"|property="og:[^"]+"))[^>]*>|link\b(?=[^>]*rel="canonical")[^>]*>|script\b[^>]*type="application/ld\+json"[^>]*>.*?</script>)', re.S)
for route, page in [('empty-leg','emptyleg'),('prenota','emptyleg'),('chi-siamo','about'),('contatti','contatti')]:
    target = root / route / 'index.html'
    existing = target.read_text()
    head_end = existing.index('</head>')
    metadata = '\n'.join(m.group() for m in seo.finditer(existing[:head_end]))
    source_end = source.index('</head>')
    head = seo.sub('', source[:source_end]).replace('<head>', '<head>\n<base href="/">', 1)
    result = head + '\n' + metadata + '\n' + source[source_end:]
    result = re.sub(r'(id="page-[^"]+" class="page) active', r'\1', result)
    result = result.replace(f'id="page-{page}" class="page"', f'id="page-{page}" class="page active"')
    target.write_text(result)
