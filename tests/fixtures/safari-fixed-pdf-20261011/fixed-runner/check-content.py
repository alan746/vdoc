from pathlib import Path
import json,re,pdfplumber
from pypdf import PdfReader
files=[Path('output/pdf/safari-native-20261011/b-100.pdf'),*sorted(Path('output/pdf/safari-native-20261011').glob('fixed-handoff-*.pdf')),Path('output/pdf/safari-fixed-pdf-20261011/prototype-b.pdf')]
report=[]
for f in files:
 r=PdfReader(f);pages=[]
 with pdfplumber.open(f) as pdf:
  for i,p in enumerate(pdf.pages):
   text=r.pages[i].extract_text();chars=p.chars;outside=[c for c in chars if c['x0']<-.1 or c['x1']>p.width+.1 or c['top']<-.1 or c['bottom']>p.height+.1]
   pages.append({'page':i+1,'rows':re.findall(r'ROW\s+(\d{2})',text),'header': 'VDoc system acceptance' in text,'footer':'Local document acceptance' in text,'pageNumber':f'{i+1} / 5' in text,'finalHeading':'FINAL PAGE CHECK' in text,'charactersOutsideMediaBox':len(outside),'outsideSamples':[{'text':c['text'],'x0':c['x0'],'top':c['top'],'bottom':c['bottom']} for c in outside[:4]],'inkBounds':[min(c['x0'] for c in chars),min(c['top'] for c in chars),max(c['x1'] for c in chars),max(c['bottom'] for c in chars)],'fonts':sorted(set(c['fontname'] for c in chars)),'images':len(p.images)})
 report.append({'file':str(f),'pages':pages,'allFootersAndHeaders':all(p['header'] and p['footer'] and p['pageNumber'] for p in pages),'noTextOutsideMediaBox':all(p['charactersOutsideMediaBox']==0 for p in pages)})
 print(f.name,[(p['page'],p['charactersOutsideMediaBox'],p['pageNumber']) for p in pages])
Path('tests/fixtures/safari-fixed-pdf-20261011/content-geometry.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
