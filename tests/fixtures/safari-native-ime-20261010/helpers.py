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
