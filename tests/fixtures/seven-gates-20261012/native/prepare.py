import json, subprocess, time, uuid
from pathlib import Path
OUT=Path(__file__).resolve().parent
origin=json.loads((OUT/'server.json').read_text())['origin']
def apple(script):
 return subprocess.check_output(['osascript','-e',script],text=True,stderr=subprocess.PIPE,timeout=15).strip()
def wait(fn,seconds=30):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  try:
   value=fn()
   if value:return value
  except (FileNotFoundError,json.JSONDecodeError):pass
  time.sleep(.3)
 raise TimeoutError('Bounded QA wait expired')
def state():return json.loads((OUT/'state.json').read_text())
def command(action):
 cid=str(uuid.uuid4());(OUT/'command.json').write_text(json.dumps({'id':cid,'action':action}))
 def ack():
  a=json.loads((OUT/'ack.json').read_text());return a if a['id']==cid else None
 a=wait(ack);assert a['ok'],a;return a
report={'origin':origin};window=None
try:
 apple('tell application "Safari"\nmake new document with properties {URL:'+json.dumps(origin+'/')+'}\nactivate\nend tell')
 def owned_front():
  s=apple('tell application "Safari"\nif (URL of current tab of front window) starts with '+json.dumps(origin+'/')+' then return id of front window\nreturn ""\nend tell')
  return int(s) if s else None
 window=wait(owned_front);report['windowId']=window
 wait(state);report['import']=command('bootstrap')
 report['before']=wait(lambda:state() if state().get('ready') else None)
 report['preview']=command('preview')
 report['ready']=wait(lambda:state() if state().get('printReady') else None,60)
 assert len(report['ready']['pages'])==5
 assert 'FINAL PAGE CHECK' in report['ready']['pages'][-1]
 assert report['before']['snapshot']['document']==report['ready']['snapshot']['document']
 report['passed']=True
except Exception as e:
 report['passed']=False;report['error']=repr(e);report['stderr']=str(getattr(e,'stderr',''))
 if window:
  try:
   apple('tell application "Safari"\nset w to window id '+str(window)+'\nif not ((URL of current tab of w) starts with '+json.dumps(origin+'/')+') then error "Changed target"\nclose w\nend tell');report['closed']=True
  except Exception as close:report['closeError']=str(close)
finally:
 (OUT/'prepare.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
 print(json.dumps({k:v for k,v in report.items() if k not in ['before','ready']}))
if not report.get('passed'):raise SystemExit(1)
