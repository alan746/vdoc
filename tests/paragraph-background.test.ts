import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import JSZip from 'jszip';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { selectedParagraphBackground } from '../lib/editor/paragraph/paragraph-background';
import { parseDocument } from '../lib/infrastructure/persistence/document-codec';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { exportHTML } from '../lib/infrastructure/export/html-export';
import { previewSource } from '../lib/infrastructure/preview/paged-preview';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
let editor: Editor, engine: DocumentEngine;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<h2>Heading 中文</h2><p dir="rtl">العربية עברית</p><p>日本語 ไทย हिन्दी</p>' });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); });
const apply = (paragraphBackground: string | null) => engine.execute({ operations: [{ type: 'paragraph.style', paragraphBackground }] });
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
it('colors the complete paragraph from a partial text selection and undoes one batch', () => {
  editor.commands.setTextSelection({from:2,to:5}); const original = editor.getJSON();
  expect(apply('#FFF2CC').ok).toBe(true); expect(editor.state.doc.firstChild!.attrs.paragraphBackground).toBe('#FFF2CC');
  expect(editor.state.doc.child(1).attrs.paragraphBackground).toBeNull();
  expect(editor.state.doc.firstChild!.firstChild!.marks).toEqual([]);
  engine.history('undo'); expect(editor.getJSON()).toEqual(original);
  engine.history('redo'); expect(selectedParagraphBackground(editor)).toBe('#FFF2CC');
});
it('reads mixed shading and clears all selected paragraph types without changing text direction', () => {
  apply('#FFFFFF'); editor.commands.selectAll(); expect(selectedParagraphBackground(editor)).toBe('mixed');
  expect(apply(null).ok).toBe(true); expect(selectedParagraphBackground(editor)).toBeNull();
  expect(editor.state.doc.child(1).attrs.direction).toBe('rtl'); expect(editor.state.doc.firstChild!.type.name).toBe('heading');
});
it('applies only to a disjoint selected table column, keeping cell backgrounds independent', () => {
  editor.commands.setContent('<table><tr><td style="background-color:#112233"><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr></table>');
  const table = editor.state.doc.firstChild!, map = TableMap.get(table);
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, 1+map.map[0], 1+map.map[2])));
  expect(apply('#AABBCC').ok).toBe(true);
  const shades: unknown[] = []; editor.state.doc.firstChild!.descendants(n => { if(n.type.name==='paragraph') shades.push(n.attrs.paragraphBackground); });
  expect(shades).toEqual(['#AABBCC',null,'#AABBCC',null]);
  expect(editor.state.doc.firstChild!.firstChild!.firstChild!.attrs.backgroundColor).toBe('rgb(17, 34, 51)');
});
it('preserves paragraph shading independently from highlighted text through HTML, backup and preview', () => {
  editor.commands.setContent('<p style="background-color:#abc"><mark data-color="#00FF00" style="background-color:#00FF00">中文</mark> العربية</p>');
  expect(selectedParagraphBackground(editor)).toBe('#AABBCC');
  const content = editor.getJSON(), html = editor.getHTML();
  const other = new Editor({ extensions:createExtensions(),content:html }); expect(other.getJSON()).toEqual(content); other.destroy();
  expect(parseDocument(JSON.stringify({version:1,title:'Shading',content})).content).toEqual(content);
  for (const result of [exportHTML('Shading',html,content), previewSource('Shading',html,content).html]) {
    const parsed = new DOMParser().parseFromString(result,'text/html');
    expect(parsed.querySelector('p')!.style.backgroundColor).toBe('rgb(170, 187, 204)');
    expect(parsed.querySelector('mark')!.style.backgroundColor).toBe('rgb(0, 255, 0)');
  }
  apply(null); expect(editor.state.doc.firstChild!.firstChild!.marks.some(mark=>mark.type.name==='highlight')).toBe(true);
});
it.each(['red','url(https://example.com)', '#12345', 42])('rejects invalid operation/backup color %s', color => {
  const original = editor.getJSON();
  expect(engine.execute({operations:[{type:'text.insert',text:'must not commit'}, {type:'paragraph.style',paragraphBackground:color}]}).ok).toBe(false);
  expect(editor.getJSON()).toEqual(original);
  expect(()=>parseDocument(JSON.stringify({version:1,title:'Bad',content:{type:'doc',content:[{type:'paragraph',attrs:{paragraphBackground:color}}]}}))).toThrow('paragraph background');
});
it('retains shading after Enter and keeps ordinary old backups unshaded', () => {
  apply('#FFF2CC'); editor.commands.setTextSelection(4); editor.commands.splitBlock();
  expect(editor.state.doc.child(1).attrs.paragraphBackground).toBe('#FFF2CC');
  const saved=parseDocument(JSON.stringify({version:1,title:'Old',content:{type:'doc',content:[{type:'paragraph'}]}}));
  editor.commands.setContent(saved.content); expect(selectedParagraphBackground(editor)).toBeNull();
});
it('round-trips headings, RTL, list and table paragraphs with direct Word shading', async () => {
  editor.commands.setContent('<h2 style="background-color:#fff2cc">中文</h2><p dir="rtl" style="background-color:#ddeeff">العربية עברית</p><ul><li><p style="background-color:#112233">日本語 ไทย हिन्दी</p></li></ul><table><tr><td style="background-color:#ffff00"><p style="background-color:#aabbcc">Cell</p></td></tr></table><p>Plain</p>');
  const data = await bytes(await exportWord(editor.getJSON(),'Shading'));
  const zip=await JSZip.loadAsync(data); const xml=new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'),'application/xml');
  const fills=Array.from(xml.getElementsByTagName('w:pPr')).map(p=>p.getElementsByTagName('w:shd')[0]?.getAttribute('w:fill')).filter(Boolean);
  expect(fills).toEqual(['FFF2CC','DDEEFF','112233','AABBCC']);
  const result=await importWord(data); expect(result.warnings).toEqual([]);
  editor.commands.setContent(result.content);
  const values: unknown[]=[];editor.state.doc.descendants(n=>{if(['heading','paragraph'].includes(n.type.name))values.push(n.attrs.paragraphBackground);});
  expect(values).toEqual(['#FFF2CC','#DDEEFF','#112233','#AABBCC',null]);
  expect(editor.state.doc.child(1).attrs.direction).toBe('rtl');
});
