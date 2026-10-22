import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Editor} from '@tiptap/core';
import {CellSelection,TableMap} from '@tiptap/pm/tables';
import {createExtensions} from '../lib/editor/extensions';
import {DocumentEngine} from '../lib/usecases/engine';
import {listStyleTargets} from '../lib/editor/list/list-style';
import {checklistTargets} from '../lib/editor/list/checklist';
import {parseDocument} from '../lib/infrastructure/persistence/storage';
import {exportWord,importWord} from '../lib/infrastructure/word/word';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
let editor:Editor,engine:DocumentEngine;
const ol=(text:string,start=1,type='1',prefix='',suffix='.')=>`<ol start="${start}" type="${type}" data-number-prefix="${prefix}" data-number-suffix="${suffix}"><li><p>${text}</p><ul data-bullet-text="★"><li><p>Nested ${text}</p></li></ul></li></ol>`;
const ul=(text:string,bullet='★')=>`<ul data-bullet-text="${bullet}"><li><p>${text}</p><ol type="I"><li><p>Nested ${text}</p></li></ol></li></ul>`;
const task=(text:string,strike=true)=>`<ul data-type="taskList" data-strike-completed="${strike}"><li data-type="taskItem" data-checked="true"><p><strong>${text}</strong></p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Nested ${text}</p></li></ul></li></ul>`;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:`<p>Outside</p><table><tr><td>${ol('中文 A',4,'I','(',')')}</td><td>${ol('Keep',20)}</td></tr><tr><td>${ol('العربية B',8,'a','[',']')}</td><td><p>Keep plain</p></td></tr></table>`});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
function table(){let result:{pos:number;node:typeof editor.state.doc}|undefined;editor.state.doc.descendants((node,pos)=>{if(node.type.name==='table'&&!result)result={pos,node};});return result!;}
function select(row=0,col=0,endRow=1,endCol=0){const t=table(),map=TableMap.get(t.node);editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,t.pos+1+map.map[row*map.width+col],t.pos+1+map.map[endRow*map.width+endCol])));}
function cell(row:number,col:number){const t=table(),map=TableMap.get(t.node);return t.node.nodeAt(map.map[row*map.width+col])!;}
const run=(operations:unknown[])=>engine.execute({operations});
const json=()=>editor.getJSON();
function textCursor(text:string){let pos=-1;editor.state.doc.descendants((n,p)=>{if(n.isText&&n.text===text)pos=p;});editor.commands.setTextSelection(pos);}
it.each(['upper-roman','lower-alpha','decimal'] as const)('styles a reverse column as %s without changing starts, nested lists or unselected cells',style=>{
 select(1,0,0,0);const before=json(),grid=engine.snapshot().tables,others=[cell(0,1).toJSON(),cell(1,1).toJSON()],children=[cell(0,0).firstChild!.content.toJSON(),cell(1,0).firstChild!.content.toJSON()];expect(run([{type:'list.style',style}]).ok).toBe(true);expect([cell(0,0).firstChild!.attrs.start,cell(1,0).firstChild!.attrs.start]).toEqual([4,8]);expect([cell(0,0),cell(1,0)].map(c=>c.firstChild!.attrs.type)).toEqual(Array(2).fill(style==='upper-roman'?'I':style==='lower-alpha'?'a':null));expect([cell(0,0).firstChild!.content.toJSON(),cell(1,0).firstChild!.content.toJSON()]).toEqual(children);expect([cell(0,1).toJSON(),cell(1,1).toJSON()]).toEqual(others);expect(engine.snapshot().tables).toEqual(grid);const sel=editor.state.selection as CellSelection;expect(sel.$anchorCell.pos).toBeGreaterThan(sel.$headCell.pos);const after=json();engine.history('undo');expect(json()).toEqual(before);engine.history('redo');expect(json()).toEqual(after);
});
it('changes only the requested affix, keeping mixed types and other affixes',()=>{
 select();expect(run([{type:'list.marker',prefix:'§'}]).ok).toBe(true);expect(cell(0,0).firstChild!.attrs).toMatchObject({numberPrefix:'§',numberSuffix:')',type:'I',start:4});expect(cell(1,0).firstChild!.attrs).toMatchObject({numberPrefix:'§',numberSuffix:']',type:'a',start:8});
});
it('styles each selected cell continuation group without joining numbering across cells',()=>{
 editor.commands.setContent(`<table><tr><td>${ol('A',4)}<p>Gap</p><ol start="5" data-continue-numbering="true"><li><p>Tail</p></li></ol></td><td>${ol('B',30)}</td></tr></table>`);select(0,0,0,1);expect(run([{type:'list.style',style:'upper-roman'},{type:'list.marker',prefix:'(',suffix:')'}]).ok).toBe(true);expect(cell(0,0).child(2).attrs).toMatchObject({start:5,type:'I',continuePrevious:true,numberPrefix:'('});expect(cell(0,1).firstChild!.attrs).toMatchObject({start:30,type:'I',continuePrevious:false});
});
it('updates custom bullets then resets to a preset without touching nested numbering',()=>{
 editor.commands.setContent(`<table><tr><td>${ul('中文')}</td><td>${ul('日本語','✓')}</td></tr></table>`);select(0,0,0,1);const nested=cell(0,0).firstChild!.firstChild!.lastChild!.toJSON();expect(run([{type:'list.marker',bullet:'👩🏽‍💻'}]).ok).toBe(true);expect([cell(0,0),cell(0,1)].map(c=>c.firstChild!.attrs.bulletText)).toEqual(['👩🏽‍💻','👩🏽‍💻']);expect(run([{type:'list.style',style:'square'}]).ok).toBe(true);for(const c of [cell(0,0),cell(0,1)])expect(c.firstChild!.attrs).toMatchObject({bulletText:null,bulletStyle:'square'});expect(cell(0,0).firstChild!.firstChild!.lastChild!.toJSON()).toEqual(nested);
});
it('handles merged headers once while keeping span and stable IDs',()=>{
 editor.commands.setContent(`<table><tr><th colspan="2">${ul('Wide')}</th><th rowspan="2">${ul('Tall')}</th></tr><tr><td>${ul('One')}</td><td>${ul('Two')}</td></tr></table>`);select(0,0,1,2);const grid=engine.snapshot().tables;expect(listStyleTargets(editor.state.doc,editor.state.selection)).toHaveLength(4);expect(run([{type:'list.marker',bullet:'✓'}]).ok).toBe(true);expect(engine.snapshot().tables).toEqual(grid);expect(listStyleTargets(editor.state.doc,editor.state.selection).map(c=>c.node.attrs.bulletText)).toEqual(['✓','✓','✓','✓']);
});
it('changes all direct selected checklists but keeps checked state, nested settings and other cells',()=>{
 editor.commands.setContent(`<table><tr><td>${task('中文',true)}</td><td>${task('Keep',true)}</td></tr><tr><td>${task('हिन्दी',false)}<p>Plain</p></td><td>${ul('Other')}</td></tr></table>`);select();const before=json(),contents=[cell(0,0).firstChild!.content.toJSON(),cell(1,0).firstChild!.content.toJSON()];expect(checklistTargets(editor.state.doc,editor.state.selection)).toHaveLength(2);expect(run([{type:'list.checklistStyle',strikeCompleted:false}]).ok).toBe(true);expect([cell(0,0),cell(1,0)].map(c=>c.firstChild!.attrs.strikeCompleted)).toEqual([false,false]);expect(cell(0,1).firstChild!.attrs.strikeCompleted).toBe(true);expect([cell(0,0).firstChild!.content.toJSON(),cell(1,0).firstChild!.content.toJSON()]).toEqual(contents);engine.history('undo');expect(json()).toEqual(before);
});
it('skips plain cells and checklists for ordinary style, and ordinary lists for checklist style',()=>{
 editor.commands.setContent(`<table><tr><td>${ul('Bullet')}</td><td>${task('Task')}</td><td><p>Plain</p></td></tr></table>`);select(0,0,0,2);expect(run([{type:'list.style',style:'circle'},{type:'list.checklistStyle',strikeCompleted:false}]).ok).toBe(true);expect(cell(0,0).firstChild!.attrs.bulletStyle).toBe('circle');expect(cell(0,1).firstChild!.attrs.strikeCompleted).toBe(false);expect(cell(0,2).firstChild!.type.name).toBe('paragraph');
});
it('rejects mixed ordered/bullet marker edits atomically instead of converting a list family',()=>{
 editor.commands.setContent(`<table><tr><td>${ul('Bullet')}</td><td>${ol('Number')}</td></tr></table>`);select(0,0,0,1);const before=json(),revision=engine.revision;expect(listStyleTargets(editor.state.doc,editor.state.selection)).toEqual([]);expect(run([{type:'text.style',style:{bold:true}},{type:'list.style',style:'square'}]).ok).toBe(false);expect(run([{type:'list.marker',bullet:'★'}]).ok).toBe(false);expect(json()).toEqual(before);expect(engine.revision).toBe(revision);
});
it('does not change a surrounding list when the cursor is in a plain cell inside it',()=>{
 editor.commands.setContent(`<ol><li><p>Outer</p><table><tr><td><p>Cell</p></td></tr></table></li></ol>`);textCursor('Cell');const before=json();expect(listStyleTargets(editor.state.doc,editor.state.selection)).toEqual([]);expect(run([{type:'list.style',style:'upper-roman'}]).ok).toBe(false);expect(run([{type:'list.marker',prefix:'('}]).ok).toBe(false);expect(json()).toEqual(before);
});
it('allows bulk conversion and all style changes in one atomic transaction and one undo',()=>{
 select();const before=json();expect(run([{type:'list.toggle',kind:'bullet'},{type:'list.style',style:'circle'},{type:'list.marker',bullet:'✓'}]).ok).toBe(true);for(const c of [cell(0,0),cell(1,0)])expect(c.firstChild!.attrs).toMatchObject({bulletText:'✓',bulletStyle:'circle'});engine.history('undo');expect(json()).toEqual(before);
});
it('keeps no-op bulk writes out of revision/history and rolls back a failed later operation',()=>{
 select();run([{type:'list.style',style:'upper-roman'}]);const before=json(),revision=engine.revision;expect(run([{type:'list.style',style:'upper-roman'}]).ok).toBe(true);expect(engine.revision).toBe(revision);expect(run([{type:'list.marker',prefix:'['},{type:'list.continue'}]).ok).toBe(false);expect(json()).toEqual(before);expect(engine.revision).toBe(revision);
});
it('honors external cell targets, stale versions and composition protection',()=>{
 const snap=engine.snapshot(),request={source:'api',expectedSessionId:snap.sessionId,expectedRevision:snap.revision,target:{kind:'cells',tableId:snap.tables[0].id,row:0,col:0,endRow:1,endCol:0},operations:[{type:'list.style',style:'upper-roman'}]};expect(engine.execute(request).ok).toBe(true);const after=json();expect(engine.execute(request).code).toBe('STALE');Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>true});expect(run([{type:'list.marker',prefix:'('}]).ok).toBe(false);expect(json()).toEqual(after);
});
it('preserves bulk styles through HTML, backup and real Word bytes',async()=>{
 select();run([{type:'list.style',style:'upper-roman'},{type:'list.marker',prefix:'[',suffix:']'}]);const after=json(),other=new Editor({extensions:createExtensions(),content:editor.getHTML()});expect(other.getJSON()).toEqual(after);other.destroy();expect(parseDocument(JSON.stringify({version:1,title:'Bulk styles',content:after})).content).toEqual(after);
 const blob=await exportWord(after,'Bulk styles'),bytes=await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);});const imported=await importWord(bytes);expect(imported.warnings).toEqual([]);editor.commands.setContent(imported.content);expect(cell(0,0).firstChild!.attrs).toMatchObject({start:4,type:'I',numberPrefix:'[',numberSuffix:']'});expect(cell(1,0).firstChild!.attrs).toMatchObject({start:8,type:'I',numberPrefix:'[',numberSuffix:']'});expect(cell(0,1).firstChild!.attrs).toMatchObject({start:20,type:null});
});

it('preserves bulk custom bullets and checklist modes through HTML and local backup',()=>{
 editor.commands.setContent(`<table><tr><td>${ul('Emoji')}${task('中文')}</td><td>${ul('Other','✓')}${task('العربية',false)}</td></tr></table>`);select(0,0,0,1);expect(run([{type:'list.marker',bullet:'👩🏽‍💻'},{type:'list.checklistStyle',strikeCompleted:false}]).ok).toBe(true);const after=json(),other=new Editor({extensions:createExtensions(),content:editor.getHTML()});expect(other.getJSON()).toEqual(after);other.destroy();expect(parseDocument(JSON.stringify({version:1,title:'Mixed modes',content:after})).content).toEqual(after);
});
