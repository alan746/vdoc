from capture import *
run(['osascript','-l','JavaScript','-e','const s=Application("Safari"),w=s.windows.byId(2742);if(!w.exists()||w.currentTab.url()!=="http://127.0.0.1:4189/vdoc-flow-contextual.pdf")throw Error("QA origin changed");s.activate();delay(.3);Application("System Events").processes.byName("Safari").menuBars[0].menuBarItems.byName("Window").menus.byName("Window").menuItems.byName("\\u200e127.0.0.1:4189/vdoc-flow-contextual.pdf").click();delay(.4);'],capture_output=True,text=True,check=True)
code='const s=Application("Safari"),w=s.windows.byId(2742),p=Application("System Events").processes.byName("Safari");if(!w.exists()||w.currentTab.url()!=="http://127.0.0.1:4189/vdoc-flow-contextual.pdf"||s.windows[0].id()!==2742||!p.frontmost())throw Error("QA identity changed");const f=p.menuBars[0].menuBarItems.byName("File");f.click();delay(.2);f.menus.byName("File").menuItems.byName("Print…").click();'
run(['osascript','-l','JavaScript','-e',code],capture_output=True,text=True,check=True);time.sleep(.7)
nodes=flatten(ax()['focused']);f=next(n for n in nodes if n.get('AXRole')=='AXTextField' and str(n.get('AXValue','')).endswith('%'));assert action('focus',f)['returncode']==0
code='const s=Application("Safari"),p=Application("System Events").processes.byName("Safari");if(s.windows[0].id()!==2742||!p.frontmost())throw Error("QA focus changed");const se=Application("System Events");se.keystroke("a",{using:["command down"]});se.keystroke("100");se.keyCode(48);'
run(['osascript','-l','JavaScript','-e',code],capture_output=True,text=True,check=True);time.sleep(.5)
tree=ax();assert any(n.get('AXValue')=='100%' for n in flatten(tree['focused']));save('normalized-restored-native-100',tree)
cancel=next(n for n in flatten(tree['focused']) if n.get('AXRole')=='AXButton' and n.get('AXTitle')=='Cancel');action('press',cancel);time.sleep(.5)
run(['osascript','-l','JavaScript','-e','const s=Application("Safari"),w=s.windows.byId(2742);if(!w.exists()||w.currentTab.url()!=="http://127.0.0.1:4189/vdoc-flow-contextual.pdf")throw Error("QA identity changed");w.close();'],capture_output=True,text=True,check=True)
print('Native100 restored; owned2742 close requested',flush=True)
