(async()=>{
 if(location.pathname==='/print-preview'){
  for(const name of ['beforeprint','afterprint'])addEventListener(name,e=>parent.postMessage({type:'qa-native-print-event',event:name,trusted:e.isTrusted,at:Date.now()},location.origin));
  return;
 }
 if(location.pathname!=='/')return;
 document.title='VDoc isolated native print 4187';
 const protocol=[];
 addEventListener('message',e=>{const frame=document.querySelector('iframe[title="Paginated document preview"]');if(e.origin!==location.origin||e.source!==frame?.contentWindow)return;if(e.data?.type?.startsWith('vdoc-preview-')||e.data?.type==='qa-native-print-event')protocol.push({at:Date.now(),...e.data})});
 const fieldName=e=>e.getAttribute?.('aria-label')||e.closest?.('label')?.textContent.trim()||'';
 const errors=[];addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));addEventListener('error',e=>errors.push(e.message));const events=[];let last='',working=false,pointer=null;
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
  }else if(c.action==='select-image'){const el=document.querySelector('.document-editor img');if(!el)throw Error('Image absent');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect(),args={bubbles:true,button:0,clientX:r.left+r.width/2,clientY:r.top+r.height/2};el.dispatchEvent(new MouseEvent('mousedown',args));el.dispatchEvent(new MouseEvent('mouseup',args));el.dispatchEvent(new MouseEvent('click',args));}
  else if(c.action==='focus-field'){const el=[...document.querySelectorAll('input,textarea')].find(e=>fieldName(e)===c.name);if(!el)throw Error('Field absent');el.focus();el.setSelectionRange(el.value.length,el.value.length);events.length=0;}
  else if(c.action==='measure-blur'){const el=c.name==='dialog-description'?document.querySelector('[data-slot=dialog-description]'):[...document.querySelectorAll('input,textarea')].find(e=>fieldName(e)===c.name);if(!el)throw Error('Blur target absent');const r=el.getBoundingClientRect();if(r.width<1||r.height<1)throw Error('Blur target invisible');pointer={at:Date.now(),name:c.name,x:screenX+r.left+r.width/2,y:screenY+outerHeight-innerHeight+r.top+r.height/2,screenX,screenY,outerHeight,innerHeight,outerWidth,innerWidth,rect:{left:r.left,top:r.top,width:r.width,height:r.height}};}
  else if(c.action==='open-menu'){const el=button(c.name);if(!el)throw Error('Menu absent');el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'}));}
  else if(c.action==='click-control'){const el=button(c.name);if(!el||el.disabled)throw Error('Control unavailable');el.click();}
  else if(c.action==='click-version'){const el=[...document.querySelectorAll('.local-documents button')].find(e=>e.querySelector('strong')?.textContent===c.name);if(!el)throw Error('Version absent');el.click();}
  else if(c.action==='focus-version'){const el=[...document.querySelectorAll('.local-documents button')].find(e=>e.querySelector('strong')?.textContent===c.name);if(!el)throw Error('Version absent');el.focus();}
  else if(c.action==='focus-control'){const el=button(c.name);if(!el)throw Error('Control absent');el.focus();}
  else if(c.action==='export-menu'){button('File').click();}
  else if(c.action==='export-backup'){button('Download VDoc backup').click();}
  else if(c.action==='reload'){setTimeout(()=>location.reload(),100);}
  else throw Error('Unknown bounded QA action');
 }
 async function tick(){document.title='VDoc isolated native print 4187';if(working)return;working=true;try{
  const q=await (await fetch('/__qa/command',{cache:'no-store',signal:AbortSignal.timeout(4000),headers:{'x-vdoc-qa-owner':'print-capture-4187'}})).json();if(q){try{await command(q);await fetch('/__qa/ack',{method:'POST',body:JSON.stringify({id:q.id,ok:true})})}catch(e){await fetch('/__qa/ack',{method:'POST',body:JSON.stringify({id:q.id,ok:false,error:String(e)})})}}
  const frameDoc=document.querySelector('iframe[title="Paginated document preview"]')?.contentDocument;const state={errors,at:Date.now(),protocol,preview:frameDoc?[...frameDoc.querySelectorAll('.pagedjs_page')].map(p=>({text:p.innerText,images:[...p.querySelectorAll('img')].map(i=>({complete:i.complete,width:i.naturalWidth})),})):null,statuses:[...document.querySelectorAll('[role=status],[role=alert]')].map(e=>e.textContent),pointer,url:location.href,title:document.title,visibility:document.visibilityState,active:document.activeElement?.getAttribute('aria-label'),snapshot:window.vdoc?.snapshot(),save:[...document.querySelectorAll('.save-indicator,.save-status')].map(e=>e.textContent),selection:getSelection()?.toString(),fields:Object.fromEntries([...document.querySelectorAll('input:not([type=file]),textarea')].map(e=>[fieldName(e),e.value])),versions:[...document.querySelectorAll('.local-documents strong')].map(e=>e.textContent),dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>e.textContent.slice(0,100)),menus:[...document.querySelectorAll('[role=menuitem]')].map(e=>e.textContent),events};
  const encoded=JSON.stringify(state);if(encoded!==last){await fetch('/__qa/state',{method:'POST',body:encoded});last=encoded}
 }catch(e){errors.push(String(e));try{await fetch('/__qa/state',{method:'POST',body:JSON.stringify({at:Date.now(),url:location.href,title:document.title,errors})})}catch{}}finally{working=false}}setInterval(tick,300);tick();
})();
