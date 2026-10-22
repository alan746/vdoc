import {afterEach,beforeEach,expect,it} from 'vitest';
import {Editor} from '@tiptap/core';
import {NodeSelection} from '@tiptap/pm/state';
import {CellSelection,TableMap} from '@tiptap/pm/tables';
import {createExtensions} from '../lib/editor/extensions';
import {DocumentEngine} from '../lib/usecases/engine';
import {availableIndentCommand} from '../lib/editor/list/list-editing';
let editor:Editor,engine:DocumentEngine;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(op=>op==='undo'||op==='redo'?engine.history(op).ok:engine.execute({source:'keyboard',operations:[op]}).ok),content:'<p>Plain</p><ol><li><p>First</p></li><li><p>Second</p></li></ol>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
function select(text:string){let pos=-1;editor.state.doc.descendants((n,p)=>{if(n.isText&&n.text===text)pos=p;});editor.commands.setTextSelection(pos);}
const available=(direction:'in'|'out')=>availableIndentCommand(editor,direction);
function key(key:string,shiftKey=false,ctrlKey=true){const e=new KeyboardEvent('keydown',{key,ctrlKey,shiftKey,bubbles:true,cancelable:true});editor.view.dom.dispatchEvent(e);return e.defaultPrevented;}
function cells(){let p=-1;editor.state.doc.descendants((n,pos)=>{if(n.type.name==='table'&&p<0)p=pos;});const m=TableMap.get(editor.state.doc.nodeAt(p)!);editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,p+1+m.map[0],p+1+m.map[m.map.length-1])));}
it('disables first-item increase while allowing later items and lifting',()=>{
 select('First');expect(available('in')).toBeNull();expect(available('out')).toBe('list.indent');select('Second');expect(available('in')).toBe('list.indent');expect(available('out')).toBe('list.indent');
});
it('checks actual overflow rejection in both nested and outer list lifts',()=>{
 for(const nested of [false,true]){const list='<ol start="2147483647"><li><p>A</p></li><li><p>B</p></li><li><p>C</p></li></ol>';editor.commands.setContent(nested?'<ol><li><p>Parent</p>'+list+'</li></ol>':list);select('B');const before=editor.getJSON();expect(available('out')).toBeNull();expect(editor.getJSON()).toEqual(before);}
});
it('checks paragraph zero, negative and maximum boundaries without rewriting attributes',()=>{
 select('Plain');expect(available('out')).toBeNull();expect(available('in')).toBe('paragraph.indent');for(const value of [-24,0,10000]){engine.execute({operations:[{type:'paragraph.style',indentStart:value}]});expect(available('in')).toBe(value===10000?null:'paragraph.indent');expect(available('out')).toBe(value<=0?null:'paragraph.indent');}
});
it('can decrease a mixed paragraph selection if at least one paragraph can change',()=>{
 editor.commands.setContent('<p>Zero</p><p data-indent-start="24">Indented</p>');editor.commands.selectAll();expect(available('out')).toBe('paragraph.indent');expect(key('[')).toBe(true);expect(editor.state.doc.content.content.map(n=>n.attrs.indentStart)).toEqual([null,0]);
});
it('does not offer indentation for code blocks or selected images',()=>{
 editor.commands.setContent('<pre><code>code</code></pre><img src="data:image/png;base64,AA==" alt="image"/>');select('code');expect(available('in')).toBeNull();expect(available('out')).toBeNull();let p=-1;editor.state.doc.descendants((n,pos)=>{if(n.type.name==='image')p=pos;});editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc,p)));expect(available('in')).toBeNull();
});
it('is read-only for content, selection, revision and history during repeated menu checks',()=>{
 select('Second');const before=editor.getJSON(),selection=editor.state.selection.toJSON(),revision=engine.revision,undo=engine.canUndo;for(let i=0;i<20;i++){available('in');available('out');}expect(editor.getJSON()).toEqual(before);expect(editor.state.selection.toJSON()).toEqual(selection);expect(engine.revision).toBe(revision);expect(engine.canUndo).toBe(undo);expect(engine.records).toHaveLength(0);
});
it('handles composition and non-editable documents without offering an edit',()=>{
 select('Second');editor.setEditable(false);expect(available('in')).toBeNull();expect(available('out')).toBeNull();editor.setEditable(true);Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>true});expect(available('in')).toBeNull();expect(available('out')).toBeNull();
});
it('moves paragraph indentation with brackets and undoes each keystroke separately',()=>{
 select('Plain');const before=editor.getJSON();expect(key(']')).toBe(true);expect(editor.state.doc.firstChild!.attrs.indentStart).toBe(24);expect(key(']')).toBe(true);expect(editor.state.doc.firstChild!.attrs.indentStart).toBe(48);expect(key('[')).toBe(true);expect(editor.state.doc.firstChild!.attrs.indentStart).toBe(24);engine.history('undo');expect(editor.state.doc.firstChild!.attrs.indentStart).toBe(48);engine.history('undo');expect(editor.state.doc.firstChild!.attrs.indentStart).toBe(24);engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('uses list structure for brackets, not paragraph margins, with exact undo/redo',()=>{
 select('Second');const before=editor.getJSON();expect(key(']')).toBe(true);expect(editor.state.doc.child(1).firstChild!.lastChild!.type.name).toBe('orderedList');expect(editor.state.selection.$from.parent.attrs.indentStart).toBeNull();const after=editor.getJSON();engine.history('undo');expect(editor.getJSON()).toEqual(before);engine.history('redo');expect(editor.getJSON()).toEqual(after);expect(key('[')).toBe(true);expect(editor.getJSON()).toEqual(before);
});
it('consumes unavailable bracket shortcuts without writing or recording a failed operation',()=>{
 select('First');const before=editor.getJSON(),revision=engine.revision;expect(key(']')).toBe(true);expect(editor.getJSON()).toEqual(before);expect(engine.revision).toBe(revision);expect(engine.records).toHaveLength(0);select('Plain');expect(key('[')).toBe(true);expect(engine.records).toHaveLength(0);
});
it('supports whole-cell decrease and plain-cell indentation without changing the table',()=>{
 editor.commands.setContent('<table><tr><td><ol><li><p>中文</p></li></ol></td><td><p>العربية</p></td></tr></table>');cells();const grid=engine.snapshot().tables;expect(available('in')).toBeNull();expect(available('out')).toBe('list.indent');expect(key('[')).toBe(true);expect(engine.snapshot().tables).toEqual(grid);expect(available('in')).toBe('paragraph.indent');expect(available('out')).toBeNull();expect(key(']')).toBe(true);expect(engine.snapshot().tables).toEqual(grid);expect(available('out')).toBe('paragraph.indent');
});
it('keeps Tab cell navigation distinct from local list bracket indentation',()=>{
 editor.commands.setContent('<table><tr><td><ol><li><p>A</p></li><li><p>B</p></li></ol></td><td><p>Keep</p></td></tr></table>');select('B');expect(key(']')).toBe(true);expect(editor.state.selection.$from.parent.textContent).toBe('B');const after=editor.getJSON();expect(key('Tab',false,false)).toBe(true);expect(editor.state.selection.$from.parent.textContent).toBe('Keep');expect(editor.getJSON()).toEqual(after);
});
it('refuses mixed list/body text selections without accidental paragraph edits',()=>{
 select('Plain');const from=editor.state.selection.from;select('Second');editor.commands.setTextSelection({from,to:editor.state.selection.from});expect(available('in')).toBeNull();expect(available('out')).toBeNull();const before=editor.getJSON();expect(key(']')).toBe(true);expect(editor.getJSON()).toEqual(before);
});
