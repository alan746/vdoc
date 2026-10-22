import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Editor} from '@tiptap/core';
import {createExtensions} from '../lib/editor/extensions';
import {DocumentEngine} from '../lib/editor/engine';
import {parseDocument} from '../lib/editor/storage';
import {exportWord,importWord} from '../lib/editor/word';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
let editor:Editor,engine:DocumentEngine;
const item=(text:string)=>`<li><p>${text}</p></li>`;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:'<ol start="4" type="I">'+item('First')+'<li><p>中文</p><ol start="30" type="a">'+item('Child')+'</ol></li>'+item('Last')+'</ol>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
function select(text:string){let pos=-1;editor.state.doc.descendants((n,p)=>{if(n.isText&&n.text===text)pos=p;});editor.commands.setTextSelection(pos);}
const run=()=>engine.execute({operations:[{type:'list.indent',direction:'out'}]}).ok;
it('keeps a split tail independent of the lifted item’s differently styled child numbering',()=>{
 select('中文');expect(run()).toBe(true);expect(editor.state.doc.content.content.filter(n=>n.type.name==='orderedList').at(-1)!.attrs).toMatchObject({start:5,type:'I',continuePrevious:false});expect(editor.state.doc.child(2).attrs).toMatchObject({start:30,type:'a'});
});
it('does not connect an orphan child continuation to the surrounding parent list',()=>{
 editor.commands.setContent('<ol start="4" type="I">'+item('First')+'<li><p>中文</p><ol start="30" type="a" data-continue-numbering="true">'+item('Child')+'</ol></li>'+item('Last')+'</ol>');select('中文');expect(run()).toBe(true);expect(editor.state.doc.child(2).attrs).toMatchObject({start:30,type:'a',continuePrevious:false});
});
it('preserves each promoted item’s independent child chain across a backward multi-item selection',()=>{
 editor.commands.setContent('<ol start="4" type="I">'+item('First')+'<li><h3><strong>中文</strong></h3><ol start="30" type="a">'+item('A1')+'</ol><p>Gap</p><ol data-continue-numbering="true">'+item('A2')+'</ol></li><li><p>日本語</p><ol start="10" type="a" data-continue-numbering="true">'+item('B1')+'</ol></li>'+item('Last')+'</ol>');select('中文');const from=editor.state.selection.from;select('日本語');editor.commands.setTextSelection({from:editor.state.selection.from+2,to:from});const before=editor.getJSON();expect(run()).toBe(true);expect(editor.state.doc.content.content.filter(n=>n.type.name==='orderedList').map(n=>[n.attrs.start,n.attrs.type,n.attrs.continuePrevious])).toEqual([[4,'I',false],[30,'a',false],[31,'a',true],[10,'a',false],[5,'I',false]]);expect(editor.state.selection.anchor).toBeGreaterThan(editor.state.selection.head);const after=editor.getJSON();engine.history('undo');expect(editor.getJSON()).toEqual(before);engine.history('redo');expect(editor.getJSON()).toEqual(after);
});
it.each(['First','Last'])('keeps following continuation numbering when removing the %s item with a child list',text=>{
 editor.commands.setContent('<ol start="4" type="I">'+(text==='First'?'<li><p>First</p><ol start="30" type="a">'+item('Child')+'</ol></li>'+item('Last'):item('First')+'<li><p>Last</p><ol start="30" type="a">'+item('Child')+'</ol></li>')+'</ol><p>Gap</p><ol data-continue-numbering="true">'+item('Follow')+'</ol><p>Gap</p><ol data-continue-numbering="true">'+item('Follow 2')+'</ol>');select(text);expect(run()).toBe(true);const lists=editor.state.doc.content.content.filter(n=>n.type.name==='orderedList');expect(lists.at(-2)!.attrs).toMatchObject({start:5,type:'I',continuePrevious:text==='First'});expect(lists.at(-1)!.attrs).toMatchObject({start:6,type:'I',continuePrevious:true});
});
it('keeps the following series start when the entire original numbered list is removed',()=>{
 editor.commands.setContent('<ol start="4" type="I"><li><p>Only</p><ol start="30" type="a">'+item('Child')+'</ol></li></ol><p>Gap</p><ol data-continue-numbering="true">'+item('Follow')+'</ol>');select('Only');expect(run()).toBe(true);expect(editor.state.doc.content.content.filter(n=>n.type.name==='orderedList').map(n=>[n.attrs.start,n.attrs.type,n.attrs.continuePrevious])).toEqual([[30,'a',false],[4,'I',false]]);
});
it('does not let a child of an unlisted bullet take over the surrounding numbered continuation',()=>{
 editor.commands.setContent('<ol start="8" type="I">'+item('Before')+'</ol><ul><li><p>Bullet</p><ol start="30" type="a">'+item('Child')+'</ol></li></ul><ol data-continue-numbering="true">'+item('After')+'</ol>');select('Bullet');expect(run()).toBe(true);expect(editor.state.doc.content.content.filter(n=>n.type.name==='orderedList').map(n=>[n.attrs.start,n.attrs.type,n.attrs.continuePrevious])).toEqual([[8,'I',false],[30,'a',false],[9,'I',false]]);
});
it('preserves the cell, neighboring content and paragraph IDs',()=>{
 editor.commands.setContent('<table><tr><td>'+editor.getHTML()+'</td><td><p>Keep</p></td></tr></table>');select('中文');const grid=engine.snapshot().tables,ids=engine.snapshot().blocks.map(b=>b.id);expect(run()).toBe(true);expect(engine.snapshot().tables).toEqual(grid);expect(engine.snapshot().blocks.map(b=>b.id)).toEqual(ids);const lists=editor.state.doc.firstChild!.firstChild!.firstChild!.content.content.filter(n=>n.type.name==='orderedList');expect(lists.map(n=>[n.attrs.start,n.attrs.type])).toEqual([[4,'I'],[30,'a'],[5,'I']]);
});
it('plans native can without changes and rolls back failed batches and composition',()=>{
 select('中文');const before=editor.getJSON();expect(editor.can().liftListItem('listItem')).toBe(true);expect(editor.getJSON()).toEqual(before);expect(engine.execute({operations:[{type:'list.indent',direction:'out'},{type:'list.style',style:'square'}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>true});expect(run()).toBe(false);expect(editor.getJSON()).toEqual(before);
});
it('handles earlier text mutations and one undo for the complete batch',()=>{
 select('中文');const before=editor.getJSON();expect(engine.execute({operations:[{type:'text.insert',text:'前缀'},{type:'list.indent',direction:'out'}]}).ok).toBe(true);expect(editor.state.selection.$from.parent.textContent).toBe('前缀中文');engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('resolves later continuation starts inside the transaction before dispatch',()=>{
 editor.commands.setContent('<ol start="4" type="I">'+item('First')+'<li><p>中文</p><ol start="30" type="a">'+item('Child')+'</ol></li></ol><ol data-continue-numbering="true">'+item('Follow')+'</ol><ol data-continue-numbering="true">'+item('Follow 2')+'</ol>');select('中文');expect(editor.chain().liftListItem('listItem').command(({tr})=>{expect(tr.doc.content.content.filter(n=>n.type.name==='orderedList').map(n=>n.attrs.start)).toEqual([4,30,5,6]);return true;}).run()).toBe(true);
});
it('keeps promoted task state, separate modes and custom bullet markers',()=>{
 editor.commands.setContent('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Task</p><ul data-type="taskList" data-strike-completed="false"><li data-type="taskItem" data-checked="true"><p>Child task</p></li></ul><ul data-bullet-text="★">'+item('Bullet child')+'</ul></li><li data-type="taskItem" data-checked="false"><p>Keep</p></li></ul>');select('Task');const original=editor.state.doc.firstChild!.firstChild!,expected=[original.child(1).toJSON(),original.child(2).toJSON()],before=editor.getJSON();expect(run()).toBe(true);expect([editor.state.doc.child(1).toJSON(),editor.state.doc.child(2).toJSON()]).toEqual(expected);engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('retains independent numbering through HTML, backup and actual Word bytes',async()=>{
 select('中文');run();const after=editor.getJSON(),other=new Editor({extensions:createExtensions(),content:editor.getHTML()});expect(other.getJSON()).toEqual(after);other.destroy();expect(parseDocument(JSON.stringify({version:1,title:'Root lift',content:after})).content).toEqual(after);const blob=await exportWord(after,'Root lift'),buffer=await new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});const imported=await importWord(buffer);expect(imported.warnings).toEqual([]);editor.commands.setContent(imported.content);expect(editor.state.doc.content.content.filter(n=>n.type.name==='orderedList').map(n=>[n.attrs.start,n.attrs.type,n.attrs.continuePrevious])).toEqual([[4,'I',false],[30,'a',false],[5,'I',false]]);
});
