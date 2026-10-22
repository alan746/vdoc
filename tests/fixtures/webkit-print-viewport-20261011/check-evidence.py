"""Inspect actual native PDFs. Passing means diagnosis reproduced, not a product pass."""
from pathlib import Path
from pypdf import PdfReader
from pypdf.generic import ContentStream
from PIL import Image, ImageChops
import json,hashlib,logging
logging.getLogger('pypdf').setLevel(logging.ERROR)
root=Path(__file__).resolve().parents[3];base=Path(__file__).resolve().parent;out=root/'output/pdf/webkit-print-viewport-20261011'
def ops(page,reader,name):return [[float(x) for x in a] for a,o in ContentStream(page.get_contents(),reader).operations if o==name]
results=[]
for name,pages in [('short-100',1),('short-101',2),('fixed-mm-100',2),('fixed-mm-101',6),('viewport-100',2),('viewport-101',6)]:
 p=out/(name+'.pdf');reader=PdfReader(p);assert len(reader.pages)==pages
 run=json.loads((base/(name+'.run.json')).read_text());assert run['exit']==0 and run['stoppedReason'] is None and run['sha256']==hashlib.sha256(p.read_bytes()).hexdigest()
 metrics=json.loads((base/(name+'.stdout')).read_text().splitlines()[-1]);assert metrics['success'] and metrics['events'][-1]['phase']=='afterprint'
 results.append({'file':str(p.relative_to(root)),'sha256':run['sha256'],'pages':pages,'passedDiagnostic':True})
# Same public measurements at the beforeprint / entering-print boundaries do
# not reveal which of these two scale settings the OS uses later.
for mode in ['short','fixed-mm','viewport']:
 a=json.loads((base/(mode+'-100.stdout')).read_text().splitlines()[-1]);b=json.loads((base/(mode+'-101.stdout')).read_text().splitlines()[-1]);assert a['events']==b['events']
# The short second page repeats text drawing operators off the visible page:
# its original content is translated horizontally, not vertically.
a=PdfReader(out/'short-101.pdf');left=ops(a.pages[0],a,b'cm')[0];right=ops(a.pages[1],a,b'cm')[0]
assert left[:4]==right[:4] and left[5]==right[5] and 590<left[4]-right[4]<600
strip=ops(a.pages[1],a,b're')[1];assert 0<strip[2]<7
im=Image.open(base/'short-101-2.png').convert('RGB');assert ImageChops.difference(im,Image.new('RGB',im.size,'white')).getbbox() is None
legacy=[]
for name in ['b-101.pdf','b-101-repeat.pdf']:
 p=root/'output/pdf/safari-native-20261011'/name;r=PdfReader(p);assert len(r.pages)==12
 widths=[]
 for i in range(0,12,2):
  l=ops(r.pages[i],r,b're');rr=ops(r.pages[i+1],r,b're');assert l[1][0:2]==rr[1][0:2] and l[1][3]==rr[1][3]
  assert 590<l[1][2]<600 and 0<rr[1][2]<7
  assert abs(rr[2][0]-l[2][0]+l[1][2])<.001
  widths.append(rr[1][2])
 legacy.append({'file':str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'pairs':6,'rightStripWidthsPt':widths})
report={'scope':'Six generated PDFs plus two existing native Safari outputs; diagnosis only','outputs':results,'legacySafari':legacy,'shortHorizontalOffsetPt':left[4]-right[4],'shortRightStripWidthPt':strip[2],'shortRightStripVisuallyBlank':True,'publicScaleMetricsEqual':True,'passed':True}
(base/'evidence-check.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
