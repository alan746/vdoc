const encoding=process.env.VDOC_QA_READER_VARIANT||'bidi-runs';
if(!['bidi-runs','whole-cluster','cluster-actual','local-clusters','record-actual'].includes(encoding))throw Error('Unknown QA reader variant');
// Check actual PDF text-fragment highlighting in a fresh, isolated Chrome viewer.
// No system clipboard, user browser session, or PDF rewriting is used.
const fs = require('node:fs/promises');
const http = require('node:http');
const crypto = require('node:crypto');
const { chromium } = require('/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const targets = ['words','arabic','hebrew','arabic-marked','hebrew-marked'].map(label=>({label,directory:'browser-unicode-20261011',name:label.replace('-marked','')+'-unicode-ordered-'+encoding+(label.endsWith('-marked')?'-marked':'')}));
const destination = `tests/fixtures/reader-control-20261011/search-${encoding}.json`;
const collapse = value => value.replace(/\s+/gu, ' ').trim();

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
        const target=file.report.targets.find(item=>item.line===1);
        if(!target)throw Error('Missing own source word geometry');
        const query=target.expected;
        await page.screenshot({path:`tests/fixtures/reader-control-20261011/search-${encoding}-${file.label}-before.png`});
        await frame.evaluate(query=>document.querySelector('pdf-viewer').pluginController_.highlightTextFragments([encodeURIComponent(query)]),query);
        await page.waitForTimeout(350);
        await page.screenshot({path:`tests/fixtures/reader-control-20261011/search-${encoding}-${file.label}-match.png`});
        await frame.evaluate(()=>document.querySelector('pdf-viewer').pluginController_.highlightTextFragments(['VDOC_ABSENT_854e1ca9']));
        await page.waitForTimeout(350);
        await page.screenshot({path:`tests/fixtures/reader-control-20261011/search-${encoding}-${file.label}-absent.png`});
        results.push({label:file.label,file:file.file,sha256:crypto.createHash('sha256').update(file.bytes).digest('hex'),query,target,geometry,negativeQuery:'VDOC_ABSENT_854e1ca9',method:'Actual PDF plugin text-fragment search; screenshot highlights need independent inspection. Not Cmd-F UI acceptance.'});
        console.log(JSON.stringify({label:file.label,query}));

      } catch (error) {
        results.push({ label: file.label, error: error.message });
      } finally { await page.close(); }
    }
    await fs.writeFile(destination, JSON.stringify({ at: new Date().toISOString(), browser: browser.version(), method: 'Actual PDF plugin text-fragment search with positive and absent controls; inspect screenshots. Not Cmd-F UI acceptance.', results }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
