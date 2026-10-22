from helpers import *
import shutil
before=json.loads((out/'source-imported.json').read_text())['snapshot']['document']
s=state();assert s['snapshot']['document']==before
assert any(e.get('event')=='afterprint' and e.get('trusted') for e in s['protocol'])
assert len(s['preview'])==5
command('click-control',name='Return to editing');assert state()['snapshot']['document']==before
command('focus',text='IME test area:');keys(49)
s=state();assert text(s['snapshot']['document'])==text(before).replace('IME test area: 中文输入测试.','IME test area: 中文输入测试. ',1),'Native edit not at prepared caret'
save('after-cancel-native-edit',s);keys('undo');assert state()['snapshot']['document']==before
save('after-cancel-native-undo',state())
start=time.time();title=state()['fields']['Document title']
command('focus-control',name='File');keys(49);command('focus-control',name='Download VDoc backup');keys(36)
files=[]
for _ in range(60):
 files=[f for f in Path('/Users/ph.qian/Downloads').glob(title+'*.json') if f.stat().st_mtime>=start]
 if files:break
 time.sleep(.2)
assert files,'Download absent; no extra Enter is sent'
f=max(files,key=lambda f:f.stat().st_mtime);backup=json.loads(f.read_text());assert backup['title']==title and backup['content']==before;shutil.copy2(f,out/'native-after-cancel-backup.vdoc.json')
save('after-cancel-download',{'path':str(f),'started':start,'fullContentMatches':True,'titleMatches':True})
prior=state()['snapshot']['sessionId'];keys('reload')
for _ in range(100):
 s=state()
 if s.get('snapshot',{}).get('sessionId') and s['snapshot']['sessionId']!=prior and s['snapshot'].get('document'):break
 time.sleep(.2)
assert s['snapshot']['sessionId']!=prior and s['snapshot']['document']==before
save('after-cancel-reload',s)
print('Native cancel → edit → undo → real backup → reload: complete JSON matches',flush=True)
