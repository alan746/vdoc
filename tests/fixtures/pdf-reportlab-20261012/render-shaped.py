from pathlib import Path
import sys,json,hashlib
sys.path.insert(0,str(Path('tmp/reportlab-shaping-qa').resolve()))
import reportlab,uharfbuzz
from reportlab.pdfgen.canvas import Canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont,shapeStr,ShapedStr
out=Path('tests/fixtures/pdf-reportlab-20261012/shaped');out.mkdir(exist_ok=True);inputs=[];reports=[]
for name,fontname in [('words','Devanagari'),('arabic','Arabic'),('hebrew','Hebrew')]:
 target=out/f'{name}.pdf'
 if target.exists():raise ValueError('Refuse overwrite')
 source=json.loads(Path(f'tests/fixtures/browser-unicode-20261011/{name}-unicode-ordered-report.json').read_text())['sourceText'];source='\n'.join(source.split('\n')[:4])
 font=Path(f'tests/fixtures/browser-pdf-20261011/fonts/NotoSans{fontname}-static.ttf');pdfmetrics.registerFont(TTFont(name,str(font),shapable=True))
 c=Canvas(str(target),pagesize=(595.28,841.89));c.setFont(name,16);shapes=[]
 for i,line in enumerate(source.split('\n')):
  shaped=shapeStr(line,name,16,force=True);assert isinstance(shaped,ShapedStr) and len(shaped.__shapeData__)==len(shaped)
  width=pdfmetrics.stringWidth(shaped,name,16);assert width<515
  c.drawString(40,780-i*70,shaped)
  shapes.append({'source':line,'glyphSequence':str(shaped),'data':[list(x) for x in shaped.__shapeData__],'width':width})
 c.save();inputs.append({'label':name,'file':str(target),'sourceText':source});reports.append({'script':name,'shapes':shapes,'pdfSHA256':hashlib.sha256(target.read_bytes()).hexdigest(),'fontSHA256':hashlib.sha256(font.read_bytes()).hexdigest()})
(out/'generation.json').write_text(json.dumps({'reportlab':reportlab.Version,'harfbuzz':uharfbuzz.version_string(),'method':'Explicit shapeStr(force=True), asserts ShapedStr + glyph records before drawing; no unavailable bidi adapter or copied visual character permutation.','results':reports},ensure_ascii=False,indent=2));(out/'inputs.json').write_text(json.dumps(inputs,ensure_ascii=False))
s=Path('tests/fixtures/pdf-direct-readers-20261012/check-copy.cjs').read_text().replace("const out='tests/fixtures/pdf-direct-readers-20261012';",f"const out='{out}';");(out/'check-copy.cjs').write_text(s)
