import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Editor} from '@tiptap/core';
import {CellSelection,TableMap} from '@tiptap/pm/tables';
import {createExtensions} from '../lib/editor/extensions';
import {DocumentEngine} from '../lib/usecases/engine';
import { canRestartNumbering, cellRestartOverflows, changeListNumbering } from '../lib/editor/list/list-numbering';
import { MAX_LIST_START } from '../lib/domain/rules/list-numbering';
import {parseDocument} from '../lib/infrastructure/persistence/storage';
import {exportWord,importWord} from '../lib/infrastructure/word/word';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
let editor:Editor,engine:DocumentEngine;
const ol=(text:string,start=4,linked=false)=>`<ol start="${start}" type="I" data-number-prefix="(" data-number-suffix=")" data-continue-numbering="${linked}"><li><h3><strong>${text}</strong></h3><ul data-bullet-text="★"><li><p>Nested ${text}</p></li></ul></li></ol>`;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:`<p>Outside</p><table><tr><th>${ol('中文 A')}<p>Gap</p>${ol('Tail A',5,true)}</th><th>${ol('Keep',20)}</th></tr><tr><td>${ol('العربية B',8)}</td><td><p>Plain</p></td></tr></table>`});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
function table(){let result:{pos:number;node:typeof editor.state.doc}|undefined;editor.state.doc.descendants((node,pos)=>{if(node.type.name==='table'&&!result)result={pos,node};});return result!;}
function select(row=0,col=0,endRow=1,endCol=0){const t=table(),map=TableMap.get(t.node);editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,t.pos+1+map.map[row*map.width+col],t.pos+1+map.map[endRow*map.width+endCol])));}
function cell(row:number,col:number){const t=table(),map=TableMap.get(t.node);return t.node.nodeAt(map.map[row*map.width+col])!;}
const run=(start:number)=>engine.execute({operations:[{type:'list.restart',start}]});
const json=()=>editor.getJSON();
function cursor(text:string){let pos=-1;editor.state.doc.descendants((n,p)=>{if(n.isText&&n.text===text)pos=p;});editor.commands.setTextSelection(pos);}
it.each([0,1,10])('restarts a reverse column at %s with continued sections, stable structure and exact undo/redo',start=>{
 select(1,0,0,0);const before=json(),grid=engine.snapshot().tables,unselected=[cell(0,1).toJSON(),cell(1,1).toJSON()],children=cell(0,0).firstChild!.content.toJSON();expect(canRestartNumbering(editor.state.doc,editor.state.selection)).toBe(true);expect(run(start).ok).toBe(true);expect(cell(0,0).firstChild!.attrs).toMatchObject({start,continuePrevious:false,type:'I',numberPrefix:'(',numberSuffix:')'});expect(cell(0,0).child(2).attrs).toMatchObject({start:start+1,continuePrevious:true});expect(cell(1,0).firstChild!.attrs.start).toBe(start);expect(cell(0,0).firstChild!.content.toJSON()).toEqual(children);expect(engine.snapshot().tables).toEqual(grid);expect([cell(0,1).toJSON(),cell(1,1).toJSON()]).toEqual(unselected);expect((editor.state.selection as CellSelection).$anchorCell.pos).toBeGreaterThan((editor.state.selection as CellSelection).$headCell.pos);const after=json();engine.history('undo');expect(json()).toEqual(before);engine.history('redo');expect(json()).toEqual(after);
});
it('restarts independent groups in a cell while preserving each group continuation',()=>{
 editor.commands.setContent(`<table><tr><td>${ol('First',4)}<p>Gap</p>${ol('First tail',5,true)}${ol('Separate',30)}<p>Gap</p>${ol('Separate tail',31,true)}</td></tr></table>`);select(0,0,0,0);expect(run(0).ok).toBe(true);expect(cell(0,0).content.content.filter(n=>n.type.name==='orderedList').map(n=>[n.attrs.start,n.attrs.continuePrevious])).toEqual([[0,false],[1,true],[0,false],[1,true]]);
});
it('continued sections keep tracking later item insertion in only their own cell',()=>{
 select();run(10);cursor('中文 A');editor.commands.setTextSelection(editor.state.selection.from+'中文 A'.length);expect(editor.commands.splitListItem('listItem')).toBe(true);expect(cell(0,0).child(2).attrs.start).toBe(12);expect(cell(1,0).firstChild!.attrs.start).toBe(10);
});
it('handles merged headers once without changing rowspan, colspan or IDs',()=>{
 editor.commands.setContent(`<table><tr><th colspan="2">${ol('Wide')}</th><th rowspan="2">${ol('Tall')}</th></tr><tr><td>${ol('One')}</td><td>${ol('Two')}</td></tr></table>`);select(0,0,1,2);const grid=engine.snapshot().tables;expect(run(9).ok).toBe(true);expect(engine.snapshot().tables).toEqual(grid);for(const [r,c] of [[0,0],[0,2],[1,0],[1,1]])expect(cell(r,c).firstChild!.attrs.start).toBe(9);
});
it('skips bullets, tasks, paragraphs and nested lists or tables',()=>{
 editor.commands.setContent(`<table><tr><td><ul><li><p>Bullet</p>${ol('Nested')}</li></ul><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Task</p></li></ul><table><tr><td>${ol('Nested table')}</td></tr></table></td><td>${ol('Direct')}<p>Plain</p></td></tr></table>`);select(0,0,0,1);const untouched=cell(0,0).toJSON();expect(run(9).ok).toBe(true);expect(cell(0,0).toJSON()).toEqual(untouched);expect(cell(0,1).firstChild!.attrs.start).toBe(9);select(0,0,0,0);expect(canRestartNumbering(editor.state.doc,editor.state.selection)).toBe(false);expect(run(1).ok).toBe(false);
});
it('normalizes an orphan continuation as a new independent series',()=>{
 editor.commands.setContent(`<table><tr><td>${ol('Orphan',7,true)}</td><td>${ol('Other',20)}</td></tr></table>`);select(0,0,0,1);expect(run(3).ok).toBe(true);expect(cell(0,0).firstChild!.attrs).toMatchObject({start:3,continuePrevious:false});expect(cell(0,1).firstChild!.attrs.start).toBe(3);
});
it('rejects an overflowing continued start before any native transaction writes',()=>{
 select();const tr=editor.state.tr;expect(cellRestartOverflows(tr.selection,MAX_LIST_START)).toBe(true);expect(changeListNumbering(tr,'restart',MAX_LIST_START)).toBe(false);expect(tr.steps).toHaveLength(0);expect(tr.doc.eq(editor.state.doc)).toBe(true);const before=json(),revision=engine.revision;expect(engine.execute({operations:[{type:'text.style',style:{bold:true}},{type:'list.restart',start:MAX_LIST_START}]}).ok).toBe(false);expect(json()).toEqual(before);expect(engine.revision).toBe(revision);
});
it('accepts the exact boundary when the last continued start reaches the maximum',()=>{
 select();expect(cellRestartOverflows(editor.state.selection,MAX_LIST_START-1)).toBe(false);expect(run(MAX_LIST_START-1).ok).toBe(true);expect(cell(0,0).child(2).attrs.start).toBe(MAX_LIST_START);
});
it('does not treat separate cell counters as a continuation when the start is at maximum',()=>{
 editor.commands.setContent(`<table><tr><td>${ol('A')}</td><td>${ol('B')}</td></tr></table>`);select(0,0,0,1);expect(run(MAX_LIST_START).ok).toBe(true);expect(cell(0,0).firstChild!.attrs.start).toBe(MAX_LIST_START);expect(cell(0,1).firstChild!.attrs.start).toBe(MAX_LIST_START);
});
it('supports prior conversion and later style operations in one undo',()=>{
 editor.commands.setContent('<table><tr><td><p>A</p><p>B</p></td><td><p>C</p></td></tr></table>');select(0,0,0,1);const before=json();expect(engine.execute({operations:[{type:'list.toggle',kind:'ordered'},{type:'list.restart',start:0},{type:'list.style',style:'upper-alpha'}]}).ok).toBe(true);expect(cell(0,0).firstChild!.attrs).toMatchObject({start:0,type:'A'});expect(cell(0,1).firstChild!.attrs).toMatchObject({start:0,type:'A'});engine.history('undo');expect(json()).toEqual(before);
});
it('does not change revision for an identical restart and rolls back later failures',()=>{
 select();run(10);const before=json(),revision=engine.revision;expect(run(10).ok).toBe(true);expect(engine.revision).toBe(revision);expect(engine.execute({operations:[{type:'list.restart',start:0},{type:'list.indent',direction:'in'}]}).ok).toBe(false);expect(json()).toEqual(before);expect(engine.revision).toBe(revision);
});
it('allows existing cell continuations while plain cell cursors cannot reach an outer numbered list',()=>{
 select();expect(engine.execute({operations:[{type:'list.continue'}]}).ok).toBe(true);editor.commands.setContent(`<ol><li><p>Outer</p><table><tr><td><p>Cell</p></td></tr></table></li></ol>`);cursor('Cell');const before=json();expect(canRestartNumbering(editor.state.doc,editor.state.selection)).toBe(false);expect(run(9).ok).toBe(false);expect(engine.execute({operations:[{type:'list.continue'}]}).ok).toBe(false);expect(json()).toEqual(before);
});
it('honors external cell targets, stale versions and composing input',()=>{
 const snap=engine.snapshot(),request={source:'api',expectedSessionId:snap.sessionId,expectedRevision:snap.revision,target:{kind:'cells',tableId:snap.tables[0].id,row:0,col:0,endRow:1,endCol:0},operations:[{type:'list.restart',start:6}]};expect(engine.execute(request).ok).toBe(true);const after=json();expect(engine.execute(request).code).toBe('STALE');Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>true});expect(run(2).ok).toBe(false);expect(json()).toEqual(after);
});
it('preserves zero, continuation and per-cell independence through HTML, backup and Word bytes',async()=>{
 select();run(0);const after=json(),other=new Editor({extensions:createExtensions(),content:editor.getHTML()});expect(other.getJSON()).toEqual(after);other.destroy();expect(parseDocument(JSON.stringify({version:1,title:'Numbering',content:after})).content).toEqual(after);const blob=await exportWord(after,'Numbering'),buffer=await new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});const imported=await importWord(buffer);expect(imported.warnings).toEqual([]);editor.commands.setContent(imported.content);expect(cell(0,0).firstChild!.attrs).toMatchObject({start:0,type:'I'});expect(cell(0,0).child(2).attrs).toMatchObject({start:1,continuePrevious:true});expect(cell(1,0).firstChild!.attrs).toMatchObject({start:0,continuePrevious:false});expect(cell(0,1).firstChild!.attrs.start).toBe(20);
});
