// Read existing QA PDFs in isolated stock readers; no PDF rewriting or clipboard.
const fs=require('node:fs/promises'),http=require('node:http'),crypto=require('node:crypto');
const runtime='/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(runtime+'/playwright');
const out='tests/fixtures/pdf-story-20261012';
const collapse=s=>s.replace(/\s+/gu,' ').trim();
function comparison(expected,actual){
 const e=collapse(expected),a=collapse(actual);let first=0;while(first<Math.min(e.length,a.length)&&e[first]===a[first])first++;
 return {match:e===a,expectedLength:e.length,actualLength:a.length,firstDifference:first,expectedContext:e.slice(Math.max(0,first-50),first+160),actualContext:a.slice(Math.max(0,first-50),first+160),sameNonWhitespace:e.replace(/\s/gu,'')===a.replace(/\s/gu,''),nulls:[...a].filter(c=>c==='\0'||c==='\ufffd').length};
}
(async()=>{
 try{await fs.access(out+'/copy-readers.json');throw Error('Refuse overwrite evidence')}catch(e){if(e.code!=='ENOENT')throw e;}
 const inputs=JSON.parse(await fs.readFile(out+'/inputs.json','utf8'));
 const files=await Promise.all(inputs.map(async x=>({...x,bytes:await fs.readFile(x.file)})));
 const server=http.createServer((req,res)=>{const match=/^\/qa-(\d+)\.pdf$/.exec(req.url),f=match&&files[+match[1]];if(!f){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':f.bytes.length});res.end(f.bytes);});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const report={at:new Date().toISOString(),browser:browser.version(),scope:'Stock Chrome plugin selectAll plus official PDF.js text-layer copy handler for each page. Synthetic ClipboardEvent with isolated in-memory DataTransfer; no system clipboard or native key press. Raw Selection.toString retained separately. Known generated margins are excluded only for a separate body comparison, with occurrence counts retained. Neither raw nor body comparison silently changes Unicode or word order.',results:[]};
 try{
  const context=await browser.newContext({viewport:{width:1200,height:1100}});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const assets={'/pdf.mjs':runtime+'/pdfjs-dist/legacy/build/pdf.mjs','/pdf.worker.mjs':runtime+'/pdfjs-dist/legacy/build/pdf.worker.mjs','/pdf_viewer.mjs':runtime+'/pdfjs-dist/web/pdf_viewer.mjs','/pdf_viewer.css':runtime+'/pdfjs-dist/web/pdf_viewer.css'};
  await context.route('http{,s}://**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!==origin)return route.abort();
   if(u.pathname==='/reader')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/pdf_viewer.css"><style>body{margin:0;background:#ddd}#viewer{--scale-factor:1.3333333333333333}.page{margin:10px!important}</style><main id="viewer" class="pdfViewer"></main>'});
   if(assets[u.pathname])return route.fulfill({contentType:u.pathname.endsWith('.css')?'text/css':'text/javascript',body:await fs.readFile(assets[u.pathname])});
   return route.continue();
  });
  for(const [index,file] of files.entries()){
   const result={label:file.label,file:file.file,pdfSha256:crypto.createHash('sha256').update(file.bytes).digest('hex'),source:file.sourceText};
   const p=await context.newPage();
   try{
    await p.goto(`${origin}/qa-${index}.pdf`);let viewerFrame;
    for(let attempt=0;attempt<50;attempt++){viewerFrame=p.frames().find(f=>f.url().startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'));if(viewerFrame)break;await p.waitForTimeout(100);}
    if(!viewerFrame)throw Error('Chrome PDF viewer absent');
    await viewerFrame.waitForFunction(()=>document.querySelector('pdf-viewer')?.loadState_==='success',null,{timeout:15000});
    const chrome=await viewerFrame.evaluate(async()=>{const v=document.querySelector('pdf-viewer');v.pluginController_.selectAll();return Promise.race([v.pluginController_.getSelectedText(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Selection timeout')),8000))]);});
    if(!chrome.selectedText)throw Error('Chrome returned no selected text');
    result.chrome={selectedText:chrome.selectedText,...comparison(file.sourceText,chrome.selectedText)};
    await p.screenshot({path:out+'/'+file.label+'-copy-chrome.png'});
    await p.goto(origin+'/reader');
    const pdfjs=await p.evaluate(async bytes=>{
     globalThis.pdfjsLib=await import('/pdf.mjs');pdfjsLib.GlobalWorkerOptions.workerSrc='/pdf.worker.mjs';
     const {PDFPageView,EventBus}=await import('/pdf_viewer.mjs');
     const doc=await pdfjsLib.getDocument({data:new Uint8Array(bytes),useSystemFonts:false}).promise;
     if(doc.numPages>10)throw Error('QA page bound exceeded');const pages=[],copies=[],copyEvents=[],views=[];
     for(let i=1;i<=doc.numPages;i++){
      const page=await doc.getPage(i),bus=new EventBus();
      const ready=new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('Text-layer timeout')),15000);bus.on('textlayerrendered',e=>{clearTimeout(t);e.error?reject(e.error):resolve();});});
      const view=new PDFPageView({container:document.querySelector('#viewer'),id:i,scale:1,defaultViewport:page.getViewport({scale:1}),eventBus:bus,textLayerMode:1,annotationMode:0});view.setPdfPage(page);await view.draw();await ready;await document.fonts.ready;
      const selection=getSelection(),range=document.createRange();range.selectNodeContents(view.textLayer.div);selection.removeAllRanges();selection.addRange(range);pages.push(selection.toString());
      const data=new DataTransfer();const event=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data});view.textLayer.div.dispatchEvent(event);
      if(!event.defaultPrevented||!data.types.includes('text/plain'))throw Error('Official copy handler did not run');
      copies.push(data.getData('text/plain'));copyEvents.push({isTrusted:event.isTrusted,defaultPrevented:event.defaultPrevented,types:[...data.types]});
      selection.removeAllRanges();views.push(view);
     }
     globalThis.qaDoc=doc;globalThis.qaViews=views;return {pages,copies,copyEvents,version:pdfjsLib.version};
    },[...file.bytes]);
    result.pdfjs={...pdfjs,selectedText:pdfjs.pages.join('\n'),copiedText:pdfjs.copies.join('\n'),...comparison(file.sourceText,pdfjs.copies.join('\n'))};
    for(const [reader,selected] of [['chrome',chrome.selectedText],['pdfjs',result.pdfjs.copiedText]]){
     const headers=[...selected.matchAll(/^VDoc system acceptance [^\n]*\n/gm)].map(x=>x[0]);
     const footers=[...selected.matchAll(/^Local document acceptance \d+ \/ \d+\n/gm)].map(x=>x[0]);
     const body=selected.replace(/^VDoc system acceptance [^\n]*\n/gm,'').replace(/^Local document acceptance \d+ \/ \d+\n/gm,'');
     result[reader].body={removedHeaders:headers,removedFooters:footers,...comparison(file.sourceText,body)};
    }
    await p.screenshot({path:out+'/'+file.label+'-copy-pdfjs.png'});
    await p.evaluate(async()=>{qaViews.forEach(v=>v.destroy());await qaDoc.destroy();});
    console.log(JSON.stringify({label:file.label,chrome:result.chrome.match,pdfjs:result.pdfjs.match,chromeDifference:result.chrome.firstDifference,pdfjsDifference:result.pdfjs.firstDifference}));
   }catch(error){result.error=error.stack;console.error(file.label,error.message);}
   finally{report.results.push(result);await p.close();}
  }
 }finally{await fs.writeFile(out+'/copy-readers.json',JSON.stringify(report,null,2),{flag:'wx'});await browser.close();await new Promise(resolve=>server.close(resolve));}
 if(report.results.some(x=>x.error))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
