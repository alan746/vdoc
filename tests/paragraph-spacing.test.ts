import { afterEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import JSZip from 'jszip';
import { createExtensions } from '../lib/editor/extensions';
import { parseDocument } from '../lib/infrastructure/persistence/document-codec';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));

const editors: Editor[] = [];
function open(content: JSONContent | string) {
  const editor = new Editor({ extensions: createExtensions(), content });
  editors.push(editor); return editor;
}
afterEach(() => editors.splice(0).forEach(editor => editor.destroy()));
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.onerror = reject; reader.readAsArrayBuffer(blob);
});
function paragraphs(doc: JSONContent): JSONContent[] {
  return [ ...(doc.type === 'paragraph' || doc.type === 'heading' ? [doc] : []), ...(doc.content || []).flatMap(paragraphs) ];
}

it.each([
  ['2.4px', 2.4], ['18pt', 24], ['1.5pc', 24], ['0.25in', 24],
  ['2.54cm', 96], ['2.54mm', 9.6], ['101.6q', 96], ['0px', 0],
] as const)('converts paragraph and heading spacing from %s into physical pixels', (length, pixels) => {
  const editor = open(`<p style="margin-top:${length};margin-bottom:${length}">中文</p><h2 style="margin:${length} 0">العربية</h2>`);
  for (const node of paragraphs(editor.getJSON())) {
    expect(node.attrs!.spaceBefore).toBeCloseTo(pixels, 6);
    expect(node.attrs!.spaceAfter).toBeCloseTo(pixels, 6);
  }
});

it.each(['', '2em', '10%', '-12px'])('does not reinterpret unsupported or missing margin %s as positive pixels', value => {
  const editor = open(`<p style="margin-top:${value};margin-bottom:${value}">Text</p>`);
  expect(editor.state.doc.firstChild!.attrs).toMatchObject({ spaceBefore: null, spaceAfter: null });
});

it.each([0, 0.4, 2.4, 10.8, 2.45])('preserves %s px paragraph spacing through HTML, backup and actual Word bytes', async spacing => {
  const p = (text: string): JSONContent => ({ type: 'paragraph', attrs: { spaceBefore: spacing, spaceAfter: spacing, lineHeight: '1.5' }, content: [{ type: 'text', text }] });
  const editor = open({ type: 'doc', content: [
    { ...p('Heading 中文'), type: 'heading', attrs: { ...p('').attrs, level: 2 } },
    p('Body العربية'),
    { type: 'bulletList', content: [{ type: 'listItem', content: [p('List 日本語')] }] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('Cell हिन्दी')] }] }] },
  ] });
  await new Promise(resolve => setTimeout(resolve, 0));
  const original = editor.getJSON();
  expect(open(editor.getHTML()).getJSON()).toEqual(original);
  expect(parseDocument(JSON.stringify({ version: 1, title: 'Spacing', content: original })).content).toEqual(original);
  const buffer = await bytes(await exportWord(original, 'Spacing'));
  const zip = await JSZip.loadAsync(buffer), xml = await zip.file('word/document.xml')!.async('string');
  const spacingNodes = new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('w:spacing');
  const explicit = Array.from(spacingNodes).filter(node => node.hasAttribute('w:before'));
  expect(explicit).toHaveLength(4);
  for (const node of explicit) {
    expect(node.getAttribute('w:before')).toBe(String(Math.round(spacing * 15)));
    expect(node.getAttribute('w:after')).toBe(String(Math.round(spacing * 15)));
  }
  const imported = (await importWord(buffer)).content;
  const restored = paragraphs(imported).filter(node => node.content?.some(child => child.type === 'text'));
  expect(restored).toHaveLength(4);
  // Word defaults now materialize as text marks; verify content and those defaults separately.
  expect(restored.map(node => node.content?.map(({ marks: _marks, ...text }) => text))).toEqual(paragraphs(original).filter(node => node.content?.some(child => child.type === 'text')).map(node => node.content));
  for (const node of restored) for (const text of node.content || []) {
    expect(text.marks?.find(mark => mark.type === 'textStyle')?.attrs?.fontFamily).toBe('Arial');
  }
  for (const node of restored) {
    expect(node.attrs!.spaceBefore).toBeCloseTo(Math.round(spacing * 15) / 15, 5);
    expect(node.attrs!.spaceAfter).toBeCloseTo(Math.round(spacing * 15) / 15, 5);
    expect(node.attrs!.lineHeight).toBe('1.5');
  }
  expect(editor.getJSON()).toEqual(original);
});
