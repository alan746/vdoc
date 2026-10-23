import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { parseDocument } from '../lib/infrastructure/persistence/document-codec';
import { cellBorder } from '../lib/editor/table/table-borders';
import { columnDelta } from '../lib/editor/table/table-direction';
let editor: Editor, engine: DocumentEngine;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:'<table><tr><td colwidth="100"><p dir="rtl">العربية</p></td><td colwidth="150">עברית</td><td colwidth="200">日本語</td></tr><tr><td>A</td><td>B</td><td>C</td></tr></table>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();vi.restoreAllMocks();});
const table=()=>editor.state.doc.firstChild!;
const target=(col=0)=>({kind:'cells',tableId:table().attrs.blockId,row:0,col});
const rtl=()=>expect(engine.execute({target:target(),operations:[{type:'table.direction',direction:'rtl'}]}).ok).toBe(true);
it('changes display direction without reordering cells, IDs, widths, or paragraph direction; restores history and backup',()=>{
 const before=editor.getJSON(),content=table().content.toJSON();rtl();
 expect(table().content.toJSON()).toEqual(content);expect(engine.snapshot().tables[0].columnDirection).toBe('rtl');
 expect(editor.view.dom.querySelector('table')!.dir).toBe('rtl');
 const saved=editor.getJSON();expect(parseDocument(JSON.stringify({version:1,title:'RTL',content:saved})).content).toEqual(saved);
 const html=editor.getHTML();engine.history('undo');expect(editor.getJSON()).toEqual(before);engine.history('redo');expect(editor.getJSON()).toEqual(saved);
 editor.commands.setContent(html);expect(table().attrs.columnDirection).toBe('rtl');expect(table().child(0).child(0).child(0).attrs.direction).toBe('rtl');
});
it('rejects invalid directions atomically and validates backups',()=>{
 const before=editor.getJSON();expect(engine.execute({target:target(),operations:[{type:'table.layout',alignment:'right'},{type:'table.direction',direction:'sideways'}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);
 before.content![0].attrs!.columnDirection='sideways';expect(()=>parseDocument(JSON.stringify({version:1,title:'Invalid',content:before}))).toThrow();
});
it.each(['left','right'] as const)('synchronizes the physical %s border of an RTL interior cell',side=>{
 rtl();expect(engine.execute({target:target(1),operations:[{type:'table.border',scope:side,width:4,color:'#FF0000',style:'dashed'}]}).ok).toBe(true);
 expect(cellBorder(table().child(0).child(1).attrs,side).width).toBe(4);
 const neighbour=side==='left'?2:0,opposite=side==='left'?'right':'left';
 expect(cellBorder(table().child(0).child(neighbour).attrs,opposite).width).toBe(4);
 expect(cellBorder(table().child(0).child(side==='left'?0:2).attrs,side).width).not.toBe(4);
});
it.each(['left','right'] as const)('moves a column physically %s while preserving RTL order and undo',side=>{
 rtl();const before=editor.getJSON();expect(engine.execute({target:target(1),operations:[{type:'table.move',axis:'column',from:1,to:1+columnDelta('rtl',side)}]}).ok).toBe(true);
 expect(table().child(1).textContent).toBe(side==='left'?'ACB':'BAC');expect(TableMap.get(table()).problems).toBeNull();engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it.each([{key:'ArrowLeft',from:0,to:1},{key:'ArrowRight',from:1,to:0},{key:'ArrowRight',from:0,to:0},{key:'ArrowLeft',from:2,to:2}])('navigates a cell selection physically $key from $from to $to',({key,from,to})=>{
 rtl();const map=TableMap.get(table()),pos=(col:number)=>1+map.map[col];editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,pos(from))));
 editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));
 expect((editor.state.selection as CellSelection).$headCell.pos).toBe(pos(to));
});
it('extends an RTL cell selection physically left',()=>{
 rtl();const map=TableMap.get(table());editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,1+map.map[0])));
 editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true,bubbles:true,cancelable:true}));
 expect((editor.state.selection as CellSelection).$anchorCell.pos).toBe(1+map.map[0]);expect((editor.state.selection as CellSelection).$headCell.pos).toBe(1+map.map[1]);
});
it.each(['all','outer','inner'] as const)('applies %s RTL borders consistently around a full selection',scope=>{
 rtl();expect(engine.execute({target:{...target(),endRow:1,endCol:2},operations:[{type:'table.border',scope,width:4,color:'#FF0000',style:'solid'}]}).ok).toBe(true);
 const a=table().child(0).child(0),b=table().child(0).child(1);
 expect(cellBorder(a.attrs,'right').width).toBe(scope==='inner'?1:4);
 expect(cellBorder(a.attrs,'left').width).toBe(scope==='outer'?1:4);
 expect(cellBorder(b.attrs,'right').width).toBe(scope==='outer'?1:4);
 expect(cellBorder(a.attrs,'top').width).toBe(scope==='inner'?1:4);
});
it('moves through paragraphs within an RTL cell before crossing the table boundary',()=>{
 editor.commands.setContent('<table dir="rtl"><tr><td><p dir="rtl">أول</p><p dir="rtl">ثان</p></td><td>Next</td></tr></table>');
 const paragraphs:number[]=[];editor.state.doc.descendants((n,pos)=>{if(n.isTextblock)paragraphs.push(pos);});
 vi.spyOn(editor.view,'endOfTextblock').mockReturnValue(true);
 editor.commands.setTextSelection(paragraphs[0]+1+3);
 editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
 expect(editor.state.selection.$head.parent.textContent).toBe('ثان');
 editor.commands.setTextSelection(paragraphs[1]+1+3);
 editor.view.dom.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
 expect(editor.state.selection.$head.parent.textContent).toBe('Next');
});
