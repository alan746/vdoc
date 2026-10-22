import json,subprocess,os,time,hashlib
from pathlib import Path
P=Path(__file__).resolve().parent
W=json.loads((P/'check.json').read_text())['ownedWindow']
ENV={**os.environ,'VDOC_QA_WINDOW_TITLE':W['title']}
OUTPUT=Path('output/pdf/safari-native-20261011').resolve()
def run(args):
 r=subprocess.run(args,text=True,capture_output=True,timeout=15,env=ENV)
 return r
def flatten(n):return [n]+[item for c in n.get('children',[]) for item in flatten(c)]
def ax():
 for _ in range(12):
  r=run(['/tmp/vdoc-localpdf-ax'])
  if r.returncode==0:return json.loads(r.stdout)
  if 'Main accessibility window unavailable' not in r.stdout:raise RuntimeError(r.stdout+r.stderr)
  time.sleep(.3)
 raise RuntimeError('Print window did not become inspectable')
def action(kind,n,value=None):
 args=['/tmp/vdoc-localpdf-action',kind,n['path'],n['AXRole'],n.get('AXTitle',n.get('AXDescription',''))]
 if value is not None:args.append(value)
 r=run(args);return {'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
def js(body):
 guard='const s=Application("Safari"),w=s.windows.byId('+str(W['id'])+'),p=Application("System Events").processes.byName("Safari");if(!w.exists()||w.currentTab.url()!=='+json.dumps(W['url'])+'||s.windows[0].id()!=='+str(W['id'])+'||!p.frontmost())throw Error("Owned print target changed");'
 r=run(['osascript','-l','JavaScript','-e',guard+body]);assert r.returncode==0,r.stderr;return r.stdout
def activate():
 r=run(['/tmp/vdoc-production-activate']);state=json.loads(r.stdout);assert state['safariActive'] and state['mainMatchesOwnedTitle'],state
def open_print():
 js('const m=p.menuBars[0].menuBarItems.byName("File");m.click();delay(.2);m.menus.byName("File").menuItems.byName("Print…").click();');time.sleep(.7)
 for _ in range(12):
  tree=ax()
  if any(n.get('AXTitle','').startswith('All ') for n in flatten(tree.get('focused',{}))):return tree
  time.sleep(.3)
 raise RuntimeError('Print panel missing')
def scale(value):
 tree=ax();nodes=flatten(tree['focused']);field=next(n for n in nodes if n.get('AXRole')=='AXTextField' and str(n.get('AXValue','')).endswith('%'))
 r=action('focus',field);assert r['exit']==0,r
 js('const se=Application("System Events");se.keystroke("a",{using:["command down"]});se.keystroke('+json.dumps(str(value))+');se.keyCode(48);');time.sleep(.6)
 tree=ax();nodes=flatten(tree['focused']);assert any(n.get('AXValue')==str(value)+'%' for n in nodes)
 pages=next(n for n in nodes if n.get('AXRole')=='AXRadioButton' and n.get('AXTitle','').startswith('All '));assert pages['AXTitle']=='All 5 Pages' and pages['AXValue']==1,pages
 assert any(str(n.get('AXValue','')).startswith('A4 ') for n in nodes)
 assert any(n.get('AXTitle')==' Portrait' and n.get('AXValue')==1 for n in nodes)
 (P/f'scale-{value}.json').write_text(json.dumps(tree));return nodes
def start_save(value):
 nodes=scale(value);pdf=next(n for n in nodes if n.get('AXRole')=='AXButton' and n.get('AXDescription')=='PDF');press=action('press',pdf);time.sleep(.5)
 tree=ax();(P/f'save-dialog-{value}.json').write_text(json.dumps(tree));return tree,press
if __name__=='__main__':
 activate();tree,press=start_save(100);print(json.dumps({'pdfPress':press,'fields':[{k:v for k,v in n.items() if k!='children'} for n in flatten(tree.get('focused',{})) if n.get('AXRole') in ['AXTextField','AXPopUpButton','AXButton']]}))
