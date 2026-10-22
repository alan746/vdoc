import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { completePinnedBoundary, pinnedHeaderOffset, pinnedRowCount } from '../lib/editor/table/table-headers';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
import { TableMap } from '@tiptap/pm/tables';
let editor: Editor, engine: DocumentEngine;
beforeEach(async()=>{
  editor = new Editor({extensions:createExtensions(),content:'<table><tr><td>900</td><td>标题 العربية</td></tr><tr><td>800</td><td>日本語 한국어</td></tr><tr><td>20</td><td>हिन्दी</td></tr><tr><td>3</td><td>Deutsch</td></tr><tr><td>10</td><td>Français</td></tr></table>'});
  await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);
});
afterEach(()=>{engine.destroy();editor.destroy();});
const table=()=>editor.state.doc.firstChild!;
const target=(row=0,col=0,endRow=row,endCol=col)=>({kind:'cells',tableId:table().attrs.blockId,row,col,endRow,endCol});
const pin=(count:number)=>engine.execute({target:target(),operations:[{type:'table.pinRows',count}]});
const sort=()=>engine.execute({target:target(),operations:[{type:'table.sort',column:0}]});
const texts=()=>Array.from({length:table().childCount},(_,i)=>table().child(i).child(0).textContent);

it('pins ordinary cells without changing their styles and protects exactly that range during numeric sorting',()=>{
  const before=editor.getJSON(),content=table().content.toJSON();expect(pin(2).ok).toBe(true);
  expect(table().content.toJSON()).toEqual(content);expect(pinnedRowCount(table())).toBe(2);
  expect(editor.view.dom.querySelectorAll('.vdoc-pinned-row')).toHaveLength(2);
  expect(sort().ok).toBe(true);expect(texts()).toEqual(['900','800','3','10','20']);
  engine.history('undo');engine.history('undo');expect(editor.getJSON()).toEqual(before);
  engine.history('redo');expect(pinnedRowCount(table())).toBe(2);
});
it('unpins styled headers explicitly, allowing them to sort, and preserves zero through HTML and JSON',()=>{
  editor.commands.setContent('<table><tr><th>900</th></tr><tr><th>800</th></tr><tr><td>3</td></tr></table>');
  expect(pinnedRowCount(table())).toBe(2);expect(pin(0).ok).toBe(true);
  expect(table().firstChild!.firstChild!.type.name).toBe('tableHeader');expect(pinnedRowCount(table())).toBe(0);
  const saved=editor.getJSON(),html=editor.getHTML();expect(html).toContain('data-pinned-rows="0"');
  expect(parseDocument(JSON.stringify({version:1,title:'Unpinned',content:saved})).content).toEqual(saved);
  expect(sort().ok).toBe(true);expect(texts()).toEqual(['3','800','900']);
  editor.commands.setContent(html);expect(pinnedRowCount(table())).toBe(0);
});
it('pins all rows and leaves an all-pinned table unchanged when sorted',()=>{
  expect(pin(5).ok).toBe(true);const before=editor.getJSON();expect(sort().ok).toBe(true);expect(editor.getJSON()).toEqual(before);
});
it.each([-1,1.5,6])('rejects count %s atomically',count=>{
  const before=editor.getJSON();expect(engine.execute({target:target(),operations:[{type:'table.layout',alignment:'right'},{type:'table.pinRows',count}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);
});
it.each([-1,1.5,6,'2'])('rejects invalid backup pin count %s',pinnedRows=>{
  const content=editor.getJSON();content.content![0].attrs!.pinnedRows=pinnedRows;
  expect(()=>parseDocument(JSON.stringify({version:1,title:'Invalid',content}))).toThrow(/pinned row/);
});
it('rejects partial rowspans, accepts complete merged headers, sorts their ordinary body, and preserves widths',()=>{
  editor.commands.setContent('<table><tr><td rowspan="2" colwidth="100">标题</td><td colwidth="150">العربية</td></tr><tr><td colwidth="150">日本語</td></tr><tr><td colwidth="100">20</td><td colwidth="150">B</td></tr><tr><td colwidth="100">3</td><td colwidth="150">A</td></tr></table>');
  const before=editor.getJSON();expect(completePinnedBoundary(table(),1)).toBe(2);expect(pin(1).ok).toBe(false);expect(editor.getJSON()).toEqual(before);
  expect(pin(2).ok).toBe(true);const header=table().content.cut(0,table().child(0).nodeSize+table().child(1).nodeSize).toJSON();
  expect(sort().ok).toBe(true);expect(texts()).toEqual(['标题','日本語','3','20']);
  expect(table().content.cut(0,table().child(0).nodeSize+table().child(1).nodeSize).toJSON()).toEqual(header);expect(TableMap.get(table()).problems).toBeNull();
});
it.each(['rowBefore','rowAfter'] as const)('extends a pinned region for %s inside it and restores pin count with one Undo',action=>{
  pin(2);const before=editor.getJSON();
  expect(engine.execute({target:target(action==='rowBefore'?1:0),operations:[{type:'table.edit',action}]}).ok).toBe(true);
  expect(pinnedRowCount(table())).toBe(3);engine.history('undo');expect(editor.getJSON()).toEqual(before);
  engine.history('redo');expect(pinnedRowCount(table())).toBe(3);
});
it('shrinks the fixed region when pinned rows are deleted and keeps added body rows unpinned',()=>{
  pin(2);const before=editor.getJSON();
  expect(engine.execute({target:target(),operations:[{type:'table.edit',action:'deleteRow'}]}).ok).toBe(true);expect(pinnedRowCount(table())).toBe(1);
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
  expect(engine.execute({target:target(1),operations:[{type:'table.edit',action:'rowAfter'}]}).ok).toBe(true);expect(pinnedRowCount(table())).toBe(2);
});
it('unpins when all pinned rows are removed, with exact undo',()=>{
  pin(2);const before=editor.getJSON();expect(engine.execute({target:target(0,0,1,1),operations:[{type:'table.edit',action:'deleteRow'}]}).ok).toBe(true);expect(pinnedRowCount(table())).toBe(0);
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('blocks merged cells and row moves across the header boundary without partial changes',()=>{
  pin(2);const before=editor.getJSON();
  expect(engine.execute({target:target(1,0,2,0),operations:[{type:'table.edit',action:'merge'}]}).ok).toBe(false);
  expect(engine.execute({target:target(),operations:[{type:'table.move',axis:'row',from:1,to:2}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);
  expect(engine.execute({target:target(),operations:[{type:'table.move',axis:'row',from:2,to:3}]}).ok).toBe(true);expect(pinnedRowCount(table())).toBe(2);
});
it('uses the document locale when sorting',()=>{
  editor.commands.setContent('<table data-pinned-rows="0"><tr><td>ä</td></tr><tr><td>z</td></tr><tr><td>a</td></tr></table>');
  expect(engine.execute({target:target(),operations:[{type:'document.language',language:'sv'},{type:'table.sort',column:0}]}).ok).toBe(true);expect(texts()).toEqual(['a','z','ä']);
});
it('honors an explicit pin count after inserting a header row in the same batch',()=>{
  pin(2);const before=editor.getJSON();
  expect(engine.execute({target:target(1),operations:[{type:'table.edit',action:'rowBefore'},{type:'table.pinRows',count:2}]}).ok).toBe(true);
  expect(pinnedRowCount(table())).toBe(2);engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('rejects a backup whose pin boundary cuts a rowspan',()=>{
  editor.commands.setContent('<table><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table>');
  const content=editor.getJSON();content.content![0].attrs!.pinnedRows=1;
  expect(()=>parseDocument(JSON.stringify({version:1,title:'Invalid boundary',content}))).toThrow(/boundary/);
});
it.each([0.75,1,1.25])('clamps sticky offset at table boundaries at scale %s',scale=>{
  expect(pinnedHeaderOffset(200,1000*scale,100*scale,150,scale)).toBe(0);
  expect(pinnedHeaderOffset(100,1000*scale,100*scale,150,scale)).toBeCloseTo(50/scale);
  expect(pinnedHeaderOffset(-1000,1000*scale,100*scale,150,scale)).toBe(900);
});
