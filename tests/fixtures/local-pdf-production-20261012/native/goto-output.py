from capture import *
activate();tree=ax();assert tree.get('focused',{}).get('AXDescription')=='save'
js('Application("System Events").keystroke("g",{using:["command down","shift down"]});');time.sleep(.4)
tree=ax();(P/'goto-folder.json').write_text(json.dumps(tree));print(json.dumps([{k:v for k,v in n.items() if k!='children'} for n in flatten(tree.get('focused',{})) if n.get('AXRole') in ['AXTextField','AXButton','AXComboBox']]))
