/** Local QA prototype. Not shipped in the browser and not a production PDF endpoint.
 * Uses an isolated browser profile and a supplied local VDoc fixture; never reads
 * the user's open browser or sends document content to external services.
 */
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const runtime=process.env.VDOC_PLAYWRIGHT_MODULE;
if(!runtime)throw Error('Set VDOC_PLAYWRIGHT_MODULE to the installed Playwright module path');
const {chromium}=createRequire(__filename)(runtime);
const [fixtureArg,outputArg]=process.argv.slice(2);
if(!fixtureArg||!outputArg)throw Error('Usage: render-prototype.cjs fixture.vdoc.json output.pdf');
const fixture=path.resolve(fixtureArg),output=path.resolve(outputArg),base=process.env.VDOC_QA_URL||'http://localhost:5173/';
const url=new URL(base);if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Only a loopback VDoc QA origin is allowed');
// QA only: register script-specific fallback faces before measuring text.
// The production app is untouched; font choice still needs a shipping policy.
function installEarlyFaces(faces){
 const state={started:performance.now(),loaded:null,error:null,atRender:null,firstPage:null};
 window.__vdocFontDiagnostic=state;
 const registeredFaces=faces.map(f=>{
  const face=new FontFace(f.name,f.src,{unicodeRange:f.range,weight:'400'});
  document.fonts.add(face);return face;
 });
 const pending=registeredFaces.map(face=>face.load());
 window.addEventListener('message',event=>{
  if(event.source!==parent||event.origin!==location.origin||event.data?.type!=='vdoc-preview-render')return;
  // A preview initialized in about:blank can replace its Document while keeping
  // the Window. Reattach the loaded faces and observer to the actual document.
  registeredFaces.forEach(face=>document.fonts.add(face));
  const style=document.createElement('style');
  style.textContent='html body,html body * {font-family:'+faces.map(f=>JSON.stringify(f.name)).join(',')+',Arial,sans-serif !important;}';
  document.head.append(style);
  state.atRender={at:performance.now(),loaded:state.loaded,status:document.fonts.status,faces:registeredFaces.map(face=>({present:document.fonts.has(face),status:face.status}))};
  const observer=new MutationObserver(()=>{
   if(document.querySelector('.pagedjs_page')){state.firstPage={at:performance.now(),fonts:document.fonts.status};observer.disconnect();}
  });
  observer.observe(document,{childList:true,subtree:true});
 });
 return Promise.all(pending).then(()=>{state.loaded=performance.now();return state;},error=>{state.error=String(error);throw error;});
}
function measurePages(){
 return [...document.querySelectorAll('#preview-pages .pagedjs_page')].map(page=>{
  const origin=page.getBoundingClientRect();
  return [...page.querySelectorAll('p,h1,h2,h3,h4,h5,h6,tr,td,th,img')].map(el=>{
   const r=el.getBoundingClientRect(),s=getComputedStyle(el);
   return {tag:el.tagName,text:el.textContent,box:[r.x-origin.x,r.y-origin.y,r.width,r.height],font:[s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight]};
  });
 });
}
(async()=>{
 const source=JSON.parse(await fs.readFile(fixture,'utf8'));
 assert(source.version===1&&source.content?.type==='doc','Expected VDoc fixture');
 const devanagariFont=process.env.VDOC_QA_DEVANAGARI_FONT||null;
 const cjkFont=process.env.VDOC_QA_CJK_FONT||null;
 const fontPhase=process.env.VDOC_QA_FONT_PHASE||'after-pagination';
 assert(['before-pagination','after-pagination'].includes(fontPhase),'Invalid diagnostic font phase');
 if(fontPhase==='before-pagination'){
  const check=value=>{
   if(!value||typeof value!=='object')return;
   assert(value.type!=='codeBlock','Early font diagnostic does not support monospace code blocks');
   assert(!value.fontFamily||value.fontFamily==='Arial','Early font diagnostic only supports Arial fixtures; do not replace user font choices');
   Object.values(value).forEach(check);
  };
  check(source.content);
 }
 const fontPath=process.env.VDOC_QA_DEVANAGARI_FILE;
 assert(!(devanagariFont&&fontPath),'Choose a local font name or a font file, not both');
 const fontBytes=fontPath?await fs.readFile(path.resolve(fontPath)):null;
 const earlyFaces=[];
 if(devanagariFont||fontBytes)earlyFaces.push({name:'VDoc QA Early Devanagari',src:fontBytes?'url("data:font/ttf;base64,'+fontBytes.toString('base64')+'")':'local('+JSON.stringify(devanagariFont)+')',range:'U+0900-097F'});
 if(cjkFont)earlyFaces.push({name:'VDoc QA Early CJK',src:'local('+JSON.stringify(cjkFont)+')',range:'U+3000-30FF,U+3400-9FFF,U+F900-FAFF,U+FF00-FFEF'});
 assert(fontPhase!=='before-pagination'||devanagariFont||fontBytes||cjkFont,'Early font mode requires a diagnostic font');
 await fs.access(output).then(()=>{throw Error('Refuse to overwrite output')},e=>{if(e.code!=='ENOENT')throw e});
 await fs.mkdir(path.dirname(output),{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.VDOC_CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--renderer-process-limit=2']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});const blocked=[];
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(['data:','blob:','about:'].includes(u.protocol)||u.origin===url.origin)return route.continue();blocked.push(u.origin);return route.abort();});
 // Chromium may initialize this iframe while its location is still about:blank.
 // The isolated VDoc session only creates the preview child frame. Assert its
 // final URL and the loaded-before-first-page trace before accepting any PDF.
 if(fontPhase==='before-pagination')await context.addInitScript({content:'if(window!==window.top){('+installEarlyFaces.toString()+')('+JSON.stringify(earlyFaces)+').catch(()=>{}); }'});
 const page=await context.newPage();page.setDefaultTimeout(15000);
 try{
  await page.goto(base);await page.getByLabel('Import file into library').setInputFiles(fixture);
  await page.getByRole('textbox',{name:'Document body',exact:true}).waitFor();
  const before=await page.evaluate(()=>window.vdoc.snapshot().document);
  const normalize=v=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>k!=='blockId').map(([k,x])=>[k,normalize(x)])):v;
  assert.deepEqual(normalize(before),normalize(source.content));
  await page.getByRole('button',{name:'Print',exact:true}).click();
  await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Print / Save PDF');return b&&!b.disabled},null,{timeout:65000});
  const frame=page.frames().find(f=>new URL(f.url()).pathname==='/print-preview');assert(frame,'Preview frame absent');
  const snapshot=await frame.evaluate(async()=>{
   await document.fonts.ready;
   const host=document.querySelector('#preview-pages');if(!host)throw Error('Pages absent');
   const pages=[...host.querySelectorAll('.pagedjs_page')];if(!pages.length)throw Error('No rendered pages');
   const styles=[...document.styleSheets].map(sheet=>[...sheet.cssRules].map(r=>r.cssText).join('\n')).join('\n');
   return {pages:pages.length,styles,html:host.outerHTML,texts:pages.map(p=>p.innerText),images:[...host.querySelectorAll('img')].map(i=>({loaded:i.complete&&i.naturalWidth>0,source:i.getAttribute('src')?.slice(0,30)})),lang:document.documentElement.lang};
  });
  assert(snapshot.images.every(i=>i.loaded),'Preview image not ready');
  const previewLayout=await frame.evaluate(measurePages);
  const earlyFontState=fontPhase==='before-pagination'?await frame.evaluate(()=>window.__vdocFontDiagnostic):null;
  if(fontPhase==='before-pagination')assert(earlyFontState?.loaded&&!earlyFontState.error&&earlyFontState.atRender&&earlyFontState.firstPage?.fonts==='loaded'&&earlyFontState.loaded<=earlyFontState.firstPage.at,'Early diagnostic fonts did not load before pagination; no PDF should be accepted: '+JSON.stringify(earlyFontState));
  // Copy the preview's layout/CSS and embedded images. Browser printing and the
  // optional diagnostic font substitution still require independent layout QA.
  const printPage=await context.newPage();
  await printPage.setContent('<!doctype html><html><head><meta charset="utf-8"><style>'+snapshot.styles.replace(/<\/style/gi,'<\\/style')+'</style></head><body>'+snapshot.html+'</body></html>');
  if(fontPhase==='before-pagination')await printPage.evaluate(installEarlyFaces,earlyFaces);
  await printPage.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
  if(fontPhase==='after-pagination'&&(devanagariFont||fontBytes||cjkFont)){
   // Diagnostic-only font fallback, recorded explicitly. Not shipped to users.
   const faces=[];
   if(devanagariFont||fontBytes)faces.push({name:'VDoc QA Devanagari',src:fontBytes?'url("data:font/ttf;base64,'+fontBytes.toString('base64')+'")':'local('+JSON.stringify(devanagariFont)+')',range:'U+0900-097F',sample:'हिन्दी'});
   if(cjkFont)faces.push({name:'VDoc QA CJK',src:'local('+JSON.stringify(cjkFont)+')',range:'U+3000-30FF,U+3400-9FFF,U+F900-FAFF,U+FF00-FFEF',sample:'中文日本語'});
   await printPage.evaluate(async faces=>{
    const style=document.createElement('style');style.textContent=faces.map(f=>'@font-face{font-family:'+JSON.stringify(f.name)+';src:'+f.src+';font-weight:100 900;unicode-range:'+f.range+';}').join('\n');document.head.append(style);
    const elements=[...document.body.querySelectorAll('*')].filter(el=>el instanceof HTMLElement);
    const families=elements.map(el=>getComputedStyle(el).fontFamily);
    elements.forEach((el,i)=>{el.style.fontFamily=faces.map(f=>JSON.stringify(f.name)).join(',')+','+families[i];});
    for(const face of faces){const fonts=await document.fonts.load('16px '+JSON.stringify(face.name),face.sample);if(!fonts.length)throw Error('Diagnostic font did not load: '+face.name);}
    await document.fonts.ready;
   },faces);
  }
  const printLayout=await printPage.evaluate(measurePages);
  const layoutDifferences=[];
  if(previewLayout.length!==printLayout.length)layoutDifferences.push('page count');
  previewLayout.forEach((nodes,p)=>{
   if(nodes.length!==printLayout[p]?.length)layoutDifferences.push('node count on page '+(p+1));
   nodes.forEach((node,i)=>{const other=printLayout[p]?.[i];if(!other||node.tag!==other.tag||node.text!==other.text||JSON.stringify(node.font)!==JSON.stringify(other.font)||node.box.some((n,k)=>Math.abs(n-other.box[k])>.1))layoutDifferences.push({page:p+1,node:i,preview:node,print:other});});
  });
  if(fontPhase==='before-pagination')assert.equal(layoutDifferences.length,0,'Preview and print-copy typography or geometry differ');
  await printPage.pdf({path:output,preferCSSPageSize:true,printBackground:true,scale:1,displayHeaderFooter:false});
  assert.deepEqual(await page.evaluate(()=>window.vdoc.snapshot().document),before);
  const report={prototypeOnly:true,diagnosticFontPhase:fontPhase,earlyFontState,layoutDifferences,measuredElements:previewLayout.reduce((n,p)=>n+p.length,0),diagnosticDevanagariFont:devanagariFont,diagnosticCjkFont:cjkFont,diagnosticFontFile:fontPath||null,fixture,output,browser:browser.version(),origin:url.origin,pageCount:snapshot.pages,sourceUnchanged:true,blockedExternalOrigins:[...new Set(blocked)],snapshot};
  await fs.writeFile(output+'.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({output,pages:snapshot.pages,sourceUnchanged:true,blockedExternalOrigins:report.blockedExternalOrigins}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
