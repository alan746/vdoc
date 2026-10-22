from capture import *
command('focus-field',name='Find text')
code='const s=Application("Safari"),p=Application("System Events").processes.byName("Safari");if(s.windows[0].id()!==1713||!p.frontmost()||!s.windows[0].currentTab.url().startsWith("http://127.0.0.1:4188/#document="))throw Error("QA focus changed");const se=Application("System Events");se.keystroke("a",{using:["command down"]});for(const ch of "ROW 36"){se.keystroke(ch);delay(.15)}'
run(['osascript','-l','JavaScript','-e',code],capture_output=True,text=True,check=True);time.sleep(1);s=state();assert s['fields']['Find text']=='ROW 36',s['fields'];assert s['snapshot']['document']==baseline;save('last-row-search-before-print',s)
command('click-control',name='Print')
for _ in range(80):
 s=state()
 if s.get('preview') and len(s['preview'])==5 and any('5 pages' in v for v in s['statuses']):break
 time.sleep(.25)
assert len(s.get('preview') or [])==5;assert 'FINAL PAGE CHECK' in s['preview'][-1]['text']
command('select-control',name='Go to page',value='5');assert state()['selects']['Go to page']=='5';save('last-page-before-combined-print',state())
command('focus-control',name='Print / Save PDF');keys(49);capture(100,'b-search-125-last-page-100')
assert state()['snapshot']['document']==baseline
command('click-control',name='Return to editing');command('open-menu',name='125%');command('click-control',name='100%');save('combined-returned-editing',state())
print('Search ROW36 + editor125 + previewpage5 + native100 actual PDF saved; editor restored100',flush=True)
