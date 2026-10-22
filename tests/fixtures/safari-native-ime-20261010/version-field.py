from helpers import *
results=[]
def press(name,key=49):command('focus-control',name=name);keys(key)
def openDialog(field):
 if field=='Header':press('Format');press('Page setup',36)
 else:press('Edit history');press('Saved versions')
try:
 command('reload');time.sleep(1)
 for field in ['Version name']:
  openDialog(field)
  for kind,codes,ending in [('cancel',[8,14,1,4,34],[53]),('space',[6,4,31,45,5],[49]),('enter',[8,14,1,4,34],[36]),('backspace',[6,4,31,45,5],[51,51,49])]:
   command('focus-field',name=field);before=state();prior=before['fields'][field];keys(*codes);candidate=state();assert any(e['type']=='compositionupdate' and e['trusted'] and e.get('target')==field for e in candidate['events']);keys(*ending);after=state();assert field in after['fields'],'IME submitted/closed the dialog';assert any(e['type']=='compositionend' and e['trusted'] for e in after['events']);assert after['snapshot']['document']==before['snapshot']['document'],'Candidate prematurely changed body';assert after['versions']==before['versions'],'Candidate created a version'
   if kind=='cancel':assert after['fields'][field]==prior
   else:assert len(after['fields'][field])>len(prior)
   save(field.replace(' ','-')+'-'+kind,{'before':before,'candidate':candidate,'after':after});results.append({'field':field,'case':kind,'noPrematureSubmit':True,'before':prior,'after':after['fields'][field]});print(field,kind,'passed',flush=True)
  confirmed=state();value=confirmed['fields'][field]
  if field=='Header':press('Apply');assert state()['snapshot']['document']['attrs']['header']==value
  else:
   press('Save current version');time.sleep(.7);assert state()['versions']==[value];assert state()['fields'][field]==''
  saved=state();command('reload');time.sleep(1);restored=state();assert restored['snapshot']['document']==saved['snapshot']['document']
  if field=='Header':assert restored['snapshot']['document']['attrs']['header']==value
  else:openDialog(field);assert state()['versions']==[value];restored=state()
  save(field.replace(' ','-')+'-persisted',{'value':value,'before':confirmed,'saved':saved,'restored':restored});results.append({'field':field,'case':'commit-reload','passed':True});print(field,'commit/reload passed',flush=True)
 if 'Version name' in state()['fields']:keys(53)
except Exception as e:
 results.append({'failure':str(e)});save('dialog-field-failure',state());raise
finally:save('dialog-field-cases',{'results':results,'allPassed':not any('failure' in r for r in results)})
