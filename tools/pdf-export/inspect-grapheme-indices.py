"""Character-index geometry controls in PDFium153; not Chrome154 selection acceptance."""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1]))
from qa_paths import qa_path, recorded_path
import hashlib,json,re
from pathlib import Path
import pypdfium2 as pdfium
ROOT=Path(__file__).resolve().parents[2];FIX=qa_path('reader-control-20261011');results=[]
source=json.loads((FIX/'partial-record-marked-boxes-wide-standards.json').read_text())['results']
for mode in ['record-marked-boxes','record-mark-advance','record-grapheme']:
 for label,word in [('arabic-marked','جَمِيلَةٌ'),('hebrew-marked','שָׁלוֹם')]:
  baseline=next(r for r in source if r['label']==label);file=baseline['file'].replace('record-marked-boxes',mode);path=recorded_path(file)
  doc=pdfium.PdfDocument(path);page=doc[0];text=page.get_textpage()
  try:
   value=text.get_text_range();aligned=len(value)==text.count_chars();start=value.find(word);chars=[];hits=[]
   if aligned and start>=0:
    for i in range(start,start+len(word)):
     chars.append({'index':i,'unicode':value[i],'tightBox':list(text.get_charbox(i)),'looseBox':list(text.get_charbox(i,loose=True))})
    points=[r for r in baseline['sourceGeometry']['ranges'] if r['word']==word];firstLine=min(r['line'] for r in points)
    for r in points:
     if r['line']!=firstLine:continue
     box=r['rect'];y=page.get_height()-(box['y']+box['height']/2)*.75
     for inset in [.15,1]:
      inset=min(inset,box['width']/4);right=(box['x']+box['width']-inset)*.75;left=(box['x']+inset)*.75
      indices=[text.get_index(x,y,0,0) for x in [right,left]]
      hits.append({'grapheme':r['expected'],'inset':inset,'rightThenLeftIndices':indices,'rightThenLeftChars':[value[i] if i is not None else None for i in indices]})
   results.append({'mode':mode,'label':label,'file':file,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'sourceWord':word,'sourceWordPresent':start>=0,'BMPCountMatches':aligned,'selectedText':value,'characters':chars,'hitIndices':hits})
  finally:text.close();page.close();doc.close()
p=FIX/'grapheme-indices.json';assert not p.exists();p.write_text(json.dumps({'engine':str(pdfium.PDFIUM_INFO),'scope':'Tight/loose character bounds and zero-tolerance character hit indices in standalone PDFium153. Source positions from independent DOM ranges; unlike Chrome154 drag/caret behavior. Not a substitute for real pointer probes. Missing words retained as failures; no guessed index mapping.','results':results},ensure_ascii=False,indent=2)+'\n');print([(r['mode'],r['label'],r['sourceWordPresent']) for r in results])
