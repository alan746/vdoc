from pathlib import Path
from pypdf import PdfReader
from PIL import Image,ImageChops
import json,unicodedata,collections,importlib.util,logging
logging.getLogger('pypdf').setLevel(logging.ERROR)
files=[Path('output/pdf/safari-fixed-pdf-20261011/prototype-b.pdf'),Path('output/pdf/safari-native-20261011/prototype-native-100.pdf'),Path('output/pdf/pdf-unicode-20261011/global-order-b.pdf'),Path('output/pdf/safari-native-20261011/global-native-100.pdf')]
rows=[]
for path in files:
 reader=PdfReader(path);text='\n'.join(p.extract_text() for p in reader.pages);normalized=unicodedata.normalize('NFKC',text);types=collections.Counter()
 for page in reader.pages:
  for font in page['/Resources'].get('/Font',{}).values():types[str(font.get_object().get('/Subtype'))]+=1
 rows.append({'file':str(path),'pages':len(reader.pages),'logicalHindiWords':text.count('हिन्दी'),'hindiCodepoints':sum('\u0900'<=c<='\u097f' for c in text),'cjkCodepointsAfterNFKC':sum('\u3400'<=c<='\u9fff' for c in normalized),'nullCodepoints':text.count('\0'),'fontResourceSubtypes':dict(types)})
print(rows)
visual=[]
for stem in ['repaired-b','normalized-b','normalized-clusters-b','incremental-b','global-order-b']:
 values=[]
 for i in range(1,6):
  a=Image.open(f'tests/fixtures/safari-fixed-pdf-20261011/renders/prototype-b-{i}.png').convert('RGB');b=Image.open(f'tests/fixtures/pdf-unicode-20261011/renders/{stem}-{i}.png').convert('RGB');values.append(a.size==b.size and ImageChops.difference(a,b).getbbox() is None)
 visual.append({'variant':stem,'pagesPixelIdentical':values})
js=json.load(open('tests/fixtures/pdf-unicode-20261011/pdfjs-text.json'));jsChecks=[]
for result in js:
 text=''.join(p['text'] for p in result['pages']);hindi=''.join(c for c in text if '\u0900'<=c<='\u097f');jsChecks.append({'file':result['file'],'all18HindiInLogicalOrder':hindi=='हिन्दी'*18,'nullCount':text.count('\0')})
report={'textAndFontComparison':rows,'rasterComparison':visual,'pdfjsChecks':jsChecks,'conclusion':'Unmodified Chrome PDF already loses CJK/Devanagari extraction when reprinted by Safari. Global mapping repair fixes direct-PDF extraction and logical order while retaining every rendered pixel; it does not repair Safari reprint text preservation. Type3 fonts are present in the source; causality is a next investigation, not established solely by these counts.'}
Path('tests/fixtures/pdf-unicode-20261011/comparison.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
