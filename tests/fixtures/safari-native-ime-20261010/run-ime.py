import json,time,subprocess,uuid
from pathlib import Path
p=Path('tmp/safari-native-bridge');out=Path('tests/fixtures/safari-native-ime-20261010');results=[]
def state():return json.loads((p/'state.json').read_text())
def command(action,**kwargs):
 subprocess.run(['osascript','-l','JavaScript',str(p/'keys.js')],check=True,capture_output=True)
 c={'id':str(uuid.uuid4()),'action':action,**kwargs};(p/'command.json').write_text(json.dumps(c));end=time.monotonic()+20
 while time.monotonic()<end:
  try:
   a=json.loads((p/'ack.json').read_text())
   if a['id']==c['id']:assert a['ok'],a;time.sleep(.5);return
  except FileNotFoundError:pass
  time.sleep(.1)
 raise TimeoutError('QA command not acknowledged')
def keys(*codes):
 subprocess.run(['osascript','-l','JavaScript',str(p/'keys.js'),*map(str,codes)],check=True,capture_output=True);time.sleep(.7)
def text(n):return n.get('text','')+''.join(text(c) for c in n.get('content',[]))
def shape(n):return {k:([shape(c) for c in v] if k=='content' else v) for k,v in n.items() if k!='text'}
def save(name,s): (out/(name+'.json')).write_text(json.dumps(s,ensure_ascii=False,indent=2))
try:
 for group,target in [('body','IME test area:'),('list','Verify Chinese candidate selection'),('table','ROW 03 —')]:
  for kind,codes,ending in [('cancel',[8,14,1,4,34],[53]),('space',[6,4,31,45,5],[49]),('enter',[8,14,1,4,34],[36]),('backspace',[6,4,31,45,5],[51,51,49]),('candidate-move',[6,4,31,45,5],[125,49])]:
   command('focus',text=target);before=state()['snapshot']['document'];keys(*codes);candidate=state();assert any(e['type']=='compositionupdate' and e['trusted'] for e in candidate['events']),'No real composition events'
   save(group+'-'+kind+'-candidate',candidate);keys(*ending);after=state();doc=after['snapshot']['document'];events=after['events'];assert any(e['type']=='compositionend' and e['trusted'] for e in events),'No real composition end'
   assert 'Saved locally' in after['save'],after['save']
   if kind=='cancel':assert doc==before,'Cancel changed full JSON'
   else:
    assert shape(doc)==shape(before),'Composition changed document structure/format'
    assert len(text(doc))>len(text(before)), 'No committed text'
   save(group+'-'+kind+'-after',after)
   r={'group':group,'case':kind,'trustedComposition':True,'before':before,'after':doc,'paragraphAndFormattingStable':True}
   if kind!='cancel':
    keys('undo');assert state()['snapshot']['document']==before,'Undo failed exact full JSON'
    keys('redo');assert state()['snapshot']['document']==doc,'Redo failed exact full JSON'
    keys('undo');assert state()['snapshot']['document']==before
    r['undoRedoExactJSON']=True
   results.append(r);print(group,kind,'passed',flush=True)
  command('focus',text=target);keys(6,4,31,45,5,49);beforeReload=state();command('reload');time.sleep(1);afterReload=state();assert afterReload['snapshot']['document']==beforeReload['snapshot']['document'];assert afterReload['events']==[]
  save(group+'-persisted',beforeReload);save(group+'-reloaded',afterReload);results.append({'group':group,'case':'persistence','fullJSONEqual':True});print(group,'persistence passed',flush=True)
except Exception as e:
 save('failure-state',state());results.append({'failure':str(e)});raise
finally:
 save('cases',{'results':results,'allPassed':not any('failure' in r for r in results)})
