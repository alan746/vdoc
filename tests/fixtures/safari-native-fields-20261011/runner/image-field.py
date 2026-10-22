from helpers import *
import copy
results=[]
def press(name,key=49):command('focus-control',name=name);keys(key)
def images(n):
 return ([n] if n.get('type')=='image' else [])+sum((images(c) for c in n.get('content',[])),[])
try:
 command('reload');time.sleep(1);baseline=state()['snapshot']['document']
 command('select-image');press('Insert');press('Image properties',36)
 field='Alternative text'
 for kind,codes,ending in [('cancel',[8,14,1,4,34],[53]),('space',[6,4,31,45,5],[49]),('enter',[8,14,1,4,34],[36]),('backspace',[6,4,31,45,5],[51,51,49])]:
  command('focus-field',name=field);before=state();prior=before['fields'][field];keys(*codes);candidate=state();assert any(e['type']=='compositionupdate' and e['trusted'] and e.get('target')==field for e in candidate['events']);keys(*ending);after=state();assert field in after['fields'],'IME submitted/closed dialog';assert any(e['type']=='compositionend' and e['trusted'] for e in after['events']);assert after['snapshot']['document']==baseline,'IME prematurely changed image'
  if kind=='cancel':assert after['fields'][field]==prior
  else:assert len(after['fields'][field])>len(prior)
  save('Image-'+kind,{'before':before,'candidate':candidate,'after':after});results.append({'field':field,'case':kind,'passed':True,'noPrematureSubmit':True,'before':prior,'after':after['fields'][field]});print('Image',kind,'passed',flush=True)
 confirmed=state();value=confirmed['fields'][field];expected=copy.deepcopy(baseline);images(expected)[0]['attrs']['alt']=value
 press('Apply');saved=state();assert saved['snapshot']['document']==expected,'Unexpected image edit'
 keys('undo');assert state()['snapshot']['document']==baseline,'Image Undo mismatch'
 keys('redo');assert state()['snapshot']['document']==expected,'Image Redo mismatch'
 command('reload');time.sleep(1);restored=state();assert restored['snapshot']['document']==expected
 command('select-image');press('Insert');press('Image properties',36);assert state()['fields'][field]==value
 save('Image-persisted',{'value':value,'baseline':baseline,'before':confirmed,'saved':saved,'restored':restored,'reopened':state()});results.append({'field':field,'case':'apply-undo-redo-reload-reopen','passed':True});print('Image apply/Undo/Redo/reload/reopen passed',flush=True);keys(53)
except Exception as e:results.append({'failure':str(e)});save('image-field-failure',state());raise
finally:save('image-field-cases',{'results':results,'allPassed':not any('failure' in r for r in results)})
