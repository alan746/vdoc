from pathlib import Path
import sys,json,hashlib
sys.path.insert(0,str(Path('tmp/reportlab-shaping-qa').resolve()))
import reportlab,uharfbuzz
from reportlab.pdfgen.canvas import Canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
out=Path('tests/fixtures/pdf-reportlab-20261012');target=out/'hindi.pdf'
if target.exists():raise ValueError('Refuse overwrite')
source=json.loads(Path('tests/fixtures/browser-unicode-20261011/words-unicode-ordered-report.json').read_text())['sourceText'];source='\n'.join(source.split('\n')[:4])
font=Path('tests/fixtures/browser-pdf-20261011/fonts/NotoSansDevanagari-static.ttf')
pdfmetrics.registerFont(TTFont('QADevanagari',str(font),shapable=True))
c=Canvas(str(target),pagesize=(595.28,841.89));c.setFont('QADevanagari',16)
for i,line in enumerate(source.split('\n')):c.drawString(40,780-i*70,line,shaping=True)
c.save()
(out/'inputs.json').write_text(json.dumps([{'label':'hindi','file':str(target),'sourceText':source}],ensure_ascii=False))
(out/'generation.json').write_text(json.dumps({'reportlab':reportlab.Version,'harfbuzz':uharfbuzz.version_string(),'fontSHA256':hashlib.sha256(font.read_bytes()).hexdigest(),'pdfSHA256':hashlib.sha256(target.read_bytes()).hexdigest(),'shaping':True,'direction':'LTR Devanagari','source':source},ensure_ascii=False,indent=2))
s=Path('tests/fixtures/pdf-direct-readers-20261012/check-copy.cjs').read_text().replace("const out='tests/fixtures/pdf-direct-readers-20261012';",f"const out='{out}';");(out/'check-copy.cjs').write_text(s)
