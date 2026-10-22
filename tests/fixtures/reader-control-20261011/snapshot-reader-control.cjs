// QA-only: Chrome's own print renderer is a control, not a browser export API.
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { chromium } = require('/Users/ph.qian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixture = 'tests/fixtures/reader-control-20261011';
const output = 'output/pdf/reader-control-20261011';
const variants = ['words', 'arabic', 'hebrew', 'arabic-marked', 'hebrew-marked'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
(async () => {
  await fs.mkdir(fixture, { recursive: true }); await fs.mkdir(output, { recursive: true });
  for (const name of variants) {
    try { await fs.access(`${output}/${name}.pdf`); throw Error('Refuse overwrite'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    for (const name of variants) {
      const script = name.split('-')[0];
      const fontName = { words: 'Devanagari', arabic: 'Arabic', hebrew: 'Hebrew' }[script];
      const font = await fs.readFile(`tests/fixtures/browser-pdf-20261011/fonts/NotoSans${fontName}-static.ttf`);
      const source = JSON.parse(await fs.readFile(`tests/fixtures/browser-unicode-20261011/${script}-unicode-ordered${name.endsWith('-marked') ? '-marked' : ''}-report.json`, 'utf8')).sourceText;
      const context = await browser.newContext({ viewport: { width: 900, height: 1200 } });
      try {
        await context.route('**/*', route => route.abort());
        const page = await context.newPage();
        await page.setContent(`<meta charset="utf-8"><style>
          @font-face{font-family:QA;src:url(data:font/ttf;base64,${font.toString('base64')})}
          @page{size:794px 1123px;margin:0}*{box-sizing:border-box}body{margin:0;font:400 22px QA}
          #fixture{width:794px;height:1123px;padding:60px}.line{line-height:2;margin:18px 0;white-space:pre}
          table{border-collapse:collapse;width:100%;margin-top:32px}td{border:1px solid #a6adbd;padding:12px;background:#fafafc;line-height:2}
          </style><main id="fixture"></main>`);
        const report = await page.evaluate(async ({ source, script }) => {
          const root = document.querySelector('#fixture'); const lines = source.split('\n');
          for (const [index, text] of lines.slice(0, 4).entries()) {
            const line = document.createElement('div'); line.className = 'line';
            if (script !== 'words' && index > 0) line.dir = 'rtl';
            line.textContent = text; root.append(line);
          }
          const table = document.createElement('table');
          for (const line of lines.slice(4)) {
            const row = table.insertRow(); for (const text of line.split('\t')) row.insertCell().textContent = text;
          }
          root.append(table); await document.fonts.load('22px QA'); await document.fonts.ready;
          const before = root.innerHTML, targets = [];
          for (const [lineIndex, line] of [...root.querySelectorAll('.line')].entries()) {
            const words = [...line.textContent.matchAll(/\S+/gu)];
            for (const index of new Set([0, words.length - 1])) {
              const word = words[index]; const range = document.createRange();
              range.setStart(line.firstChild, word.index); range.setEnd(line.firstChild, word.index + word[0].length);
              const rect = range.getBoundingClientRect();
              targets.push({ line: lineIndex, expected: word[0], x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
            }
          }
          return { sourceText: root.innerText, html: before, targets, width: 794, height: 1123 };
        }, { source, script });
        if (report.sourceText !== source) throw Error('Source text changed');
        await page.locator('#fixture').screenshot({ path: `${fixture}/${name}-browser.png` });
        const bytes = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true });
        if (await page.locator('#fixture').innerHTML() !== report.html) throw Error('Source mutated while printing');
        delete report.html;
        await fs.writeFile(`${output}/${name}.pdf`, bytes, { flag: 'wx' });
        await fs.writeFile(`${fixture}/${name}-report.json`, JSON.stringify({ ...report, sha256: hash(bytes), sourceUnchanged: true, fontSha256: hash(font), renderer: browser.version(), method: 'Playwright page.pdf native print control; not a shipping browser API' }, null, 2), { flag: 'wx' });
        console.log(JSON.stringify({ name, targets: report.targets.length, sha256: hash(bytes) }));
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
