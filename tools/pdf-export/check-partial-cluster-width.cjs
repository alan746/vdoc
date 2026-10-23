const { qaPath } = require('../qa-paths.cjs');
// Probe grapheme-range drag selection using verified source DOM Range geometry.
// No system clipboard, user browser session, or PDF rewriting is used.
const fs = require('node:fs/promises');
const http = require('node:http');
const crypto = require('node:crypto');
const { chromium } = require('/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const targets = ['words','arabic','hebrew','arabic-marked','hebrew-marked'].map(label=>({label,directory:'browser-unicode-20261011',name:label.replace('-marked','')+'-unicode-ordered-cluster-width'+(label.endsWith('-marked')?'-marked':'')}));
const destination = qaPath('reader-control-20261011/partial-cluster-width.json');

async function measureSource(context, file) {
  const variant=file.label.split('-')[0];
  const family={words:'Devanagari',arabic:'Arabic',hebrew:'Hebrew'}[variant];
  const font=await fs.readFile(qaPath(`browser-pdf-20261011/fonts/NotoSans${family}-static.ttf`));
  const sourcePage=await context.newPage();
  try {
    await sourcePage.setContent(`<style>@font-face{font-family:QA;src:url(data:font/ttf;base64,${font.toString('base64')})}*{box-sizing:border-box}body{margin:0;background:white;font-family:QA;font-size:22px;font-weight:400}#fixture{width:794px;height:1123px;padding:60px;background:white}.line{line-height:2;margin:18px 0}.token{display:inline-block;white-space:pre;font-weight:400}.baseline{display:inline-block;width:0;height:0;vertical-align:baseline}table{border-collapse:collapse;width:100%;margin-top:32px}td{border:1px solid #a6adbd;padding:12px;background:#fafafc;line-height:2}</style><main id="fixture"></main>`);
    const result=await sourcePage.evaluate(async ({source,variant,original})=>{
      const root=document.querySelector('#fixture');
      const fill=(el,text)=>{for(const word of text.split(/(\s+)/).filter(Boolean)){const span=document.createElement('span');span.className='token';span.textContent=word;const mark=document.createElement('i');mark.className='baseline';span.append(mark);el.append(span);}};
      const lines=source.split('\n');
      for(const [i,text] of lines.slice(0,4).entries()){const line=document.createElement('div');line.className='line';if(variant!=='words'&&i>0)line.dir='rtl';fill(line,text);root.append(line);}
      const table=document.createElement('table');for(const text of lines.slice(4)){const tr=table.insertRow();for(const cell of text.split('\t'))fill(tr.insertCell(),cell);}root.append(table);
      await document.fonts.load('22px QA');await document.fonts.ready;
      if(root.innerText!==source)throw Error('Reconstructed source text mismatch');
      const rectOf=(node,start=0,end=node.length)=>{const r=document.createRange();r.setStart(node,start);r.setEnd(node,end);const b=r.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};};
      const blocks=[...root.querySelectorAll('.line')];
      const targets=blocks.flatMap((line,lineIndex)=>{const tokens=[...line.querySelectorAll('.token')].filter(t=>t.firstChild.textContent.trim());return [...new Set([0,tokens.length-1])].map(i=>({line:lineIndex,expected:tokens[i].firstChild.textContent,rect:rectOf(tokens[i].firstChild)}));});
      let maxRectDelta=0;
      for(const [i,target] of targets.entries()){if(target.expected!==original[i].expected)throw Error('Source target mismatch');for(const k of ['x','y','width','height'])maxRectDelta=Math.max(maxRectDelta,Math.abs(target.rect[k]-original[i].rect[k]));}
      if(maxRectDelta>0.05)throw Error('Source geometry drift: '+maxRectDelta);
      const ranges=[];
      for(const lineIndex of [0,1]){
        const line=blocks[lineIndex], node=line.querySelector('.token').firstChild;
        const segments=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(node.textContent)];
        for(const segment of segments){const start=segment.index,end=start+segment.segment.length;const rect=rectOf(node,start,end);if(rect.width<=0)throw Error('Unmeasurable grapheme');ranges.push({line:lineIndex,word:node.textContent,expected:segment.segment,start,end,rtl:line.dir==='rtl',rect});}
      }
      return {source:root.innerText,maxRectDelta,targets,ranges};
    },{source:file.report.sourceText,variant,original:file.report.targets});
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
    report: JSON.parse(await fs.readFile(qaPath(`${target.directory}/${target.name}-report.json`), 'utf8')),
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
        const selections = [];
        for (const point of sourceGeometry.ranges) {
          const r=geometry.rect, sc=geometry.scroller;
          if(!sc) throw Error('Missing scroller');
          const left=sc.x+r.x+point.rect.x*r.width/794;
          const right=left+point.rect.width*r.width/794;
          const y=sc.y+r.y+(point.rect.y+point.rect.height/2)*r.height/1123;
          // Stay 0.15 CSS pixels inside each measured range edge. No guessed character widths.
          const from=point.rtl?right-0.15:left+0.15;
          const to=point.rtl?left+0.15:right-0.15;
          await page.mouse.click(sc.x+20,sc.y+20);
          await page.mouse.move(from,y); await page.mouse.down();
          await page.mouse.move(to,y,{steps:8}); await page.mouse.up();
          await page.waitForTimeout(120);
          const selected=await frame.evaluate(()=>document.querySelector('pdf-viewer').pluginController_.getSelectedText());
          selections.push({...point,from,to,y,selectedText:selected.selectedText,match:selected.selectedText===point.expected});
        }
        await page.screenshot({path:qaPath(`reader-control-20261011/partial-${file.label}.png`)});
        results.push({label:file.label,file:file.file,sha256:crypto.createHash('sha256').update(file.bytes).digest('hex'),geometry,sourceGeometry,selections});
        console.log(JSON.stringify({label:file.label,pass:selections.filter(x=>x.match).length,total:selections.length,failed:selections.filter(x=>!x.match).map(x=>({expected:x.expected,actual:x.selectedText}))}));

      } catch (error) {
        results.push({ label: file.label, error: error.message });
      } finally { await page.close(); }
    }
    await fs.writeFile(destination, JSON.stringify({ at: new Date().toISOString(), browser: browser.version(), method: 'Mouse drag over DOM-measured grapheme ranges in actual isolated Chrome PDF viewer. Reconstructed source text and original eight word rectangles must match before probing. No clipboard.', results }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
