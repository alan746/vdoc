const fs=require('node:fs/promises'),assert=require('node:assert/strict');
const {chromium}=require('/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out='tests/fixtures/core-final-candidate-20261012';
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',r=>{const u=new URL(r.request().url());return u.origin==='http://127.0.0.1:4191'||['blob:','data:','about:'].includes(u.protocol)?r.continue():r.abort()});
 try{
 await page.goto('http://127.0.0.1:4191/');
 await page.getByLabel('Import file into library').setInputFiles('tests/fixtures/safari-preview/source.vdoc.json');
 await page.getByRole('textbox',{name:'Document body',exact:true}).waitFor();
 const before=await page.evaluate(()=>window.vdoc.snapshot().document);
 await page.getByText('Saved locally',{exact:true}).first().waitFor();
 await page.reload();await page.getByRole('textbox',{name:'Document body',exact:true}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.vdoc.snapshot().document),before);
 await page.getByRole('button',{name:'Print',exact:true}).click();
 await page.getByText('Your PDF opens in a new tab with fixed pages.',{exact:false}).waitFor({timeout:65000});
 const response=page.waitForResponse(r=>r.url().endsWith('/__vdoc/local-pdf')&&r.request().method()==='POST',{timeout:60000});
 const popupEvent=context.waitForEvent('page');
 await page.getByRole('button',{name:'Print / Save PDF',exact:true}).click();
 const popup=await popupEvent,r=await response;assert.equal(r.status(),200);
 await popup.waitForURL('blob:**',{timeout:10000});
 const transfer=page.waitForEvent('download');
 await page.evaluate(url=>{const a=document.createElement('a');a.href=url;a.download='VDoc acceptance.pdf';document.body.append(a);a.click();a.remove();},popup.url());
 const download=await transfer;assert.equal(await download.failure(),null);
 await download.saveAs(out+'/browser-download-verified.pdf');
 const bytes=await fs.readFile(out+'/browser-download-verified.pdf');assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
 const after=await page.evaluate(()=>window.vdoc.snapshot().document);assert.deepEqual(after,before);assert.deepEqual(errors,[]);
 await page.screenshot({path:out+'/browser-preview-verified.png'});
 await fs.writeFile(out+'/browser-verified.json',JSON.stringify({browser:browser.version(),sourceUnchanged:true,saveAndReloadUnchanged:true,errors,bytes:bytes.length,responseType:r.headers()['content-type'],popupProtocol:new URL(popup.url()).protocol},null,2),{flag:'wx'});
 console.log('Actual preview button produced a PDF in an isolated new tab; source unchanged.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
