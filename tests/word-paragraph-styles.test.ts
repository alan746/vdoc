import { afterEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import * as d from 'docx';
import JSZip from 'jszip';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { parseDocument } from '../lib/infrastructure/persistence/document-codec';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { previewSource } from '../lib/infrastructure/preview/paged-preview';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob);
});
const style = (id: string, properties: string, base = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id === 'Heading2' ? 'heading 2' : id}"/>${base ? `<w:basedOn w:val="${base}"/>` : ''}<w:pPr>${properties}</w:pPr></w:style>`;
async function fixture(styles: string, children: (d.Paragraph | d.Table)[], defaults = '') {
  const zip = await JSZip.loadAsync(await bytes(await d.Packer.toBlob(new d.Document({ sections: [{ children }] }))));
  zip.file('word/styles.xml', `<w:styles xmlns:w="${W}"><w:docDefaults><w:pPrDefault><w:pPr>${defaults}</w:pPr></w:pPrDefault></w:docDefaults>${styles}</w:styles>`);
  return zip.generateAsync({ type: 'arraybuffer' });
}
function paragraphs(doc: JSONContent): JSONContent[] {
  return [...(['paragraph', 'heading'].includes(doc.type || '') ? [doc] : []), ...(doc.content || []).flatMap(paragraphs)];
}
const keys = ['indentStart', 'indentEnd', 'firstLineIndent', 'direction', 'textAlign', 'keepWithNext', 'keepLinesTogether', 'preventSingleLines'];
const layout = (doc: JSONContent) => paragraphs(doc).filter(node => node.content?.length).map(node => Object.fromEntries(keys.map(key => [key, node.attrs![key]])));
const textContent = (doc: JSONContent) => paragraphs(doc).filter(node => node.content?.length).map(node => node.content!.map(({ marks: _marks, ...content }) => content));

it('preserves inherited layout across heading, body, list and table, with direct zero/off overrides and exact undo', async () => {
  const base = '<w:ind w:left="720" w:right="180" w:hanging="180"/><w:jc w:val="center"/><w:bidi w:val="0"/><w:keepNext/><w:keepLines/><w:widowControl w:val="0"/>';
  const styles = style('Base', base) + style('Child', '<w:ind w:right="300"/><w:keepNext w:val="false"/>', 'Base') + style('Heading2', '', 'Child') + style('ListParagraph', '', 'Child');
  const source = await fixture(styles, [
    new d.Paragraph({ text: 'Body 中文', style: 'Child' }),
    new d.Paragraph({ text: 'Heading العربية', heading: d.HeadingLevel.HEADING_2 }),
    new d.Paragraph({ text: 'List 日本語', bullet: { level: 0 } }),
    new d.Table({ rows: [new d.TableRow({ children: [new d.TableCell({ children: [new d.Paragraph({ text: 'Cell हिन्दी', style: 'Child' })] })] })] }),
    new d.Paragraph({ text: 'Override עברית', style: 'Child', indent: { left: 0, right: 0, hanging: 0 }, alignment: d.AlignmentType.RIGHT, keepNext: false, keepLines: false, widowControl: true }),
    new d.Paragraph({ text: 'Sibling Français', style: 'Base' }),
  ]);
  const originalBytes = new Uint8Array(source).slice(), imported = await importWord(source);
  const inherited = { indentStart: 36, indentEnd: 20, firstLineIndent: -12, direction: 'ltr', textAlign: 'center', keepWithNext: false, keepLinesTogether: true, preventSingleLines: false };
  const expected = [inherited, inherited, { ...inherited, indentStart: 12 }, inherited, { ...inherited, indentStart: 0, indentEnd: 0, firstLineIndent: 0, textAlign: 'right', keepLinesTogether: false, preventSingleLines: true }, { ...inherited, indentEnd: 12, keepWithNext: true }];
  expect(layout(imported.content)).toEqual(expected);
  const editor = new Editor({ extensions: createExtensions(), content: imported.content }); editors.push(editor);
  await new Promise(resolve => setTimeout(resolve, 0)); const original = editor.getJSON();
  const htmlEditor = new Editor({ extensions: createExtensions(), content: editor.getHTML() }); editors.push(htmlEditor);
  expect(htmlEditor.getJSON().content).toEqual(original.content);
  expect(parseDocument(JSON.stringify({ version: 1, title: 'Inherited layout', content: original })).content).toEqual(original);
  const preview = previewSource('Inherited layout', editor.getHTML(), original);
  expect(preview.html).toContain('data-keep-lines-together="true"'); expect(preview.html).toContain('orphans: 1');
  let content: JSONContent = original;
  for (let i = 0; i < 2; i++) {
    content = (await importWord(await bytes(await exportWord(content, 'Inherited layout')))).content;
    expect(layout(content)).toEqual(expected);
    expect(textContent(content)).toEqual(textContent(original));
    for (const node of paragraphs(content)) for (const text of node.content || []) if (text.type === 'text') expect(text.marks?.find(mark => mark.type === 'textStyle')?.attrs?.fontFamily).toBe('Arial');
  }
  editor.commands.selectAll(); const engine = new DocumentEngine(editor);
  try {
    expect(engine.execute({ operations: [{ type: 'paragraph.style', align: 'left', indentStart: 0, keepLinesTogether: false }] }).ok).toBe(true);
    const changed = editor.getJSON(); engine.history('undo'); expect(editor.getJSON()).toEqual(original);
    engine.history('redo'); expect(editor.getJSON()).toEqual(changed);
  } finally { engine.destroy(); }
  expect(new Uint8Array(source)).toEqual(originalBytes);
});

it.each([true, false])('resolves physical indentation using the effective inherited RTL flag (%s)', async rtl => {
  const buffer = await fixture(style('Base', '<w:bidi/><w:ind w:left="150" w:right="750" w:hanging="150"/><w:jc w:val="start"/>') + style('Child', rtl ? '' : '<w:bidi w:val="false"/>', 'Base'), [new d.Paragraph({ text: 'العربية English', style: 'Child' })]);
  expect(layout((await importWord(buffer)).content)[0]).toMatchObject({ indentStart: rtl ? 40 : 0, indentEnd: rtl ? 10 : 50, firstLineIndent: -10, direction: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' });
});

it.each(['0', 'false', 'off'])('lets inherited explicit %s disable flags while an empty child flag reenables them', async off => {
  const flags = ['keepNext', 'keepLines', 'widowControl', 'bidi'];
  const buffer = await fixture(style('Base', flags.map(name => `<w:${name} w:val="${off}"/>`).join('')) + style('Child', flags.map(name => `<w:${name}/>`).join(''), 'Base'), [new d.Paragraph({ text: 'Off', style: 'Base' }), new d.Paragraph({ text: 'On', style: 'Child' })]);
  const result = layout((await importWord(buffer)).content);
  expect(result[0]).toMatchObject({ keepWithNext: false, keepLinesTogether: false, preventSingleLines: false, direction: 'ltr' });
  expect(result[1]).toMatchObject({ keepWithNext: true, keepLinesTogether: true, preventSingleLines: true, direction: 'rtl' });
});

it('retains defaults and partial indent overrides without borrowing historical paragraph properties', async () => {
  const buffer = await fixture(style('History', '<w:pPrChange><w:pPr><w:keepNext/><w:ind w:left="900"/><w:jc w:val="right"/></w:pPr></w:pPrChange>') + style('Child', '<w:ind w:firstLine="150"/>'), [new d.Paragraph({ text: 'History', style: 'History' }), new d.Paragraph({ text: 'Child', style: 'Child' })], '<w:ind w:left="300" w:right="60"/><w:jc w:val="both"/><w:keepNext w:val="0"/>');
  const result = layout((await importWord(buffer)).content);
  expect(result[0]).toMatchObject({ indentStart: 20, indentEnd: 4, firstLineIndent: 0, textAlign: 'justify', keepWithNext: false });
  expect(result[1]).toMatchObject({ indentStart: 20, indentEnd: 4, firstLineIndent: 10 });
});

it('preserves logical start/end indentation and warns instead of silently using character-based or invalid values', async () => {
  const buffer = await fixture(style('Logical', '<w:bidi/><w:ind w:start="450" w:end="75"/>') + style('Chars', '<w:ind w:left="600" w:leftChars="200"/>') + style('Invalid', '<w:ind w:left="bad"/>'), ['Logical', 'Chars', 'Invalid'].map(text => new d.Paragraph({ text, style: text })));
  const result = await importWord(buffer), layouts = layout(result.content);
  expect(layouts[0]).toMatchObject({ indentStart: 30, indentEnd: 5, direction: 'rtl' });
  expect(layouts[1].indentStart).toBe(null); expect(layouts[2].indentStart).toBe(null);
  expect(result.warnings.filter(message => message.includes('paragraph indentation'))).toHaveLength(1);
});

it('normalizes external nested list indentation to VDoc levels while retaining custom tab origins', async () => {
  const buffer = await fixture(style('ListParagraph', '<w:ind w:left="1440" w:hanging="360"/>'), [0, 1, 0].map((level, index) => new d.Paragraph({
    text: `Item ${index} 中文\tالعربية`, bullet: { level },
    tabStops: [2160, 2880, 3600].map(position => ({ type: d.TabStopType.START, position })),
  })));
  const imported = await importWord(buffer);
  const listParagraphs = paragraphs(imported.content).filter(node => node.content?.length);
  expect(listParagraphs.map(node => node.attrs!.indentStart)).toEqual([48, 24, 48]);
  for (const node of listParagraphs) expect(node.attrs).toMatchObject({ firstLineIndent: -24, tabInterval: 48 });
  expect(imported.warnings.filter(message => message.includes('tab stops'))).toEqual([]);
  const editor = new Editor({ extensions: createExtensions(), content: imported.content }); editors.push(editor);
  expect(editor.getHTML().match(/<ul/g)).toHaveLength(2);
  const result = await importWord(await bytes(await exportWord(imported.content, 'Nested list')));
  // Word export makes the body paragraph's implicit keep-with-next=false explicit.
  expect(layout(result.content)).toEqual(layout(imported.content).map(value => ({ ...value, keepWithNext: false })));
  expect(textContent(result.content)).toEqual(textContent(imported.content));
  for (const node of paragraphs(result.content)) for (const text of node.content || []) if (text.type === 'text') expect(text.marks?.find(mark => mark.type === 'textStyle')?.attrs).toMatchObject({ fontFamily: 'Arial', fontSize: '16px', color: 'rgb(54, 65, 82)' });
});

it('does not turn malformed inherited flags on or retain out-of-range computed indents', async () => {
  const buffer = await fixture(style('Invalid', '<w:keepLines w:val="invalid"/><w:bidi w:val="invalid"/><w:ind w:left="-150000" w:hanging="150000"/>'), [new d.Paragraph({ text: 'Preserved 中文', style: 'Invalid' })]);
  const result = await importWord(buffer);
  expect(layout(result.content)[0]).toMatchObject({ indentStart: null, direction: 'auto', keepLinesTogether: false });
  expect(result.warnings.some(message => message.includes('paragraph layout'))).toBe(true);
  expect(result.warnings.some(message => message.includes('paragraph indentation'))).toBe(true);
  expect(parseDocument(JSON.stringify({ version: 1, title: 'Import', content: result.content })).content).toEqual(result.content);
});
