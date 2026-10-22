import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Editor} from '@tiptap/core';
import {CellSelection,TableMap} from '@tiptap/pm/tables';
import {indentCommandType} from '../lib/editor/list-editing';
import {parseDocument} from '../lib/editor/storage';
import {exportWord,importWord} from '../lib/editor/word';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
import {createExtensions} from '../lib/editor/extensions';
import {DocumentEngine} from '../lib/editor/engine';
let editor:Editor,engine:DocumentEngine;
const item=(t:string)=>`<li><p>${t}</p></li>`;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:'<ol><li><p>Parent</p><ol start="4" type="I" data-number-prefix="(" data-number-suffix=")">'+item('First')+item('中文')+item('Last')+'</ol></li>'+item('End')+'</ol>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
function select(text:string){let pos=-1;editor.state.doc.descendants((n,p)=>{if(n.isText&&n.text===text)pos=p;});editor.commands.setTextSelection(pos);}
const out=()=>engine.execute({operations:[{type:'list.indent',direction:'out'}]}).ok;
it('keeps the remaining nested numbered tail after lifting a middle item',()=>{
 select('中文');const before=editor.getJSON();expect(out()).toBe(true);const root=editor.state.doc.firstChild!;expect(root.child(1).lastChild!.attrs).toMatchObject({start:5,type:'I',continuePrevious:false,numberPrefix:'(',numberSuffix:')'});expect(root.firstChild!.lastChild!.attrs.start).toBe(4);engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('does not merge the lifted item’s own child list with differently styled remaining siblings',()=>{
 editor.commands.setContent('<ol><li><p>Parent</p><ol start="4" type="I">'+item('First')+'<li><p>中文</p><ol start="30" type="a"><li><p>Own child</p></li></ol></li>'+item('Last')+'</ol></li>'+item('End')+'</ol>');select('中文');expect(out()).toBe(true);const lifted=editor.state.doc.firstChild!.child(1);expect(lifted.content.content.filter(n=>n.type.name==='orderedList').map(n=>[n.attrs.start,n.attrs.type,n.textContent])).toEqual([[30,'a','Own child'],[5,'I','Last']]);
});

it.each([['First',4],['Last',null]] as const)('handles lifting %s without inventing or restarting a tail', (text,start)=>{
 select(text);const before=editor.getJSON();expect(out()).toBe(true);const lifted=editor.state.doc.firstChild!.child(1);if(start===null)expect(lifted.childCount).toBe(1);else expect(lifted.lastChild!.attrs).toMatchObject({start,continuePrevious:false,type:'I'});engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('keeps backward multi-item selections and gives the remaining siblings their correct counter',()=>{
 editor.commands.setContent('<ol><li><p>Parent</p><ol start="4" type="I">'+['First','A','B','Last'].map(item).join('')+'</ol></li>'+item('End')+'</ol>');select('A');const from=editor.state.selection.from;select('B');editor.commands.setTextSelection({from:editor.state.selection.from+1,to:from});const before=editor.getJSON();expect(out()).toBe(true);const root=editor.state.doc.firstChild!;expect(root.childCount).toBe(4);expect(root.child(2).lastChild!.attrs.start).toBe(5);expect(editor.state.selection.anchor).toBeGreaterThan(editor.state.selection.head);const after=editor.getJSON();engine.history('undo');expect(editor.getJSON()).toEqual(before);engine.history('redo');expect(editor.getJSON()).toEqual(after);
});
it('preserves different custom bullet markers instead of joining child lists',()=>{
 editor.commands.setContent('<ul><li><p>Parent</p><ul data-bullet-text="★">'+item('First')+'<li><h3><strong>中文</strong></h3><p>Continuation</p><ul data-bullet-text="✓">'+item('Own child')+'</ul></li>'+item('Last')+'</ul></li>'+item('End')+'</ul>');select('中文');const before=editor.getJSON();expect(out()).toBe(true);const lifted=editor.state.doc.firstChild!.child(1);expect(lifted.firstChild!.type.name).toBe('heading');expect(lifted.firstChild!.attrs.level).toBe(3);expect(lifted.firstChild!.firstChild!.marks[0].type.name).toBe('bold');expect(lifted.content.content.filter(n=>n.type.name==='bulletList').map(n=>[n.attrs.bulletText,n.textContent])).toEqual([['✓','Own child'],['★','Last']]);engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('preserves task completion and separate child checklist modes when lifting',()=>{
 const li=(t:string,extra='')=>`<li data-type="taskItem" data-checked="true"><p>${t}</p>${extra}</li>`,list=(content:string,mode=true)=>`<ul data-type="taskList" data-strike-completed="${mode}">${content}</ul>`;
 editor.commands.setContent(list(li('Parent',list(li('First')+li('中文',list(li('Own child'),false))+li('Last')))+li('End')));select('中文');const before=editor.getJSON();expect(out()).toBe(true);const lifted=editor.state.doc.firstChild!.child(1);expect(lifted.attrs.checked).toBe(true);expect(lifted.content.content.filter(n=>n.type.name==='taskList').map(n=>[n.attrs.strikeCompleted,n.firstChild!.attrs.checked,n.textContent])).toEqual([[false,true,'Own child'],[true,true,'Last']]);engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('keeps a moved numbered tail independent from the lifted item’s existing continuation chain',()=>{
 editor.commands.setContent('<ol><li><p>Parent</p><ol start="8" type="I">'+item('First')+'<li><p>中文</p><ol start="20" type="a">'+item('Own')+'</ol><p>Gap</p><ol start="21" type="a" data-continue-numbering="true">'+item('Own tail')+'</ol></li>'+item('Last')+'</ol></li></ol>');select('中文');expect(out()).toBe(true);const lists=editor.state.doc.firstChild!.child(1).content.content.filter(n=>n.type.name==='orderedList');expect(lists.map(n=>[n.attrs.start,n.attrs.type,n.attrs.continuePrevious])).toEqual([[20,'a',false],[21,'a',true],[9,'I',false]]);
});
it('rejects nested counter overflow before native commands write and can() stays read-only',()=>{
 editor.commands.setContent('<ol><li><p>Parent</p><ol start="2147483647">'+['First','中文','Last'].map(item).join('')+'</ol></li></ol>');select('中文');const before=editor.getJSON(),revision=engine.revision;expect(editor.can().liftListItem('listItem')).toBe(false);expect(editor.commands.liftListItem('listItem')).toBe(false);expect(editor.getJSON()).toEqual(before);expect(engine.revision).toBe(revision);
});
it('keeps valid can() read-only and respects composition and batch failure',()=>{
 select('中文');const before=editor.getJSON();expect(editor.can().liftListItem('listItem')).toBe(true);expect(editor.getJSON()).toEqual(before);expect(engine.execute({operations:[{type:'list.indent',direction:'out'},{type:'list.style',style:'square'}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>true});expect(out()).toBe(false);expect(editor.getJSON()).toEqual(before);
});
it('lifts after an earlier edit in one transaction with exact undo and stable paragraph IDs',()=>{
 select('中文');const before=editor.getJSON(),ids=engine.snapshot().blocks.map(b=>b.id);expect(engine.execute({operations:[{type:'text.insert',text:'前缀'},{type:'list.indent',direction:'out'}]}).ok).toBe(true);expect(editor.state.selection.$from.parent.textContent).toBe('前缀中文');expect(engine.snapshot().blocks.map(b=>b.id)).toEqual(ids);engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('supports a local nested list in a table without changing adjacent cells',()=>{
 const inner=editor.getHTML();editor.commands.setContent('<table><tr><td>'+inner+'</td><td><p>Keep</p></td></tr></table>');select('中文');const grid=engine.snapshot().tables;expect(out()).toBe(true);expect(engine.snapshot().tables).toEqual(grid);expect(editor.state.doc.firstChild!.firstChild!.firstChild!.firstChild!.child(1).lastChild!.attrs.start).toBe(5);
});
it('does not route a multi-cell or mixed list selection to paragraph indentation',()=>{
 editor.commands.setContent('<table><tr><td><ol>'+item('A')+item('B')+'</ol></td><td><p>Plain</p></td></tr></table>');const map=TableMap.get(editor.state.doc.firstChild!);editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,1+map.map[0],1+map.map[1])));expect(indentCommandType(editor.state.selection)).toBeNull();select('B');expect(indentCommandType(editor.state.selection)).toBe('list.indent');select('Plain');expect(indentCommandType(editor.state.selection)).toBe('paragraph.indent');editor.commands.selectAll();expect(indentCommandType(editor.state.selection)).toBeNull();
});
it('keeps paragraph indentation available inside plain cells of an outer list',()=>{
 editor.commands.setContent('<ol><li><p>Outer</p><table><tr><td><p>Plain A</p></td><td><p>Plain B</p></td></tr></table></li></ol>');select('Plain A');expect(indentCommandType(editor.state.selection)).toBe('paragraph.indent');
});
it('disables indentation when a selection starts inside a list and ends in plain text, in either direction',()=>{
 editor.commands.setContent('<ol>'+item('List text')+'</ol><p>Plain text</p>');select('List text');const from=editor.state.selection.from+2;select('Plain text');const to=editor.state.selection.from+3;editor.commands.setTextSelection({from,to});expect(indentCommandType(editor.state.selection)).toBeNull();editor.commands.setTextSelection({from:to,to:from});expect(indentCommandType(editor.state.selection)).toBeNull();
});
it('retains separated child styles and counter values through HTML, backup and actual Word bytes',async()=>{
 editor.commands.setContent('<ol><li><p>Parent</p><ol start="4" type="I">'+item('First')+'<li><p>中文</p><ol start="30" type="a">'+item('Own child')+'</ol></li>'+item('Last')+'</ol></li>'+item('End')+'</ol>');select('中文');out();const after=editor.getJSON(),other=new Editor({extensions:createExtensions(),content:editor.getHTML()});expect(other.getJSON()).toEqual(after);other.destroy();expect(parseDocument(JSON.stringify({version:1,title:'Lift',content:after})).content).toEqual(after);const blob=await exportWord(after,'Lift'),buffer=await new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});const imported=await importWord(buffer);expect(imported.warnings).toEqual([]);editor.commands.setContent(imported.content);const lists=editor.state.doc.firstChild!.child(1).content.content.filter(n=>n.type.name==='orderedList');expect(lists.map(n=>[n.attrs.start,n.attrs.type,n.textContent])).toEqual([[30,'a','Own child'],[5,'I','Last']]);
});
