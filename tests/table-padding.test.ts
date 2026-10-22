import { expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { parseDocument } from '../lib/editor/storage';
import { fitPreviewTables } from '../lib/editor/preview-layout';
import { exportWord, importWord } from '../lib/editor/word';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
it.each([0, 0.4, 2.4, 10.8])('preserves %s px padding on headers and cells through HTML, backup and Word', async padding => {
  const input: JSONContent = { type: 'doc', content: [{ type: 'table', attrs: { pinnedRows: 1 }, content: ['tableHeader', 'tableCell'].map((type, index) => ({ type: 'tableRow', content: [{ type, attrs: { padding, colwidth: [300] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: index ? 'Body العربية' : 'Header 中文' }] }] }] })) }] };
  const editor = new Editor({ extensions: createExtensions(), content: input });
  await new Promise(resolve => setTimeout(resolve, 0));
  const original = editor.getJSON(), htmlEditor = new Editor({ extensions: createExtensions(), content: editor.getHTML() });
  try {
    const fromBackup = parseDocument(JSON.stringify({ version: 1, title: 'Padding', content: original })).content;
    const fromWord = (await importWord(await bytes(await exportWord(original, 'Padding')))).content;
    for (const doc of [htmlEditor.getJSON() as JSONContent, fromBackup, fromWord]) {
      const rows = doc.content![0].content!;
      expect(rows[0].content![0].type).toBe('tableHeader'); expect(rows[1].content![0].type).toBe('tableCell');
      for (const row of rows) expect(row.content![0].attrs!.padding).toBeCloseTo(padding, 6);
      expect(rows.map(row => row.content![0].content![0].content![0].text)).toEqual(['Header 中文', 'Body العربية']);
    }
    expect(editor.getJSON()).toEqual(original);
  } finally { htmlEditor.destroy(); editor.destroy(); }
});

function nested(style: string) {
  const root = document.createElement('div');
  root.innerHTML = `<table style="width:600px"><colgroup><col style="width:200px"><col style="width:400px"></colgroup><tbody><tr><td style="${style}"><p>Outer 中文</p><table style="width:1000px"><colgroup><col style="width:400px"><col style="width:600px"></colgroup><tbody><tr><td><p>Inner العربية</p></td><td><p>Second 日本語</p></td></tr></tbody></table></td><td><p>Other cell</p></td></tr></tbody></table>`;
  return root;
}
it.each([[0, 197], [0.4, 196.2], [10, 177], [null, 177]] as const)('fits nested tables using the actual %s px cell padding', (padding, width) => {
  const source = nested(padding === null ? '' : `padding:${padding}px`), before = source.innerHTML;
  const root = source.cloneNode(true) as HTMLElement, text = root.textContent;
  expect(fitPreviewTables(root, 601)).toBe(1);
  const inner = root.querySelectorAll('table')[1];
  expect(parseFloat(inner.style.width)).toBeCloseTo(width, 6);
  const columns = Array.from(inner.querySelectorAll('col')).map(col => parseFloat(col.style.width));
  expect(columns[0] / columns[1]).toBeCloseTo(2 / 3, 6);
  expect(root.textContent).toBe(text); expect(source.innerHTML).toBe(before);
  expect(fitPreviewTables(root, 601)).toBe(0);
});
it('uses horizontal CSS padding when the serialized cell has a shorthand or separate sides', () => {
  for (const style of ['padding:4px 30px 8px 0px', 'padding-top:4px;padding-right:30px;padding-bottom:8px;padding-left:0px']) {
    const root = nested(style); fitPreviewTables(root, 601);
    expect(parseFloat(root.querySelectorAll('table')[1].style.width)).toBeCloseTo(167, 6);
  }
});
