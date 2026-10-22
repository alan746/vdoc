from capture import *
for scale in [100,101,93]:
 code='const s=Application("Safari"),w=s.windows.byId(2580),p=Application("System Events").processes.byName("Safari");if(!w.exists()||w.currentTab.url()!=="http://127.0.0.1:4189/vdoc-embedded-logical.pdf")throw Error("QA PDF identity changed");s.activate();delay(.2);p.menuBars[0].menuBarItems.byName("Window").menus.byName("Window").menuItems.byName("\\u200e127.0.0.1:4189/vdoc-embedded-logical.pdf").click();delay(.3);if(s.windows[0].id()!==2580||!p.frontmost())throw Error("QA foreground changed");const f=p.menuBars[0].menuBarItems.byName("File");f.click();delay(.2);f.menus.byName("File").menuItems.byName("Print…").click();'
 run(['osascript','-l','JavaScript','-e',code],capture_output=True,text=True,check=True);time.sleep(.8)
 capture(scale,'embedded-native-'+str(scale))
