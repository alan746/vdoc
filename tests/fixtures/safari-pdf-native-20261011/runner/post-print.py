from helpers import *
import shutil
baseline=json.loads((out/'source-before-scale-matrix.vdoc.json').read_text())['content']
assert state()['snapshot']['document']==baseline
command('focus',text='IME test area:');before=state();keys(49);edited=state();assert text(edited['snapshot']['document'])!=text(baseline);assert shape(edited['snapshot']['document'])==shape(baseline)
keys('undo');assert state()['snapshot']['document']==baseline;save('post-pdf-edit-undo',{'before':before,'edited':edited,'restored':state()});print('Native edit + Undo restored exact JSON',flush=True)
start=time.time();command('open-menu',name='File');command('click-control',name='Download VDoc backup');time.sleep(1)
title=state()['fields']['Document title'];files=[f for f in Path('/Users/ph.qian/Downloads').glob(title+'*.json') if f.stat().st_mtime>=start];assert files,'No new actual Safari backup'
f=max(files,key=lambda f:f.stat().st_mtime);data=json.loads(f.read_text());assert data['content']==baseline;shutil.copy2(f,out/'source-after-scale-matrix.vdoc.json');save('post-pdf-download',{'path':str(f),'started':start,'fullContentMatched':True,'titleMatched':data['title']==title});print('Actual Safari backup matched',flush=True)
command('reload');time.sleep(1);assert state()['snapshot']['document']==baseline;save('post-pdf-reloaded',state());print('Reload exact JSON matched',flush=True)
command('click-control',name='Print / Save PDF')
for _ in range(60):
 s=state()
 if s.get('preview') and len(s['preview'])==5 and any('5 pages' in v for v in s['statuses']):break
 time.sleep(.25)
assert len(s.get('preview') or [])==5,s.get('statuses');assert 'FINAL PAGE CHECK' in s['preview'][-1]['text'];save('post-reload-first-preview',s);print('First preview after reload: five complete pages',flush=True)
