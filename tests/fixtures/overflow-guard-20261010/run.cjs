const {chromium} = require('/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {buildSync} = require('esbuild');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const output = path.resolve('tests/fixtures/overflow-guard-20261010');
const bundle = buildSync({stdin:{contents:'export {previewOverflowDetails, previewMarginOverflow} from "./lib/editor/preview-layout"; export {finalizePreviewFlow} from "./lib/editor/preview-final-flow";',resolveDir:process.cwd()},bundle:true,write:false,platform:'browser',format:'iife',globalName:'VDocPreviewAudit'}).outputFiles[0].text;
(async()=>{
 const browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const report={at:new Date().toISOString(),browser:browser.version(),scope:'Real DOM geometry of current product overflow guards in an isolated Chromium page; not Safari print, not pagination integration',cases:[]};
 try {
  const page=await browser.newPage({viewport:{width:1200,height:1100}});
  await page.setContent('<!doctype html><html><head><style>body{margin:20px}.pagedjs_area{position:relative;width:600px;height:800px}.object{position:absolute;margin:0;padding:0;border:0;box-sizing:border-box} table{border-collapse:collapse} p{margin:0;font:16px Arial}</style></head><body><main id="root"></main></body></html>');
  await page.addScriptTag({content:bundle});
  const inputs=[
   {name:'fitting-table',tag:'table',x:0,y:0,w:600,h:200,expected:null},
   {name:'half-pixel-border',tag:'table',x:-.5,y:0,w:601,h:200,expected:null},
   {name:'actual-5px-bottom',tag:'table',x:0,y:705,w:600,h:100,expected:{page:1,kind:'table',edge:'bottom',pixels:5}},
   {name:'actual-9px-bottom',tag:'table',x:0,y:709,w:600,h:100,expected:{page:1,kind:'table',edge:'bottom',pixels:9}},
   {name:'actual-5px-right',tag:'table',x:0,y:0,w:605,h:100,expected:{page:1,kind:'table',edge:'right',pixels:5}},
   {name:'actual-1794px-right',tag:'table',x:0,y:0,w:2394,h:100,expected:{page:1,kind:'table',edge:'right',pixels:1794}},
   {name:'image-left',tag:'img',x:-12,y:30,w:100,h:100,expected:{page:1,kind:'image',edge:'left',pixels:12}},
   {name:'divider-bottom',tag:'hr',x:0,y:799,w:600,h:8,expected:{page:1,kind:'divider',edge:'bottom',pixels:7}},
   {name:'checkbox-right',tag:'input',x:592,y:10,w:20,h:20,expected:{page:1,kind:'checkbox',edge:'right',pixels:12}},
   {name:'paragraph-border-bottom',tag:'span',border:true,x:0,y:799,w:600,h:8,expected:{page:1,kind:'paragraph border',edge:'bottom',pixels:7}},
   {name:'second-page-image-bottom',second:true,tag:'img',x:0,y:780,w:100,h:30,expected:{page:2,kind:'image',edge:'bottom',pixels:10}},
  ];
  for(const input of inputs){
   const result=await page.evaluate(v=>{
    const root=document.querySelector('#root');root.replaceChildren();
    const create=()=>{const area=document.createElement('div');area.className='pagedjs_area';root.append(area);return area};
    if(v.second)create();const area=create(),element=document.createElement(v.tag);element.className='object';
    if(v.border)element.dataset.previewBorderLine='bottom';
    if(v.tag==='img')element.src='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="blue"/></svg>';
    if(v.tag==='input')element.type='checkbox';
    if(v.tag==='table')element.innerHTML='<tbody><tr><td></td></tr></tbody>';
    Object.assign(element.style,{left:v.x+'px',top:v.y+'px',width:v.w+'px',height:v.h+'px'});area.append(element);
    return {issue:VDocPreviewAudit.previewOverflowDetails(root),area:area.getBoundingClientRect().toJSON(),object:element.getBoundingClientRect().toJSON()};
   },input);
   assert.deepEqual(result.issue,input.expected,input.name);report.cases.push({name:input.name,...result});
  }
  const text=await page.evaluate(()=>{
   const root=document.querySelector('#root');root.innerHTML='<div class="pagedjs_area"><p style="position:absolute;left:595px;top:20px;width:5px;white-space:nowrap">中文 العربية Text crossing the edge</p></div>';
   const p=root.querySelector('p'),a=root.querySelector('.pagedjs_area');const r=document.createRange();r.selectNodeContents(p);
   return {issue:VDocPreviewAudit.previewOverflowDetails(root),elementRight:p.getBoundingClientRect().right,areaRight:a.getBoundingClientRect().right,textRects:[...r.getClientRects()].map(x=>x.toJSON())};
  });
  assert.equal(text.elementRight,text.areaRight);assert.equal(text.issue.kind,'text');assert.equal(text.issue.edge,'right');assert(text.issue.pixels>2);report.cases.push({name:'painted-text-outside-fitting-paragraph',...text});
  const flow=await page.evaluate(()=>{
   const root=document.querySelector('#root');root.innerHTML='<div class="pagedjs_area"><div class="pagedjs_page_content" style="column-width:600px;column-gap:900px"><table style="position:absolute;top:750px;width:600px;height:100px"><tr><td><p>Unchanged 中文</p></td></tr></table></div></div>';
   const content=root.querySelector('.pagedjs_page_content'),before=content.innerHTML;VDocPreviewAudit.finalizePreviewFlow(root);
   return {issue:VDocPreviewAudit.previewOverflowDetails(root),markupUnchanged:before===content.innerHTML,columnWidth:content.style.columnWidth};
  });
  assert.equal(flow.markupUnchanged,true);assert.equal(flow.columnWidth,'auto');assert.deepEqual(flow.issue,{page:1,kind:'table',edge:'bottom',pixels:50});report.cases.push({name:'final-flow-still-refuses-clipping',...flow});
  const margin=await page.evaluate(()=>{
   const root=document.querySelector('#root');root.innerHTML='<div class="pagedjs_page"><div class="pagedjs_margin-top" style="width:600px;height:50px"><div class="pagedjs_margin-top-center hasContent" style="width:100px;height:30px"><div class="pagedjs_margin-content" style="font:20px Arial;white-space:nowrap;width:100px;height:30px">Long header extends outside its reserved margin</div></div></div></div>';
   return VDocPreviewAudit.previewMarginOverflow(root);
  });
  assert.deepEqual(margin,{page:1,part:'Header'});report.cases.push({name:'header-scroll-extent',issue:margin});
  report.state='passed-in-stated-scope';
  console.log(`${report.cases.length} actual Chromium geometry checks passed; no Safari/native PDF claim.`);
 } catch(error){report.state='failed';report.error=String(error);throw error;}
 finally{
  report.sourceHashes={};for(const file of ['lib/editor/preview-layout.ts','lib/editor/preview-final-flow.ts'])report.sourceHashes[file]=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
  await fs.writeFile(path.join(output,'browser-geometry.json'),JSON.stringify(report,null,2)+'\n');await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1});
