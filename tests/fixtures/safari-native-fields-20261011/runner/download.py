from helpers import *
import shutil
before=state();start=time.time();title=before['fields']['Document title']
def newFiles():return [f for f in Path('/Users/ph.qian/Downloads').glob(title+'*.json') if f.stat().st_mtime>=start]
command('focus-control',name='File');keys(49);command('focus-control',name='Download VDoc backup');keys(36);time.sleep(2)
files=newFiles()
if not files:keys(36);time.sleep(2);files=newFiles()
after=state();result={'started':start,'downloaded':bool(files),'title':title,'before':before,'after':after}
if files:
 latest=max(files,key=lambda f:f.stat().st_mtime);backup=json.loads(latest.read_text());assert backup['content']==before['snapshot']['document'];assert backup['title']==title;shutil.copy(latest,out/'native-final-backup.vdoc.json');result.update(path=str(latest),modified=latest.stat().st_mtime,matchedFullDocument=True,matchedTitle=True);print('New actual Safari download:',latest.name,flush=True)
else:print('New download missing; not accepted',flush=True)
if after['snapshot']['document']!=before['snapshot']['document']:
 keys('undo');assert state()['snapshot']['document']==before['snapshot']['document'];result['restoredNativeReturnEdit']=True
result['documentUnchanged']=state()['snapshot']['document']==before['snapshot']['document'];save('final-download-check',result)
assert files,'No new actual downloaded file'
