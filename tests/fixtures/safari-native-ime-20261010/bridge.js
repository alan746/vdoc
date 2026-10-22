(async()=>{
 const fieldName=e=>e.getAttribute?.('aria-label')||e.closest?.('label')?.textContent.trim()||'';
 const events=[];let last='',working=false;
 for(const name of ['compositionstart','compositionupdate','compositionend','beforeinput','input','keydown','keyup'])document.addEventListener(name,e=>{if(!window.vdoc||!(e.target.closest?.('.document-editor')||e.target.matches?.('input,textarea')))return;events.push({at:Date.now(),type:e.type,data:e.data,key:e.key,inputType:e.inputType,composing:e.isComposing,trusted:e.isTrusted,target:fieldName(e.target)});if(events.length>250)events.shift()},true);
 const button=name=>[...document.querySelectorAll('button,[role="menuitem"]')].find(e=>(e.getAttribute('aria-label')||e.textContent.trim())===name);
 async function command(c){
  if(c.action==='import'){
   const el=document.querySelector('input[aria-label="Import file into library"]');if(!el)throw Error('Import input absent');
   const bytes=await (await fetch('/__qa/fixture')).text(), dt=new DataTransfer();dt.items.add(new File([bytes],'QA Safari native IME.vdoc.json',{type:'application/json'}));el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));
  }else if(c.action==='focus'){
   const body=document.querySelector('.document-editor'),walk=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);let n;
   while(n=walk.nextNode())if(n.textContent.includes(c.text)){body.focus();const r=document.createRange();r.setStart(n,n.textContent.length);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);events.length=0;return;}
   throw Error('Target text absent');
  }else if(c.action==='focus-field'){const el=[...document.querySelectorAll('input,textarea')].find(e=>fieldName(e)===c.name);if(!el)throw Error('Field absent');el.focus();el.setSelectionRange(el.value.length,el.value.length);events.length=0;}
  else if(c.action==='focus-control'){const el=button(c.name);if(!el)throw Error('Control absent');el.focus();}
  else if(c.action==='export-menu'){button('File').click();}
  else if(c.action==='export-backup'){button('Download VDoc backup').click();}
  else if(c.action==='reload'){setTimeout(()=>location.reload(),100);}
  else throw Error('Unknown bounded QA action');
 }
 async function tick(){if(working)return;working=true;try{
  const q=await (await fetch('/__qa/command',{cache:'no-store'})).json();if(q){try{await command(q);await fetch('/__qa/ack',{method:'POST',body:JSON.stringify({id:q.id,ok:true})})}catch(e){await fetch('/__qa/ack',{method:'POST',body:JSON.stringify({id:q.id,ok:false,error:String(e)})})}}
  const state={url:location.href,title:document.title,visibility:document.visibilityState,active:document.activeElement?.getAttribute('aria-label'),snapshot:window.vdoc?.snapshot(),save:[...document.querySelectorAll('.save-indicator,.save-status')].map(e=>e.textContent),selection:getSelection()?.toString(),fields:Object.fromEntries([...document.querySelectorAll('input:not([type=file]),textarea')].map(e=>[fieldName(e),e.value])),versions:[...document.querySelectorAll('.local-documents strong')].map(e=>e.textContent),dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>e.textContent.slice(0,100)),menus:[...document.querySelectorAll('[role=menuitem]')].map(e=>e.textContent),events};
  const encoded=JSON.stringify(state);if(encoded!==last){await fetch('/__qa/state',{method:'POST',body:encoded});last=encoded}
 }finally{working=false}}setInterval(tick,300);tick();
})();
