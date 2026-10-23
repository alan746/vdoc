"""Compare actual PDFium Arabic-Indic character locations with independent source DOM ranges."""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1]))
from qa_paths import qa_path, recorded_path
from pathlib import Path
import json,hashlib
import pypdfium2 as pdfium
ROOT=Path(__file__).resolve().parents[2];FIX=qa_path('reader-control-20261011');word='١٢٣٤٥٦٧٨٩٠';result=[]
for mode in ['record-alef','record-digits','record-number-tail']:
 raw=json.loads((FIX/f'partial-{mode}-wide-standards-numbers.json').read_text());row=next(r for r in raw['results'] if r['label']=='arabic');ranges=[r for r in row['sourceGeometry']['ranges'] if r['word']==word]
 assert len(ranges)==10
 path=recorded_path(row['file']);doc=pdfium.PdfDocument(path);page=doc[0];text=page.get_textpage()
 try:
  value=text.get_text_range();assert len(value)==text.count_chars();assert value.count(word)==1;start=value.index(word);characters=[]
  for i,source in enumerate(ranges):
   box=list(text.get_charbox(start+i));cx=(box[0]+box[2])/2/.75;r=source['rect'];characters.append({'text':source['expected'],'sourceRect':r,'pdfBox':box,'pdfCenterCssX':cx,'centerWithinSourceRange':r['x']<=cx<=r['x']+r['width']})
  result.append({'mode':mode,'file':row['file'],'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'sourceWord':word,'selectedLogicalWordPresent':True,'characters':characters,'positionsPass':sum(c['centerWithinSourceRange'] for c in characters)})
 finally:text.close();page.close();doc.close()
out=FIX/'numeric-direction-geometry.json';assert not out.exists();out.write_text(json.dumps({'engine':str(pdfium.PDFIUM_INFO),'scope':'Independent PDFium 153 character geometry, not a substitute for Chrome154 pointer probes or ink review. Positions compared to source DOM ranges. All source characters are BMP and text count is asserted.','results':result},ensure_ascii=False,indent=2)+'\n');print([(r['mode'],r['positionsPass']) for r in result])
