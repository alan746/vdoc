from helpers import *
command('click-control',name='Print')
for _ in range(60):
 s=state()
 if s.get('preview') and len(s['preview'])==5 and any('5 pages' in v for v in s['statuses']):break
 time.sleep(.25)
assert len(s.get('preview') or [])==5,s.get('statuses');assert 'FINAL PAGE CHECK' in s['preview'][-1]['text'];save('post-reload-first-preview',s);print('First preview after reload: five complete pages',flush=True)
