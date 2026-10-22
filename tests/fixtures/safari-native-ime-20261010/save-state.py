import json,sys,time
from pathlib import Path
p=Path('tmp/safari-native-bridge/state.json');out=Path('tests/fixtures/safari-native-ime-20261010')
time.sleep(.8);x=json.loads(p.read_text());(out/(sys.argv[1]+'.json')).write_text(json.dumps(x,ensure_ascii=False,indent=2));text=lambda n:n.get('text','')+''.join(map(text,n.get('content',[])))
print('save:',x['save']);print('IME paragraph:',[text(n) for n in x['snapshot']['document']['content'] if 'IME test area' in text(n)]);print('recent events:',json.dumps(x['events'][-5:],ensure_ascii=False))
