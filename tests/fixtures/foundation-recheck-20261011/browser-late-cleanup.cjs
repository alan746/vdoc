const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {chromium}=require('/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const report={scope:'Real Paged.js deferred beforePreview on the actual React component; controlled close while pending, no native print or IME',browser:browser.version(),checks:[]};
 try{
  const context=await browser.newContext();
  await context.route('**/*',r=>new URL(r.request().url()).origin==='http://localhost:5173'?r.continue():r.abort());
  const page=await context.newPage();await page.goto('http://localhost:5173/');
  await page.locator('[aria-label="Import file into library"]').waitFor({state:'attached'});
  page.setDefaultTimeout(20000);
  report.checks=await page.evaluate(async()=>{
   const src=await(await fetch('/app/print-preview/page.tsx')).text();
   const reactPath=src.match(/from\s+["']([^"']*\/react\.js[^"']*)/)[1];
   const pagedPath=src.match(/import\(["']([^"']*pagedjs[^"']*)/)[1];
   const React=await import(reactPath);const ReactDOM=await import(reactPath.replace('/react.js','/react-dom_client.js'));
   const {default:Preview}=await import('/app/print-preview/page.tsx');const {Previewer}=await import(pagedPath);
   const original=Previewer.prototype.preview,checks=[];
   const until=async(fn)=>{const end=performance.now()+15000;while(!fn()){if(performance.now()>end)throw new Error('QA wait timeout');await new Promise(r=>setTimeout(r,20));}};
   for(const reject of [false,true]){
    let release,entered=false,settled=false,engine;
    const pause=new Promise(r=>release=r),messages=[];
    Previewer.prototype.preview=function(...args){engine=this;this.hooks.beforePreview.register(async()=>{entered=true;await pause;});return original.apply(this,args).finally(()=>settled=true);};
    const mount=document.createElement('div');document.body.append(mount);const root=(ReactDOM.createRoot || ReactDOM.default.createRoot)(mount);
    const listener=e=>{if(e.data?.type==='vdoc-preview-status')messages.push(e.data)};window.addEventListener('message',listener);
    root.render((React.createElement || React.default.createElement)(Preview));await until(()=>mount.querySelector('#preview-pages'));
    await new Promise(r=>setTimeout(r,100));
    window.postMessage({type:'vdoc-preview-render',token:'late-cleanup',snapshot:{title:'Late cleanup QA',html:'<p>Late cleanup 中文</p>',content:{type:'doc'}}},location.origin);
    await until(()=>entered);const host=mount.querySelector('#preview-pages');root.unmount();
    // Let the real parser create its own styles after unmount. Both a throw
    // and normal completion need the component's final resource cleanup.
    if(!reject){engine.chunker.hooks.beforePageLayout.clear();}
    release();await until(()=>settled);await new Promise(r=>setTimeout(r,50));
    checks.push({reject,styles:document.querySelectorAll('[data-pagedjs-inserted-styles]').length,styleConnected:!!engine.polisher.styleEl?.isConnected,hostChildren:host.childNodes.length,statuses:messages,stopped:engine.chunker.stopped});
    window.removeEventListener('message',listener);mount.remove();
   }
   Previewer.prototype.preview=original;return checks;
  });
  for(const c of report.checks){assert.equal(c.styles,0);assert.equal(c.styleConnected,false);assert.equal(c.hostChildren,0);assert.deepEqual(c.statuses,[]);assert.equal(c.stopped,true);}
  report.passed=true;
 }catch(e){report.error=String(e);process.exitCode=1;}finally{await browser.close();await fs.writeFile(__dirname+'/browser-late-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})();
