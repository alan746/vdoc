// Read actual PDFium selection from a fresh, isolated Chrome PDF viewer.
// No system clipboard, user browser session, or PDF rewriting is used.
const fs = require('node:fs/promises');
const http = require('node:http');
const crypto = require('node:crypto');
const { chromium } = require('/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const singleString = process.env.VDOC_CHROME_SELECTION_SET === 'single-string';
const singleTJ = process.env.VDOC_CHROME_SELECTION_SET === 'single-tj';
const actualWord = process.env.VDOC_CHROME_SELECTION_SET === 'actualtext-word';
const actualText = singleString || singleTJ || actualWord || process.env.VDOC_CHROME_SELECTION_SET === 'actualtext';
const legacy = process.env.VDOC_CHROME_SELECTION_SET === 'legacy';
const targets = actualText ? ['words','arabic','hebrew','arabic-marked','hebrew-marked'].map(name => ({label:'actualtext-'+name,directory:'browser-unicode-20261011',name:name.replace('-marked','')+'-unicode-ordered'+(singleString?'-single-string':singleTJ?'-single-tj':'-actualtext'+(actualWord?'-word':''))+(name.endsWith('-marked')?'-marked':'')})) : legacy ? ['arabic', 'hebrew'].flatMap(script => [
  { label: 'cluster-' + script, directory: 'browser-pdf-20261011', name: script + '-cluster-contiguous' },
  { label: 'word-' + script, directory: 'browser-pdf-20261011', name: script },
  { label: 'unicode-word-' + script, directory: 'browser-unicode-20261011', name: script + '-unicode' },
]) : [
  ...['words', 'arabic', 'hebrew', 'arabic-marked', 'hebrew-marked'].map(name => ({
    label: 'unicode-' + name,
    directory: 'browser-unicode-20261011',
    name: name.replace('-marked', '') + '-unicode-ordered' + (name.endsWith('-marked') ? '-marked' : ''),
  })),
  ...['words', 'arabic', 'hebrew', 'arabic-marked', 'hebrew-marked'].map(name => ({
    label: 'pdfkit-' + name, directory: 'pdfkit-browser-20261011', name: name + '-full-run',
  })),
  { label: 'cluster-hindi', directory: 'browser-pdf-20261011', name: 'words-cluster-contiguous' },
];
const destination = 'tests/fixtures/pdfkit-browser-20261011/chrome-selection' + (singleString ? '-single-string' : singleTJ ? '-single-tj' : actualWord ? '-actualtext-word' : actualText ? '-actualtext' : legacy ? '-legacy' : '') + '.json';
const collapse = value => value.replace(/\s+/gu, ' ').trim();

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
        const selected = await frame.evaluate(async () => {
          const viewer = document.querySelector('pdf-viewer');
          viewer.pluginController_.selectAll();
          return Promise.race([
            viewer.pluginController_.getSelectedText(),
            new Promise((_, reject) => setTimeout(() => reject(Error('Selection timeout')), 8000)),
          ]);
        });
        const text = selected.selectedText;
        if (typeof text !== 'string' || !text.trim()) throw Error('No selected PDF text returned');
        const result = {
          label: file.label, file: file.file, sha256: crypto.createHash('sha256').update(file.bytes).digest('hex'),
          source: file.source, selectedText: text,
          matchCollapsed: collapse(text) === collapse(file.source),
          sourceDigits: (file.source.match(/\d+/g) || []), selectedDigits: (text.match(/\d+/g) || []),
        };
        results.push(result);
        console.log(JSON.stringify({ label: result.label, matchCollapsed: result.matchCollapsed, selectedDigits: result.selectedDigits }));
        if (['unicode-words', 'unicode-arabic-marked', 'pdfkit-words'].includes(file.label)) {
          await page.screenshot({ path: `tests/fixtures/pdfkit-browser-20261011/chrome-${file.label}.png` });
        }
      } catch (error) {
        results.push({ label: file.label, error: error.message });
      } finally { await page.close(); }
    }
    await fs.writeFile(destination, JSON.stringify({ at: new Date().toISOString(), browser: browser.version(), method: 'Loaded local PDF in actual Chrome PDF viewer; selectAll/getSelectedText via its plugin controller. Not a system clipboard or AX-empty pass.', results }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
