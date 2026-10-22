from capture import *
for i,scale in enumerate([100,101,99,93,102]):
 if i:
  code='const s=Application("Safari"),w=s.windows.byId(1997),p=Application("System Events").processes.byName("Safari");if(!w.exists()||w.currentTab.url()!=="http://127.0.0.1:4189/vdoc-fixed-pages.pdf"||s.windows[0].id()!==1997||!p.frontmost())throw Error("QA PDF identity/focus changed");Application("System Events").keystroke("p",{using:["command down"]});'
  run(['osascript','-l','JavaScript','-e',code],capture_output=True,text=True,check=True);time.sleep(.8)
 capture(scale,'fixed-handoff-'+str(scale))
