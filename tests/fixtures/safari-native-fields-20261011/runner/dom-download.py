import json,time,uuid,shutil
from pathlib import Path
p=Path('tmp/safari-native-fields');out=Path('tests/fixtures/safari-native-fields-20261011')
def state():return json.loads((p/'state.json').read_text())
def cmd(action,**kw):
 assert state()['url']=='http://127.0.0.1:4185/#document=6bf28ea4-1e4b-46ec-84c0-095108f2f267'
 prior=state().get('snapshot',{}).get('sessionId')
 c={'id':str(uuid.uuid4()),'action':action,**kw};(p/'command.json').write_text(json.dumps(c));start=time.monotonic()
 while time.monotonic()-start<10:
  a=json.loads((p/'ack.json').read_text())
  if a.get('id')==c['id']:
   assert a['ok'],a;time.sleep(.6)
   if action=='reload':
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
     now=state();session=now.get('snapshot',{}).get('sessionId')
     if session and session!=prior and now.get('snapshot',{}).get('document') and 'Document title' in now.get('fields',{}):return
     time.sleep(.2)
    raise TimeoutError('Reload did not produce a new ready editor')
   return
  time.sleep(.1)
 raise TimeoutError('No own-origin acknowledgement')
if __name__=='__main__':
 cmd('reload');time.sleep(1);before=state();title=before['fields']['Document title'];start=time.time();cmd('open-menu',name='File');assert 'Download VDoc backup' in state()['menus'];cmd('click-control',name='Download VDoc backup');time.sleep(2)
 files=[f for f in Path('/Users/ph.qian/Downloads').glob(title+'*.json') if f.stat().st_mtime>=start];result={'method':'Normal product menu download via bounded DOM pointer/click preparation in own Safari origin; no synthetic composition', 'started':start,'downloaded':bool(files),'before':before,'after':state()}
 if files:
  f=max(files,key=lambda f:f.stat().st_mtime);data=json.loads(f.read_text());assert data['content']==before['snapshot']['document'];assert data['title']==title;assert state()['snapshot']['document']==before['snapshot']['document'];shutil.copy(f,out/'native-final-backup.vdoc.json');result.update(path=str(f),modified=f.stat().st_mtime,matchedFullDocument=True,matchedTitle=True);print('New actual Safari download:',f.name)
 else:print('No new downloaded file yet; not accepted')
 (out/'final-download-check.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
