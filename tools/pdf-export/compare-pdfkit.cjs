// QA-only browser comparison. No application dependency or export button imports this.
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const runtime = '/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = require(runtime + '/playwright');
const script = process.argv[2] || 'words';
const marked = process.argv.includes('--marked');
const fullRun = !process.argv.includes('--cached');
if (!['words', 'arabic', 'hebrew'].includes(script) || (marked && script === 'words')) throw Error('Invalid fixture');
const name = `${script}${marked ? '-marked' : ''}-${fullRun ? 'full-run' : 'cached'}`;
const fixture = 'tests/fixtures/pdfkit-browser-20261011';
const output = 'output/pdf/pdfkit-browser-20261011';
const fontName = { words: 'Devanagari', arabic: 'Arabic', hebrew: 'Hebrew' }[script];
const assets = {
  '/pdfkit.js': 'tmp/pdfkit-browser-20261011/package/js/pdfkit.standalone.js',
  '/font.ttf': `tests/fixtures/browser-pdf-20261011/fonts/NotoSans${fontName}-static.ttf`,
};
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:QA;src:url('/font.ttf')}*{box-sizing:border-box}
body{margin:0;background:white;font-family:QA;font-size:22px;font-weight:400}
#fixture{width:794px;height:1123px;padding:60px;background:white}
.line{line-height:2;margin:18px 0}.token{display:inline-block;white-space:pre;font-weight:400}
.baseline{display:inline-block;width:0;height:0;vertical-align:baseline}
table{border-collapse:collapse;width:100%;margin-top:32px}td{border:1px solid #a6adbd;padding:12px;background:#fafafc;line-height:2}
</style><main id="fixture"></main><script src="/pdfkit.js"></script>`;

(async () => {
  await fs.mkdir(fixture, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  const file = path.join(output, name + '.pdf');
  try { await fs.access(file); throw Error('Refuse overwrite: ' + file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const prior = JSON.parse(await fs.readFile(`tests/fixtures/browser-unicode-20261011/${script}-unicode-ordered${marked ? '-marked' : ''}-report.json`, 'utf8'));
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const requests = [];
  try {
    const context = await browser.newContext({ viewport: { width: 900, height: 1200 } });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://127.0.0.1:4192') throw Error('External request refused');
      requests.push(url.pathname);
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
      const asset = assets[url.pathname];
      if (!asset) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ contentType: url.pathname.endsWith('.ttf') ? 'font/ttf' : 'text/javascript', body: await fs.readFile(asset) });
    });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4192/');
    const result = await page.evaluate(async ({ sourceText, script, fullRun, name }) => {
      const root = document.querySelector('#fixture');
      const lines = sourceText.split('\n');
      function fill(element, text) {
        for (const word of text.split(/(\s+)/).filter(Boolean)) {
          const token = document.createElement('span'); token.className = 'token'; token.textContent = word;
          const baseline = document.createElement('i'); baseline.className = 'baseline'; token.append(baseline); element.append(token);
        }
      }
      for (const [index, text] of lines.slice(0, 4).entries()) {
        const line = document.createElement('div'); line.className = 'line';
        if (script !== 'words' && index > 0) line.dir = 'rtl';
        fill(line, text); root.append(line);
      }
      const table = document.createElement('table');
      for (const line of lines.slice(4)) {
        const row = table.insertRow(); for (const cell of line.split('\t')) fill(row.insertCell(), cell);
      }
      root.append(table); await document.fonts.load('22px QA'); await document.fonts.ready;
      const before = root.innerHTML;
      const font = new Uint8Array(await (await fetch('/font.ttf')).arrayBuffer());
      const Constructor = window.PDFDocument.PDFDocument || window.PDFDocument;
      const doc = new Constructor({ font: null, size: [794 * .75, 1123 * .75], margin: 0 });
      const chunks = [];
      const completed = new Promise((resolve, reject) => {
        doc.on('data', chunk => chunks.push(chunk)); doc.on('end', resolve); doc.on('error', reject);
      });
      doc.font(font).fontSize(16.5);
      const bounds = root.getBoundingClientRect(), measurements = [];
      for (const cell of root.querySelectorAll('td')) {
        const rect = cell.getBoundingClientRect();
        doc.rect((rect.x - bounds.x) * .75, (rect.y - bounds.y) * .75, rect.width * .75, rect.height * .75)
          .lineWidth(.5).fillAndStroke('#fafafc', '#a6adbd');
      }
      doc.fillColor('black');
      for (const block of root.querySelectorAll('.line,td')) {
        const tokens = [...block.querySelectorAll('.token')];
        const text = tokens.map(token => token.firstChild.textContent).join('');
        const rects = tokens.map(token => token.getBoundingClientRect());
        const left = Math.min(...rects.map(rect => rect.left));
        const right = Math.max(...rects.map(rect => rect.right));
        const baseline = tokens[0].querySelector('.baseline').getBoundingClientRect().top;
        const options = { lineBreak: false, baseline: 'alphabetic', ...(fullRun ? { features: [] } : {}) };
        const width = doc.widthOfString(text, options) / .75;
        measurements.push({ text, domWidth: right - left, fontWidth: width, delta: Math.abs(width - right + left) });
        doc.text(text, (left - bounds.x) * .75, (baseline - bounds.y) * .75, options);
      }
      doc.end(); await completed;
      const blob = new Blob(chunks, { type: 'application/pdf' });
      const bytes = await blob.arrayBuffer();
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(x => x.toString(16).padStart(2, '0')).join('');
      const link = document.createElement('a'); link.id = 'download'; link.href = URL.createObjectURL(blob);
      link.download = name + '.pdf'; link.textContent = 'Download QA comparison'; document.body.append(link);
      return { sourceText: root.innerText, sourceUnchanged: root.innerHTML === before, sha256, measurements, fullRun, engine: 'pdfkit@0.20.2' };
    }, { sourceText: prior.sourceText, script, fullRun, name });
    await page.locator('#fixture').screenshot({ path: `${fixture}/${name}-browser.png` });
    const pending = page.waitForEvent('download'); await page.locator('#download').click();
    const download = await pending; await download.saveAs(file);
    if (await download.failure()) throw Error('Download failed');
    const sha256 = crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
    if (sha256 !== result.sha256 || !result.sourceUnchanged) throw Error('Download or source integrity failed');
    await page.evaluate(() => URL.revokeObjectURL(document.querySelector('#download').href));
    await fs.writeFile(`${fixture}/${name}-report.json`, JSON.stringify({ ...result, download: { sha256 }, requests }, null, 2));
    console.log(JSON.stringify({ file, sourceUnchanged: result.sourceUnchanged, maxWidthDelta: Math.max(...result.measurements.map(x => x.delta)) }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
