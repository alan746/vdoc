from helpers import *
import copy
results=[]
def press(name,key=49):command('focus-control',name=name);keys(key)
def nativeClick(name):
 command('measure-blur',name=name);point=state()['pointer'];assert time.time()*1000-point['at']<5000
 subprocess.run(['osascript','-l','JavaScript',str(p/'click.js'),str(point['x']),str(point['y'])],check=True,capture_output=True);time.sleep(1)
try:
 command('reload');time.sleep(1)
 baseline=state()['snapshot']['document']
 for label,target in []:
  command('focus',text=target);before=state();keys(6,4,31,45,5);candidate=state();assert any(e['type']=='compositionupdate' and e['trusted'] for e in candidate['events']);nativeClick('Document title');blurred=state();ends=[e for e in blurred['events'] if e['type']=='compositionend' and e['trusted']];assert ends,'Native click did not end composition';raw=[e.get('data','') for e in candidate['events'] if e['type']=='compositionupdate'][-1];options=[ends[-1].get('data',''),raw,''];actual=None
  for option in options:
   expected=copy.deepcopy(baseline)
   def append(n):
    if target in n.get('text',''):n['text']+=option
    for c in n.get('content',[]):append(c)
   append(expected)
   if blurred['snapshot']['document']==expected:actual=option;break
  assert actual is not None,'Blur content not equal to one native commit/cancel' 
  command('focus',text=target)
  if actual:keys('undo')
  restored=state();assert restored['snapshot']['document']==baseline,'Blur Undo mismatch'
  save(label+'-native-blur',{'before':before,'candidate':candidate,'blurred':blurred,'restored':restored});results.append({'field':label,'case':'native-click-blur-and-undo','committed':actual,'passed':True});print(label,'native click/blur/Undo passed',flush=True)
 for field in ['Header','Alternative text','Version name']:
  if field=='Find text':command('focus',text='IME test area:');keys('find')
  elif field=='Header':press('Format');press('Page setup',36)
  elif field=='Alternative text':command('select-image');press('Insert');press('Image properties',36)
  elif field=='Version name':press('Edit history');press('Saved versions')
  command('focus-field',name=field);before=state();prior=before['fields'][field];keys(6,4,31,45,5);candidate=state();assert any(e['type']=='compositionupdate' and e['trusted'] and e.get('target')==field for e in candidate['events']);nativeClick('Font size (px)' if field=='Document title' else 'Document title' if field=='Find text' else 'dialog-description');blurred=state();ends=[e for e in blurred['events'] if e['type']=='compositionend' and e['trusted'] and e.get('target')==field];assert ends,'Native click did not end composition';raw=[e.get('data','') for e in candidate['events'] if e['type']=='compositionupdate'][-1];actual=blurred['fields'][field][len(prior):];assert blurred['fields'][field].startswith(prior);assert actual in [ends[-1].get('data',''),raw,''];assert blurred['snapshot']['document']==baseline;assert blurred['versions']==before['versions']
  command('focus-field',name=field)
  if actual:keys('undo')
  restored=state();assert restored['fields'][field]==prior;assert restored['snapshot']['document']==baseline
  save(field.replace(' ','-')+'-native-blur',{'before':before,'candidate':candidate,'blurred':blurred,'restored':restored});results.append({'field':field,'case':'native-click-blur-and-undo','committed':actual,'passed':True});print(field,'native click/blur/Undo passed',flush=True)
  if field=='Document title':command('focus',text='IME test area:')
  else:keys(53)
 command('reload');time.sleep(1);assert state()['snapshot']['document']==baseline;save('blur-final-restored',state())
except Exception as e:results.append({'failure':str(e)});save('blur-failure',state());raise
finally:save('blur-cases',{'results':results,'allPassed':not any('failure' in r for r in results)})
