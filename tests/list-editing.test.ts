import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { parseDocument } from '../lib/editor/storage';
import { exportWord, importWord } from '../lib/editor/word';
import { previewSource } from '../lib/editor/paged-preview';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
import { DocumentEngine } from '../lib/editor/engine';

let editor: Editor, engine: DocumentEngine;
const item = (text: string) => `<li><p>${text}</p></li>`;
const numbered = (items: string[]) => `<ol start="4" type="I" data-number-prefix="(" data-number-suffix=")">${items.map(item).join('')}</ol>`;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(op => op === 'undo' || op === 'redo' ? engine.history(op).ok : engine.execute({operations:[op]}).ok), content: numbered(['A','中文','العربية','हिन्दी']) });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); });
function pos(text: string) { let value = -1; editor.state.doc.descendants((n,p) => { if (n.isText && n.text === text) value = p; }); if (value < 0) throw new Error(text); return value; }
const select = (text: string) => editor.commands.setTextSelection(pos(text));
const run = (direction: 'in'|'out') => engine.execute({operations:[{type:'list.indent',direction}]}).ok;
const key = (key: string, shiftKey = false) => { const event = new KeyboardEvent('keydown',{key,shiftKey,bubbles:true,cancelable:true}); editor.view.dom.dispatchEvent(event); return event.defaultPrevented; };
it('inherits custom markers for a new nested numbered list, resets its counter, and undoes atomically', () => {
  select('中文'); const before = editor.getJSON(), ids = engine.snapshot().blocks.map(b=>b.id);
  expect(run('in')).toBe(true);
  const nested = editor.state.doc.firstChild!.firstChild!.lastChild!;
  expect(nested.attrs).toMatchObject({type:'I',start:1,continuePrevious:false,numberPrefix:'(',numberSuffix:')'});
  expect(nested.attrs.blockId).not.toBe(editor.state.doc.firstChild!.attrs.blockId);
  expect(engine.snapshot().blocks.map(b=>b.id)).toEqual(ids);
  const after=editor.getJSON(); engine.history('undo'); expect(editor.getJSON()).toEqual(before); engine.history('redo'); expect(editor.getJSON()).toEqual(after);
});
it('keeps an existing destination list style and counter', () => {
  editor.commands.setContent('<ol type="I"><li><p>A</p><ol start="8" type="a" data-number-prefix="[" data-number-suffix="]">'+item('Existing')+'</ol></li>'+item('中文')+'</ol>');
  select('中文'); expect(run('in')).toBe(true);
  expect(editor.state.doc.firstChild!.firstChild!.lastChild!.attrs).toMatchObject({type:'a',start:8,numberPrefix:'[',numberSuffix:']'});
});
it.each(['★','👩🏽‍💻'])('preserves custom bullet %s through native Tab and Shift+Tab', bullet => {
  editor.commands.setContent(`<ul data-bullet-text="${bullet}" style="list-style-type:square">${item('A')}${item('中文')}</ul>`);
  select('中文'); const before=editor.getJSON(); expect(key('Tab')).toBe(true);
  expect(editor.state.doc.firstChild!.firstChild!.lastChild!.attrs).toMatchObject({bulletStyle:'square',bulletText:bullet});
  expect(key('Tab',true)).toBe(true); expect(editor.getJSON()).toEqual(before);
});
it('indents the nearest regular list inside a task item, preserving outer checkbox and siblings', () => {
  editor.commands.setContent('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Task</p>'+numbered(['A','中文'])+'</li><li data-type="taskItem" data-checked="false"><p>Sibling</p></li></ul>');
  select('中文'); const before=editor.getJSON(); expect(run('in')).toBe(true);
  const outer=editor.state.doc.firstChild!; expect(outer.childCount).toBe(2); expect(outer.firstChild!.attrs.checked).toBe(true);
  expect(outer.firstChild!.lastChild!.childCount).toBe(1);
  expect(run('out')).toBe(true); expect(editor.getJSON()).toEqual(before);
});
it('rejects a command aimed at an outer item type instead of silently moving the outer list', () => {
  editor.commands.setContent('<ul data-type="taskList"><li data-type="taskItem"><p>First task</p></li><li data-type="taskItem"><p>Second task</p>'+numbered(['A','中文'])+'</li></ul>');
  select('中文'); const before=editor.getJSON(); expect(editor.commands.sinkListItem('taskItem')).toBe(false); expect(editor.getJSON()).toEqual(before);
});
it('unlisting a middle item keeps the remaining ordered tail continuous', () => {
  select('中文'); const before=editor.getJSON(); expect(run('out')).toBe(true);
  expect(editor.state.doc.child(2).attrs).toMatchObject({start:5,continuePrevious:true,type:'I',numberPrefix:'(',numberSuffix:')'});
  select('A'); expect(engine.execute({operations:[{type:'list.restart',start:10}]}).ok).toBe(true);
  expect(editor.state.doc.child(2).attrs.start).toBe(11);
  engine.history('undo'); engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});
it('native keymaps choose the nested task list inside a regular list', () => {
  editor.commands.setContent('<ol><li><p>Outer</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Task A</p></li><li data-type="taskItem" data-checked="false"><p>Task B</p></li></ul></li>'+item('End')+'</ol>');
  select('Task B'); const before=editor.getJSON(); expect(key('Tab')).toBe(true);
  const tasks=editor.state.doc.firstChild!.firstChild!.lastChild!; expect(tasks.childCount).toBe(1); expect(tasks.firstChild!.attrs.checked).toBe(true);
  expect(tasks.firstChild!.lastChild!.firstChild!.attrs.checked).toBe(false);
  expect(key('Tab',true)).toBe(true); expect(editor.getJSON()).toEqual(before);
});
it('moves a multi-item selection together without losing text or marks', () => {
  editor.commands.setTextSelection({from:pos('中文'),to:pos('العربية')+'العربية'.length});
  editor.commands.setBold(); const before=editor.getJSON(); expect(run('in')).toBe(true);
  const nested=editor.state.doc.firstChild!.firstChild!.lastChild!; expect(nested.childCount).toBe(2); expect(nested.textContent).toBe('中文العربية');
  expect(editor.state.selection.from).toBeLessThan(editor.state.selection.to);
  engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});
it('preserves original start when removing the first item and does not add a tail after the last', () => {
  select('A'); expect(run('out')).toBe(true); expect(editor.state.doc.child(1).attrs).toMatchObject({start:4,continuePrevious:false});
  select('हिन्दी'); expect(run('out')).toBe(true); expect(editor.state.doc.child(2).type.name).toBe('paragraph'); expect(editor.state.doc.child(2).textContent).toBe('हिन्दी'); expect(editor.state.doc.child(1).childCount).toBe(2);
});
it('rejects selections across unrelated lists and rolls back preceding batch writes', () => {
  editor.commands.setContent(numbered(['A','中文'])+'<p>Gap</p>'+numbered(['B','العربية']));
  editor.commands.setTextSelection({from:pos('中文'),to:pos('العربية')}); const before=editor.getJSON(); expect(run('in')).toBe(false); expect(editor.getJSON()).toEqual(before);
  select('A'); expect(engine.execute({operations:[{type:'text.insert',text:'Transient'}, {type:'list.indent',direction:'in'}]}).ok).toBe(false); expect(editor.getJSON()).toEqual(before);
});
it('can() does not mutate content and an active composition blocks list movement', () => {
  select('中文'); const before=editor.getJSON(); expect(editor.can().sinkListItem('listItem')).toBe(true); expect(editor.getJSON()).toEqual(before);
  Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>true}); expect(editor.commands.sinkListItem('listItem')).toBe(false); expect(editor.commands.liftListItem('listItem')).toBe(false); expect(editor.getJSON()).toEqual(before);
});
it('does not capture a table cell inside an outer list; table Tab still navigates cells', () => {
  editor.commands.setContent('<ol><li><p>Outer</p><table><tr><td><p>Cell A</p></td><td><p>Cell B</p></td></tr></table></li>'+item('End')+'</ol>');
  select('Cell A'); const before=editor.getJSON(); expect(run('in')).toBe(false); expect(run('out')).toBe(false);
  expect(key('Tab')).toBe(true); expect(editor.state.selection.$from.parent.textContent).toBe('Cell B'); expect(editor.getJSON()).toEqual(before);
});
it('in a table cell, toolbar indentation targets only the local list while Tab keeps cell navigation', () => {
  editor.commands.setContent('<table><tr><td>'+numbered(['A','中文'])+'</td><td><p>Other cell</p></td></tr></table>');
  select('中文'); const before=editor.getJSON(); expect(run('in')).toBe(true); expect(key('Tab')).toBe(true); expect(editor.state.selection.$from.parent.textContent).toBe('Other cell');
  engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});
it('handles an indentation after a text mutation in the same atomic transaction', () => {
  select('中文'); const before=editor.getJSON(); expect(engine.execute({operations:[{type:'text.insert',text:'前缀'}, {type:'list.indent',direction:'in'}]}).ok).toBe(true);
  expect(editor.state.doc.firstChild!.firstChild!.lastChild!.textContent).toBe('前缀中文'); engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});

it('preserves the resulting nested markers and continued tail through backup, HTML, preview and Word', async () => {
  select('中文'); run('out'); select('हिन्दी'); run('in'); const before=editor.getJSON();
  expect(parseDocument(JSON.stringify({version:1,title:'Nested',content:before})).content).toEqual(before);
  const other=new Editor({extensions:createExtensions(),content:editor.getHTML()}); expect(other.getJSON()).toEqual(before); other.destroy();
  const preview=new DOMParser().parseFromString(previewSource('Nested',editor.getHTML(),before).html,'text/html');
  expect([...preview.querySelectorAll('ol')].map(el=>[el.start,el.type,el.dataset.numberPrefix,el.dataset.numberSuffix])).toEqual([[4,'I','(',')'],[5,'I','(',')'],[1,'I','(',')']]);
  const blob=await exportWord(before,'Nested'); const buffer=await new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);});
  const result=await importWord(buffer); expect(result.warnings).toEqual([]); editor.commands.setContent(result.content);
  const lists: unknown[]=[]; editor.state.doc.descendants(n=>{if(n.type.name==='orderedList')lists.push([n.attrs.start,n.attrs.type,n.attrs.numberPrefix,n.attrs.numberSuffix,n.attrs.continuePrevious]);});
  expect(lists).toEqual([[4,'I','(',')',false],[5,'I','(',')',true],[1,'I','(',')',false]]);
  expect(editor.state.doc.textContent).toBe('A中文العربيةहिन्दी');
});
it('each rapid Tab and Shift+Tab has a separate undo step', () => {
  select('中文'); const before=editor.getJSON(); expect(key('Tab')).toBe(true); const nested=editor.getJSON();
  expect(key('Tab',true)).toBe(true); expect(editor.getJSON()).toEqual(before);
  engine.history('undo'); expect(editor.getJSON()).toEqual(nested); engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});
it('refuses a split whose new counter would exceed the supported range without corrupting saved data', () => {
  editor.commands.setContent('<ol start="2147483647">'+['A','中文','End'].map(item).join('')+'</ol>');
  select('中文'); const before=editor.getJSON(); expect(run('out')).toBe(false); expect(editor.getJSON()).toEqual(before);
});
