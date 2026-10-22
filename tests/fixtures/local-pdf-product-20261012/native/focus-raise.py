import json,subprocess
from pathlib import Path
p=Path(__file__).resolve().parent;url=json.loads((p/'server.json').read_text())['url'];title='\u200e'+url.removeprefix('http://')
code='const s=Application("Safari"),w=s.windows.byName('+json.dumps(title)+');if(!w.exists()||w.currentTab.url()!=='+json.dumps(url)+')throw Error("Owned PDF window absent");const id=w.id();s.activate();delay(.3);const p=Application("System Events").processes.byName("Safari"),a=p.windows.byName('+json.dumps(title)+');if(a.exists())a.actions.byName("AXRaise").perform();delay(.3);if(s.windows[0].id()!==id)p.menuBars[0].menuBarItems.byName("Window").menus.byName("Window").menuItems.byName('+json.dumps(title)+').click();delay(.3);if(s.windows[0].id()!==id||s.windows[0].currentTab.url()!=='+json.dumps(url)+')throw Error("Owned PDF did not become front");JSON.stringify({id,url:w.currentTab.url(),title:w.name()});'
result=subprocess.run(['osascript','-l','JavaScript','-e',code],text=True,capture_output=True,timeout=15)
(p/'focus-result.json').write_text(json.dumps({'exit':result.returncode,'stdout':result.stdout,'stderr':result.stderr}))
assert result.returncode==0,result.stderr
r=result.stdout
(p/'window.json').write_text(r);print(r)
