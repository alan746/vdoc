import json,time,subprocess,uuid
from pathlib import Path
p=Path('tmp/pdf-unicode-20261011');out=Path('tests/fixtures/pdf-unicode-20261011');results=[]
def run(args,**kwargs):
 try:return subprocess.run(args,timeout=20,**kwargs)
 except subprocess.TimeoutExpired as e:raise RuntimeError('Native step timed out: '+str(e.stderr)) from e
 except subprocess.CalledProcessError as e:raise RuntimeError((e.stderr.decode(errors='replace') if isinstance(e.stderr,bytes) else e.stderr) or (e.stdout.decode(errors='replace') if isinstance(e.stdout,bytes) else e.stdout)) from e
def state():return json.loads((p/'state.json').read_text())
def command(action,**kwargs):
 run(['osascript','-l','JavaScript',str(p/'keys.js')],check=True,capture_output=True)
 prior=state().get('snapshot',{}).get('sessionId')
 c={'id':str(uuid.uuid4()),'action':action,**kwargs};(p/'command.json').write_text(json.dumps(c));end=time.monotonic()+20
 while time.monotonic()<end:
  try:
   a=json.loads((p/'ack.json').read_text())
   if a['id']==c['id']:
    assert a['ok'],a;time.sleep(.5)
    if action=='reload':
     deadline=time.monotonic()+5
     while (not state().get('snapshot',{}).get('sessionId') or state().get('snapshot',{}).get('sessionId')==prior) and time.monotonic()<deadline:time.sleep(.1)
     assert state().get('snapshot',{}).get('sessionId') and state().get('snapshot',{}).get('sessionId')!=prior,'Reload did not complete; no next key sent'
    return
  except FileNotFoundError:pass
  time.sleep(.1)
 raise TimeoutError('QA command not acknowledged')
def keys(*codes):
 run(['osascript','-l','JavaScript',str(p/'keys.js'),*map(str,codes)],check=True,capture_output=True);time.sleep(.7)
def text(n):return n.get('text','')+''.join(text(c) for c in n.get('content',[]))
def shape(n):return {k:([shape(c) for c in v] if k=='content' else v) for k,v in n.items() if k!='text'}
def save(name,s): (out/(name+'.json')).write_text(json.dumps(s,ensure_ascii=False,indent=2))
