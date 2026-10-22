from helpers import *
import hashlib
output=Path('output/pdf/safari-native-20261011');baseline=json.loads((out/'source-before-scale-matrix.vdoc.json').read_text())['content']
def flatten(n):
 result=[n]
 for c in n.get('children',[]):result+=flatten(c)
 return result
def ax():
 r=run([str(p/'ax-sheet')],capture_output=True,text=True,check=True);return json.loads(r.stdout)
def action(kind,n,value=None):
 label=n.get('AXTitle',n.get('AXDescription',''));args=[str(p/'action'),kind,n['path'],n['AXRole'],label]
 if value is not None:args.append(value)
 r=run(args,capture_output=True,text=True);return {'returncode':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
def native_tab():
 code='const s=Application("Safari"),p=Application("System Events").processes.byName("Safari");if(s.windows[0].id()!==1713||!p.frontmost())throw Error("QA focus changed");Application("System Events").keyCode(48);'
 run(['osascript','-l','JavaScript','-e',code],capture_output=True,text=True,check=True)
def capture(scale,name):
 target=output/(name+'.pdf');assert not target.exists(),'Refuse overwrite '+str(target)
 tree=ax();nodes=flatten(tree['focused']);field=next(n for n in nodes if n.get('AXRole')=='AXTextField' and str(n.get('AXValue','')).endswith('%'))
 result=action('focus',field);assert result['returncode']==0,result
 code='const s=Application("Safari"),p=Application("System Events").processes.byName("Safari");if(s.windows[0].id()!==1713||!p.frontmost())throw Error("QA focus changed");const se=Application("System Events");se.keystroke("a",{using:["command down"]});se.keystroke('+json.dumps(str(scale))+');se.keyCode(48);'
 run(['osascript','-l','JavaScript','-e',code],capture_output=True,text=True,check=True);time.sleep(.8)
 tree=ax();nodes=flatten(tree['focused']);actual=next(n['AXValue'] for n in nodes if n.get('AXRole')=='AXTextField' and str(n.get('AXValue','')).endswith('%'));assert actual==str(scale)+'%',actual
 allpages=next(n for n in nodes if n.get('AXRole')=='AXRadioButton' and n.get('AXTitle','').startswith('All '));assert allpages['AXValue']==1
 assert any(n.get('AXValue','').startswith('A4 ') for n in nodes if isinstance(n.get('AXValue'),str))
 assert next(n['AXValue'] for n in nodes if n.get('AXTitle')==' Portrait')==1
 assert next(n['AXValue'] for n in nodes if n.get('AXTitle')=='Print headers and footers')==0
 assert next(n['AXValue'] for n in nodes if n.get('AXTitle')=='Print backgrounds')==1
 save(name+'-print-settings',tree)
 pdf=next(n for n in nodes if n.get('AXRole')=='AXButton' and n.get('AXDescription')=='PDF');press=action('press',pdf);time.sleep(.4)
 dialog=ax();items=flatten(dialog['focused']);assert dialog['focused'].get('AXDescription')=='save','Save dialog missing'
 assert next(n['AXValue'] for n in items if n.get('AXTitle')=='Where:')=='safari-native-20261011','Wrong output directory'
 filename=next(n for n in items if n.get('AXRole')=='AXTextField' and str(n.get('AXValue','')).endswith('.pdf'));assert action('set',filename,name+'.pdf')['returncode']==0
 savebutton=next(n for n in items if n.get('AXRole')=='AXButton' and n.get('AXTitle')=='Save');saved=action('press',savebutton)
 for _ in range(60):
  if target.exists() and target.stat().st_size>0:break
  time.sleep(.2)
 assert target.exists(),'Saved PDF absent; no blind retry'

 result={'scale':scale,'file':str(target),'nativePageLabel':allpages['AXTitle'],'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size,'sourceUnchanged':None,'pdfButtonAction':press,'saveAction':saved}
 save(name+'-result',result);print(name,allpages['AXTitle'],target.stat().st_size,'bytes',flush=True)

 return result
