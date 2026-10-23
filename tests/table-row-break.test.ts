import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { parseDocument } from '../lib/infrastructure/persistence/document-codec';
import { exportHTML } from '../lib/infrastructure/export/html-export';
let editor: Editor, engine: DocumentEngine;
beforeEach(async()=>{
 editor=new Editor({extensions:createExtensions(),content:'<table data-pinned-rows="1"><tr><th>Header</th><th>اللغة</th></tr><tr style="height:60px"><td rowspan="2">日本語</td><td>עברית</td></tr><tr><td>हिन्दी</td></tr><tr><td>Last</td><td>End</td></tr></table>'});
 await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);
});
afterEach(()=>{engine.destroy();editor.destroy();});
const table=()=>editor.state.doc.firstChild!;
const target=()=>({kind:'cells',tableId:table().attrs.blockId,row:1,col:1});
const flags=()=>Array.from({length:table().childCount},(_,r)=>table().child(r).attrs.allowSplit);
it('sets only specified rows, preserves merged cells, heights, IDs, pins, and has one exact undo/redo',()=>{
 const before=editor.getJSON(),cells=Array.from({length:4},(_,r)=>table().child(r).content.toJSON()),ids=engine.snapshot().tables[0].rowBreaks.map(r=>r.id);
 expect(engine.execute({target:target(),operations:[{type:'table.rowBreak',from:1,to:3,allowSplit:true}]}).ok).toBe(true);
 expect(flags()).toEqual([false,true,true,false]);expect(table().attrs.pinnedRows).toBe(1);expect(table().child(1).attrs.minHeight).toBe(60);
 expect(Array.from({length:4},(_,r)=>table().child(r).content.toJSON())).toEqual(cells);
 expect(engine.snapshot().tables[0].rowBreaks).toEqual(ids.map((id,row)=>({id,row,allowSplit:row===1||row===2})));
 const after=editor.getJSON();expect(parseDocument(JSON.stringify({version:1,title:'Rows',content:after})).content).toEqual(after);
 engine.history('undo');expect(editor.getJSON()).toEqual(before);engine.history('redo');expect(editor.getJSON()).toEqual(after);
});
it.each([{from:2,to:2},{from:3,to:1},{from:0,to:5},{from:-1,to:2},{from:0.5,to:2}])('rejects invalid range %j without applying an earlier operation',range=>{
 const before=editor.getJSON();expect(engine.execute({target:target(),operations:[{type:'table.layout',alignment:'right'},{type:'table.rowBreak',...range,allowSplit:true}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);
});
it('preserves per-row choices in rendered HTML, exported print HTML, and HTML reimport',()=>{
 engine.execute({target:target(),operations:[{type:'table.rowBreak',from:1,to:3,allowSplit:true}]});
 const html=editor.getHTML(),exported=new DOMParser().parseFromString(exportHTML('Rows',html,editor.getJSON()),'text/html');
 for(const dom of [editor.view.dom,exported.body])expect(Array.from(dom.querySelectorAll('tr')).map(r=>[r.dataset.allowSplit,r.style.breakInside,r.style.pageBreakInside])).toEqual([['false','avoid','avoid'],['true','auto','auto'],['true','auto','auto'],['false','avoid','avoid']]);
 editor.commands.setContent(html);expect(flags()).toEqual([false,true,true,false]);
});
it.each([null,'true',1])('rejects malformed row metadata %j in backups',allowSplit=>{
 const content: JSONContent=editor.getJSON();content.content![0].content![0].attrs!.allowSplit=allowSplit;
 expect(()=>parseDocument(JSON.stringify({version:1,title:'Invalid',content}))).toThrow('row page-break');
});
it('keeps legacy defaults and recognizes ordinary HTML break-inside values',()=>{
 expect(flags()).toEqual([false,false,false,false]);editor.commands.setContent('<table><tr style="break-inside:auto"><td>A</td></tr><tr style="page-break-inside:avoid"><td>B</td></tr></table>');expect(flags()).toEqual([true,false]);
});
it('keeps row settings with the row ID during reordering',()=>{
 editor.commands.setContent('<table data-pinned-rows="0"><tr><td>A</td></tr><tr><td>B</td></tr><tr><td>C</td></tr></table>');
 const before=editor.getJSON(),id=table().child(1).attrs.blockId;
 expect(engine.execute({target:{...target(),row:1,col:0},operations:[{type:'table.rowBreak',from:1,to:2,allowSplit:true},{type:'table.move',axis:'row',from:1,to:2}]}).ok).toBe(true);
 expect(table().child(2).attrs).toMatchObject({blockId:id,allowSplit:true});expect(flags()).toEqual([false,false,true]);engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('external stable-cell requests target the correct table and reject a stale retry',()=>{
 const snap=engine.snapshot(),request={expectedSessionId:snap.sessionId,expectedRevision:snap.revision,target:{kind:'cell',tableId:snap.tables[0].id,cellId:snap.tables[0].cells[3].id},operations:[{type:'table.rowBreak',from:1,to:2,allowSplit:true}]};
 expect(engine.executeExternal(request).ok).toBe(true);const after=editor.getJSON();expect(engine.executeExternal(request)).toMatchObject({ok:false,code:'STALE'});expect(editor.getJSON()).toEqual(after);
});
it('limits row changes to the explicitly targeted table, including nested tables',()=>{
 editor.commands.setContent('<table><tr><td><p>Outer A</p><table><tr><td>Inner A</td></tr><tr><td>Inner B</td></tr></table></td></tr><tr><td>Outer B</td></tr></table>');
 const snap=engine.snapshot(),outer=snap.tables[0],inner=snap.tables[1];
 expect(engine.execute({target:{kind:'cell',tableId:outer.id,cellId:outer.cells[0].id},operations:[{type:'table.rowBreak',from:0,to:2,allowSplit:true}]}).ok).toBe(true);
 expect(engine.snapshot().tables.map(t=>t.rowBreaks.map(r=>r.allowSplit))).toEqual([[true,true],[false,false]]);
 expect(engine.execute({target:{kind:'cell',tableId:inner.id,cellId:inner.cells[0].id},operations:[{type:'table.rowBreak',from:0,to:1,allowSplit:true}]}).ok).toBe(true);
 expect(engine.snapshot().tables.map(t=>t.rowBreaks.map(r=>r.allowSplit))).toEqual([[true,true],[true,false]]);
});
