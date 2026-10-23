import { expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import JSZip from 'jszip';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { parseDocument } from '../lib/infrastructure/persistence/document-codec';
import { cellBorder } from '../lib/editor/table/table-borders';
import { colorToHex } from '../lib/domain/text/color';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
const p = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const cell = (text: string, attrs: Record<string, unknown>): JSONContent => ({ type: 'tableCell', attrs, content: [p(text)] });

it.each([1, 2])('preserves cell formatting and column widths around combined merges after %s Word round trips', async rounds => {
  const input: JSONContent = { type: 'doc', content: [{ type: 'table', attrs: { alignment: 'center', pinnedRows: 0 }, content: [
    { type: 'tableRow', content: [cell('Merged 中文 العربية', { rowspan: 2, colspan: 2, colwidth: [90, 150], backgroundColor: '#FFF0AD', padding: 14, verticalAlign: 'middle', borders: { top: { width: 3, color: '#CC0000', style: 'dashed' }, right: { width: 0, color: '#000000', style: 'solid' } } }), cell('Right 日本語', { colwidth: [180], backgroundColor: '#D8EFDE', padding: 6, verticalAlign: 'bottom' })] },
    { type: 'tableRow', content: [cell('Below يمين', { colwidth: [180], backgroundColor: '#EADFF6', padding: 18 })] },
    { type: 'tableRow', content: [cell('A', { colwidth: [90] }), cell('B', { colwidth: [150] }), cell('C', { colwidth: [180] })] },
  ] }] };
  let content = input;
  for (let i = 0; i < rounds; i++) content = (await importWord(await bytes(await exportWord(content, 'Merged formatting')))).content;
  const table = parseDocument(JSON.stringify({ version: 1, title: 'Merged', content })).content.content![0];
  const merged = table.content![0].content![0], right = table.content![0].content![1], below = table.content![1].content![0];
  expect(merged.attrs).toMatchObject({ rowspan: 2, colspan: 2, colwidth: [90, 150], padding: 14, verticalAlign: 'middle' });
  expect(colorToHex(merged.attrs!.backgroundColor)).toBe('#FFF0AD');
  expect({ ...cellBorder(merged.attrs!, 'top'), color: colorToHex(cellBorder(merged.attrs!, 'top').color) }).toEqual({ width: 3, color: '#CC0000', style: 'dashed' });
  expect(cellBorder(merged.attrs!, 'right').width).toBe(0);
  expect(right.attrs).toMatchObject({ colwidth: [180], padding: 6, verticalAlign: 'bottom' }); expect(colorToHex(right.attrs!.backgroundColor)).toBe('#D8EFDE');
  expect(below.attrs).toMatchObject({ colwidth: [180], padding: 18 }); expect(colorToHex(below.attrs!.backgroundColor)).toBe('#EADFF6');
  expect(table.content![2].content!.map(c => c.attrs!.colwidth)).toEqual([[90], [150], [180]]);
});

it('does not borrow a nested table cell style when an outer cell has no explicit properties', async () => {
  const input: JSONContent = { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('Outer'), { type: 'table', attrs: { columnDirection: 'rtl', alignment: 'right' }, content: [{ type: 'tableRow', content: [cell('Nested العربية', { backgroundColor: '#EADFF6', padding: 18, verticalAlign: 'bottom', colwidth: [120] })] }] }, p('After')] }] }] }] };
  const zip = await JSZip.loadAsync(await bytes(await exportWord(input, 'Nested styles')));
  const xml = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const outer = xml.getElementsByTagNameNS(w, 'tbl')[0];
  Array.from(outer.children).filter(node => ['tblPr', 'tblGrid'].includes(node.localName)).forEach(node => node.remove());
  const outerCell = xml.getElementsByTagNameNS(w, 'tc')[0];
  Array.from(outerCell.children).find(node => node.localName === 'tcPr')?.remove();
  zip.file('word/document.xml', new XMLSerializer().serializeToString(xml));
  const output = await importWord(await zip.generateAsync({ type: 'arraybuffer' }));
  const table = output.content.content![0], parent = table.content![0].content![0], nested = parent.content!.find(node => node.type === 'table')!;
  expect(table.attrs).toMatchObject({ columnDirection: 'ltr', alignment: 'left' });
  expect(parent.attrs).toMatchObject({ backgroundColor: null, padding: null, colwidth: null, verticalAlign: 'top' });
  expect(nested.attrs).toMatchObject({ columnDirection: 'rtl', alignment: 'right' });
  expect(nested.content![0].content![0].attrs).toMatchObject({ padding: 18, colwidth: [120], verticalAlign: 'bottom' });
});

it('keeps nested vertical merges and their styles separate from surrounding outer cells', async () => {
  const inner: JSONContent = { type: 'table', attrs: { columnDirection: 'rtl', alignment: 'right' }, content: [
    { type: 'tableRow', content: [cell('Same العربية', { rowspan: 2, backgroundColor: '#EADFF6', padding: 18, colwidth: [100] }), cell('Same العربية', { backgroundColor: '#D8EFDE', padding: 4, colwidth: [140] })] },
    { type: 'tableRow', content: [cell('Same العربية', { backgroundColor: '#FFF0AD', padding: 8, colwidth: [140] })] },
  ] };
  const outerCell = cell('Same العربية', { backgroundColor: '#DCE3ED', padding: 12, colwidth: [300] }); outerCell.content!.push(inner, p('After nested table'));
  const input: JSONContent = { type: 'doc', content: [{ type: 'table', attrs: { columnDirection: 'ltr', alignment: 'center' }, content: [
    { type: 'tableRow', content: [outerCell, cell('Sibling', { padding: 6, colwidth: [180] })] },
    { type: 'tableRow', content: [cell('Next row', { padding: 7, colwidth: [300] }), cell('Last', { padding: 9, colwidth: [180] })] },
  ] }] };
  const output = await importWord(await bytes(await exportWord(input, 'Nested merges')));
  const outer = output.content.content![0], parent = outer.content![0].content![0], nested = parent.content!.find(node => node.type === 'table')!;
  expect(outer.attrs).toMatchObject({ columnDirection: 'ltr', alignment: 'center' });
  expect(parent.attrs).toMatchObject({ padding: 12, colwidth: [300] }); expect(colorToHex(parent.attrs!.backgroundColor)).toBe('#DCE3ED');
  expect(outer.content![1].content!.map(c => c.attrs!.padding)).toEqual([7, 9]);
  expect(nested.attrs).toMatchObject({ columnDirection: 'rtl', alignment: 'right' });
  expect(nested.content![0].content![0].attrs).toMatchObject({ rowspan: 2, padding: 18, colwidth: [100] });
  expect(nested.content!.flatMap(row => row.content!).map(c => colorToHex(c.attrs!.backgroundColor))).toEqual(['#EADFF6', '#D8EFDE', '#FFF0AD']);
  expect(nested.content![1].content![0].attrs).toMatchObject({ padding: 8, colwidth: [140] });
  parseDocument(JSON.stringify({ version: 1, title: 'Nested', content: output.content }));
});
