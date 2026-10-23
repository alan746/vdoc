import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Editor} from '@tiptap/core';
import {CellSelection,TableMap} from '@tiptap/pm/tables';
import {createExtensions} from '../lib/editor/extensions';
import {DocumentEngine} from '../lib/usecases/engine';
import { canContinueNumbering, changeListNumbering } from '../lib/editor/list/list-numbering';
import { MAX_LIST_START } from '../lib/domain/rules/list-numbering';
import {parseDocument} from '../lib/infrastructure/persistence/storage';
import {exportWord,importWord} from '../lib/infrastructure/word/word';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
let editor:Editor,engine:DocumentEngine;
const ol=(text:string,start=4,linked=false)=>`<ol start="${start}" type="I" data-number-prefix="(" data-number-suffix=")" data-continue-numbering="${linked}"><li><h3><strong>${text}</strong></h3><ul data-bullet-text="★"><li><p>Nested ${text}</p></li></ul></li></ol>`;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:`<p>Outside</p><table><tr><th>${ol('中文 A')}<p>Gap</p>${ol('Tail A',40,false)}</th><th>${ol('Keep',20)}</th></tr><tr><td>${ol('العربية B',8)}<p>Gap B</p>${ol('Tail B',60,false)}</td><td><p>Plain</p></td></tr></table>`});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
function table(){let result:{pos:number;node:typeof editor.state.doc}|undefined;editor.state.doc.descendants((node,pos)=>{if(node.type.name==='table'&&!result)result={pos,node};});return result!;}
function select(row=0,col=0,endRow=1,endCol=0){const t=table(),map=TableMap.get(t.node);editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,t.pos+1+map.map[row*map.width+col],t.pos+1+map.map[endRow*map.width+endCol])));}
function cell(row:number,col:number){const t=table(),map=TableMap.get(t.node);return t.node.nodeAt(map.map[row*map.width+col])!;}
const run=()=>engine.execute({operations:[{type:'list.continue'}]});
const json=()=>editor.getJSON();
function cursor(text:string){let pos=-1;editor.state.doc.descendants((n,p)=>{if(n.isText&&n.text===text)pos=p;});editor.commands.setTextSelection(pos);}
it('connects a reverse column within each cell while preserving contents, IDs, first starts and unselected cells',()=>{
 select(1,0,0,0);const before=json(),grid=engine.snapshot().tables,heads=[cell(0,0).firstChild!.toJSON(),cell(1,0).firstChild!.toJSON()],contents=[cell(0,0).child(2).content.toJSON(),cell(1,0).child(2).content.toJSON()],other=[cell(0,1).toJSON(),cell(1,1).toJSON()];expect(canContinueNumbering(editor.state.doc,editor.state.selection)).toBe(true);expect(run().ok).toBe(true);expect(cell(0,0).child(2).attrs).toMatchObject({start:5,continuePrevious:true});expect(cell(1,0).child(2).attrs).toMatchObject({start:9,continuePrevious:true});expect([cell(0,0).firstChild!.toJSON(),cell(1,0).firstChild!.toJSON()]).toEqual(heads);expect([cell(0,0).child(2).content.toJSON(),cell(1,0).child(2).content.toJSON()]).toEqual(contents);expect([cell(0,1).toJSON(),cell(1,1).toJSON()]).toEqual(other);expect(engine.snapshot().tables).toEqual(grid);expect((editor.state.selection as CellSelection).$anchorCell.pos).toBeGreaterThan((editor.state.selection as CellSelection).$headCell.pos);const after=json();engine.history('undo');expect(json()).toEqual(before);engine.history('redo');expect(json()).toEqual(after);
});
it('propagates the first series style and counts through multiple separated lists immediately in the transaction',()=>{
 editor.commands.setContent(`<table><tr><td>${ol('Head',4)}<p>Gap</p><ol start="30" type="a"><li><p>A</p></li><li><p>B</p></li></ol><p>Gap</p><ol start="80"><li><p>Tail</p></li></ol></td></tr></table>`);select(0,0,0,0);const tr=editor.state.tr;expect(changeListNumbering(tr,'continue')).toBe(true);const lists:unknown[]=[];tr.doc.descendants(n=>{if(n.type.name==='orderedList')lists.push([n.attrs.start,n.attrs.continuePrevious,n.attrs.type,n.attrs.numberPrefix,n.attrs.numberSuffix]);});expect(lists).toEqual([[4,false,'I','(',')'],[5,true,'I','(',')'],[7,true,'I','(',')']]);expect(editor.state.doc.eq(tr.doc)).toBe(false);
});
it('allows single-list and empty selected cells without joining them across cells',()=>{
 select(0,0,1,1);expect(run().ok).toBe(true);expect(cell(0,1).firstChild!.attrs).toMatchObject({start:20,continuePrevious:false});expect(cell(1,1).firstChild!.type.name).toBe('paragraph');editor.commands.setContent(`<table><tr><td>${ol('A',4)}</td><td>${ol('B',20)}</td></tr></table>`);select(0,0,0,1);const before=json();expect(canContinueNumbering(editor.state.doc,editor.state.selection)).toBe(false);expect(run().ok).toBe(false);expect(json()).toEqual(before);
});
it('handles merged cells without repeating targets or changing grid geometry',()=>{
 editor.commands.setContent(`<table><tr><th colspan="2">${ol('Wide',3)}<p>Gap</p>${ol('Tail',50)}</th><th rowspan="2">${ol('Tall',20)}<p>Gap</p>${ol('Tail tall',80)}</th></tr><tr><td><p>Plain</p></td><td>${ol('Alone')}</td></tr></table>`);select(0,0,1,2);const grid=engine.snapshot().tables;expect(run().ok).toBe(true);expect(cell(0,0).child(2).attrs.start).toBe(4);expect(cell(0,2).child(2).attrs.start).toBe(21);expect(engine.snapshot().tables).toEqual(grid);
});
it('skips bullets, checklists and nested tables without altering their nested numbering',()=>{
 editor.commands.setContent(`<table><tr><td>${ol('Head')}<ul><li><p>Bullet</p>${ol('Nested',30)}</li></ul><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Task</p></li></ul><table><tr><td>${ol('Nested table',70)}</td></tr></table>${ol('Tail',90)}</td></tr></table>`);select(0,0,0,0);const objects=cell(0,0).content.content.slice(1,4).map(n=>n.toJSON());expect(run().ok).toBe(true);expect(cell(0,0).lastChild!.attrs.start).toBe(5);expect(cell(0,0).content.content.slice(1,4).map(n=>n.toJSON())).toEqual(objects);
});
it('keeps newly connected sections dynamic when earlier items change',()=>{
 select();run();cursor('中文 A');editor.commands.setTextSelection(editor.state.selection.from+'中文 A'.length);expect(editor.commands.splitListItem('listItem')).toBe(true);expect(cell(0,0).child(2).attrs.start).toBe(6);expect(cell(1,0).child(2).attrs.start).toBe(9);
});
it('rejects overflow in any selected cell before any transaction writes',()=>{
 editor.commands.setContent(`<table><tr><td>${ol('Valid head',1)}<p>Gap</p>${ol('Valid tail',20)}</td><td>${ol('Overflow head',MAX_LIST_START)}<p>Gap</p>${ol('Overflow tail',30)}</td></tr></table>`);select(0,1,0,0);const before=json(),tr=editor.state.tr;expect(canContinueNumbering(tr.doc,tr.selection)).toBe(false);expect(changeListNumbering(tr,'continue')).toBe(false);expect(tr.steps).toHaveLength(0);expect(engine.execute({operations:[{type:'text.style',style:{italic:true}},{type:'list.continue'}]}).ok).toBe(false);expect(json()).toEqual(before);
});
it.each([0,MAX_LIST_START-1])('supports a first start of %s and a valid continued boundary',start=>{
 editor.commands.setContent(`<table><tr><td>${ol('Head',start)}<p>Gap</p>${ol('Tail',70)}</td></tr></table>`);select(0,0,0,0);expect(run().ok).toBe(true);expect(cell(0,0).child(2).attrs.start).toBe(start+1);
});
it('does not add revision/history for an already connected selection',()=>{
 select();run();const revision=engine.revision,before=json();expect(run().ok).toBe(true);expect(engine.revision).toBe(revision);expect(json()).toEqual(before);engine.history('undo');expect(cell(0,0).child(2).attrs).toMatchObject({start:40,continuePrevious:false});
});
it('can restart, connect and style in a single atomic batch and rolls back a later failure',()=>{
 select();const before=json();expect(engine.execute({operations:[{type:'list.restart',start:10},{type:'list.continue'},{type:'list.marker',prefix:'[',suffix:']'}]}).ok).toBe(true);expect(cell(0,0).child(2).attrs).toMatchObject({start:11,continuePrevious:true,numberPrefix:'[',numberSuffix:']'});engine.history('undo');expect(json()).toEqual(before);expect(engine.execute({operations:[{type:'list.continue'},{type:'list.indent',direction:'in'}]}).ok).toBe(false);expect(json()).toEqual(before);
});
it('honors external targets, stale versions and composition protection',()=>{
 const snap=engine.snapshot(),request={source:'api',expectedSessionId:snap.sessionId,expectedRevision:snap.revision,target:{kind:'cells',tableId:snap.tables[0].id,row:0,col:0,endRow:1,endCol:0},operations:[{type:'list.continue'}]};expect(engine.execute(request).ok).toBe(true);const after=json();expect(engine.execute(request).code).toBe('STALE');Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>true});expect(run().ok).toBe(false);expect(json()).toEqual(after);
});
it('preserves distinct per-cell numbering chains in HTML, local backup and actual Word bytes',async()=>{
 select();run();const after=json(),other=new Editor({extensions:createExtensions(),content:editor.getHTML()});expect(other.getJSON()).toEqual(after);other.destroy();expect(parseDocument(JSON.stringify({version:1,title:'Continuation',content:after})).content).toEqual(after);const blob=await exportWord(after,'Continuation'),buffer=await new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});const imported=await importWord(buffer);expect(imported.warnings).toEqual([]);editor.commands.setContent(imported.content);expect(cell(0,0).firstChild!.attrs.start).toBe(4);expect(cell(0,0).child(2).attrs).toMatchObject({start:5,continuePrevious:true,type:'I'});expect(cell(1,0).firstChild!.attrs.start).toBe(8);expect(cell(1,0).child(2).attrs).toMatchObject({start:9,continuePrevious:true});expect(cell(0,1).firstChild!.attrs.start).toBe(20);
});
