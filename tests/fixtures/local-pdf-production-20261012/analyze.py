from pathlib import Path
from pypdf import PdfReader
from PIL import Image,ImageChops,ImageDraw
import pdfplumber,json,re,subprocess,hashlib
out=Path('tests/fixtures/local-pdf-production-20261012');renders=out/'renders';renders.mkdir(exist_ok=True);results=[]
for scale in [93,99,100,101,102]:
 p=Path(f'output/pdf/safari-native-20261011/local-production-{scale}.pdf');reader=PdfReader(p);texts=[page.extract_text() for page in reader.pages];s='\n'.join(texts)
 r={'scale':scale,'file':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'pages':len(reader.pages),'rows':re.findall(r'ROW\s*(\d{2})\b',s),'headers':len(re.findall('VDoc system acceptance',s)),'footers':len(re.findall('Local document acceptance',s)),'lastPageBody':'This heading must start on a new page.' in texts[-1]}
 with pdfplumber.open(p) as pdf:
  r['geometry']=[{'page':i+1,'charactersOutsideMediaBox':sum(c['x0']<-.15 or c['x1']>page.width+.15 or c['top']<-.15 or c['bottom']>page.height+.15 for c in page.chars),'images':len(page.images),'inkBounds':[min(c['x0'] for c in page.chars),min(c['top'] for c in page.chars),max(c['x1'] for c in page.chars),max(c['bottom'] for c in page.chars)]} for i,page in enumerate(pdf.pages)]
 subprocess.run(['pdftoppm','-scale-to','900','-png',str(p),str(renders/str(scale))],check=True,capture_output=True)
 pages=[Image.open(renders/f'{scale}-{i}.png').convert('RGB') for i in range(1,len(reader.pages)+1)]
 r['blankPages']=[i+1 for i,im in enumerate(pages) if ImageChops.difference(im,Image.new('RGB',im.size,'white')).getbbox() is None]
 sheet=Image.new('RGB',(3*425,2*635),'#ddd');draw=ImageDraw.Draw(sheet)
 for i,im in enumerate(pages):
  im.thumbnail((415,600));x=(i%3)*425+5;y=(i//3)*635+25;sheet.paste(im,(x,y));draw.text((x,y-18),f'{scale}% Page {i+1}',fill='black')
 sheet.save(renders/f'{scale}-contact.png')
 r['passed']=r['pages']==5 and r['rows']==[f'{i:02}' for i in range(1,37)] and r['headers']==5 and r['footers']==5 and r['lastPageBody'] and not r['blankPages'] and all(x['charactersOutsideMediaBox']==0 for x in r['geometry'])
 results.append(r);print(scale,r['passed'],flush=True)
(out/'native-analysis.json').write_text(json.dumps(results,ensure_ascii=False,indent=2));assert all(x['passed'] for x in results)
