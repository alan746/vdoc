import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Editor} from '@tiptap/core';
import {CellSelection,TableMap} from '@tiptap/pm/tables';
import {createExtensions} from '../lib/editor/extensions';
import {graphemeCount,selectionGraphemeCount} from '../lib/domain/text/unicode';
import {selectedCellListType} from '../lib/editor/list/cell-lists';
import {DocumentEngine} from '../lib/usecases/engine';
import {parseDocument} from '../lib/infrastructure/persistence/document-codec';
import {exportWord,importWord} from '../lib/infrastructure/word/word';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
let editor:Editor,engine:DocumentEngine;
beforeEach(async()=>{
 editor=new Editor({extensions:createExtensions(),content:'<p>Before</p><table><tr><th><h2>中文 A</h2></th><th><p>Keep B</p></th><th><p>Keep C</p></th></tr><tr><td><p dir="rtl"><strong>العربية D</strong></p><p>हिन्दी E</p></td><td><p>Keep F</p></td><td><p>Keep G</p></td></tr></table><p>After</p>'});
 await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);
});
afterEach(()=>{engine.destroy();editor.destroy();});
function table(){let result:{pos:number;node:typeof editor.state.doc}|undefined;editor.state.doc.descendants((node,pos)=>{if(node.type.name==='table'&&!result)result={pos,node};});return result!;}
function select(row:number,col:number,endRow=row,endCol=col){const t=table(),map=TableMap.get(t.node);editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,t.pos+1+map.map[row*map.width+col],t.pos+1+map.map[endRow*map.width+endCol])));}
const json=()=>editor.getJSON();
const run=(kind:'ordered'|'bullet'|'task')=>engine.execute({operations:[{type:'list.toggle',kind}]}).ok;
const cell=(row:number,col:number)=>{const t=table();return t.node.nodeAt(TableMap.get(t.node).map[row*TableMap.get(t.node).width+col])!;};
const wrap=(html:string)=>editor.commands.setContent(`<table><tr><td>${html}</td><td><p>Other</p></td></tr></table>`);
it.each(['ordered','bullet','task'] as const)('formats only a selected column as %s with one undo/redo',kind=>{
 select(0,0,1,0);const before=json(),grid=engine.snapshot().tables,unselected=[cell(0,1),cell(0,2),cell(1,1),cell(1,2)].map(n=>n.toJSON());
 expect(run(kind)).toBe(true);expect(engine.snapshot().tables).toEqual(grid);expect([cell(0,1),cell(0,2),cell(1,1),cell(1,2)].map(n=>n.toJSON())).toEqual(unselected);
 expect(cell(0,0).firstChild!.firstChild!.firstChild!.type.name).toBe('heading');expect(cell(1,0).firstChild!.childCount).toBe(2);expect(cell(1,0).firstChild!.firstChild!.firstChild!.attrs.direction).toBe('rtl');
 expect(editor.state.selection).toBeInstanceOf(CellSelection);const after=json();engine.history('undo');expect(json()).toEqual(before);engine.history('redo');expect(json()).toEqual(after);
});
it('preserves reverse cell selection and each cell starts its own numbering',()=>{
 select(1,2,0,0);expect(run('ordered')).toBe(true);const selection=editor.state.selection as CellSelection;expect(selection.$anchorCell.pos).toBeGreaterThan(selection.$headCell.pos);
 for(let row=0;row<2;row++)for(let col=0;col<3;col++)expect(cell(row,col).firstChild!.attrs.start).toBe(1);
 let count=0;selection.forEachCell(()=>count++);expect(count).toBe(6);
});
it('handles rowspans and colspans once while preserving header and cell attributes',()=>{
 editor.commands.setContent('<table><tr><th colspan="2" style="background-color:#ff0000"><p>Wide</p></th><th rowspan="2"><p>Tall</p></th></tr><tr><td><p>One</p></td><td><p>Two</p></td></tr></table>');select(0,0,1,2);
 const before=json(),grid=engine.snapshot().tables,attrs:unknown[]=[];table().node.descendants(n=>{if(['tableCell','tableHeader'].includes(n.type.name))attrs.push(n.attrs);});expect(run('task')).toBe(true);expect(engine.snapshot().tables).toEqual(grid);
 const afterAttrs:unknown[]=[],types:string[]=[];table().node.descendants(n=>{if(['tableCell','tableHeader'].includes(n.type.name)){afterAttrs.push(n.attrs);types.push(n.firstChild!.type.name);}});expect(afterAttrs).toEqual(attrs);expect(types).toEqual(['taskList','taskList','taskList','taskList']);engine.history('undo');expect(json()).toEqual(before);
});
it('applies a mixed selection before toggling the whole matching selection off',()=>{
 wrap('<ul data-bullet-text="★"><li><p>Existing</p></li></ul><h3>New</h3>');select(0,0,0,1);const existing=cell(0,0).firstChild!.toJSON();expect(run('bullet')).toBe(true);expect(cell(0,0).firstChild!.toJSON()).toEqual(existing);expect(cell(0,0).child(1).type.name).toBe('bulletList');expect(cell(0,1).firstChild!.type.name).toBe('bulletList');
 expect(run('bullet')).toBe(true);expect(cell(0,0).content.content.map(n=>n.type.name)).toEqual(['paragraph','heading']);expect(cell(0,1).firstChild!.type.name).toBe('paragraph');
});
it('preserves multi-paragraph items, nested checked tasks and object blocks during conversion',()=>{
 wrap('<ol start="8" type="I"><li><h2><em>Title</em></h2><p>Continuation</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Nested</p></li></ul></li></ol><blockquote><p>Quote</p></blockquote><table><tr><td><p>Nested cell</p></td></tr></table><p>Last</p>');select(0,0);
 const original=cell(0,0),contents=original.firstChild!.firstChild!.content.toJSON(),quote=original.child(1).toJSON(),nestedTable=original.child(2).toJSON();expect(run('task')).toBe(true);
 expect(cell(0,0).firstChild!.firstChild!.content.toJSON()).toEqual(contents);expect(cell(0,0).firstChild!.firstChild!.attrs.checked).toBe(false);expect(cell(0,0).child(1).toJSON()).toEqual(quote);expect(cell(0,0).child(2).toJSON()).toEqual(nestedTable);expect(cell(0,0).lastChild!.type.name).toBe('taskList');
 expect(run('task')).toBe(true);expect(cell(0,0).content.content.map(n=>n.type.name)).toEqual(['heading','paragraph','taskList','blockquote','table','paragraph']);
});
it('keeps an existing task list mode and completed state while applying tasks to other cells',()=>{
 wrap('<ul data-type="taskList" data-strike-completed="false"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul>');select(0,0,0,1);const original=cell(0,0).toJSON();expect(run('task')).toBe(true);expect(cell(0,0).toJSON()).toEqual(original);expect(cell(0,1).firstChild!.firstChild!.attrs.checked).toBe(false);
});
it('does not attach existing continued numbering to a new series in its gap',()=>{
 wrap('<ol start="8" type="I"><li><p>Before</p></li></ol><p>Gap</p><ol start="9" type="I" data-continue-numbering="true"><li><p>Tail</p></li></ol>');select(0,0);expect(run('ordered')).toBe(true);
 expect(cell(0,0).child(0).attrs).toMatchObject({start:8,type:'I'});expect(cell(0,0).child(1).attrs).toMatchObject({start:1,type:null});expect(cell(0,0).child(2).attrs).toMatchObject({start:9,type:'I',continuePrevious:false});
});
it('preserves an unaffected continuation chain when another cell needs numbering',()=>{
 wrap('<ol start="8" type="I"><li><p>Before</p></li></ol><blockquote><p>Separator</p></blockquote><ol start="9" type="I" data-continue-numbering="true"><li><p>Tail</p></li></ol>');select(0,0,0,1);const original=cell(0,0).toJSON();expect(run('ordered')).toBe(true);expect(cell(0,0).toJSON()).toEqual(original);
});
it('refuses object-only cells without modifying them, but keeps them intact in a mixed selection',()=>{
 wrap('<blockquote><p>Quote</p></blockquote>');select(0,0);const before=json();expect(editor.can().toggleBulletList()).toBe(false);expect(run('bullet')).toBe(false);expect(json()).toEqual(before);select(0,0,0,1);const quote=cell(0,0).toJSON();expect(run('bullet')).toBe(true);expect(cell(0,0).toJSON()).toEqual(quote);
});
it('keeps cell selection through preceding and subsequent operations in an atomic batch',()=>{
 select(0,0,1,0);const before=json();expect(engine.execute({operations:[{type:'text.style',style:{bold:true}},{type:'list.toggle',kind:'task'},{type:'list.toggle',kind:'ordered'},{type:'paragraph.style',level:3}]}).ok).toBe(true);
 expect(cell(1,0).firstChild!.childCount).toBe(2);expect(cell(1,0).firstChild!.child(1).firstChild!.type.name).toBe('heading');expect(cell(1,0).firstChild!.child(1).firstChild!.attrs.level).toBe(3);expect(cell(1,1).firstChild!.type.name).toBe('paragraph');engine.history('undo');expect(json()).toEqual(before);
});
it('supports explicit external cell targets and rejects stale retries without changes',()=>{
 const snap=engine.snapshot(),before=json();const request={source:'api',expectedSessionId:snap.sessionId,expectedRevision:snap.revision,target:{kind:'cells',tableId:snap.tables[0].id,row:0,col:0,endRow:1,endCol:0},operations:[{type:'list.toggle',kind:'task'}]};expect(engine.execute(request).ok).toBe(true);const after=json();expect(engine.execute(request).code).toBe('STALE');expect(json()).toEqual(after);engine.history('undo');expect(json()).toEqual(before);
});
it('does not write during can or composing input',()=>{
 select(0,0,1,0);const before=json(),revision=engine.revision;expect(editor.can().toggleOrderedList()).toBe(true);expect(json()).toEqual(before);expect(engine.revision).toBe(revision);Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>true});expect(editor.commands.toggleOrderedList()).toBe(false);expect(run('ordered')).toBe(false);expect(json()).toEqual(before);
});
it.each(['ordered','bullet','task'] as const)('round-trips multi-cell %s lists through HTML and local backup',kind=>{
 select(0,0,1,2);expect(run(kind)).toBe(true);const after=json(),other=new Editor({extensions:createExtensions(),content:editor.getHTML()});expect(other.getJSON()).toEqual(after);other.destroy();expect(parseDocument(JSON.stringify({version:1,title:'Cells',content:after})).content).toEqual(after);
});
it.each(['ordered','bullet'] as const)('retains table list structure and headings through actual %s Word bytes',async kind=>{
 select(0,0,1,2);expect(run(kind)).toBe(true);const text=editor.state.doc.textContent,blob=await exportWord(json(),'Cell lists'),buffer=await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);});const result=await importWord(buffer);expect(result.warnings).toEqual([]);editor.commands.setContent(result.content);expect(editor.state.doc.textContent).toBe(text);expect(TableMap.get(table().node).width).toBe(3);expect(cell(0,0).firstChild!.firstChild!.firstChild!.type.name).toBe('heading');expect(cell(1,0).firstChild!.childCount).toBe(2);
});

it('reports toolbar list state for selected cells only and clears mixed or toggled-off state',()=>{
 select(0,0,1,0);expect(selectedCellListType(editor.state.selection)).toBeNull();run('ordered');expect(selectedCellListType(editor.state.selection)).toBe('orderedList');
 select(0,0,1,1);expect(selectedCellListType(editor.state.selection)).toBeNull();run('bullet');expect(selectedCellListType(editor.state.selection)).toBe('bulletList');run('bullet');expect(selectedCellListType(editor.state.selection)).toBeNull();
});

it('counts every selected column cell without counting intervening unselected cells',()=>{
 select(0,0,1,0);const expected=graphemeCount('中文 A')+graphemeCount('العربية Dहिन्दी E');expect(selectionGraphemeCount(editor.state.doc,editor.state.selection)).toBe(expected);run('task');expect(selectionGraphemeCount(editor.state.doc,editor.state.selection)).toBe(expected);
});
it('counts merged cells only once and keeps emoji and combining characters whole',()=>{
 editor.commands.setContent('<table><tr><td colspan="2"><p>👨‍👩‍👧‍👦</p></td><td rowspan="2"><p>é</p></td></tr><tr><td><p>👍🏽</p></td><td><p>🇨🇦</p></td></tr></table>');select(0,0,1,2);expect(selectionGraphemeCount(editor.state.doc,editor.state.selection)).toBe(4);run('ordered');expect(selectionGraphemeCount(editor.state.doc,editor.state.selection)).toBe(4);
});
it('keeps ordinary text and empty-caret character counts unchanged',()=>{
 editor.commands.setContent('<p>A👨‍👩‍👧‍👦é</p>');editor.commands.selectAll();expect(selectionGraphemeCount(editor.state.doc,editor.state.selection)).toBe(3);editor.commands.setTextSelection(1);expect(selectionGraphemeCount(editor.state.doc,editor.state.selection)).toBe(0);
});
