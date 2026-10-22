import json,subprocess,time
from pathlib import Path
p=Path(__file__).resolve().parent;url=json.loads((p/'server.json').read_text())['url']
def js(code):return subprocess.check_output(['osascript','-l','JavaScript','-e',code],text=True,stderr=subprocess.PIPE,timeout=15).strip()
js('const s=Application("Safari");s.Document({url:'+json.dumps(url)+'}).make();s.activate();')
report=None
for _ in range(40):
 raw=js('const s=Application("Safari"),w=s.windows[0];JSON.stringify(w.currentTab.url()==='+json.dumps(url)+'?{id:w.id(),url:w.currentTab.url(),title:w.name()}:null)')
 report=json.loads(raw)
 if report:break
 time.sleep(.25)
assert report,'No owned front window; no further action'
time.sleep(1)
report=json.loads(js('const s=Application("Safari"),w=s.windows[0];if(w.id()!=='+str(report['id'])+'||w.currentTab.url()!=='+json.dumps(url)+')throw Error("QA changed");JSON.stringify({id:w.id(),url:w.currentTab.url(),title:w.name()})'))
(p/'window.json').write_text(json.dumps(report,ensure_ascii=False));print(json.dumps(report,ensure_ascii=False))
