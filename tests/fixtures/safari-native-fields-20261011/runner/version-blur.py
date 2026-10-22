from helpers import *
def press(name,key=49):command('focus-control',name=name);keys(key)
def click(name):
 command('measure-blur',name=name);point=state()['pointer'];assert time.time()*1000-point['at']<5000
 run(['osascript','-l','JavaScript',str(p/'click.js'),str(point['x']),str(point['y'])],check=True,capture_output=True);time.sleep(.7)
try:
 press('Edit history');press('Saved versions');command('focus-field',name='Version name');before=state();prior=before['fields']['Version name'];keys(6,4,31,45,5);candidate=state();assert any(e['type']=='compositionupdate' and e['trusted'] and e['target']=='Version name' for e in candidate['events'])
 click('dialog-description');blurred=state();assert blurred['snapshot']['document']==before['snapshot']['document'];assert blurred['versions']==before['versions'];assert blurred['fields']['Version name'] in [prior,prior+'zhong',prior+'中'];click('Version name');returned=state()
 ended=any(e['type']=='compositionend' and e['trusted'] and e['target']=='Version name' for e in returned['events'])
 if ended:keys('undo')
 else:keys(53)
 restored=state();assert restored['fields']['Version name']==prior;assert restored['snapshot']['document']==before['snapshot']['document'];assert restored['versions']==before['versions'];save('Version-name-native-blur',{'before':before,'candidate':candidate,'blurred':blurred,'returned':returned,'restored':restored,'compositionEndedBeforeRestoring':ended,'restoration':'native Undo' if ended else 'native Escape cancels retained composition','passed':True});keys(53);print('Version name native click/return/restore passed')
except Exception as e:save('version-blur-failure',{'error':str(e),'state':state()});raise
