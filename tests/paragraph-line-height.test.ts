import { afterEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import * as d from 'docx';
import JSZip from 'jszip';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const editors: Editor[] = [];
function open(content: JSONContent | string) {
  const editor = new Editor({ extensions: createExtensions(), content }); editors.push(editor); return editor;
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.onerror = reject; reader.readAsArrayBuffer(blob);
});
function paragraphs(doc: JSONContent): JSONContent[] {
  return [...(['paragraph', 'heading'].includes(doc.type || '') ? [doc] : []), ...(doc.content || []).flatMap(paragraphs)];
}
const sample = (lineHeight: unknown): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', attrs: { lineHeight }, content: [{ type: 'text', text: 'English 中文 العربية हिन्दी 👩‍💻' }] }] });
async function spacing(buffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buffer);
  return new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml').getElementsByTagName('w:spacing')[0];
}

it.each(['1', '1.15', '1.25', '1.5', '1.75', '2', '2.5', '3'])('retains toolbar multiplier %s through real Word bytes', async lineHeight => {
  const source = sample(lineHeight), before = structuredClone(source), buffer = await bytes(await exportWord(source, 'Line spacing'));
  const xml = await spacing(buffer);
  expect(xml.getAttribute('w:line')).toBe(String(Math.round(Number(lineHeight) * 240)));
  expect(xml.getAttribute('w:lineRule')).toBe('auto');
  const result = await importWord(buffer);
  expect(result.content.content![0].attrs!.lineHeight).toBe(lineHeight);
  expect(result.content.content![0].content).toEqual(source.content![0].content!.map(node => ({ ...node, marks: [{ type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '16px', color: 'rgb(54, 65, 82)' } }] })));
  expect(source).toEqual(before);
});

it.each([['24px', 360], ['18pt', 360], ['0.25in', 360], ['2.54cm', 1440], ['24.45px', 367]] as const)('exports fixed %s as exact Word spacing and restores it', async (lineHeight, twips) => {
  const editor = open(sample(lineHeight)); await new Promise(resolve => setTimeout(resolve, 0));
  const original = editor.getJSON();
  expect(open(editor.getHTML()).getJSON()).toEqual(original);
  expect(parseDocument(JSON.stringify({ version: 1, title: 'Fixed spacing', content: original })).content).toEqual(original);
  const buffer = await bytes(await exportWord(original, 'Fixed spacing')), xml = await spacing(buffer);
  expect(xml.getAttribute('w:line')).toBe(String(twips)); expect(xml.getAttribute('w:lineRule')).toBe('exact');
  const result = await importWord(buffer);
  expect(parseFloat(result.content.content![0].attrs!.lineHeight)).toBeCloseTo(twips / 15, 5);
  expect(result.content.content![0].attrs!.lineHeight).toMatch(/px$/);
  expect(result.content.content![0].content).toEqual(original.content![0].content!.map(node => ({ ...node, marks: [{ type: 'textStyle', attrs: { fontFamily: 'Arial', fontSize: '16px', color: 'rgb(54, 65, 82)' } }] })));
  expect(editor.getJSON()).toEqual(original);
});

it.each(['150%', '1.5em', 'calc(1em + 2px)', 'bad', '0px', '-2', { value: 2 }])('rejects unresolved line height %j without generating a broken DOCX or changing source', async lineHeight => {
  const source = sample(lineHeight), original = structuredClone(source);
  await expect(exportWord(source, 'Unsupported spacing')).rejects.toThrow('Choose a line spacing');
  expect(source).toEqual(original);
});

it.each([null, '', 'normal'])('exports default line height %s without an invalid numeric value', async lineHeight => {
  const xml = await spacing(await bytes(await exportWord(sample(lineHeight), 'Default spacing')));
  expect(xml.hasAttribute('w:line')).toBe(false);
  expect(xml.hasAttribute('w:lineRule')).toBe(false);
});

it('imports externally constructed exact spacing in headings, lists and cells, and replaces it through one undoable operation', async () => {
  const p = (text: string, extras: Partial<d.IParagraphOptions> = {}) => new d.Paragraph({ ...extras, children: [new d.TextRun(text)], spacing: { line: 366, lineRule: d.LineRuleType.EXACT } });
  const source = new d.Document({ sections: [{ children: [
    p('Heading 中文', { heading: d.HeadingLevel.HEADING_2 }), p('Body العربية'),
    p('List 日本語', { bullet: { level: 0 } }),
    new d.Table({ rows: [new d.TableRow({ children: [new d.TableCell({ children: [p('Cell हिन्दी')] })] })] }),
  ] }] });
  const imported = await importWord(await bytes(await d.Packer.toBlob(source)));
  expect(imported.warnings.filter(message => message.includes('line spacing'))).toEqual([]);
  const editor = open(imported.content); await new Promise(resolve => setTimeout(resolve, 0));
  const original = editor.getJSON(), formatted = paragraphs(original).filter(node => node.content?.length);
  expect(formatted).toHaveLength(4);
  for (const node of formatted) expect(node.attrs!.lineHeight).toBe('24.4px');
  expect(original.content![0].type).toBe('heading');
  expect(original.content!.some(node => node.type === 'bulletList')).toBe(true);
  expect(original.content!.some(node => node.type === 'table')).toBe(true);
  // Editor body HTML does not carry document-level page settings.
  expect(open(editor.getHTML()).getJSON().content).toEqual(original.content);
  expect(parseDocument(JSON.stringify({ version: 1, title: 'Imported spacing', content: original })).content).toEqual(original);
  editor.commands.selectAll(); const engine = new DocumentEngine(editor);
  try {
    expect(engine.execute({ operations: [{ type: 'paragraph.style', lineHeight: '2' }] }).ok).toBe(true);
    for (const node of paragraphs(editor.getJSON())) expect(node.attrs!.lineHeight).toBe('2');
    engine.history('undo'); expect(editor.getJSON()).toEqual(original);
    engine.history('redo'); for (const node of paragraphs(editor.getJSON())) expect(node.attrs!.lineHeight).toBe('2');
  } finally { engine.destroy(); }
});

it('reports minimum Word line spacing once while preserving every paragraph and source bytes', async () => {
  const source = new d.Document({ sections: [{ children: ['中文', 'العربية'].map(text => new d.Paragraph({ text, spacing: { line: 360, lineRule: d.LineRuleType.AT_LEAST } })) }] });
  const buffer = await bytes(await d.Packer.toBlob(source)), original = new Uint8Array(buffer).slice();
  const result = await importWord(buffer);
  expect(result.warnings.filter(message => message.includes('line spacing'))).toHaveLength(1);
  expect(result.warnings.join(' ')).toContain('minimum');
  expect(paragraphs(result.content).map(node => node.content?.[0].text)).toEqual(['中文', 'العربية']);
  expect(new Uint8Array(buffer)).toEqual(original);
});
