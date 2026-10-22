from pathlib import Path
import json,hashlib
from pypdf import PdfReader,PdfWriter
from pypdf.generic import ContentStream,ByteStringObject,TextStringObject,ArrayObject,NameObject
out=Path('tests/fixtures/pdf-text-segments-20261012')
inputs=[]
for name,src in [('auto','output/pdf/type0-minimal-20261011/hebrew-page-visual.pdf'),('r2l','tests/fixtures/pdf-reading-direction-20261012/page-visual-r2l.pdf')]:
 r=PdfReader(src); w=PdfWriter(clone_from=r); page=w.pages[0]; stream=ContentStream(page.get_contents(),w); before=after=0
 for args,op in stream.operations:
  if op!=b'TJ':continue
  result=[]
  for v in args[0]:
   if isinstance(v,(ByteStringObject,TextStringObject)):
    before+=1
    raw=v.original_bytes if isinstance(v,TextStringObject) else bytes(v)
    if result and isinstance(result[-1],ByteStringObject):result[-1]=ByteStringObject(bytes(result[-1])+raw)
    else:result.append(ByteStringObject(raw))
   else:result.append(v)
  after+=sum(isinstance(v,ByteStringObject) for v in result)
  args[0]=ArrayObject(result)
 page[NameObject('/Contents')]=w._add_object(stream)
 target=out/f'{name}.pdf'
 with target.open('xb') as f:w.write(f)
 source=json.loads(Path('tests/fixtures/pdf-type0-minimal-20261011/hebrew-page-visual.json').read_text())
 inputs.append(dict(label=name,file=str(target),original=src,sourceText=source['sourceText'],targets=source['targets'],stringsBefore=before,stringsAfter=after,sha256=hashlib.sha256(target.read_bytes()).hexdigest()))
(out/'inputs.json').write_text(json.dumps(inputs,indent=2,ensure_ascii=False))
print([(i['label'],i['stringsBefore'],i['stringsAfter']) for i in inputs])
