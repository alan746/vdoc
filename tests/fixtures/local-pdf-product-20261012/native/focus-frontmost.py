import json,subprocess,os
from pathlib import Path
p=Path(__file__).resolve().parent;url=json.loads((p/'server.json').read_text())['url'];title='\u200e'+url.removeprefix('http://')
code='const s=Application("Safari"),w=s.windows.byId(7305),p=Application("System Events").processes.byName("Safari");if(!w.exists()||w.currentTab.url()!=='+json.dumps(url)+')throw Error("Owned PDF changed");p.frontmost=true;delay(1);if(!p.frontmost())throw Error("Safari cannot become frontmost");p.menuBars[0].menuBarItems.byName("Window").menus.byName("Window").menuItems.byName('+json.dumps(title)+').click();delay(1);JSON.stringify({targetId:7305,targetURL:w.currentTab.url(),frontId:s.windows[0].id(),frontmost:p.frontmost()})'
r=subprocess.run(['osascript','-l','JavaScript','-e',code],text=True,capture_output=True,timeout=15)
report={'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr};print(json.dumps(report));(p/'frontmost-result.json').write_text(json.dumps(report))
if r.returncode==0:
 a=subprocess.run(['/tmp/vdoc-localpdf-ax'],env={**os.environ,'VDOC_QA_WINDOW_TITLE':title},text=True,capture_output=True,timeout=10)
 (p/'frontmost-ax.json').write_text(json.dumps({'exit':a.returncode,'stdout':a.stdout,'stderr':a.stderr}));print(a.stdout[:1400])
