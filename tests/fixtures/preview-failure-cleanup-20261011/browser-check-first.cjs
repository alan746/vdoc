const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {chromium}=require('/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dir=__dirname,origin='http://localhost:5173';
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const report={scope:'Real preview route with QA snapshots, real Paged.js; no native printing or import coverage',browser:browser.version(),checks:[]};
 try {
  const context=await browser.newContext();
  await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  const page=await context.newPage();
  for(const fail of [true,false]){
   await page.goto(origin+'/print-preview');await page.locator('#preview-pages').waitFor();
   await page.evaluate(()=>{
    window.__qa={messages:[],createdPages:0,createdStyles:0,printCalls:0};window.print=()=>window.__qa.printCalls++;
    new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType!==1)return;window.__qa.createdPages+=Number(node.matches('.pagedjs_page'))+node.querySelectorAll('.pagedjs_page').length;window.__qa.createdStyles+=Number(node.matches('[data-pagedjs-inserted-styles]'))+node.querySelectorAll('[data-pagedjs-inserted-styles]').length;}))).observe(document,{childList:true,subtree:true});
    window.addEventListener('message',e=>{if(e.source===window&&e.origin===location.origin&&e.data.type==='vdoc-preview-status')window.__qa.messages.push(e.data)});
   });
   await page.evaluate(fail=>window.postMessage({type:'vdoc-preview-render',token:'cleanup-qa',snapshot:{title:'Failure cleanup QA',html:fail?'<p style="transform:translateX(1500px)">Overflow cleanup marker</p>':'<p>Recovery ready marker</p>',content:{type:'doc',attrs:{pageSize:'a4'},content:[{type:'paragraph',content:[{type:'text',text:fail?'Overflow cleanup marker':'Recovery ready marker'}]}]}}},location.origin),fail);
   await page.waitForFunction(()=>window.__qa.messages.length>0,null,{timeout:65000});
   if(fail){await page.evaluate(()=>window.postMessage({type:'vdoc-preview-print',token:'cleanup-qa'},location.origin));await page.waitForTimeout(100);}
   const state=await page.evaluate(()=>({...window.__qa,remainingPages:document.querySelectorAll('.pagedjs_page').length,remainingStyles:document.querySelectorAll('[data-pagedjs-inserted-styles]').length,text:document.querySelector('#preview-pages').textContent}));
   report.checks.push({failure:fail,...state});
   if(fail){assert.equal(state.messages[0].state,'error');assert.match(state.messages[0].error,/right edge/);assert(state.createdPages>0&&state.createdStyles>0);assert.equal(state.remainingPages,0);assert.equal(state.remainingStyles,0);assert.equal(state.printCalls,0);assert.equal(state.text,'');}
   else {assert.equal(state.messages[0].state,'ready');assert.equal(state.remainingPages,1);assert.match(state.text,/Recovery ready marker/);await page.screenshot({path:dir+'/recovery.png'});}
  }
  report.passed=true;
 }catch(e){report.error=String(e);process.exitCode=1;}finally{await browser.close();await fs.writeFile(dir+'/browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})();
