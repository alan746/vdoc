import json,subprocess,os,time
from pathlib import Path
p=Path(__file__).resolve().parent;r=json.loads((p/'check.json').read_text());w=r['ownedWindow'];env={**os.environ,'VDOC_QA_WINDOW_TITLE':w['title']}
def run(args):return subprocess.run(args,text=True,capture_output=True,timeout=15,env=env)
a=run(['/tmp/vdoc-production-activate']);state=json.loads(a.stdout);assert state['safariActive'] and state['mainMatchesOwnedTitle'],state
code='const s=Application("Safari"),w=s.windows.byId('+str(w['id'])+'),p=Application("System Events").processes.byName("Safari");if(!w.exists()||w.currentTab.url()!=='+json.dumps(w['url'])+'||!p.frontmost())throw Error("Owned target changed");const m=p.menuBars[0].menuBarItems.byName("File");m.click();delay(.2);m.menus.byName("File").menuItems.byName("Print…").click();'
a=run(['osascript','-l','JavaScript','-e',code]);assert a.returncode==0,a.stderr
time.sleep(.7);a=run(['/tmp/vdoc-localpdf-ax']);assert a.returncode==0,a.stdout+a.stderr;(p/'print-open.json').write_text(a.stdout);print(a.stdout[:4000])
