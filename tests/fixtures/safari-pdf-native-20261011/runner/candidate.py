from helpers import *
keys(53);command('focus',text='IME test area:');before=state()
try:
 keys(6,4,31,45,5);candidate=state();assert any(e['type']=='compositionupdate' and e['trusted'] for e in candidate['events']),candidate['events']
 r=run([str(p/'candidate-ax')],capture_output=True,text=True,check=True);observed=json.loads(r.stdout);save('focused-native-candidate-probe',{'before':before,'candidate':candidate,'accessibility':observed});print(json.dumps(observed),flush=True)
finally:
 keys(53);assert state()['snapshot']['document']==before['snapshot']['document'];save('candidate-probe-restored',state());print('Candidate canceled; complete document restored',flush=True)
