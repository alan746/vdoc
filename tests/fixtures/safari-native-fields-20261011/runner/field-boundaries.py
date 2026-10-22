from helpers import *
results=[]
def press(name,key=49):command('focus-control',name=name);keys(key)
def openField(field):
 if field=='Find text':command('focus',text='IME test area:');keys('find')
 elif field=='Header':press('Format');press('Page setup',36)
 elif field=='Alternative text':command('select-image');press('Insert');press('Image properties',36)
 elif field=='Version name':press('Edit history');press('Saved versions')
def closeField(field):
 if field=='Document title':command('focus',text='IME test area:')
 else:keys(53)
try:
 command('reload');time.sleep(1)
 for field in ['Document title','Find text','Header','Alternative text','Version name']:
  openField(field);command('focus-field',name=field);before=state();prior=before['fields'][field]
  keys(6,4,31,45,5);candidate=state();assert any(e['type']=='compositionupdate' and e['trusted'] and e.get('target')==field for e in candidate['events'])
  keys(125,124,49);selected=state();value=selected['fields'][field];assert value==prior+'🀄️',repr(value);assert selected['snapshot']['document']==before['snapshot']['document'];assert selected['versions']==before['versions']
  keys('undo');undone=state();assert undone['fields'][field]==prior,('Undo',field,undone['fields'][field],prior)
  keys('redo');redone=state();assert redone['fields'][field]==value,('Redo',field,redone['fields'][field],value)
  keys('undo');restored=state();assert restored['fields'][field]==prior;assert restored['snapshot']['document']==before['snapshot']['document']
  save(field.replace(' ','-')+'-alternate-history',{'before':before,'candidate':candidate,'selected':selected,'undone':undone,'redone':redone,'restored':restored});results.append({'field':field,'case':'alternate-candidate-native-undo-redo-restore','passed':True});print(field,'alternate + Undo/Redo/restore passed',flush=True)
  closeField(field)
 command('reload');time.sleep(1);save('fields-final-restored',state())
except Exception as e:results.append({'failure':str(e)});save('field-boundary-failure',state());raise
finally:save('field-boundary-cases',{'results':results,'allPassed':not any('failure' in r for r in results)})
