from capture import *
variants={'root-narrow':'html{width:150mm} body{width:140mm}', 'root-clipped':'html,body{overflow:hidden}', 'root-auto-paper':'@page{size:auto;margin:20mm} html,body{width:150mm}', 'root-contained':'html,body{contain:paint;width:150mm;max-width:150mm}'}
for variant,css in variants.items():
 html='<html><head><meta charset="utf-8"><title>VDoc isolated native print 4188</title><style>'+css+'</style></head><body><h1>ONE PAGE CONTROL</h1><p>English 中文 العربية. End of short text.</p></body></html>'
 (p/'single-page-control.html').write_text(html)
 (out/'diagnostic-sources'/(variant+'.html')).write_text(html)
 url='http://127.0.0.1:4188/__qa/diagnostic/single-page-control'
 code='const s=Application("Safari"),w=s.windows.byId(1713);if(!w.exists()||!w.currentTab.url().startsWith("http://127.0.0.1:4188/"))throw Error("QA identity mismatch");w.currentTab.url='+json.dumps(url)+';'
 run(['osascript','-l','JavaScript','-e',code],capture_output=True,text=True,check=True);time.sleep(1)
 keys()
 for scale in [100,101]:
  code='const s=Application("Safari"),p=Application("System Events").processes.byName("Safari");if(s.windows[0].id()!==1713||!p.frontmost()||s.windows[0].currentTab.url()!=='+json.dumps(url)+')throw Error("QA focus changed");Application("System Events").keystroke("p",{using:["command down"]});'
  run(['osascript','-l','JavaScript','-e',code],capture_output=True,text=True,check=True);time.sleep(1)
  capture(scale,'diagnostic-'+variant+'-'+str(scale))
