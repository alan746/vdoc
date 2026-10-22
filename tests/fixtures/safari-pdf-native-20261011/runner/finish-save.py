from capture import *
name="diagnostic-root-clipped-101";scale=101;target=output/(name+".pdf");assert not target.exists()
tree=json.loads((out/(name+"-print-settings.json")).read_text());allpages=next(n for n in flatten(tree["focused"]) if n.get("AXRole")=="AXRadioButton" and n.get("AXTitle","").startswith("All "));press={"note":"PDF action succeeded before focus guard stopped; resumed existing Save sheet"}
dialog=ax();items=flatten(dialog['focused']);assert dialog['focused'].get('AXDescription')=='save','Save dialog missing'
assert next(n['AXValue'] for n in items if n.get('AXTitle')=='Where:')=='safari-native-20261011','Wrong output directory'
filename=next(n for n in items if n.get('AXRole')=='AXTextField' and str(n.get('AXValue','')).endswith('.pdf'));assert action('set',filename,name+'.pdf')['returncode']==0
savebutton=next(n for n in items if n.get('AXRole')=='AXButton' and n.get('AXTitle')=='Save');saved=action('press',savebutton)
for _ in range(60):
 if target.exists() and target.stat().st_size>0:break
 time.sleep(.2)
assert target.exists(),'Saved PDF absent; no blind retry'

result={'scale':scale,'file':str(target),'nativePageLabel':allpages['AXTitle'],'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'bytes':target.stat().st_size,'sourceUnchanged':None,'pdfButtonAction':press,'saveAction':saved}
save(name+'-result',result);print(name,allpages['AXTitle'],target.stat().st_size,'bytes',flush=True)
