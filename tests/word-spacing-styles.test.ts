import { afterEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import * as d from 'docx';
import JSZip from 'jszip';
import { createExtensions } from '../lib/editor/extensions';
import { parseDocument } from '../lib/editor/storage';
import { exportWord, importWord } from '../lib/editor/word';
import { restoreWordFormatting } from '../lib/editor/word-import-formatting';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const editors: Editor[] = [];
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob);
});
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
const style = (id: string, spacing: string, base = '', extra = '') => `<w:style w:type="paragraph" w:styleId="${id}" ${extra}><w:name w:val="${id === 'Heading2' ? 'heading 2' : id}"/>${base ? `<w:basedOn w:val="${base}"/>` : ''}<w:pPr><w:spacing ${spacing}/></w:pPr></w:style>`;
async function fixture(styles: string, children: (d.Paragraph | d.Table)[], defaults = '') {
  const zip = await JSZip.loadAsync(await bytes(await d.Packer.toBlob(new d.Document({ sections: [{ children }] }))));
  zip.file('word/styles.xml', `<w:styles xmlns:w="${W}"><w:docDefaults><w:pPrDefault><w:pPr><w:spacing ${defaults}/></w:pPr></w:pPrDefault></w:docDefaults>${styles}</w:styles>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}
function paragraphs(doc: JSONContent): JSONContent[] {
  return [...(['paragraph', 'heading'].includes(doc.type || '') ? [doc] : []), ...(doc.content || []).flatMap(paragraphs)];
}
function values(doc: JSONContent) {
  return paragraphs(doc).filter(node => node.content?.length).map(node => ({
    text: node.content!.map(child => child.text || '').join(''),
    before: node.attrs!.spaceBefore, after: node.attrs!.spaceAfter, line: node.attrs!.lineHeight,
  }));
}

it('resolves defaults, base/child/sibling styles and direct overrides in body, heading, list and table paragraphs', async () => {
  const styles = style('Normal', 'w:after="90"', '', 'w:default="1"') + style('Base', 'w:before="120" w:line="366" w:lineRule="exact"') + style('Child', 'w:after="150"', 'Base') + style('Sibling', 'w:before="300"', 'Base') + style('Heading2', '', 'Child') + style('ListParagraph', '', 'Child');
  const buffer = await fixture(styles, [
    new d.Paragraph('Default 中文'), new d.Paragraph({ text: 'Child العربية', style: 'Child' }),
    new d.Paragraph({ text: 'Sibling हिन्दी', style: 'Sibling' }),
    new d.Paragraph({ text: 'Override עברית', style: 'Child', spacing: { before: 0, line: 480, lineRule: d.LineRuleType.AUTO } }),
    new d.Paragraph({ text: 'Heading 日本語', heading: d.HeadingLevel.HEADING_2 }),
    new d.Paragraph({ text: 'List Français', bullet: { level: 0 } }),
    new d.Table({ rows: [new d.TableRow({ children: [new d.TableCell({ children: [new d.Paragraph({ text: 'Cell 👩‍💻', style: 'Child' })] })] })] }),
  ], 'w:before="30" w:after="60" w:line="360" w:lineRule="auto"');
  const originalBytes = new Uint8Array(buffer).slice(), result = await importWord(buffer);
  const expected = [
    { text: 'Default 中文', before: 2, after: 6, line: '1.5' },
    { text: 'Child العربية', before: 8, after: 10, line: '24.4px' },
    { text: 'Sibling हिन्दी', before: 20, after: 4, line: '24.4px' },
    { text: 'Override עברית', before: 0, after: 10, line: '2' },
    { text: 'Heading 日本語', before: 8, after: 10, line: '24.4px' },
    { text: 'List Français', before: 8, after: 10, line: '24.4px' },
    { text: 'Cell 👩‍💻', before: 8, after: 10, line: '24.4px' },
  ];
  expect(values(result.content)).toEqual(expected);
  expect(result.content.content!.some(node => node.type === 'heading')).toBe(true);
  expect(result.content.content!.some(node => node.type === 'bulletList')).toBe(true);
  expect(result.content.content!.some(node => node.type === 'table')).toBe(true);
  expect(result.warnings.filter(message => /spacing|style inheritance/.test(message))).toEqual([]);
  const editor = new Editor({ extensions: createExtensions(), content: result.content }); editors.push(editor);
  await new Promise(resolve => setTimeout(resolve, 0)); const original = editor.getJSON();
  const htmlEditor = new Editor({ extensions: createExtensions(), content: editor.getHTML() }); editors.push(htmlEditor);
  expect(htmlEditor.getJSON().content).toEqual(original.content);
  expect(parseDocument(JSON.stringify({ version: 1, title: 'Inherited spacing', content: original })).content).toEqual(original);
  let content: JSONContent = original;
  for (let i = 0; i < 2; i++) { content = (await importWord(await bytes(await exportWord(content, 'Styles')))).content; expect(values(content)).toEqual(expected); }
  expect(editor.getJSON()).toEqual(original); expect(new Uint8Array(buffer)).toEqual(originalBytes);
});

it.each([['w:lineRule="auto"', '2'], ['w:line="720"', '48px']])('inherits omitted spacing attributes separately from %s', async (child, expected) => {
  const buffer = await fixture(style('Base', 'w:line="480" w:lineRule="exact"') + style('Child', child, 'Base'), [new d.Paragraph({ text: 'Partial 中文', style: 'Child' })]);
  expect(values((await importWord(buffer)).content)[0].line).toBe(expected);
});

it.each([false, true])('warns for inherited minimum spacing only when it is effective (direct override: %s)', async override => {
  const buffer = await fixture(style('Base', 'w:line="360" w:lineRule="atLeast"') + style('Child', '', 'Base'), [new d.Paragraph({ text: 'Minimum العربية', style: 'Child', ...(override ? { spacing: { line: 480, lineRule: d.LineRuleType.AUTO } } : {}) })]);
  const result = await importWord(buffer);
  expect(result.warnings.filter(message => message.includes('line spacing'))).toHaveLength(override ? 0 : 1);
  expect(values(result.content)[0].line).toBe(override ? '2' : null);
});

it('falls back to the default paragraph style when the requested style is missing or is a character style', async () => {
  const buffer = await fixture(style('Normal', 'w:after="180"', '', 'w:default="1"') + '<w:style w:type="character" w:styleId="Run"><w:name w:val="Run"/><w:pPr><w:spacing w:after="900"/></w:pPr></w:style>', ['Missing', 'Run'].map(id => new d.Paragraph({ text: id, style: id })), 'w:before="30"');
  expect(values((await importWord(buffer)).content)).toEqual(['Missing', 'Run'].map(text => ({ text, before: 2, after: 12, line: null })));
});

it.each(['w:beforeLines="100"', 'w:beforeAutospacing="1"'])('does not silently treat unsupported %s as inherited fixed spacing', async setting => {
  const buffer = await fixture(style('Base', 'w:before="120"') + style('Child', setting, 'Base'), [new d.Paragraph({ text: 'Unsupported', style: 'Child' })]);
  const result = await importWord(buffer);
  expect(values(result.content)[0].before).toBe(null);
  expect(result.warnings.some(message => message.includes('paragraph spacing'))).toBe(true);
});

it('respects explicit zero line-based margins and disabled automatic margins', async () => {
  const buffer = await fixture(style('Base', 'w:before="120" w:after="90" w:beforeAutospacing="1"') + style('Child', 'w:beforeAutospacing="0" w:afterLines="0"', 'Base'), [new d.Paragraph({ text: 'Zero', style: 'Child' })]);
  const result = await importWord(buffer); expect(values(result.content)[0]).toMatchObject({ before: 8, after: 0 });
  expect(result.warnings.filter(message => message.includes('paragraph spacing'))).toEqual([]);
});

it('bounds cyclic inheritance and never borrows spacing from archived change properties', async () => {
  const buffer = await fixture(style('A', 'w:before="30"', 'B') + style('B', 'w:after="60"', 'A') + '<w:style w:type="paragraph" w:styleId="History"><w:pPr><w:pPrChange><w:pPr><w:spacing w:before="900"/></w:pPr></w:pPrChange></w:pPr></w:style>', [new d.Paragraph({ text: 'Cycle', style: 'A' }), new d.Paragraph({ text: 'History', style: 'History' })]);
  const html = new DOMParser().parseFromString('<p>Cycle</p><p>History</p>', 'text/html'), warnings: string[] = [];
  await restoreWordFormatting(buffer, html, warnings);
  expect(html.querySelectorAll('p')[0].style.marginTop).toBe('2px');
  expect(html.querySelectorAll('p')[0].style.marginBottom).toBe('4px');
  expect(html.querySelectorAll('p')[1].style.marginTop).toBe('');
  expect(warnings.filter(message => message.includes('style inheritance'))).toHaveLength(1);
  expect(html.body.textContent).toBe('CycleHistory');
});

it('resolves a long style chain iteratively and keeps cached styles separate from direct overrides', async () => {
  const chain = Array.from({ length: 600 }, (_, i) => style(`S${i}`, i === 0 ? 'w:line="360" w:lineRule="auto" w:after="75"' : '', i ? `S${i - 1}` : '')).join('');
  const buffer = await fixture(chain, [
    new d.Paragraph({ text: 'Override', style: 'S599', spacing: { after: 0 } }),
    new d.Paragraph({ text: 'Unchanged', style: 'S599' }),
  ]);
  const html = new DOMParser().parseFromString('<p>Override</p><p>Unchanged</p>', 'text/html'), warnings: string[] = [];
  await restoreWordFormatting(buffer, html, warnings);
  expect(Array.from(html.querySelectorAll('p'), node => [node.style.lineHeight, node.style.marginBottom])).toEqual([['1.5', '0px'], ['1.5', '5px']]);
  expect(warnings).toEqual([]);
});

it('keeps known child spacing when its parent definition is missing and reports the incomplete chain', async () => {
  const buffer = await fixture(style('Child', 'w:after="90"', 'MissingParent'), [new d.Paragraph({ text: 'Child', style: 'Child' })], 'w:before="30"');
  const result = await importWord(buffer);
  expect(values(result.content)[0]).toMatchObject({ before: 2, after: 6 });
  expect(result.warnings.filter(message => message.includes('style inheritance'))).toHaveLength(1);
});
