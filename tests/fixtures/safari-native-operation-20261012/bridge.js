// Only this fixed QA fixture and four fixed actions are accepted.
(()=>{
 if(window!==window.top||window.__vdocNativeOperationBridge)return;
 window.__vdocNativeOperationBridge=true;
 const completed=new Map();
 const events=[];let busy=false,before=null,request=null;
 for(const type of ['compositionstart','compositionupdate','compositionend'])document.addEventListener(type,e=>{
  events.push({type:e.type,trusted:e.isTrusted,target:e.target.getAttribute('aria-label'),data:e.data,at:Date.now()});
  if(events.length>100)events.shift();
 },true);
 const send=(route,value)=>fetch(qaPrefix+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
 const state=()=>({at:Date.now(),ready:!!window.vdoc,snapshot:window.vdoc?.snapshot(),title:document.querySelector('[aria-label="Document title"]')?.value,active:document.activeElement?.getAttribute('aria-label'),events:[...events]});
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const wait=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await pause(100)}throw Error('QA wait timed out')};
 async function run(action){
  if(action==='bootstrap'){
   await wait(()=>document.querySelector('input[aria-label="Import file into library"]:not(:disabled)'));
   const importButton=document.querySelector('input[aria-label="Import file into library"]');
   if(!importButton)throw Error('Expected untouched QA library');
   const fixture=await(await fetch(qaPrefix+'/fixture')).text(),data=new DataTransfer();
   data.items.add(new File([fixture],'native-operation.vdoc.json',{type:'application/json'}));
   importButton.files=data.files;importButton.dispatchEvent(new Event('change',{bubbles:true}));
   await wait(()=>!!window.vdoc);return {fixtureImported:true};
  }
  if(!window.vdoc)throw Error('No owned document ready');
  const api=window.vdoc;
  if(action==='prepare'){
   before=api.snapshot();const target=before.blocks.find(b=>b.type==='paragraph');
   const seed=api.execute({id:'native-guard-seed',expectedSessionId:before.sessionId,expectedRevision:before.revision,target:{kind:'block',id:target.id},operations:[{type:'text.style',style:{italic:true}}]});
   if(!seed.ok)throw Error('Cannot seed history');
   const s=api.snapshot();request={id:'native-guard-operation',expectedSessionId:s.sessionId,expectedRevision:s.revision,target:{kind:'block',id:target.id},operations:[{type:'text.style',style:{bold:true}}]};
   const title=document.querySelector('[aria-label="Document title"]');title.focus();title.setSelectionRange(title.value.length,title.value.length);events.length=0;
   return {before,prepared:s,title:title.value};
  }
  if(action==='attempt'){
   const beforeAttempt=api.snapshot();const edit=api.execute(request),undo=api.undo(),redo=api.redo();
   return {before:beforeAttempt,edit,undo,redo,after:api.snapshot(),active:document.activeElement?.getAttribute('aria-label')};
  }
  if(action==='retry-and-restore'){
   const applied=api.execute(request),after=api.snapshot();const undo=api.undo(),undoSeed=api.undo();
   return {applied,after,undo,undoSeed,restored:api.snapshot(),original:before};
  }
  throw Error('Unknown bounded action');
 }
 setInterval(async()=>{
  if(busy)return;busy=true;
  try{
   const c=await(await fetch(qaPrefix+'/command',{cache:'no-store'})).json();
   if(c){let ack=completed.get(c.id);if(!ack){try{const result=await run(c.action);ack={id:c.id,ok:true,result}}catch(e){ack={id:c.id,ok:false,error:String(e)}}completed.set(c.id,ack)}await send('/ack',ack)}
   await send('/state',state());
  }catch(e){try{await send('/state',{at:Date.now(),bridgeError:String(e)})}catch{}}finally{busy=false}
 },300);
})();
