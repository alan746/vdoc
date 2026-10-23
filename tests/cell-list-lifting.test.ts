import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { liftCellLists } from '../lib/editor/list/cell-lists';
import { indentCommandType } from '../lib/editor/list/list-editing';
import { parseDocument } from '../lib/infrastructure/persistence/document-codec';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
let editor: Editor, engine: DocumentEngine;
const item = (text: string) => `<li><p>${text}</p></li>`;
const numbered = (text: string, start = 4, linked = false) => `<ol start="${start}" type="I" data-number-prefix="(" data-number-suffix=")" data-continue-numbering="${linked}">${item(text)}</ol>`;
beforeEach(async () => {
  editor = new Editor({extensions: createExtensions(), content: `<p>Outside</p><table><tr><th><ol start="4"><li><h3><strong>中文 A</strong></h3><p>Continuation</p><ul data-bullet-text="★">${item('日本語 child')}</ul></li>${item('Second')}</ol></th><th>${numbered('Keep',20)}</th></tr><tr><td><ul data-type="taskList" data-strike-completed="false"><li data-type="taskItem" data-checked="true"><p>العربية B</p>${numbered('Inner',8)}</li></ul><p>Gap</p></td><td><p>Plain</p></td></tr></table>`});
  await new Promise(r => setTimeout(r,0)); engine = new DocumentEngine(editor);
});
afterEach(() => {engine.destroy(); editor.destroy();});
function table() {let result: {pos: number; node: typeof editor.state.doc} | undefined; editor.state.doc.descendants((node,pos) => {if(node.type.name==='table'&&!result)result={node,pos};}); return result!;}
function select(row=0,col=0,endRow=1,endCol=0) {const t=table(),m=TableMap.get(t.node);editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,t.pos+1+m.map[row*m.width+col],t.pos+1+m.map[endRow*m.width+endCol])));}
function cell(row:number,col:number) {const t=table(),m=TableMap.get(t.node);return t.node.nodeAt(m.map[row*m.width+col])!;}
const json=()=>editor.getJSON();
const run=()=>engine.execute({operations:[{type:'list.indent',direction:'out'}]});
it('lifts mixed list types one level across a reverse column, preserving content, grid, IDs and exact undo/redo',()=>{
 select(1,0,0,0);const before=json(),grid=engine.snapshot().tables,ids=engine.snapshot().blocks.map(b=>b.id),other=[cell(0,1).toJSON(),cell(1,1).toJSON()];
 const expected=cell(0,0).firstChild!.content.content.flatMap(n=>n.content.content).map(n=>n.toJSON());
 expect(run().ok).toBe(true);expect(cell(0,0).content.toJSON()).toEqual(expected);expect(cell(1,0).content.content.map(n=>n.type.name)).toEqual(['paragraph','orderedList','paragraph']);expect(cell(1,0).child(1).attrs.start).toBe(8);
 expect(engine.snapshot().tables).toEqual(grid);expect(engine.snapshot().blocks.map(b=>b.id)).toEqual(ids);expect([cell(0,1).toJSON(),cell(1,1).toJSON()]).toEqual(other);expect((editor.state.selection as CellSelection).$anchorCell.pos).toBeGreaterThan((editor.state.selection as CellSelection).$headCell.pos);
 const after=json();engine.history('undo');expect(json()).toEqual(before);engine.history('redo');expect(json()).toEqual(after);
});
it('distinguishes whole-cell decrease from unsupported increase and leaves dry-run transactions untouched',()=>{
 select();expect(indentCommandType(editor.state.selection,'out')).toBe('list.indent');expect(indentCommandType(editor.state.selection,'in')).toBeNull();const tr=editor.state.tr,before=json();expect(liftCellLists(tr,false)).toBe(true);expect(tr.steps).toHaveLength(0);expect(engine.execute({operations:[{type:'list.indent',direction:'in'}]}).ok).toBe(false);expect(json()).toEqual(before);
});
it('skips plain cells and does not change explicit paragraph indentation',()=>{
 select(0,0,1,1);const plain=cell(1,1).toJSON();expect(run().ok).toBe(true);expect(cell(1,1).toJSON()).toEqual(plain);expect(cell(0,1).firstChild!.textContent).toBe('Keep');select(1,1,1,1);const before=json(),rev=engine.revision;expect(run().ok).toBe(false);expect(engine.revision).toBe(rev);expect(json()).toEqual(before);expect(indentCommandType(editor.state.selection,'out')).toBe('paragraph.indent');
});
it('handles merged headers and row spans without duplicated contents or geometry changes',()=>{
 editor.commands.setContent(`<table><tr><th colspan="2">${numbered('Wide')}</th><th rowspan="2">${numbered('Tall',20)}</th></tr><tr><td><p>Plain</p></td><td>${numbered('Small')}</td></tr></table>`);select(0,0,1,2);const grid=engine.snapshot().tables;expect(run().ok).toBe(true);expect(engine.snapshot().tables).toEqual(grid);expect(cell(0,0).textContent).toBe('Wide');expect(cell(0,2).firstChild!.type.name).toBe('paragraph');
});
it('preserves nested tables, images, marks, paragraph attrs and deeper checklist state',()=>{
 editor.commands.setContent(`<table><tr><td><ol><li><h2 dir="rtl"><em>عنوان</em></h2><p style="margin-left:24px">Body</p><img src="data:image/png;base64,AA==" alt="Keep"/><table><tr><td>${numbered('Nested table',70)}</td></tr></table><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Checked child</p></li></ul></li></ol></td></tr></table>`);select(0,0,0,0);const children=cell(0,0).firstChild!.firstChild!.content.toJSON();expect(run().ok).toBe(true);expect(cell(0,0).content.toJSON()).toEqual(children);
});
it('keeps independent promoted groups separate and preserves valid continuation chains inside each original item',()=>{
 editor.commands.setContent(`<table><tr><td><ul><li><p>A</p>${numbered('A1',4)}<p>Gap</p>${numbered('A2',5,true)}</li><li><p>B</p>${numbered('B1',20,true)}<p>Gap</p>${numbered('B2',21,true)}</li></ul></td></tr></table>`);select(0,0,0,0);expect(run().ok).toBe(true);const lists=cell(0,0).content.content.filter(n=>n.type.name==='orderedList');expect(lists.map(n=>[n.attrs.start,n.attrs.continuePrevious])).toEqual([[4,false],[5,true],[20,false],[21,true]]);
});
it('takes only one level at a time and does not manufacture a list when no target remains',()=>{
 select();expect(run().ok).toBe(true);expect(cell(0,0).child(2).type.name).toBe('bulletList');expect(run().ok).toBe(true);expect(cell(0,0).child(2).type.name).toBe('paragraph');const before=json(),rev=engine.revision;expect(run().ok).toBe(false);expect(json()).toEqual(before);expect(engine.revision).toBe(rev);
});
it('retains cell selection for subsequent commands and applies one atomic undo',()=>{
 select();const before=json();expect(engine.execute({operations:[{type:'list.indent',direction:'out'},{type:'list.marker',prefix:'['},{type:'text.style',style:{italic:true}}]}).ok).toBe(false);expect(json()).toEqual(before);
 expect(engine.execute({operations:[{type:'list.indent',direction:'out'},{type:'list.toggle',kind:'bullet'},{type:'text.style',style:{italic:true}}]}).ok).toBe(true);expect(editor.state.selection).toBeInstanceOf(CellSelection);expect(cell(0,0).firstChild!.type.name).toBe('bulletList');engine.history('undo');expect(json()).toEqual(before);
});
it('honors explicit cells targets, stale revision and composition protection',()=>{
 const s=engine.snapshot(),req={source:'api',expectedSessionId:s.sessionId,expectedRevision:s.revision,target:{kind:'cells',tableId:s.tables[0].id,row:0,col:0,endRow:1,endCol:0},operations:[{type:'list.indent',direction:'out'}]};expect(engine.execute(req).ok).toBe(true);const after=json();expect(engine.execute(req).code).toBe('STALE');Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>true});expect(run().ok).toBe(false);expect(json()).toEqual(after);
});
it('keeps HTML, local backups and real Word bytes consistent for promoted child lists',async()=>{
 select();run();const after=json(),other=new Editor({extensions:createExtensions(),content:editor.getHTML()});expect(other.getJSON()).toEqual(after);other.destroy();expect(parseDocument(JSON.stringify({version:1,title:'Lift cells',content:after})).content).toEqual(after);
 const blob=await exportWord(after,'Lift cells'),buffer=await new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});const imported=await importWord(buffer);expect(imported.warnings).toEqual([]);editor.commands.setContent(imported.content);expect(cell(0,0).firstChild!.type.name).toBe('heading');expect(cell(0,0).child(2).attrs.bulletText).toBe('★');expect(cell(1,0).child(1).attrs).toMatchObject({start:8,type:'I'});expect(cell(0,1).firstChild!.attrs.start).toBe(20);
});
