import sys,json,time,subprocess,socket,urllib.error
from pathlib import Path
sys.path.insert(0,str(Path('tools/native-qa').resolve()))
from safari_acceptance import Safari,ELEMENT,normalized
out=Path('tests/fixtures/safari-focused-ax-20261011');fixture=Path('tests/fixtures/safari-preview/source.vdoc.json').resolve();source=json.loads(fixture.read_text());report={'scope':'Read-only focused native accessibility capability on isolated Safari preview; no PDF or product pass inferred'}
def save():(out/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
with socket.socket() as s:assert s.connect_ex(('127.0.0.1',4181))!=0,'Driver port occupied'
d=Safari(4181);proc=subprocess.Popen(['/usr/bin/safaridriver','--port','4181'],stdout=(out/'driver.log').open('w'),stderr=subprocess.STDOUT)
try:
 for _ in range(50):
  try:d.request('GET','/status',session=False);break
  except urllib.error.URLError:time.sleep(.1)
 session=d.request('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'safari'}}},session=False);d.session=session['sessionId']
 d.request('POST','/url',{'url':'http://localhost:5173/'})
 d.wait('return !!document.querySelector(\'input[aria-label="Import file into library"]:not(:disabled)\')');upload=d.find('input[aria-label="Import file into library"]');d.request('POST','/element/'+upload[ELEMENT]+'/value',{'text':str(fixture)})
 before=d.wait('return window.vdoc?.snapshot().document || null');assert normalized(before)==normalized(source['content']);url=d.request('GET','/url');report['documentURL']=url
 d.button('Print');report['previewStatus']=d.wait('''const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Print / Save PDF');return b&&!b.disabled?document.querySelector('.print-preview-controls [role=status]')?.textContent:null''',65)
 title='VDoc focused AX QA 20261011';d.js('document.title=arguments[0]',title)
 script='''const s=Application('Safari'),se=Application('System Events'),p=se.processes.byName('Safari'),title=TITLE,url=URL;
const w=s.windows.byName(title);if(!w.exists()||w.currentTab.url()!==url)throw Error('Exact QA window not found');const id=w.id();s.activate();delay(.4);p.menuBars[0].menuBarItems.byName('Window').menus.byName('Window').menuItems.byName(title).click();delay(.5);if(s.windows[0].id()!==id||!p.frontmost())throw Error('Owned foreground guard failed');
function read(e,depth){const r={};for(const k of ['role','name','description','value'])try{const v=e[k]();r[k]=typeof v==='string'?v.slice(0,120):v}catch{}if(depth>0)try{r.children=e.uiElements().slice(0,30).map(x=>read(x,depth-1))}catch{}return r}
const r={windowId:id,guardedURL:url};for(const n of ['AXFocusedWindow','AXMainWindow','AXEnhancedUserInterface','AXManualAccessibility'])try{const a=p.attributes.byName(n);r[n]=n.endsWith('Window')?read(a.value(),5):a.value()}catch(e){r[n]={error:String(e)}}JSON.stringify(r);'''.replace('TITLE',json.dumps(title)).replace('URL;',json.dumps(url)+';')
 path=Path('tmp/safari-focused-ax/read.js');path.write_text(script)
 r=subprocess.run(['osascript','-l','JavaScript',str(path)],capture_output=True,text=True,timeout=15);report['focusedAX']={'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr};print(json.dumps(report['focusedAX'],ensure_ascii=False),flush=True)
 report['state']='capability-inspected';save()
except Exception as e:report['state']='failed';report['error']=repr(e);save();raise
finally:
 try:
  if d.session:d.request('DELETE','');report['ownSessionClosed']=True
 except Exception as e:report['cleanupError']=repr(e)
 proc.terminate()
 try:proc.wait(timeout=5)
 except subprocess.TimeoutExpired:proc.kill();proc.wait()
 save()
