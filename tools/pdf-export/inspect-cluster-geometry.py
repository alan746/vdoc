"""Inspect owned QA glyph boxes; PDFium 153 diagnostics are distinct from Chrome 154 UI evidence."""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1]))
from qa_paths import qa_path, recorded_path
import hashlib
import json
from pathlib import Path
import pypdfium2 as pdfium
from pypdf import PdfReader
from pypdf.generic import ContentStream
ROOT=Path(__file__).resolve().parents[2]
OUT=qa_path('reader-control-20261011/cluster-geometry-final.json')
files={'native-control':'output/pdf/reader-control-20261011/words.pdf'}
for encoding in ('bidi-runs','whole-cluster','cluster-actual','local-clusters','record-actual'):
    files[encoding]=f'output/pdf/browser-unicode-20261011/words-unicode-ordered-{encoding}.pdf'
results=[]
for label,relative in files.items():
    path=recorded_path(relative)
    with pdfium.PdfDocument(path) as document:
        page=document[0]
        textpage=page.get_textpage()
        try:
            text=textpage.get_text_range()
            start=text.index('हि')
            chars=[{'index':i,'text':text[i],'box':list(textpage.get_charbox(i))} for i in range(start,start+8)]
        finally:
            textpage.close()
            page.close()
    reader=PdfReader(path)
    spans=[str(args[1]['/ActualText']) for args,op in ContentStream(reader.pages[0].get_contents(),reader).operations if op==b'BDC' and '/ActualText' in args[1]]
    results.append({'label':label,'file':relative,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'firstCharacters':chars,'actualTextSpans':spans})
result={'pdfiumVersion':str(pdfium.PDFIUM_INFO),'scope':'Independent PDFium character bounding boxes, not a substitute for Chrome pointer probes. Native renderer is only a control, not automatic approval.','research':'https://pdfium.googlesource.com/pdfium/+/refs/heads/main/core/fpdftext/cpdf_textpage.cpp','sourceVersionLimit':'Main-branch source explains hypotheses; not asserted to be the exact source version of installed engines.','results':results}
if OUT.exists():raise SystemExit('Refuse overwrite')
OUT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print([(r['label'],r['firstCharacters'][0]['box'],r['firstCharacters'][1]['box']) for r in results])
