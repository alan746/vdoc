from helpers import *
import shutil
before=state()['snapshot']['document'];command('focus-control',name='File');keys(49);command('focus-control',name='Download VDoc backup');keys(36)
time.sleep(1)
files=list(Path('/Users/ph.qian/Downloads').glob('QA Safari native IME 20261010*.vdoc.json'))
if not files:
 keys(36);time.sleep(1);files=list(Path('/Users/ph.qian/Downloads').glob('QA Safari native IME 20261010*.vdoc.json'))
if files:
 latest=max(files,key=lambda f:f.stat().st_mtime);backup=json.loads(latest.read_text());assert backup['content']==before;shutil.copy(latest,out/'native-downloaded-backup.vdoc.json');print('Actual Safari download:',latest.name,flush=True)
else:print('No matching downloaded backup; not accepted',flush=True)
after=state()['snapshot']['document']
if after!=before:
 keys('undo');assert state()['snapshot']['document']==before;print('Restored reversible QA document change caused by Return')
save('download-check',{'downloaded':bool(files),'matchedSource':bool(files),'fullJSONUnchanged':state()['snapshot']['document']==before})
