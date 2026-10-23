import {afterEach,beforeEach,expect,it} from 'vitest';
import {Editor,type JSONContent} from '@tiptap/core';
import {NodeSelection} from '@tiptap/pm/state';
import {parseDocument} from '../lib/infrastructure/persistence/document-codec';
import {createExtensions} from '../lib/editor/extensions';
import {DocumentEngine} from '../lib/usecases/engine';
let editor:Editor,engine:DocumentEngine;
const item=(t:string)=>`<li><p>${t}</p></li>`;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:'<ol start="4" type="I" data-number-prefix="(" data-number-suffix=")">'+item('First')+'<li><p><strong>中文 second</strong></p><p>Extra paragraph</p><ul data-bullet-text="★">'+item('Nested')+'</ul></li>'+item('Last')+'</ol>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
function pos(text:string){let result=-1;editor.state.doc.descendants((n,p)=>{if(n.isText&&n.text===text)result=p;});if(result<0)throw new Error(text);return result;}
const select=(text:string)=>editor.commands.setTextSelection(pos(text));
const json=():JSONContent=>editor.getJSON();
const run=(kind:'ordered'|'bullet'|'task')=>engine.execute({operations:[{type:'list.toggle',kind}]}).ok;
it.each(['bullet','task'] as const)('converts only the current ordered item to %s, keeping children and remaining numbering',kind=>{
 select('中文 second');const before=json(),children=before.content![0].content![1].content,ids=engine.snapshot().blocks.map(b=>b.id);
 expect(run(kind)).toBe(true);const result=json();expect(result.content!.slice(0,3).map(n=>n.type)).toEqual(['orderedList',kind==='task'?'taskList':'bulletList','orderedList']);
 expect(result.content![1].content![0].content).toEqual(children);expect(result.content![2].attrs).toMatchObject({start:5,type:'I',continuePrevious:true,numberPrefix:'(',numberSuffix:')'});
 expect(editor.state.selection.$from.parent.textContent).toBe('中文 second');expect(engine.snapshot().blocks.map(b=>b.id)).toEqual(ids);
 const after=json();engine.history('undo');expect(json()).toEqual(before);engine.history('redo');expect(json()).toEqual(after);
});
it('converts a task item to a numbered item without flattening nested tasks or removing text marks',()=>{
 editor.commands.setContent('<ul data-type="taskList" data-strike-completed="false"><li data-type="taskItem" data-checked="true"><p><em>Task</em></p><p>Second paragraph</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Nested task</p></li></ul></li><li data-type="taskItem"><p>Keep task</p></li></ul>');select('Task');const before=json();expect(run('ordered')).toBe(true);
 const converted=json().content![0];expect(converted.type).toBe('orderedList');expect(converted.content![0].content).toEqual(before.content![0].content![0].content);expect(json().content![1].attrs!.strikeCompleted).toBe(false);
 engine.history('undo');expect(json()).toEqual(before);
});
it('does not merge a converted list into adjacent lists with different marker or checklist settings',()=>{
 editor.commands.setContent('<ul data-bullet-text="★">'+item('Before')+'</ul><ol>'+item('Convert')+'</ol><ul data-bullet-text="✓">'+item('After')+'</ul>');select('Convert');expect(run('bullet')).toBe(true);
 expect(json().content!.filter(n=>n.type==='bulletList').map(n=>n.attrs!.bulletText)).toEqual(['★',null,'✓']);
});

it.each([['bullet','ordered'],['bullet','task'],['ordered','bullet'],['ordered','task'],['task','bullet'],['task','ordered']] as const)('converts %s to %s for a backward multi-item selection', (source,target)=>{
 const tag=source==='ordered'?'ol':'ul';
 const li=(text:string)=>source==='task'?`<li data-type="taskItem" data-checked="true"><p>${text}</p></li>`:item(text);
 editor.commands.setContent(`<${tag}${source==='task'?' data-type="taskList"':''}>${['Keep','中文','العربية','हिन्दी'].map(li).join('')}</${tag}>`);
 editor.commands.setTextSelection({from:pos('हिन्दी')+'हिन्दी'.length,to:pos('中文')});const before=json();
 expect(run(target)).toBe(true);expect(editor.state.doc.firstChild!.childCount).toBe(1);expect(editor.state.doc.child(1).type.name).toBe(target==='task'?'taskList':target==='ordered'?'orderedList':'bulletList');expect(editor.state.doc.child(1).childCount).toBe(3);
 expect(editor.state.selection.anchor).toBeGreaterThan(editor.state.selection.head);expect(editor.state.doc.textContent).toBe('Keep中文العربيةहिन्दी');
 if(target==='task')expect(editor.state.doc.child(1).firstChild!.attrs.checked).toBe(false);
 expect(parseDocument(JSON.stringify({version:1,title:'Converted',content:json()})).content).toEqual(json());
 const after=json();engine.history('undo');expect(json()).toEqual(before);engine.history('redo');expect(json()).toEqual(after);
});
it('converts a whole node selection and toggles the resulting list off without touching nested lists',()=>{
 editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc,0)));const before=json();expect(run('task')).toBe(true);expect(editor.state.selection).toBeInstanceOf(NodeSelection);expect(editor.state.doc.firstChild!.childCount).toBe(3);
 expect(run('task')).toBe(true);expect(editor.state.doc.firstChild!.type.name).toBe('paragraph');expect(editor.state.doc.textContent).toBe('First中文 secondExtra paragraphNestedLast');
 engine.history('undo');engine.history('undo');expect(json()).toEqual(before);
});
it('creates an independent list from a paragraph between differently styled lists',()=>{
 editor.commands.setContent('<ul data-bullet-text="★">'+item('Before')+'</ul><p>Middle</p><ul data-bullet-text="✓">'+item('After')+'</ul>');select('Middle');const before=json();expect(run('bullet')).toBe(true);
 expect(json().content!.filter(n=>n.type==='bulletList').map(n=>n.attrs!.bulletText)).toEqual(['★',null,'✓']);engine.history('undo');expect(json()).toEqual(before);
});
it('keeps a table and every child of the converted item intact',()=>{
 editor.commands.setContent('<ul><li><p>Parent</p><table><tr><td><p>Cell 中文</p></td><td><p>Cell العربية</p></td></tr></table><p>After table</p></li>'+item('Sibling')+'</ul>');select('Parent');const children=json().content![0].content![0].content;expect(run('task')).toBe(true);expect(json().content![0].content![0].content).toEqual(children);
 select('Cell 中文');expect(run('ordered')).toBe(true);expect(editor.state.doc.firstChild!.type.name).toBe('taskList');expect(editor.state.doc.firstChild!.firstChild!.child(1).firstChild!.firstChild!.firstChild!.type.name).toBe('orderedList');
});
it('rejects mixed list selections and does not commit preceding batch writes',()=>{
 editor.commands.setContent('<ul>'+item('First')+'</ul><p>Gap</p><ol>'+item('Last')+'</ol>');editor.commands.selectAll();const before=json();expect(run('task')).toBe(false);expect(json()).toEqual(before);
 select('First');const snap=engine.snapshot();expect(engine.execute({operations:[{type:'list.toggle',kind:'task'},{type:'list.restart',start:5}]}).ok).toBe(false);expect(json()).toEqual(before);expect(engine.revision).toBe(snap.revision);
});
it('can() and composition checks do not mutate list content',()=>{
 select('中文 second');const before=json();expect(editor.can().toggleTaskList()).toBe(true);expect(json()).toEqual(before);
 Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>true});expect(editor.commands.toggleTaskList()).toBe(false);expect(json()).toEqual(before);
});
it('converts after an earlier text edit in the same transaction and keeps the caret',()=>{
 select('中文 second');const before=json();expect(engine.execute({operations:[{type:'text.insert',text:'前缀'},{type:'list.toggle',kind:'task'}]}).ok).toBe(true);expect(editor.state.selection.$from.parent.textContent).toBe('前缀中文 second');expect(editor.state.selection.$from.parentOffset).toBe(2);engine.history('undo');expect(json()).toEqual(before);
});
it('converts a single-list AllSelection without dropping children',()=>{
 // Tiptap appends a blank paragraph after the list; select-all should still convert it.
 editor.commands.selectAll();const before=editor.state.doc.textContent;expect(run('task')).toBe(true);expect(editor.state.doc.textContent).toBe(before);expect(editor.state.doc.firstChild!.type.name).toBe('taskList');
});
it('does not redirect a following continuation when an intervening list becomes a new numbered series',()=>{
 select('中文 second');run('task');const tail=json().content![2];select('中文 second');expect(run('ordered')).toBe(true);
 expect(json().content![2].attrs).toMatchObject({start:5,type:'I',numberPrefix:'(',numberSuffix:')',continuePrevious:false});expect(json().content![2].content).toEqual(tail.content);
 select('中文 second');engine.execute({operations:[{type:'list.restart',start:20}]});expect(json().content![2].attrs!.start).toBe(5);
});
it('preserves a following series when its entire source list is converted away',()=>{
 editor.commands.setContent('<ol start="20">'+item('Previous')+'</ol><p>Gap</p><ol start="4" type="I">'+item('Source')+'</ol><p>More gap</p><ol start="5" type="I" data-continue-numbering="true">'+item('Tail')+'</ol>');select('Source');const before=json();expect(run('bullet')).toBe(true);
 const lists=json().content!.filter(n=>n.type==='orderedList');expect(lists[1].attrs).toMatchObject({start:5,type:'I',continuePrevious:false});engine.history('undo');expect(json()).toEqual(before);
});

it('does not redirect continued numbering when a gap paragraph becomes a new list',()=>{
 editor.commands.setContent('<ol start="8" type="I">'+item('Before')+'</ol><p>Gap</p><ol start="9" type="I" data-continue-numbering="true">'+item('Tail')+'</ol>');select('Gap');const before=json();expect(run('ordered')).toBe(true);
 expect(json().content![2].attrs).toMatchObject({start:9,type:'I',continuePrevious:false});engine.history('undo');expect(json()).toEqual(before);
});
