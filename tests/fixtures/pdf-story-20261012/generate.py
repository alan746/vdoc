"""Bounded native Story reference; no product integration or document uploads."""
import hashlib
import html
import json
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(root / 'tmp/pdf-engine-evaluation/site'))
import pymupdf

out = root / 'output/pdf/pdf-story-20261012'
out.mkdir(parents=True, exist_ok=True)
evidence = Path(__file__).resolve().parent
fixtures = [
    ('hebrew', 'he', 'rtl', ['שלום עולם בדיקת מסמך', 'עברית כתיבה טבלה']),
    ('arabic', 'ar', 'rtl', ['العربية لغة جميلة', 'مرحبا بالعالم كتابة مستند']),
    ('hindi', 'hi', 'ltr', ['हिन्दी हिंदी भाषा में दस्तावेज़ लिखना।', 'दुनिया नमस्ते शिक्षा क्षत्रिय प्रार्थना।']),
]
inputs = []
for label, lang, direction, lines in fixtures:
    path = out / f'{label}.pdf'
    assert not path.exists(), 'Preserve existing evidence'
    markup = f'<html><body lang="{lang}" dir="{direction}">' + ''.join(
        f'<p>{html.escape(line)}</p>' for line in lines) + '</body></html>'
    css = f'body {{ font-family: sans-serif; font-size: 20pt; direction: {direction}; }} p {{ margin: 0 0 16pt; }}'
    (evidence / f'{label}.html').write_text(markup)
    story = pymupdf.Story(html=markup, user_css=css)
    writer = pymupdf.DocumentWriter(str(path))
    device = writer.begin_page(pymupdf.Rect(0, 0, 600, 400))
    more, filled = story.place(pymupdf.Rect(36, 36, 564, 364))
    assert not more, 'The bounded reference must fit one page'
    story.draw(device)
    writer.end_page()
    writer.close()
    with pymupdf.open(path) as doc:
        assert len(doc) == 1
        details = {'version': pymupdf.VersionBind, 'mupdfVersion': pymupdf.VersionFitz,
                   'source': '\n'.join(lines), 'css': css, 'filled': list(filled),
                   'fonts': doc[0].get_fonts(full=True), 'nativeText': doc[0].get_text(),
                   'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    (evidence / f'{label}.json').write_text(json.dumps(details, ensure_ascii=False, indent=2) + '\n')
    subprocess.run(['pdftoppm', '-png', '-scale-to', '1000', '-singlefile', str(path), str(evidence / label)], check=True)
    inputs.append({'label': label, 'file': str(path.relative_to(root)), 'sourceText': '\n'.join(lines), 'pages': 1})
(evidence / 'inputs.json').write_text(json.dumps(inputs, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'engine': pymupdf.VersionBind, 'generated': len(inputs), 'productIntegration': False}))
