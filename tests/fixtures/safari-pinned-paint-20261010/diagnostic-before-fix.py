import sys,json,subprocess,time,urllib.error
from pathlib import Path
sys.path.insert(0,'tools/native-qa')
from safari_acceptance import Safari,ELEMENT,FIXTURE
out=Path('tests/fixtures/safari-pinned-paint-20261010');d=Safari(4181)
p=subprocess.Popen(['/usr/bin/safaridriver','--port','4181'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
report=[]
try:
 for _ in range(50):
  try:d.request('GET','/status',session=False);break
  except urllib.error.URLError:time.sleep(.1)
 s=d.request('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'safari'}}},session=False);d.session=s['sessionId']
 d.request('POST','/window/rect',{'width':1470,'height':920})
 d.request('POST','/url',{'url':'http://localhost:5173/'})
 d.wait('''return !!document.querySelector('input[aria-label="Import file into library"]:not(:disabled)')''')
 upload=d.find('input[aria-label="Import file into library"]');d.request('POST','/element/'+upload[ELEMENT]+'/value',{'text':str(FIXTURE)})
 before=d.wait('return window.vdoc?.snapshot().document || null')
 d.click(d.find('[role="textbox"][aria-label="Document body"]'));d.keys('\ue03d','f')
 d.wait('''return !!document.querySelector('input[aria-label="Find text"]')''')
 find=d.find('input[aria-label="Find text"]');d.request('POST','/element/'+find[ELEMENT]+'/value',{'text':'FINAL PAGE CHECK'})
 d.wait('''return !!document.querySelector('.vdoc-search-current')''')
 d.button('100%');item=d.wait('''return [...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()==='125%') || null''');d.click(item)
 d.wait('''return !document.querySelector('[role="menuitem"]')''')
 d.js("const c=document.querySelector('.canvas-scroll'),t=document.querySelector('.document-editor table'); c.scrollTop+=t.getBoundingClientRect().bottom-document.querySelector('.paragraph-ruler').getBoundingClientRect().bottom-120;")
 time.sleep(.5)
 for name,css in [('before',''),('cell-z','.document-editor .vdoc-pinned-row > td,.document-editor .vdoc-pinned-row > th {z-index:3;}'),('cell-transform','.document-editor .vdoc-pinned-row {transform:none;z-index:auto;background:transparent;} .document-editor .vdoc-pinned-row > td,.document-editor .vdoc-pinned-row > th {transform:translateY(var(--vdoc-pin-offset,0px));z-index:3;}')]:
  d.js('''document.getElementById('qa-paint-style')?.remove();const s=document.createElement('style');s.id='qa-paint-style';s.textContent=arguments[0];document.head.append(s);''',css)
  time.sleep(.3)
  result=d.js('''return [...document.querySelectorAll('.document-editor .vdoc-pinned-row > th,.document-editor .vdoc-pinned-row > td')].map(cell=>{
    const r=cell.getBoundingClientRect(), style=getComputedStyle(cell);
    return {text:cell.textContent,rect:r.toJSON(),background:style.backgroundColor,z:style.zIndex,hits:[.25,.5,.75].map(x=>{
      const hit=document.elementFromPoint(r.left+r.width*x,r.top+r.height*.5)?.closest('td,th');return {pinned:!!hit?.closest('.vdoc-pinned-row'),text:hit?.textContent};})};});''')
  assert d.js('return window.vdoc.snapshot().document')==before
  d.screenshot(out/(name+'.png'));report.append({'name':name,'cells':result,'sourceUnchanged':True})
  print(name,json.dumps(result,ensure_ascii=False),flush=True)
finally:
 (out/'probe.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 if d.session:
  try:d.request('DELETE','')
  except Exception:pass
 p.terminate()
 try:p.wait(timeout=3)
 except subprocess.TimeoutExpired:p.kill();p.wait()
