from pathlib import Path
from PIL import Image, ImageChops, ImageDraw
import json,subprocess
root=Path('tests/fixtures/pdf-direction-final-20261012'); rows=json.loads((root/'full/inputs.json').read_text()); results=[]
contact=Image.new('RGB',(1600,1000),'#ececec'); draw=ImageDraw.Draw(contact)
for i,row in enumerate(rows):
 dest=root/('render-'+row['label']);subprocess.run(['pdftoppm','-singlefile','-scale-to','1100','-png',row['file'],str(dest)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 img=Image.open(str(dest)+'.png').convert('RGB'); thumb=img.copy();thumb.thumbnail((390,465)); x=(i%4)*400;y=(i//4)*500;contact.paste(thumb,(x,y+25));draw.text((x+8,y+6),row['label'],fill='black')
 results.append({'label':row['label'],'render':str(dest)+'.png','size':img.size})
contact.save(root/'contact.png');(root/'renders.json').write_text(json.dumps(results,indent=2))
