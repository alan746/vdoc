import sys,json,time,subprocess,socket,urllib.error,re
from pathlib import Path
sys.path.insert(0,str(Path('tools/native-qa').resolve()))
from safari_acceptance import Safari,ELEMENT,normalized
out=Path('tests/fixtures/safari-native-print-20261011');fixture=Path('tests/fixtures/safari-preview/source.vdoc.json').resolve();source=json.loads(fixture.read_text())
report={'scope':'Isolated Safari WebDriver: real preview lifecycle and two owned VDoc tabs; no native PDF assertion','checks':[],'applicationSha256':json.load(open('tests/fixtures/safari-pinned-paint-20261010/source-manifest.json'))['applicationSha256']}
def save(): (out/'audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
with socket.socket() as s: assert s.connect_ex(('127.0.0.1',4181))!=0,'Port occupied; refuse attachment'
d=Safari(4181);proc=subprocess.Popen(['/usr/bin/safaridriver','--port','4181'],stdout=(out/'driver.log').open('w'),stderr=subprocess.STDOUT)
try:
 for _ in range(50):
  try:d.request('GET','/status',session=False);break
  except urllib.error.URLError:time.sleep(.1)
 session=d.request('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'safari'}}},session=False);d.session=session['sessionId'];report['capabilities']=session.get('capabilities')
 d.request('POST','/url',{'url':'http://localhost:5173/'})
 d.wait('return !!document.querySelector(\'input[aria-label="Import file into library"]:not(:disabled)\')')
 upload=d.find('input[aria-label="Import file into library"]');d.request('POST','/element/'+upload[ELEMENT]+'/value',{'text':str(fixture)})
 before=d.wait('return window.vdoc?.snapshot().document || null');assert normalized(before)==normalized(source['content'])
 original=d.request('GET','/window');url=d.request('GET','/url');report['documentURL']=url
 d.js('''window.__qaProtocol=[];window.__qaVisibility=[];document.addEventListener('visibilitychange',()=>window.__qaVisibility.push({at:Date.now(),state:document.visibilityState}));window.addEventListener('message',e=>{const f=document.querySelector('iframe[title="Paginated document preview"]');if(e.origin===location.origin&&e.source===f?.contentWindow&&e.data?.type?.startsWith('vdoc-preview-'))window.__qaProtocol.push({at:Date.now(),...e.data})});''')
 d.button('Print')
 def ready():return d.wait('''const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Print / Save PDF');return b&&!b.disabled ? document.querySelector('.print-preview-controls [role=status]')?.textContent:null''',65)
 report['readyStatus']=ready();print('Preview ready; collecting actual handshake',flush=True)
 protocol=d.js('return window.__qaProtocol');(out/'protocol.json').write_text(json.dumps(protocol,indent=2))
 assert any(e['type']=='vdoc-preview-ready' for e in protocol)
 assert any(e['type']=='vdoc-preview-accepted' for e in protocol)
 assert any(e['type']=='vdoc-preview-status' and e.get('state')=='ready' for e in protocol),protocol
 report['checks'].append({'name':'real-safari-ready-accepted-completed','passed':True,'protocol':protocol})
 def pages():
  return d.js('''return [...document.querySelector('iframe[title="Paginated document preview"]').contentDocument.querySelectorAll('.pagedjs_page')].map(p=>({text:p.querySelector('.pagedjs_page_content')?.innerText||'',images:[...p.querySelectorAll('img')].map(i=>({complete:i.complete,width:i.naturalWidth}))}))''')
 baseline=pages();assert len(baseline)==5;assert 'FINAL PAGE CHECK' in baseline[-1]['text'];d.screenshot(out/'preview-before-tab-switch.png')
 new=d.request('POST','/window/new',{'type':'tab'});d.request('POST','/window',{'handle':new['handle']});d.request('POST','/url',{'url':'http://localhost:5173/'})
 d.wait('return !!document.querySelector(\'input[aria-label="Import file into library"]\')');d.screenshot(out/'second-owned-vdoc-tab.png');time.sleep(1)
 d.request('POST','/window',{'handle':original});ready();after=pages();assert after==baseline
 visibility=d.js('return window.__qaVisibility');assert [e['state'] for e in visibility][-2:]==['hidden','visible'],visibility
 d.screenshot(out/'preview-after-tab-switch.png');report['checks'].append({'name':'switch-two-owned-vdoc-tabs','passed':True,'visibility':visibility,'pagesUnchanged':True});print('Two-tab hide/show passed; document and five pages unchanged',flush=True)
 report['pages']=after
 body='\n'.join(p['text'] for p in after);counts={str(n):len(re.findall(r'ROW\s+'+f'{n:02}'+r'\b',body)) for n in range(1,37)};assert all(n==1 for n in counts.values());report['rowCounts']=counts
 d.button('Return to editing');assert d.js('return window.vdoc.snapshot().document')==before
 d.request('POST','/refresh',{});restored=d.wait('return window.vdoc?.snapshot().document||null');assert restored==before
 report['checks'].append({'name':'return-and-reload-complete-content','passed':True})
 (out/'before-document.json').write_text(json.dumps(before,ensure_ascii=False,indent=2));(out/'after-document.json').write_text(json.dumps(restored,ensure_ascii=False,indent=2))
 report['state']='passed';save()
except Exception as e:
 report['state']='failed';report['error']=repr(e);save();raise
finally:
 try:
  if d.session:d.request('DELETE','');report['ownSessionClosed']=True
 except Exception as e:report['cleanupError']=repr(e)
 proc.terminate()
 try:proc.wait(timeout=5)
 except subprocess.TimeoutExpired:proc.kill();proc.wait()
 save()
