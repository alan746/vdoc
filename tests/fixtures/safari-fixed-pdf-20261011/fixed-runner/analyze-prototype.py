from pathlib import Path
from pypdf import PdfReader
from PIL import Image,ImageOps,ImageDraw,ImageChops
import subprocess,json,re,hashlib,logging
logging.getLogger('pypdf').setLevel(logging.ERROR)
pop='/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/bin/pdftoppm'
out=Path('tests/fixtures/safari-fixed-pdf-20261011');render=out/'renders';render.mkdir(exist_ok=True);report=[]
for f in sorted(Path('output/pdf/safari-fixed-pdf-20261011').glob('prototype-*.pdf')):
 r=PdfReader(f);texts=[p.extract_text() for p in r.pages];rows=re.findall(r'ROW\s+(\d{2})','\n'.join(texts));stem=f.stem
 subprocess.run([pop,'-scale-to','900','-png',str(f),str(render/stem)],check=True,capture_output=True)
 imgs=sorted(f for f in render.glob(stem+'-*.png') if re.fullmatch(re.escape(stem)+r'-\d+\.png',f.name));assert len(imgs)==len(texts)
 sheet=Image.new('RGB',(min(3,len(imgs))*320,((len(imgs)+2)//3)*478),'#dddddd');draw=ImageDraw.Draw(sheet);blank=[]
 for i,img in enumerate(imgs):
  im=Image.open(img).convert('RGB');blank.append(ImageChops.difference(im,Image.new('RGB',im.size,'white')).getbbox() is None)
  im.thumbnail((312,448));x=(i%3)*320+4;y=(i//3)*478+24;sheet.paste(im,(x,y));draw.text((x,y-18),f'Page {i+1}',fill='black')
 sheet.save(render/(stem+'-contact.png'))
 report.append({'file':str(f),'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'pages':len(texts),'mediaBoxes':[list(map(float,p.mediabox)) for p in r.pages],'textLengths':[len(t) for t in texts],'texts':texts,'rows':rows,'all36OnceInOrder':rows==[f'{n:02}' for n in range(1,37)] if not stem.startswith('diagnostic') else None,'whiteOnlyPages':[i+1 for i,v in enumerate(blank) if v],'contact':str(render/(stem+'-contact.png'))})
 print(stem,len(texts),'blank',[i+1 for i,v in enumerate(blank) if v],flush=True)
(out/'prototype-analysis.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
