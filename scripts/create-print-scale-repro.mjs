// Run with Node's TypeScript stripping support; no browser or user data access.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { installPreviewPrintStyle } from '../lib/infrastructure/preview/preview-print.ts';

const destination = new URL('../tests/fixtures/safari-print-scale/', import.meta.url);
await mkdir(destination, { recursive: true });
const source = await readFile(new URL('../lib/infrastructure/preview/preview-print.ts', import.meta.url));
const sourceHash = createHash('sha256').update(source).digest('hex');
const outputs = [];
for (const [name, fixed] of [['full-sheet', true], ['intrinsic-height-control', false]]) {
  const dom = new JSDOM('<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body></body></html>');
  const { document } = dom.window;
  document.title = `VDoc Safari print scale — ${name}`;
  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px Arial, sans-serif; color: #111; background: #eee; }
    .instructions { padding: 20px; max-width: 850px; margin: auto; }
    .pagedjs_page { background: white; width: 210mm; margin: 16px auto; box-shadow: 0 1px 5px #999; }
    .pagedjs_sheet { width: 210mm; }
    .probe { padding: 20mm; height: 100mm; }
    h1 { font-size: 22px; margin: 0 0 12px; }
    p { margin: 12px 0; }
    @media print { .instructions { display: none !important; } }
  `;
  document.head.appendChild(style);
  const instructions = document.createElement('section');
  instructions.className = 'instructions';
  const label = document.createElement('h1'); label.textContent = document.title;
  const note = document.createElement('p');
  note.textContent = `Diagnostic fixture, not a VDoc document. Two short content blocks; no table, images, fonts from the network, or Paged.js runtime. Variant: ${name}. Print in Safari using A4 portrait at 100%, then 101%, keeping all other settings identical. Save each PDF under a different name.`;
  const hash = document.createElement('p'); hash.textContent = `Production print source SHA-256: ${sourceHash}`;
  const button = document.createElement('button'); button.textContent = 'Print diagnostic';
  button.setAttribute('onclick', 'window.print()');
  instructions.append(label, note, hash, button);
  const pages = document.createElement('div'); pages.id = 'preview-pages';
  const group = document.createElement('div'); group.className = 'pagedjs_pages';
  for (let n = 1; n <= 2; n++) {
    const page = document.createElement('section'); page.className = 'pagedjs_page';
    page.innerHTML = `<div class="pagedjs_sheet"><div class="probe"><h1>VDOC SCALE PROBE ${n} / 2</h1><p>START_${n} — English 中文 العربية 日本語</p><p>This short block should fit on one physical page at either tested scale.</p><p>END_${n} — No content follows this marker on this logical page.</p></div></div>`;
    group.appendChild(page);
  }
  pages.appendChild(group); document.body.append(instructions, pages);
  installPreviewPrintStyle(document, { type: 'doc', attrs: { pageSize: 'a4', orientation: 'portrait' } });
  if (!fixed) {
    const control = document.createElement('style');
    // Deliberately not a proposed product fix: real pre-paginated sheets have
    // positioned headers/footers and full-height content absent from this probe.
    control.textContent = '@media print { #preview-pages .pagedjs_page, #preview-pages .pagedjs_sheet { height: auto !important; } }';
    document.head.appendChild(control);
  }
  const html = dom.serialize();
  await writeFile(new URL(`${name}.html`, destination), html);
  outputs.push({ file: `${name}.html`, sha256: createHash('sha256').update(html).digest('hex'), variant: fixed ? 'Current production print CSS' : 'Only page/sheet height overridden to auto' });
  dom.window.close();
}
await writeFile(new URL('manifest.json', destination), JSON.stringify({ productionPrintSourceSha256: sourceHash, expectedLogicalPages: 2, outputs }, null, 2) + '\n');
console.log('Created two standalone print probes and their source/file hashes. No Safari printing has been performed.');
