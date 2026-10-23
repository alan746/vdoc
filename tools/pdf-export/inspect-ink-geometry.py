"""Compare actual vector paths/transforms in owned PDF experiments, never a visual signoff."""
import sys as _qa_sys
from pathlib import Path as _QAPath
_qa_sys.path.insert(0, str(_QAPath(__file__).resolve().parents[1]))
from qa_paths import qa_path, recorded_name
import hashlib,json,math,os
from pathlib import Path
from collections import defaultdict
from pypdf import PdfReader
from pypdf.generic import ContentStream
ROOT=Path(__file__).resolve().parents[2]
IDENTITY=(1,0,0,1,0,0)
def multiply(a,b):
    return (a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5])
def path_key(data):
    return hashlib.sha256(data.strip()).hexdigest()
def ink(path):
    pdf=PdfReader(path); page=pdf.pages[0];resources=page['/Resources'];ctm=IDENTITY;stack=[];tm=IDENTITY;size=None;font=None;draws=[]
    def show(text):
        nonlocal tm
        encoded=text.original_bytes if hasattr(text,'original_bytes') else bytes(text)
        differences=font['/Encoding']['/Differences'];codes={};index=0
        for value in differences:
            if isinstance(value,int):index=value
            else:codes[index]=value;index+=1
        fm=tuple(float(x) for x in font['/FontMatrix']);widths=font['/Widths'];first=int(font['/FirstChar'])
        for code in encoded:
            stream=font['/CharProcs'][codes[code]].get_object().get_data();header,body=stream.split(b'\n',1)
            if not header.endswith(b'd1'):raise ValueError('Unexpected QA character procedure')
            transform=multiply(ctm,multiply(tm,multiply((size,0,0,size,0,0),fm)))
            if body.strip():draws.append({'path':path_key(body),'matrix':transform})
            tm=multiply(tm,(1,0,0,1,float(widths[code-first])*fm[0]*size,0))
    for args,op in ContentStream(page.get_contents(),pdf).operations:
        if op==b'q':stack.append(ctm)
        elif op==b'Q':ctm=stack.pop()
        elif op==b'cm':ctm=multiply(ctm,tuple(float(x) for x in args))
        elif op==b'BT':tm=IDENTITY
        elif op==b'Tm':tm=tuple(float(x) for x in args)
        elif op==b'Tf':font=resources['/Font'][args[0]].get_object();size=float(args[1])
        elif op==b'TJ':
            for item in args[0]:
                if isinstance(item,(int,float)) or type(item).__name__=='FloatObject':tm=multiply(tm,(1,0,0,1,-float(item)/1000*size,0))
                else:show(item)
        elif op==b'Tj':show(args[0])
        elif op==b'Do':
            form=resources['/XObject'][args[0]].get_object()
            if form['/Subtype']!='/Form':raise ValueError('Unexpected nonvector paint')
            draws.append({'path':path_key(form.get_data()),'matrix':multiply(ctm,tuple(float(x) for x in form.get('/Matrix',IDENTITY)))})
    if stack:raise ValueError('Unbalanced graphics state')
    return draws
encoding=os.environ.get('VDOC_QA_READER_VARIANT','record-alef')
if encoding not in ('record-alef','record-digits','record-flow','record-number-tail','record-marked-boxes','record-mark-advance','record-grapheme'):raise ValueError('Unsupported geometry comparison')
baseline='record-marked-boxes' if encoding in ('record-mark-advance','record-grapheme') else 'record-number-tail' if encoding=='record-marked-boxes' else 'record-actual' if encoding=='record-alef' else 'record-alef'
rows=[]
for label in ('words','arabic','hebrew','arabic-marked','hebrew-marked'):
    def file(mode):return ROOT/'output/pdf/browser-unicode-20261011'/(label.replace('-marked','')+'-unicode-ordered-'+mode+('-marked' if label.endswith('-marked') else '')+'.pdf')
    old,new=file(baseline),file(encoding);a,b=ink(old),ink(new);remaining=list(b);deltas=[]
    for paint in a:
        choices=[(max(abs(x-y) for x,y in zip(paint['matrix'],candidate['matrix'])),i) for i,candidate in enumerate(remaining) if candidate['path']==paint['path']]
        if not choices:raise ValueError('Missing exact vector outline: '+label)
        delta,index=min(choices);deltas.append(delta);remaining.pop(index)
    if remaining:raise ValueError('Additional visible glyph paint: '+label)
    rows.append({'label':label,'baseline':recorded_name(old),'candidate':recorded_name(new),'baselineSha256':hashlib.sha256(old.read_bytes()).hexdigest(),'candidateSha256':hashlib.sha256(new.read_bytes()).hexdigest(),'glyphPaints':len(a),'exactPathMultiset':True,'maxTransformDelta':max(deltas,default=0),'withinTolerance':max(deltas,default=0)<=0.0001})
result={'scope':'Exact visible glyph path multiset and page transform comparison. Tables and browser rendering are checked separately. Matrix tolerance 0.0001 PDF units; not pixel identity or layout/reader acceptance.','results':rows}
out=qa_path('reader-control-20261011') / (('alef' if encoding=='record-alef' else encoding)+'-ink-geometry.json')
if out.exists():raise SystemExit('Refuse overwrite')
out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(rows,indent=2))
