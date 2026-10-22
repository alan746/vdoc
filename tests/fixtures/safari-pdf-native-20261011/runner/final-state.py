from helpers import *
baseline=json.loads((out/'source-before-scale-matrix.vdoc.json').read_text())['content']
command('reload');time.sleep(1);assert state()['snapshot']['document']==baseline;save('final-reloaded-restored',state())
r=run(['osascript','-l','JavaScript','-e','const s=Application("Safari"),w=s.windows.byId(1713);if(!w.exists()||!w.currentTab.url().startsWith("http://127.0.0.1:4188/"))throw Error("Owned QA origin changed");const info={windowId:w.id(),url:w.currentTab.url(),version:s.version()};w.close();JSON.stringify(info);'],capture_output=True,text=True,check=True);save('cleanup-request',json.loads(r.stdout));print('Final source unchanged; close requested for owned QA window only',flush=True)
