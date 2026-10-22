// Actual PDF.js canvas/text-layer reader in isolated Chrome, no clipboard access.
const fs=require('node:fs/promises'),crypto=require('node:crypto');
const runtime='/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(runtime+'/playwright');
const candidate=process.env.VDOC_QA_READER_VARIANT||'record-digits';
if(!['record-leading-space','record-space-map','record-token-boundary','record-digits','record-number-tail','record-marked-boxes','record-mark-advance','record-space-bounds','record-grapheme'].includes(candidate))throw Error('Unsupported reader candidate');
const targets=['hebrew'].flatMap(script=>['source-visual','source-logical','page-visual'].map(mode=>({label:script+'-'+mode,mode})));
const out='tests/fixtures/pdf-type0-minimal-20261011/pdfjs.json';
const collapse=s=>s.replace(/\s+/gu,' ').trim();
(async()=>{
 try{await fs.access(out);throw Error('Refuse overwrite PDF.js reader evidence');}catch(e){if(e.code!=='ENOENT')throw e;}
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});const results=[];
 try{
  const context=await browser.newContext({viewport:{width:1100,height:1200}});
  const assets={'/pdf.mjs':runtime+'/pdfjs-dist/legacy/build/pdf.mjs','/pdf.worker.mjs':runtime+'/pdfjs-dist/legacy/build/pdf.worker.mjs','/pdf_viewer.mjs':runtime+'/pdfjs-dist/web/pdf_viewer.mjs','/pdf_viewer.css':runtime+'/pdfjs-dist/web/pdf_viewer.css'};
  const html='<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pdf_viewer.css"><style>body{margin:0;background:#ddd}#viewer{--scale-factor:1.3333333333333333}.page{margin:10px!important}</style><main id="viewer" class="pdfViewer"></main>';
  const requests=[];
  await context.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!=='http://127.0.0.1:4193'){await route.abort();return;}requests.push(u.pathname);if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:html});if(!assets[u.pathname])return route.fulfill({status:404,body:''});await route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript',body:await fs.readFile(assets[u.pathname])});});
  for(const target of targets){
   const file='output/pdf/type0-minimal-20261011/'+target.label+'.pdf';const bytes=await fs.readFile(file),source=JSON.parse(await fs.readFile('tests/fixtures/pdf-type0-minimal-20261011/'+target.label+'.json','utf8')).sourceText;
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   try{
    await page.goto('http://127.0.0.1:4193/');
    const result=await page.evaluate(async bytes=>{
     globalThis.pdfjsLib=await import('/pdf.mjs');pdfjsLib.GlobalWorkerOptions.workerSrc='/pdf.worker.mjs';
     const {PDFPageView,EventBus}=await import('/pdf_viewer.mjs');
     const doc=await pdfjsLib.getDocument({data:new Uint8Array(bytes),useSystemFonts:false}).promise;const pdfPage=await doc.getPage(1);const bus=new EventBus();
     const rendered=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('PDF.js text layer timeout')),15000);bus.on('textlayerrendered',event=>{clearTimeout(timeout);event.error?reject(event.error):resolve();});});
     const view=new PDFPageView({container:document.querySelector('#viewer'),id:1,scale:1,defaultViewport:pdfPage.getViewport({scale:1}),eventBus:bus,textLayerMode:1,annotationMode:0});view.setPdfPage(pdfPage);await view.draw();await rendered;await document.fonts.ready;
     const layer=view.textLayer.div;const selection=getSelection();selection.removeAllRanges();const range=document.createRange();range.selectNodeContents(layer);selection.addRange(range);
     const selectedText=selection.toString();const textContent=layer.textContent;const raw=await pdfPage.getTextContent();
     const rawText=raw.items.map(x=>x.str+(x.hasEOL?'\n':'')).join('');
     const spans=[...layer.querySelectorAll('span')].map(el=>({text:el.textContent,dir:el.dir,rect:{x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}}));
     selection.removeAllRanges();globalThis.qaDoc=doc;globalThis.qaView=view;
     return {selectedText,textContent,rawText,spans,pages:doc.numPages,version:pdfjsLib.version};
    },[...bytes]);
    const screenshot='tests/fixtures/pdf-type0-minimal-20261011/pdfjs-'+target.label+'.png';await page.screenshot({path:screenshot});
    results.push({...target,file,pdfSha256:crypto.createHash('sha256').update(bytes).digest('hex'),source,...result,matchCollapsed:collapse(source)===collapse(result.selectedText),rawMatchCollapsed:collapse(source)===collapse(result.rawText),screenshot,errors});
    console.log(JSON.stringify({label:target.label,mode:target.mode,copyMatch:results.at(-1).matchCollapsed,rawMatch:results.at(-1).rawMatchCollapsed,errors}));
    await page.evaluate(async()=>{qaView.destroy();await qaDoc.destroy();});
   }finally{await page.close();}
  }
  await fs.writeFile(out,JSON.stringify({at:new Date().toISOString(),browser:browser.version(),scope:'Official PDF.js PDFPageView canvas/text layer; DOM Range full selection read through Selection.toString, no clipboard or Ctrl-C event. Separate from PDFium plugin and raw getTextContent concatenation. Not an arbitrary third-party viewer or assistive-technology signoff.',requests,results},null,2),{flag:'wx'});
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
