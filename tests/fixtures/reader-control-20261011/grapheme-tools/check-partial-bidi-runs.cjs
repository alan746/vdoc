const numberCases=process.env.VDOC_QA_NUMBER_CASES==='1';
const numberTag=numberCases?'-numbers':'';
const encoding=process.env.VDOC_QA_READER_VARIANT||'bidi-runs';
if(!['bidi-runs','whole-cluster','cluster-actual','local-clusters','record-actual','record-rtl','record-boxes','record-alef','record-digits','record-flow','record-number-tail','record-marked-boxes','record-mark-advance','record-space-bounds','record-grapheme','native-control'].includes(encoding))throw Error('Unknown QA reader variant');
// Probe grapheme-range drag selection using verified source DOM Range geometry.
// No system clipboard, user browser session, or PDF rewriting is used.
const fs = require('node:fs/promises');
const http = require('node:http');
const crypto = require('node:crypto');
const { chromium } = require('/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const requestedInset=Number(process.env.VDOC_QA_DRAG_INSET||0.15);
if(![0.15,1].includes(requestedInset))throw Error('Unsupported drag inset');
const insetTag=requestedInset===1?'-inset1':'';
const wide=process.env.VDOC_QA_WIDE_DRAG==='1';
// Complete source-coordinate suites require focus before their first pointer probe.
const stable=wide||process.env.VDOC_QA_STABLE_DRAG==='1';
const evidenceTag=process.env.VDOC_QA_EVIDENCE_TAG||'';
if(!['','focused','focused-controls'].includes(evidenceTag))throw Error('Unsupported evidence tag');
if(evidenceTag&&!stable)throw Error('Focused evidence requires explicit focus');
const evidenceSuffix=evidenceTag?'-'+evidenceTag:'';
const targets = (numberCases?['arabic','hebrew']:['words','arabic','hebrew','arabic-marked','hebrew-marked']).map(label=>({label,directory:encoding==='native-control'?'reader-control-20261011':'browser-unicode-20261011',name:encoding==='native-control'?label:label.replace('-marked','')+'-unicode-ordered-'+encoding+(label.endsWith('-marked')?'-marked':'')+numberTag}));
const destination = `tests/fixtures/reader-control-20261011/partial-${encoding}${wide?'-wide-standards':stable?'-stable':''}${insetTag}${numberTag}${evidenceSuffix}.json`;
const collapse = value => value.replace(/\s+/gu, ' ').trim();

async function measureSource(context, file) {
  const variant=file.label.split('-')[0];
  const family={words:'Devanagari',arabic:'Arabic',hebrew:'Hebrew'}[variant];
  const font=await fs.readFile(`tests/fixtures/browser-pdf-20261011/fonts/NotoSans${family}-static.ttf`);
  const sourcePage=await context.newPage();
  try {
    await sourcePage.setContent(`${encoding==='native-control'?'':'<!doctype html>'}<meta charset="utf-8"><style>@font-face{font-family:QA;src:url(data:font/ttf;base64,${font.toString('base64')})}*{box-sizing:border-box}body{margin:0;background:white;font-family:QA;font-size:22px;font-weight:400}#fixture{width:794px;height:1123px;padding:60px;background:white}.line{line-height:2;margin:18px 0;${encoding==='native-control'?'white-space:pre':''}}.token{display:inline-block;white-space:pre;font-weight:400}.baseline{display:inline-block;width:0;height:0;vertical-align:baseline}table{border-collapse:collapse;width:100%;margin-top:32px}td{border:1px solid #a6adbd;padding:12px;background:#fafafc;line-height:2}</style><main id="fixture"></main>`);
    const result=await sourcePage.evaluate(async ({source,variant,original,native,wide,measurements})=>{
      const root=document.querySelector('#fixture');
      const fill=(el,text)=>{if(native){el.textContent=text;return;}for(const word of text.split(/(\s+)/).filter(Boolean)){const span=document.createElement('span');span.className='token';span.textContent=word;const mark=document.createElement('i');mark.className='baseline';span.append(mark);el.append(span);}};
      const lines=source.split('\n');
      for(const [i,text] of lines.slice(0,4).entries()){const line=document.createElement('div');line.className='line';if(variant!=='words'&&i>0)line.dir='rtl';fill(line,text);root.append(line);}
      const table=document.createElement('table');for(const text of lines.slice(4)){const tr=table.insertRow();for(const cell of text.split('\t'))fill(tr.insertCell(),cell);}root.append(table);
      await document.fonts.load('22px QA');await document.fonts.ready;
      if(root.innerText!==source)throw Error('Reconstructed source text mismatch');
      const rectOf=(node,start=0,end=node.length)=>{const r=document.createRange();r.setStart(node,start);r.setEnd(node,end);const b=r.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};};
      const blocks=[...root.querySelectorAll('.line')];
      const tokensOf=line=>native?[...line.textContent.matchAll(/\S+/gu)].map(m=>({node:line.firstChild,start:m.index,end:m.index+m[0].length,text:m[0]})):[...line.querySelectorAll('.token')].filter(t=>t.firstChild.textContent.trim()).map(t=>({node:t.firstChild,start:0,end:t.firstChild.length,text:t.firstChild.textContent}));
      const targets=blocks.flatMap((line,lineIndex)=>{const tokens=tokensOf(line);return [...new Set([0,tokens.length-1])].map(i=>({line:lineIndex,expected:tokens[i].text,rect:rectOf(tokens[i].node,tokens[i].start,tokens[i].end)}));});
      let maxRectDelta=0;
      for(const [i,target] of targets.entries()){if(target.expected!==original[i].expected)throw Error('Source target mismatch');for(const k of ['x','y','width','height'])maxRectDelta=Math.max(maxRectDelta,Math.abs(target.rect[k]-original[i].rect[k]));}
      if(maxRectDelta>0.05)throw Error('Source geometry drift: '+maxRectDelta);
      if(!native&&document.compatMode!=='CSS1Compat')throw Error('Source must match standard-mode generator');
      let maxTokenWidthDelta=0;
      if(!native){const tokens=[...root.querySelectorAll('.token')];if(tokens.length!==measurements.length)throw Error('Token count mismatch');for(const [i,t] of tokens.entries()){if(t.firstChild.textContent!==measurements[i].text)throw Error('Token source mismatch');maxTokenWidthDelta=Math.max(maxTokenWidthDelta,Math.abs(t.getBoundingClientRect().width-measurements[i].domWidth));}if(maxTokenWidthDelta>0.05)throw Error('Source token width drift: '+maxTokenWidthDelta);}
      const ranges=[];
      const rangeBlocks=wide?[...blocks,...root.querySelectorAll('td')]:blocks;
      for(const lineIndex of (wide?rangeBlocks.map((_,i)=>i):[0,1])){
        const line=rangeBlocks[lineIndex];
        const tokens=wide?tokensOf(line).filter(t=>lineIndex===0?t.start===0&&t.text==='Browser':/[\p{Script=Devanagari}\p{Script=Arabic}\p{Script=Hebrew}0-9]/u.test(t.text)):tokensOf(line).slice(0,1);
        for(const token of tokens){const node=token.node;
         const segments=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(token.text)];
         for(const segment of segments){const start=segment.index,end=start+segment.segment.length;const rect=rectOf(node,token.start+start,token.start+end);if(rect.width<=0)throw Error('Unmeasurable grapheme');ranges.push({line:lineIndex,word:token.text,expected:segment.segment,start,end,rtl:/[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(segment.segment),rect});}
        }
      }

      return {source:root.innerText,maxRectDelta,maxTokenWidthDelta,compatMode:document.compatMode,targets,ranges};
    },{source:file.report.sourceText,variant,original:file.report.targets,native:encoding==='native-control',wide,measurements:file.report.report?.measurements});
    if(wide)await sourcePage.locator('#fixture').screenshot({path:`tests/fixtures/reader-control-20261011/source-${encoding}-wide-standards${insetTag}${numberTag}${evidenceSuffix}-${file.label}.png`});
    return {...result,fontSha256:crypto.createHash('sha256').update(font).digest('hex')};
  } finally {await sourcePage.close();}
}

(async () => {
  try { await fs.access(destination); throw Error('Refuse overwrite selection evidence'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = await Promise.all(targets.map(async target => ({
    ...target,
    file: `output/pdf/${target.directory}/${target.name}.pdf`,
    bytes: await fs.readFile(`output/pdf/${target.directory}/${target.name}.pdf`),
    report: JSON.parse(await fs.readFile(`tests/fixtures/${target.directory}/${target.name}-report.json`, 'utf8')),
  })));
  const server = http.createServer((request, response) => {
    const match = /^\/qa-(\d+)\.pdf$/.exec(request.url);
    const file = match && files[Number(match[1])];
    if (!file) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': file.bytes.length });
    response.end(file.bytes);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1100, height: 1200 } });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await context.route('http{,s}://**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    for (const [index, file] of files.entries()) {
      const page = await context.newPage();
      try {
        await page.goto(`${origin}/qa-${index}.pdf`);
        let frame;
        for (let attempt = 0; attempt < 50; attempt++) {
          frame = page.frames().find(item => item.url().startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'));
          if (frame) break;
          await page.waitForTimeout(100);
        }
        if (!frame) throw Error('PDF viewer frame unavailable');
        await frame.waitForFunction(() => document.querySelector('pdf-viewer')?.loadState_ === 'success', null, { timeout: 15000 });
        const geometry = await frame.evaluate(() => {
          const viewer = document.querySelector('pdf-viewer');
          const rect = viewer.viewport_.getPageScreenRect(0);
          const scroller = viewer.shadowRoot.querySelector('#scroller')?.getBoundingClientRect();
          return {rect,scroller:scroller?{x:scroller.x,y:scroller.y,width:scroller.width,height:scroller.height}:null,method:String(viewer.viewport_.getPageScreenRect)};
        });
        const sourceGeometry = await measureSource(context, file);
        if(stable){await page.bringToFront();await page.mouse.click(geometry.scroller.x+30,geometry.scroller.y+30);await page.waitForTimeout(500);}
        const selections = [];
        const probeRanges=evidenceTag==='focused-controls'?sourceGeometry.ranges.filter(point=>point.expected==='B'||(file.label==='arabic-marked'&&point.word==='جَمِيلَةٌ'&&['لَ','ةٌ'].includes(point.expected))||(file.label==='hebrew-marked'&&point.expected==='כְּ')):sourceGeometry.ranges;
        for (const point of probeRanges) {
          const r=geometry.rect, sc=geometry.scroller;
          if(!sc) throw Error('Missing scroller');
          const left=sc.x+r.x+point.rect.x*r.width/794;
          const right=left+point.rect.width*r.width/794;
          const y=sc.y+r.y+(point.rect.y+point.rect.height/2)*r.height/1123;
          // Separate near-edge and interior-pointer diagnostics. Keep both results;
          // do not silently replace original boundary-adjacent evidence.
          const inset=Math.min(requestedInset,(right-left)/4);
          const from=point.rtl?right-inset:left+inset;
          const to=point.rtl?left+inset:right-inset;
          await page.mouse.click(sc.x+20,sc.y+20);
          await page.mouse.move(from,y); await page.mouse.down();
          await page.mouse.move(to,y,{steps:8}); await page.mouse.up();
          await page.waitForTimeout(120);
          const selected=await frame.evaluate(()=>document.querySelector('pdf-viewer').pluginController_.getSelectedText());
          selections.push({...point,requestedInset,inset,from,to,y,selectedText:selected.selectedText,match:selected.selectedText===point.expected});
        }
        await page.screenshot({path:`tests/fixtures/reader-control-20261011/partial-${encoding}${wide?'-wide-standards':stable?'-stable':''}${insetTag}${numberTag}${evidenceSuffix}-${file.label}.png`});
        results.push({label:file.label,file:file.file,sha256:crypto.createHash('sha256').update(file.bytes).digest('hex'),geometry,sourceGeometry,selections});
        console.log(JSON.stringify({label:file.label,pass:selections.filter(x=>x.match).length,total:selections.length,failed:selections.filter(x=>!x.match).map(x=>({expected:x.expected,actual:x.selectedText}))}));

      } catch (error) {
        results.push({ label: file.label, error: error.message });
      } finally { await page.close(); }
    }
    await fs.writeFile(destination, JSON.stringify({ at: new Date().toISOString(), browser: browser.version(), explicitFocus:stable, evidenceTag, method: 'Mouse drag over DOM-measured grapheme ranges in actual isolated Chrome PDF viewer. Reconstructed source text and original eight word rectangles must match before probing. No clipboard.', results }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
