import json,subprocess,time,os
from pathlib import Path
p=Path(__file__).resolve().parent;url=json.loads((p/'server.json').read_text())['url'];title='\u200e'+url.removeprefix('http://')
report={'url':url}
def run(args):return subprocess.run(args,text=True,capture_output=True,timeout=15)
r=run(['osascript','-e','tell application "Safari"\nmake new document with properties {URL:'+json.dumps(url)+'}\nend tell']);report['createExit']=r.returncode
assert r.returncode==0,r.stderr
time.sleep(1)
code='const s=Application("Safari"),w=s.windows.byName('+json.dumps(title)+');if(!w.exists()||w.currentTab.url()!=='+json.dumps(url)+')throw Error("No owned test window");JSON.stringify({id:w.id(),url:w.currentTab.url(),title:w.name()})'
r=run(['osascript','-l','JavaScript','-e',code]);assert r.returncode==0,r.stderr
report['ownedWindow']=json.loads(r.stdout)
raise_code='const s=Application("Safari"),w=s.windows.byId('+str(report['ownedWindow']['id'])+');if(!w.exists()||w.currentTab.url()!=='+json.dumps(url)+')throw Error("Owned target changed");const a=Application("System Events").processes.byName("Safari").windows.byName('+json.dumps(title)+');if(a.exists())a.actions.byName("AXRaise").perform();'
r=run(['osascript','-l','JavaScript','-e',raise_code]);report['raise']={'exit':r.returncode,'error':r.stderr}
a=subprocess.run(['/tmp/vdoc-production-activate'],env={**os.environ,'VDOC_QA_WINDOW_TITLE':title},capture_output=True,text=True,timeout=10);report['activation']={'exit':a.returncode,'stdout':a.stdout,'stderr':a.stderr}
(p/'check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print(json.dumps(report,ensure_ascii=False))
