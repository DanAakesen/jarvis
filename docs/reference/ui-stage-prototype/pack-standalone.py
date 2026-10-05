"""Package the built prototype into one offline HTML file; no image manipulation."""
import base64
import re
from pathlib import Path

root = Path(__file__).parent
dist = root / 'dist'
html = (dist / 'index.html').read_text()
js_path = re.search(r'<script[^>]+src="([^"]+)"[^>]*></script>', html).group(1)
css_path = re.search(r'<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>', html).group(1)
js = (dist / js_path.lstrip('/')).read_text()
css = (dist / css_path.lstrip('/')).read_text()
font = next((dist / 'assets').glob('*.woff2'))
encoded = base64.b64encode(font.read_bytes()).decode()
css = re.sub(r'@font-face\{[^}]+\}', '@font-face{font-family:Phosphor;src:url(data:font/woff2;base64,' + encoded + ') format("woff2");font-weight:normal;font-style:normal;font-display:block}', css, count=1)
html = re.sub(r'<script[^>]+src="[^"]+"[^>]*></script>', lambda _: '<script type="module">' + js.replace('</script', '<\\/script') + '</script>', html, count=1)
html = re.sub(r'<link[^>]+rel="stylesheet"[^>]+href="[^"]+"[^>]*>', lambda _: '<style>' + css + '</style>', html, count=1)
output = root / 'jarvis-motion-study.html'
output.write_text(html)
print(f'Saved {output} ({output.stat().st_size} bytes)')
