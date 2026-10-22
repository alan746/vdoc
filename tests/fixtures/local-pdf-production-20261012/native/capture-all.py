from capture import *
def save_existing(value,press):
 name=f'local-production-{value}';target=OUTPUT/(name+'.pdf');assert not target.exists(),'Refuse overwrite'
 tree=ax();nodes=flatten(tree['focused']);assert tree['focused'].get('AXDescription')=='save'
 assert next(n['AXValue'] for n in nodes if n.get('AXTitle')=='Where:')==OUTPUT.name
 field=next(n for n in nodes if n.get('AXRole')=='AXTextField' and str(n.get('AXValue','')).endswith('.pdf'))
 result=action('set',field,name+'.pdf');assert result['exit']==0,result
 tree=ax();nodes=flatten(tree['focused']);assert any(n.get('AXValue')==name+'.pdf' for n in nodes)
 button=next(n for n in nodes if n.get('AXRole')=='AXButton' and n.get('AXTitle')=='Save');saved=action('press',button)
 previous=None
 for _ in range(50):
  if target.exists():
   data=target.read_bytes();digest=hashlib.sha256(data).hexdigest()
   if data.startswith(b'%PDF-') and b'%%EOF' in data[-1024:] and digest==previous:break
   previous=digest
  time.sleep(.2)
 else:raise RuntimeError('Complete PDF did not appear; no blind retry')
 report={'scale':value,'file':str(target),'bytes':len(data),'sha256':digest,'pdfAction':press,'saveAction':saved};(P/f'result-{value}.json').write_text(json.dumps(report,indent=2));print(json.dumps(report),flush=True)
activate()
# The Go to Folder sheet was inspected and shows this exact workspace directory.
tree=ax();nodes=flatten(tree['focused']);field=next(n for n in nodes if n.get('AXRole')=='AXTextField' and n.get('AXValue')==str(OUTPUT));assert field
js('Application("System Events").keyCode(36);');time.sleep(.4)
save_existing(100,{'exit':1,'observedSaveDialog':True,'note':'AX timeout returned after save panel opened; action was not repeated.'})
for value in [93,99,101,102]:
 open_print();_,press=start_save(value);save_existing(value,press)
open_print();nodes=scale(100);cancel=next(n for n in nodes if n.get('AXRole')=='AXButton' and n.get('AXTitle')=='Cancel');r=action('press',cancel);assert r['exit']==0,r
(P/'restored-100.json').write_text(json.dumps({'scale':100,'cancel':r}))
print('All five outputs saved; native scaling restored to 100%.',flush=True)
