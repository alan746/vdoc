from helpers import *
def press(name,key=49):command('focus-control',name=name);keys(key)
checkpoint=json.loads((out/'Version-name-persisted.json').read_text());value=checkpoint['value'];expected=checkpoint['saved']['snapshot']['document']
command('reload');time.sleep(.5);before=state();press('Edit history');press('Saved versions');assert state()['versions']==[value]
command('focus-version',name=value);keys(49);time.sleep(1);restored=state();assert restored['snapshot']['document']==expected,'Named version restore changed data';assert not restored['dialogs'];command('reload');time.sleep(.5);reloaded=state();assert reloaded['snapshot']['document']==expected;assert reloaded['fields']['Document title']==before['fields']['Document title']
press('Edit history');press('Saved versions');versions=state()['versions'];assert len(versions)==2 and versions.count(value)==1,versions;save('named-version-baseline-restore',{'before':before,'checkpoint':value,'restored':restored,'reloaded':reloaded,'versionsAfterRestore':versions,'passed':True});keys(53);print('Named version restore, automatic safety checkpoint and full reload passed',flush=True)
