from pathlib import Path
from pypdf import PdfReader
from collections import Counter
from PIL import Image,ImageDraw,ImageChops
import subprocess,json,unicodedata
out=Path('tests/fixtures/pdf-prefont-20261011');out.joinpath('renders').mkdir(exist_ok=True)
exe='/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/bin/pdftoppm'
files=list(Path('output/pdf/pdf-prefont-20261011').glob('*.pdf'))
native=Path('output/pdf/safari-native-20261011/flow-native-101.pdf')
if native.exists():files.append(native)
s=json.loads((out/'flow.vdoc.json').read_text())
def text(n):return n.get('text','')+''.join(text(c) for c in n.get('content',[]))
def script(t,start,end):return ''.join(c for c in unicodedata.normalize('NFKC',t) if start<=c<=end)
source=text(s['content']);reports=[]
for p in files:
 r=PdfReader(p);t='\n'.join(x.extract_text() for x in r.pages)
 row=dict(file=str(p),pages=len(r.pages),nulls=t.count('\0'),types=dict(Counter(str(f.get_object().get('/Subtype')) for page in r.pages for f in page['/Resources']['/Font'].values())))
 if p.stem.startswith('flow'):
  expected=source+s['content']['attrs']['header']*len(r.pages)+s['content']['attrs']['footer']*len(r.pages)
  row['inventories']={name:Counter(script(t,a,b))==Counter(script(expected,a,b)) for name,a,b in [('cjk','\u3000','\u9fff'),('hindi','\u0900','\u097f'),('arabic','\u0600','\u06ff'),('hebrew','\u0590','\u05ff')]}
  row['hindiOrder']=script(t,'\u0900','\u097f')==script(expected,'\u0900','\u097f');row['markersOnce']=all(t.count(f'BLOCK {i:02}')==t.count(f'END {i:02}')==1 for i in range(1,9))
 reports.append(row)
 subprocess.run([exe,'-r','72','-png',str(p),str(out/'renders'/p.stem)],check=True)
 sheet=Image.new('RGB',(250*len(r.pages),380),'#ddd');draw=ImageDraw.Draw(sheet)
 for i in range(1,len(r.pages)+1):
  im=Image.open(out/'renders'/f'{p.stem}-{i}.png').convert('RGB');im.thumbnail((245,348));sheet.paste(im,((i-1)*250,23));draw.text(((i-1)*250+4,5),f'{p.stem} / {i}',fill='black')
 sheet.save(out/'renders'/f'{p.stem}-contact.png')
pixels=[]
for prefix in ['flow','flow-family','flow-fallback']:
 values=[]
 for i in range(1,5):
  a=Image.open(out/'renders'/f'{prefix}-{i}.png').convert('RGB');b=Image.open(out/'renders'/f'{prefix}-contextual-{i}.png').convert('RGB');values.append(a.size==b.size and ImageChops.difference(a,b).getbbox() is None)
 pixels.append(dict(variant=prefix,pagesIdentical=values))
(out/'analysis.json').write_text(json.dumps(dict(files=reports,pixelComparison=pixels),ensure_ascii=False,indent=2));print(json.dumps(reports[-3:],ensure_ascii=False))
