const safari=Application('Safari');
if(safari.windows[0].id()!==1594) throw Error('Not owned VDoc window');
const se=Application('System Events'),proc=se.processes.byName('Safari'),out=[];if(!proc.frontmost())throw Error('Safari not frontmost');
function read(e,key){try{return e[key]();}catch{return null;}}
function walk(e,path,depth){
 if(depth>16||out.length>=240)return;
 const role=read(e,'role'),value=read(e,'value');
 out.push({path,role,name:read(e,'name'),description:read(e,'description'),value:typeof value==='string'?value.slice(0,100):value});
 if(['AXOutline','AXTable','AXBrowser'].includes(role))return;
 let kids=[];try{kids=e.uiElements();}catch{}
 kids.forEach((kid,i)=>walk(kid,path+'.'+i,depth+1));
}
const root=proc.windows[0],children=root.uiElements();
const sheets=children.map((e,i)=>({e,i})).filter(x=>read(x.e,'role')==='AXSheet');
if(sheets.length)sheets.forEach(x=>walk(x.e,'window.'+x.i,0));
else walk(root,'window',0);
JSON.stringify(out);
