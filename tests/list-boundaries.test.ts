import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Editor,type JSONContent} from '@tiptap/core';
import {CellSelection,TableMap} from '@tiptap/pm/tables';
import {NodeSelection} from '@tiptap/pm/state';
import {createExtensions} from '../lib/editor/extensions';
import {exportWord,importWord} from '../lib/infrastructure/word/word';
import {parseDocument} from '../lib/infrastructure/persistence/storage';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
import {DocumentEngine} from '../lib/usecases/engine';
let editor:Editor,engine:DocumentEngine;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:'<p>Before</p><table><tr><td><p>中文 A</p></td><td><p>العربية B</p></td></tr><tr><td><p>हिन्दी C</p></td><td><p>日本語 D</p></td></tr></table><p>After</p>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
const json=():JSONContent=>editor.getJSON();
function pos(text:string){let found=-1;editor.state.doc.descendants((n,p)=>{if(n.isText&&n.text===text)found=p;});if(found<0)throw new Error(text);return found;}
function table(){let position=-1;editor.state.doc.descendants((n,p)=>{if(n.type.name==='table')position=p;});return {pos:position,node:editor.state.doc.nodeAt(position)!};}
function cells(){const t=table(),map=TableMap.get(t.node);editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,t.pos+1+map.map[0],t.pos+1+map.map[3])));}
it.each(['bullet','ordered','task'] as const)('formats a rectangular cell selection as %s without wrapping the table',kind=>{
 cells();const before=json(),grid=engine.snapshot().tables;expect(engine.execute({operations:[{type:'list.toggle',kind}]}).ok).toBe(true);expect(engine.snapshot().tables).toEqual(grid);expect(table().node.firstChild!.firstChild!.firstChild!.type.name).toBe(kind==='ordered'?'orderedList':kind==='bullet'?'bulletList':'taskList');engine.history('undo');expect(json()).toEqual(before);
});
it('native can is read-only and commands format selected cells',()=>{
 cells();const before=json();expect(editor.can().toggleTaskList()).toBe(true);expect(json()).toEqual(before);expect(editor.commands.toggleTaskList()).toBe(true);expect(table().node.firstChild!.firstChild!.firstChild!.type.name).toBe('taskList');
});
it.each([['中文 A','العربية B'],['Before','中文 A'],['日本語 D','After']] as const)('rejects text selections crossing a cell boundary: %s to %s',(from,to)=>{
 editor.commands.setTextSelection({from:pos(from),to:pos(to)+to.length});const before=json();expect(engine.execute({operations:[{type:'list.toggle',kind:'bullet'}]}).ok).toBe(false);expect(json()).toEqual(before);
});
it('formats the table node selection normalized by the table plugin as separate cell lists',()=>{
 editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc,table().pos)));expect(editor.state.selection).toBeInstanceOf(CellSelection);const grid=engine.snapshot().tables;expect(editor.commands.toggleTaskList()).toBe(true);expect(engine.snapshot().tables).toEqual(grid);expect(table().node.type.name).toBe('table');expect(table().node.firstChild!.firstChild!.firstChild!.type.name).toBe('taskList');
});
it('converts a heading while preserving its heading level, ID and marks',()=>{
 editor.commands.setContent('<h2><strong>Heading 中文</strong></h2><p>Other</p>');editor.commands.setTextSelection(pos('Heading 中文'));const before=json();expect(engine.execute({operations:[{type:'list.toggle',kind:'bullet'}]}).ok).toBe(true);
 const item=json().content![0].content![0];expect(item.content!.some(n=>n.type==='heading'&&n.attrs!.level===2)).toBe(true);expect(item.content!.find(n=>n.type==='heading')).toEqual(before.content![0]);engine.history('undo');expect(json()).toEqual(before);
});

it.each(['bullet','ordered','task'] as const)('supports heading-first %s items through HTML and backup and keyboard editing',kind=>{
 editor.commands.setContent('<h2 dir="rtl"><strong>عنوان 中文</strong></h2><h4>Second heading</h4>');editor.commands.selectAll();expect(engine.execute({operations:[{type:'list.toggle',kind}]}).ok).toBe(true);const before=json();
 expect(editor.state.doc.firstChild!.firstChild!.firstChild!.type.name).toBe('heading');expect(editor.state.doc.firstChild!.child(1).firstChild!.attrs.level).toBe(4);
 const other=new Editor({extensions:createExtensions(),content:editor.getHTML()});expect(other.getJSON()).toEqual(before);other.destroy();expect(parseDocument(JSON.stringify({version:1,title:'Headings',content:before})).content).toEqual(before);
 editor.commands.setTextSelection(pos('Second heading'));expect(engine.execute({operations:[{type:'list.indent',direction:'in'}]}).ok).toBe(true);expect(editor.state.selection.$from.parent.type.name).toBe('heading');expect(engine.execute({operations:[{type:'list.indent',direction:'out'}]}).ok).toBe(true);expect(json()).toEqual(before);
 const itemCount=editor.state.doc.firstChild!.childCount;editor.commands.setTextSelection(pos('Second heading')+'Second heading'.length);expect(editor.commands.splitListItem(kind==='task'?'taskItem':'listItem')).toBe(true);expect(editor.state.doc.firstChild!.childCount).toBe(itemCount+1);expect(editor.state.doc.firstChild!.lastChild!.firstChild!.type.name).toBe('paragraph');
});
it.each(['bullet','ordered'] as const)('retains a first-item heading after real Word %s conversion',async kind=>{
 editor.commands.setContent('<h2><strong>Heading 中文</strong></h2><p>Second paragraph</p>');editor.commands.selectAll();engine.execute({operations:[{type:'list.toggle',kind}]});
 const blob=await exportWord(json(),'Headings'),buffer=await new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});
 const imported=await importWord(buffer);expect(imported.warnings).toEqual([]);editor.commands.setContent(imported.content);expect(editor.state.doc.firstChild!.type.name).toBe(kind==='bullet'?'bulletList':'orderedList');expect(editor.state.doc.firstChild!.firstChild!.firstChild!.type.name).toBe('heading');expect(editor.state.doc.firstChild!.firstChild!.firstChild!.attrs.level).toBe(2);expect(editor.state.doc.textContent).toBe('Heading 中文Second paragraph');
});
it('applies heading style inside an existing list item and reverses it in one undo',()=>{
 editor.commands.setContent('<ol><li><p>Title</p></li><li><p>Next</p></li></ol>');editor.commands.setTextSelection(pos('Title'));const before=json();expect(engine.execute({operations:[{type:'paragraph.style',level:3}]}).ok).toBe(true);expect(editor.state.doc.firstChild!.firstChild!.firstChild!.attrs.level).toBe(3);engine.history('undo');expect(json()).toEqual(before);
});
it('rolls back multi-cell formatting when a later batch operation fails',()=>{
 cells();const before=json();expect(engine.execute({operations:[{type:'text.style',style:{bold:true}},{type:'list.toggle',kind:'ordered'},{type:'list.continue'}]}).ok).toBe(false);expect(json()).toEqual(before);
});

it('explains the supported scope when a cross-cell text selection is rejected',()=>{
 editor.commands.setTextSelection({from:pos('中文 A'),to:pos('العربية B')+2});const result=engine.execute({operations:[{type:'list.toggle',kind:'task'}]});expect(result.ok).toBe(false);if(!result.ok)expect(result.error).toContain('one table cell');
});
it('keeps nested mixed list headings and continuation paragraphs through Word without extra empty items',async()=>{
 editor.commands.setContent('<ol start="4" type="I"><li><h2>Outer 中文</h2><ul data-bullet-text="★"><li><h3>Inner العربية</h3><p>Continuation 日本語</p></li><li><p>Other inner</p></li></ul></li><li><p>Outer end</p></li></ol>');
 const blob=await exportWord(json(),'Nested headings'),buffer=await new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});
 const imported=await importWord(buffer);expect(imported.warnings).toEqual([]);editor.commands.setContent(imported.content);
 const root=editor.state.doc.firstChild!;expect(root.attrs).toMatchObject({start:4,type:'I'});expect(root.childCount).toBe(2);expect(root.firstChild!.firstChild!.attrs.level).toBe(2);
 const nested=root.firstChild!.lastChild!;expect(nested.type.name).toBe('bulletList');expect(nested.attrs.bulletText).toBe('★');expect(nested.childCount).toBe(2);expect(nested.firstChild!.childCount).toBe(2);expect(nested.firstChild!.firstChild!.attrs.level).toBe(3);expect(nested.firstChild!.lastChild!.textContent).toBe('Continuation 日本語');
});
