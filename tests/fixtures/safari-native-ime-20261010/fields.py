from helpers import *
results=[]
try:
 command('reload');time.sleep(1)
 for field in ['Document title','Find text']:
  if field=='Find text':command('focus',text='IME test area:');keys('find')
  for kind,codes,ending in [('cancel',[8,14,1,4,34],[53]),('space',[6,4,31,45,5],[49]),('enter',[8,14,1,4,34],[36]),('backspace',[6,4,31,45,5],[51,51,49])]:
   command('focus-field',name=field);before=state();prior=before['fields'][field];keys(*codes);candidate=state();assert any(e['type']=='compositionupdate' and e['trusted'] and e.get('target')==field for e in candidate['events']);keys(*ending);after=state();assert any(e['type']=='compositionend' and e['trusted'] for e in after['events']);assert after['snapshot']['document']==before['snapshot']['document'],'Field modified body'
   if kind=='cancel':assert after['fields'][field]==prior
   else:assert len(after['fields'][field])>len(prior)
   save(field.replace(' ','-')+'-'+kind,{'before':before,'candidate':candidate,'after':after});results.append({'field':field,'case':kind,'bodyUnchanged':True,'before':prior,'after':after['fields'][field]});print(field,kind,'passed',flush=True)
  confirmed=state();command('reload');time.sleep(1);restored=state();assert restored['snapshot']['document']==confirmed['snapshot']['document'];
  if field=='Document title':assert restored['fields'][field]==confirmed['fields'][field]
  else:assert 'Find text' not in restored['fields']
  save(field.replace(' ','-')+'-persisted',{'before':confirmed,'after':restored});results.append({'field':field,'case':'reload','passed':True});print(field,'reload passed',flush=True)
except Exception as e:
 results.append({'failure':str(e)});save('field-failure',state());raise
finally:save('field-cases',{'results':results,'allPassed':not any('failure' in r for r in results)})
