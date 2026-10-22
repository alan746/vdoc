from helpers import *
command('focus',text='IME test area:');before=state();keys(6,4,31,45,5);candidate=state()
try:
 r=run(['osascript','-l','JavaScript',str(p/'ime-ax.js')],capture_output=True,text=True,check=True);data=json.loads(r.stdout);print(data,flush=True);save('native-candidate-accessibility',{'before':before,'candidate':candidate,'accessibility':data})
finally:
 keys(53);assert state()['snapshot']['document']==before['snapshot']['document'];save('candidate-probe-restored',state())
