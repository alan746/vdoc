import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import JSZip from 'jszip';
import * as docx from 'docx';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { selectedTabInterval } from '../lib/editor/paragraph/paragraph-tabs';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { exportHTML } from '../lib/infrastructure/export/html-export';
import { previewSource } from '../lib/infrastructure/preview/paged-preview';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
let editor: Editor, engine: DocumentEngine;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(operation => {
    const result = typeof operation === 'string' ? engine.history(operation, 'keyboard') : engine.execute({ source: 'keyboard', operations: [operation] }); return result.ok;
  }), content: '<p>English 中文</p><p dir="rtl">العربية עברית</p>' });
  await new Promise(r => setTimeout(r, 0)); engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); });
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
const key = (name: string, shiftKey = false) => editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: name, code: name, shiftKey, bubbles: true, cancelable: true }));
it('inserts a real tab with the keyboard, keeps marks and reverses it in one undo', () => {
  engine.execute({ operations: [{ type: 'text.toggle', mark: 'bold' }] }); const before = editor.getJSON();
  key('Tab'); expect(editor.state.doc.firstChild!.textContent).toBe('\tEnglish 中文'); expect(editor.state.doc.firstChild!.firstChild!.marks.some(m => m.type.name === 'bold')).toBe(true);
  expect(editor.getText()).toContain('\t'); engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});
it('does not insert a tab during IME composition', () => {
  const before = editor.getJSON(); (editor.view as any).input.composing = true; key('Tab'); (editor.view as any).input.composing = false;
  expect(editor.getJSON()).toEqual(before);
});
it('preserves table Tab / Shift+Tab navigation and inserts a tab through the operation in a cell', () => {
  editor.commands.setContent('<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>'); editor.commands.setTextSelection(4);
  const before = editor.getJSON(); key('Tab'); expect(editor.state.selection.$from.parent.textContent).toBe('B'); expect(editor.getJSON()).toEqual(before);
  key('Tab', true); expect(editor.state.selection.$from.parent.textContent).toBe('A');
  engine.execute({ operations: [{ type: 'text.insert', text: '\t' }] }); expect(editor.state.selection.$from.parent.textContent).toContain('\t');
  engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});
it.each(['bulletList', 'orderedList', 'taskList'])('preserves %s Tab nesting instead of inserting whitespace', type => {
  const item = type === 'taskList' ? 'taskItem' : 'listItem';
  editor.commands.setContent({ type: 'doc', content: [{ type, content: ['A', 'B'].map(text => ({ type: item, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })) }] });
  let position = 0; editor.state.doc.descendants((n, pos) => { if (n.isText && n.text === 'B') position = pos; }); editor.commands.setTextSelection(position);
  key('Tab'); expect(editor.state.doc.firstChild!.childCount).toBe(1); expect(editor.state.doc.textContent).toBe('AB');
  key('Tab', true); expect(editor.state.doc.firstChild!.childCount).toBe(2);
});
it('retains tab characters and interval through HTML, backup, export and page-preview source', () => {
  editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', attrs: { tabInterval: 96 }, content: [{ type: 'text', text: '\t中文\tעברית\tहिन्दी\t' }] }] });
  const before = editor.getJSON(), html = editor.getHTML();
  const other = new Editor({ extensions: createExtensions(), content: html }); expect(other.getJSON()).toEqual(before); other.destroy();
  expect(parseDocument(JSON.stringify({ version: 1, title: 'Tabs', content: before })).content).toEqual(before);
  expect(exportHTML('Tabs', html, before)).toContain('tab-size: 96px');
  const preview = new DOMParser().parseFromString(previewSource('Tabs', html, before).html, 'text/html');
  expect(preview.body.textContent).toBe('\t中文\tעברית\tहिन्दी\t'); expect(preview.querySelector('p')!.style.tabSize).toBe('96px');
});
it('retains heading tabs and custom interval after HTML import and Enter', () => {
  editor.commands.setContent('<h2 data-tab-interval="72">\tHeading\t</h2>');
  expect(editor.state.doc.firstChild!.textContent).toBe('\tHeading\t');
  expect(editor.state.doc.firstChild!.attrs.tabInterval).toBe(72); expect(editor.state.doc.firstChild!.attrs.level).toBe(2);
  const count = editor.state.doc.childCount; editor.commands.setTextSelection(4); key('Enter');
  expect(editor.state.doc.childCount).toBe(count + 1); expect(editor.state.doc.child(1).attrs.tabInterval).toBe(72);
});
it('imports an explicit pixel tab interval from HTML and preserves plain-text pasted tabs', () => {
  editor.commands.setContent('<p style="tab-size:72px;white-space:pre-wrap">A\tB\t</p>'); expect(editor.state.doc.firstChild!.attrs.tabInterval).toBe(72); expect(editor.state.doc.firstChild!.textContent).toBe('A\tB\t');
  editor.commands.selectAll(); editor.view.pasteText('\tStart\tEnd\t', new Event('paste') as ClipboardEvent); expect(editor.state.doc.firstChild!.textContent).toBe('\tStart\tEnd\t');
});
it.each(['bulletList', 'orderedList'])('round-trips tabs and interval inside %s without losing the list or its indentation', async type => {
  editor.commands.setContent({ type: 'doc', content: [{ type, content: [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { tabInterval: 72, indentStart: 12, firstLineIndent: -24 }, content: [{ type: 'text', text: '\tItem\tTotal\t' }] }] }] }] });
  const result = await importWord(await bytes(await exportWord(editor.getJSON(), 'List tabs')));
  expect(result.warnings).toEqual([]); expect(result.content.content![0].type).toBe(type);
  const p = result.content.content![0].content![0].content![0]; expect(p.content![0].text).toBe('\tItem\tTotal\t'); expect(p.attrs).toMatchObject({ tabInterval: 72, indentStart: 12, firstLineIndent: -24 });
});
it('changes mixed intervals across a selected column without touching other cells', () => {
  editor.commands.setContent('<table><tr><td><p data-tab-interval="48">A</p></td><td><p>B</p></td></tr><tr><td><p data-tab-interval="96">C</p></td><td><p>D</p></td></tr></table>');
  const map = TableMap.get(editor.state.doc.firstChild!); editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, 1 + map.map[0], 1 + map.map[2])));
  expect(selectedTabInterval(editor)).toBeNull(); const before = editor.getJSON();
  engine.execute({ operations: [{ type: 'paragraph.style', tabInterval: 72 }] });
  const intervals: Record<string, number> = {}; editor.state.doc.descendants(n => { if (n.type.name === 'paragraph') intervals[n.textContent] = n.attrs.tabInterval; });
  expect(intervals).toMatchObject({ A: 72, B: 48, C: 72, D: 48 }); engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});
it.each([0, 7, 481, 24.5, '48', null])('rejects invalid interval %s in operations and backups atomically', value => {
  const before = editor.getJSON(); expect(engine.execute({ operations: [{ type: 'text.insert', text: 'No write' }, { type: 'paragraph.style', tabInterval: value }] }).ok).toBe(false); expect(editor.getJSON()).toEqual(before);
  const content = structuredClone(before); content.content![0].attrs!.tabInterval = value;
  expect(() => parseDocument(JSON.stringify({ version: 1, title: 'Invalid', content }))).toThrow('tab interval');
});
it.each(['ltr', 'rtl'])('exports native Word tabs and restores %s text, marks, indent and custom interval', async direction => {
  const content: JSONContent = { type: 'doc', content: [{ type: 'paragraph', attrs: { tabInterval: 96, direction, indentStart: 12, firstLineIndent: -24 }, content: [{ type: 'text', text: '\t中文\tעברית\tहिन्दी\t', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { fontSize: '24px', color: '#123456' } }] }] }] };
  editor.commands.setContent(content); const buffer = await bytes(await exportWord(editor.getJSON(), 'Native tabs'));
  const zip = await JSZip.loadAsync(buffer), xml = await zip.file('word/document.xml')!.async('string');
  expect((xml.match(/<w:tab\/>/g) || []).length).toBe(4); expect(xml).toContain('w:pos="1980"');
  const result = await importWord(buffer); expect(result.warnings).toEqual([]);
  const p = result.content.content![0]; expect(p.attrs).toMatchObject({ tabInterval: 96, direction, indentStart: 12, firstLineIndent: -24 });
  expect(p.content!.map(n => n.text).join('')).toBe('\t中文\tעברית\tहिन्दी\t');
  expect(p.content![0].marks).toContainEqual({ type: 'bold' }); expect(p.content![0].marks).toContainEqual(expect.objectContaining({ type: 'textStyle', attrs: expect.objectContaining({ color: 'rgb(18, 52, 86)', fontSize: '24px' }) }));
});
it('keeps a Word paragraph containing only tabs', async () => {
  editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '\t\t' }] }] });
  const result = await importWord(await bytes(await exportWord(editor.getJSON(), 'Only tabs'))); expect(result.content.content![0].content![0].text).toBe('\t\t');
});
it('imports the Word document default interval and reports unsupported custom stops without losing tabs', async () => {
  const file = new docx.Document({ defaultTabStop: 1080, sections: [{ children: [new docx.Paragraph({ children: [new docx.TextRun({ children: ['A', new docx.Tab(), 'B'] })], tabStops: [{ type: docx.TabStopType.CENTER, position: 2000 }] }), new docx.Paragraph({ children: [new docx.TextRun({ children: ['C', new docx.Tab(), 'D'] })] })] }] });
  const result = await importWord(await bytes(await docx.Packer.toBlob(file))); expect(result.content.content!.map(n => n.content!.map(x => x.text).join(''))).toEqual(['A\tB', 'C\tD']);
  expect(result.content.content!.map(n => n.attrs!.tabInterval)).toEqual([72, 72]); expect(result.warnings.some(w => w.includes('custom Word tab stops'))).toBe(true);
});
