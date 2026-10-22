import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { findMatches } from '../lib/editor/search/search';
import { parseDocument, saveDocument } from '../lib/infrastructure/persistence/storage';
let editor: Editor, engine: DocumentEngine;
beforeEach(async () => { editor = new Editor({ extensions: createExtensions(), content: '<p>Apple <strong>ap</strong>ple pineapple APPLE</p><p>中文文字</p>' }); await new Promise(r=>setTimeout(r,0)); engine = new DocumentEngine(editor); });
afterEach(() => { engine.destroy(); editor.destroy(); localStorage.clear(); });
it('finds across formatting marks, honors case/word boundaries and replaces atomically', () => {
  expect(findMatches(editor.state.doc, 'apple')).toHaveLength(4);
  expect(findMatches(editor.state.doc, 'apple', false, true)).toHaveLength(3);
  expect(findMatches(editor.state.doc, 'apple', true, true)).toHaveLength(1);
  const before = editor.getJSON();
  expect(engine.execute({ operations: [{ type: 'text.findReplace', query: 'apple', replacement: 'Orange', wholeWord: true }] }).ok).toBe(true);
  expect(editor.getText()).toContain('Orange Orange pineapple Orange');
  engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});
it('moves and sorts table rows while retaining the header and undo history', () => {
  editor.commands.setContent('<table><tr><th>Name</th><th>Value</th></tr><tr><td>B</td><td>20</td></tr><tr><td>A</td><td>3</td></tr></table>');
  const table = engine.snapshot().blocks.find(b=>b.type==='table')!;
  const target = { kind:'cells',tableId:table.id,row:1,col:0 };
  const before = editor.getJSON();
  expect(engine.execute({target,operations:[{type:'table.sort',column:0}]}).ok).toBe(true);
  expect(editor.state.doc.firstChild!.child(1).textContent).toBe('A3');
  expect(engine.execute({target,operations:[{type:'table.move',axis:'row',from:1,to:2}]}).ok).toBe(true);
  expect(editor.state.doc.firstChild!.child(1).textContent).toBe('B20');
  expect(engine.execute({target,operations:[{type:'table.move',axis:'column',from:0,to:1}]}).ok).toBe(true);
  expect(editor.state.doc.firstChild!.child(0).textContent).toBe('ValueName');
  engine.history('undo');engine.history('undo');engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('does not sort merged cells and does not partially modify them', () => {
  editor.commands.setContent('<table><tr><td colspan="2">Wide</td></tr><tr><td>B</td><td>A</td></tr></table>');
  const table = engine.snapshot().blocks.find(b=>b.type==='table')!, before=editor.getJSON();
  expect(engine.execute({target:{kind:'cells',tableId:table.id,row:1,col:0},operations:[{type:'table.sort',column:0}]}).ok).toBe(false);
  expect(editor.getJSON()).toEqual(before);
});
it('supports six heading levels, indentation and spacing in one transaction', () => {
  expect(engine.execute({ operations:[{type:'paragraph.style',level:6,indent:2,spaceBefore:12,spaceAfter:18,lineHeight:'1.15'}]}).ok).toBe(true);
  expect(editor.state.doc.firstChild!.attrs).toMatchObject({level:6,indent:2,spaceBefore:12,spaceAfter:18,lineHeight:'1.15'});
});
it('creates an interactive checklist, preserves check state and undoes conversion', () => {
  expect(engine.execute({operations:[{type:'list.toggle',kind:'task'}]}).ok).toBe(true);
  expect(editor.getHTML()).toContain('data-type="taskList"');
  editor.commands.updateAttributes('taskItem',{checked:true});
  expect(editor.getHTML()).toContain('data-checked="true"');
  const saved = saveDocument('Checklist',editor.getJSON());expect(parseDocument(JSON.stringify(saved)).content).toEqual(saved.content);
});
it('saves page setup and explicit breaks, and rejects external image sources', () => {
  expect(engine.execute({operations:[{type:'document.layout',pageSize:'letter',orientation:'landscape',pageMargin:15,pageColor:'#FFF0AD'},{type:'block.pageBreak'}]}).ok).toBe(true);
  expect(editor.state.doc.attrs).toMatchObject({pageSize:'letter',orientation:'landscape',pageMargin:15});
  expect(editor.getHTML()).toContain('data-page-break');
  const before=editor.getJSON();
  expect(engine.execute({operations:[{type:'image.insert',src:'https://example.com/tracker.png'}]}).ok).toBe(false);
  expect(editor.getJSON()).toEqual(before);
});
it('numbers footnotes in document order and keeps a live contents block in sync', () => {
  editor.commands.setContent('<h1>First heading</h1><p>Paragraph</p>');
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  expect(engine.execute({operations:[{type:'footnote.insert',text:'Later note'}]}).ok).toBe(true);
  editor.commands.setTextSelection(2);
  expect(engine.execute({operations:[{type:'footnote.insert',text:'Earlier note'}]}).ok).toBe(true);
  const notes: {number:number;text:string}[]=[];
  editor.state.doc.descendants(node=>{if(node.type.name==='footnote')notes.push({number:node.attrs.number,text:node.attrs.text});});
  expect(notes).toEqual([{number:1,text:'Earlier note'},{number:2,text:'Later note'}]);
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  expect(engine.execute({operations:[{type:'block.toc'}]}).ok).toBe(true);
  let toc: typeof editor.state.doc | undefined;
  editor.state.doc.descendants(n=>{if(n.type.name==='tableOfContents')toc=n;});
  expect(toc!.attrs.items[0].text).toBe('First heading');
  editor.commands.insertContentAt(1,'Changed ');
  editor.state.doc.descendants(n=>{if(n.type.name==='tableOfContents')toc=n;});
  expect(toc!.attrs.items[0].text).toBe('Changed First heading');
});
it('keeps image node-view dimensions synchronized with properties and undo', () => {
  editor.commands.setContent({type:'doc',content:[{type:'image',attrs:{src:'data:image/png;base64,AAAA',width:320}},{type:'paragraph'}]});
  const block=engine.snapshot().blocks.find(b=>b.type==='image')!;
  expect(engine.execute({target:{kind:'block',id:block.id},operations:[{type:'image.update',width:220}]}).ok).toBe(true);
  expect(editor.view.dom.querySelector('img')!.style.width).toBe('220px');
  expect(engine.history('undo').ok).toBe(true);
  expect(editor.view.dom.querySelector('img')!.style.width).toBe('320px');
});
