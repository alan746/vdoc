// Read actual PDFium selection from a fresh, isolated Chrome PDF viewer.
// No system clipboard, user browser session, or PDF rewriting is used.
const fs = require('node:fs/promises');
const http = require('node:http');
const crypto = require('node:crypto');
const { chromium } = require('/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const targets = ['words','arabic','hebrew'].flatMap(script => [false,true].map(actual => ({label:script+(actual?'-actualtext':'-original'),directory:'browser-unicode-20261011',name:script+'-unicode-ordered'+(actual?'-actualtext':'')})));
const destination = 'tests/fixtures/pdfkit-browser-20261011/chrome-word-selection-offset.json';

(async () => {
  try { await fs.access(destination); throw Error('Refuse overwrite selection evidence'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = await Promise.all(targets.map(async target => ({
    ...target,
    file: `output/pdf/${target.directory}/${target.name}.pdf`,
    bytes: await fs.readFile(`output/pdf/${target.directory}/${target.name}.pdf`),
    source: JSON.parse(await fs.readFile(`tests/fixtures/${target.directory}/${target.name}-report.json`, 'utf8')).sourceText,
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
        const points = [{label:'heading-word',x:85,y:97,expected:'Browser'},
          {label:'script-word',x:file.label.startsWith('words')?80:714,y:159,expected:file.label.startsWith('words')?'हिन्दी':file.label.startsWith('arabic')?'اللغة':'שלום'}];
        const selections=[];
        for(const point of points){
          const r=geometry.rect;
          if(!geometry.scroller)throw Error('Viewer scroll container unavailable');
          const x=geometry.scroller.x+r.x+point.x*r.width/794, y=geometry.scroller.y+r.y+point.y*r.height/1123;
          await page.mouse.dblclick(x,y,{delay:80});
          await page.waitForTimeout(150);
          const selected=await frame.evaluate(async()=>document.querySelector('pdf-viewer').pluginController_.getSelectedText());
          selections.push({...point,x,y,selectedText:selected.selectedText,match:selected.selectedText?.trim()===point.expected});
        }
        await page.screenshot({path:`tests/fixtures/pdfkit-browser-20261011/word-offset-${file.label}.png`});
        results.push({label:file.label,file:file.file,sha256:crypto.createHash('sha256').update(file.bytes).digest('hex'),geometry,selections});
        console.log(JSON.stringify({label:file.label,geometry,selections}));

      } catch (error) {
        results.push({ label: file.label, error: error.message });
      } finally { await page.close(); }
    }
    await fs.writeFile(destination, JSON.stringify({ at: new Date().toISOString(), browser: browser.version(), method: 'Double-click a visible word in isolated Chrome PDF viewer, then read actual selected text; no system clipboard.', results }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
