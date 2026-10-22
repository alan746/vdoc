import { readFileSync } from 'node:fs';
import { getSchema, type JSONContent } from '@tiptap/core';
import { expect, it } from 'vitest';
import { createExtensions } from '../lib/editor/extensions';
import { exportPlainText } from '../lib/infrastructure/export/plain-text';
import { languageSamples, unicodeSamples } from './multilingual-fixtures';

const schema = getSchema(createExtensions());
const text = (value: string): JSONContent => ({ type: 'text', text: value });
const p = (value: string): JSONContent => ({ type: 'paragraph', ...(value ? { content: [text(value)] } : {}) });
const cell = (value: string, attrs = {}): JSONContent => ({ type: 'tableCell', attrs, content: [p(value)] });
const row = (...cells: JSONContent[]): JSONContent => ({ type: 'tableRow', content: cells });
const table = (...rows: JSONContent[]): JSONContent => ({ type: 'table', content: rows });
const item = (...blocks: JSONContent[]): JSONContent => ({ type: 'listItem', content: blocks });
const list = (type: string, content: JSONContent[], attrs = {}): JSONContent => ({ type, attrs, content });
function output(content: JSONContent[], attrs = {}) {
  const doc = schema.nodeFromJSON({ type: 'doc', attrs, content }); doc.check();
  const before = doc.toJSON(); const result = exportPlainText(doc); expect(doc.toJSON()).toEqual(before); return result;
}

it('exports the real downloaded merged-table sample without container-generated blank paragraphs', () => {
  const backup = JSON.parse(readFileSync('tests/fixtures/local-download/mixed.vdoc.json', 'utf8'));
  expect(exportPlainText(schema.nodeFromJSON(backup.content))).toBe('Mixed document 中文 العربية\n\n"Image cell 日本語\n[Image: 图片 العربية]"\tTop 中文\n\tأسفل\n\nEnd of mixed sample.');
});
it('keeps both axes of a merged table and empty cells without duplicating merged text', () => {
  expect(output([table(row(cell('A', { rowspan: 2, colspan: 2 }), cell('B')), row(cell('C')), row(cell('D'), cell(''), cell('E')))])).toBe('A\t\tB\n\t\tC\nD\t\tE');
});
it('preserves tabs, quotes and multiple paragraphs inside a cell using quoted fields', () => {
  const left = cell('First\t"quoted"'); left.content!.push(p('第二行'), p(''));
  expect(output([table(row(left, cell('right')))])).toBe('"First\t""quoted""\n第二行\n"\tright');
});
it('preserves nested table text inside its outer cell without flattening column boundaries', () => {
  const outer = cell('Before'); outer.content!.push(table(row(cell('Nested A'), cell('Nested B'))), p('After'));
  expect(output([table(row(outer, cell('Outer B')))])).toBe('"Before\nNested A\tNested B\nAfter"\tOuter B');
});
it('keeps RTL tables in logical reading order and all 40 languages and Unicode samples unchanged', () => {
  const values = [...languageSamples.map(([, value]) => value), ...unicodeSamples];
  const data = table(...values.map(value => row(cell(value), cell('123')))); data.attrs = { columnDirection: 'rtl' };
  expect(output([data])).toBe(values.map(value => `${value}\t123`).join('\n'));
});
it('preserves intentional empty paragraphs, hard breaks, code indentation and edge whitespace', () => {
  expect(output([p('  Before '), p(''), { type: 'paragraph', content: [text('Line 1'), { type: 'hardBreak' }, text('Line 2')] }, { type: 'codeBlock', content: [text('  code\n\tsecond\n')] }, p('After  ')])).toBe('  Before \n\n\n\nLine 1\nLine 2\n\n  code\n\tsecond\n\n\nAfter  ');
});
it('retains nested list markers, item continuation lines and checked state', () => {
  const tasks = list('taskList', [{ type: 'taskItem', attrs: { checked: true }, content: [p('Done')] }, { type: 'taskItem', attrs: { checked: false }, content: [p('Pending')] }]);
  const bullets = list('bulletList', [item(p('Nested'), tasks)], { bulletText: '✅' });
  expect(output([list('orderedList', [item(p('Main'), p('More'), bullets), item(p('Next'))], { start: 7 })])).toBe('7. Main\n  More\n  ✅ Nested\n    [x] Done\n    [ ] Pending\n8. Next');
});
it.each([
  ['a', 26, 'z', 'aa'], ['A', 27, 'AA', 'AB'], ['i', 4, 'iv', 'v'], ['I', 3999, 'MMMCMXCIX', '4000'], ['a', 0, '0', 'a'],
] as const)('retains %s numbering from %s with custom prefix and suffix', (type, start, first, second) => {
  expect(output([list('orderedList', [item(p('One')), item(p('Two'))], { start, type, numberPrefix: '(', numberSuffix: ')' })])).toBe(`(${first}) One\n(${second}) Two`);
});
it('uses stored continuation starts and keeps independent series separate', () => {
  expect(output([list('orderedList', [item(p('First'))], { start: 5 }), p('Break'), list('orderedList', [item(p('Continued'))], { start: 6, continuePrevious: true }), list('orderedList', [item(p('Restarted'))], { start: 1 })])).toBe('5. First\n\nBreak\n\n6. Continued\n\n1. Restarted');
});
it('retains footnote references and note text from body and merged cells exactly once', () => {
  const note = (value: string): JSONContent => ({ type: 'footnote', attrs: { number: 99, text: value } });
  const merged = cell('Cell', { rowspan: 2 }); merged.content![0].content!.push(note('جدول\n第二行'));
  expect(output([{ type: 'paragraph', content: [text('Body'), note('中文 note')] }, table(row(merged, cell('A')), row(cell('B')))])).toBe('Body[1]\n\nCell[2]\tA\n\tB\n\nNotes\n[1] 中文 note\n[2] جدول\n第二行');
});
it('includes image descriptions, contents, page break, divider and document header/footer', () => {
  expect(output([{ type: 'image', attrs: { src: 'data:image/png;base64,AA==', alt: '中文 diagram' } }, { type: 'tableOfContents', attrs: { items: [{ level: 1, text: 'Title' }, { level: 2, text: 'Child' }] } }, { type: 'horizontalRule' }, { type: 'pageBreak' }, { type: 'blockquote', content: [p('Quoted'), p('Next')] }], { header: 'Header', footer: 'Footer' })).toBe('Header\n\n[Image: 中文 diagram]\n\nContents\nTitle\n  Child\n\n---\n\n\f\n\n> Quoted\n> \n> Next\n\nFooter');
});

it('exports a large table with every row and column in order', () => {
  const rows = Array.from({ length: 1000 }, (_, r) => row(...Array.from({ length: 6 }, (_, c) => cell(`${r}:${c} 中文`))));
  expect(output([table(...rows)])).toBe(Array.from({ length: 1000 }, (_, r) => Array.from({ length: 6 }, (_, c) => `${r}:${c} 中文`).join('\t')).join('\n'));
});
