from capture import *
for variant in ['single-page-control','plain-control','full-sheet','intrinsic-height-control']:
 url='http://127.0.0.1:4188/__qa/diagnostic/'+variant
 code='const s=Application("Safari"),w=s.windows.byId(1713);if(!w.exists()||!w.currentTab.url().startsWith("http://127.0.0.1:4188/"))throw Error("QA identity mismatch");w.currentTab.url='+json.dumps(url)+';'
 run(['osascript','-l','JavaScript','-e',code],capture_output=True,text=True,check=True);time.sleep(1)
 keys()
 for scale in [100,101]:
  code='const s=Application("Safari"),p=Application("System Events").processes.byName("Safari");if(s.windows[0].id()!==1713||!p.frontmost()||s.windows[0].currentTab.url()!=='+json.dumps(url)+')throw Error("QA focus changed");Application("System Events").keystroke("p",{using:["command down"]});'
  run(['osascript','-l','JavaScript','-e',code],capture_output=True,text=True,check=True);time.sleep(1)
  capture(scale,'diagnostic-'+variant+'-'+str(scale))
