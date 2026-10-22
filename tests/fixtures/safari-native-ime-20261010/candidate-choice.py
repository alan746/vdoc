from helpers import *
results=[]
try:
 for group,target in [('body','IME test area:'),('list','Verify Chinese candidate selection'),('table','ROW 03 —')]:
  command('focus',text=target);before=state()['snapshot']['document'];keys(6,4,31,45,5);keys(125,124,49);s=state();commits=[e.get('data') for e in s['events'] if e['type']=='compositionend'];assert len(commits)==1;assert shape(s['snapshot']['document'])==shape(before);assert len(text(s['snapshot']['document']))==len(text(before))+len(commits[0]);save(group+'-alternate-candidate',s);keys('undo');assert state()['snapshot']['document']==before;results.append({'group':group,'commit':commits[0],'differentFromPreviouslyObservedDefault':commits[0]!='中','exactUndo':True});print(group,commits,flush=True)
finally:save('candidate-choices',{'results':results})
