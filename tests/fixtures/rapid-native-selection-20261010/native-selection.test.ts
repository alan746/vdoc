import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Editor} from '@tiptap/core';
import {CellSelection} from '@tiptap/pm/tables';
import {createExtensions} from '../lib/editor/extensions';
import {syncNativeTextSelection} from '../lib/editor/native-selection';
let editor:Editor;
beforeEach(async()=>{
 const mount=document.createElement('div');document.body.appendChild(mount);
 editor=new Editor({element:mount,extensions:createExtensions(),content:'<p>First</p><p>Second 中文 العربية</p>'});
 await new Promise(r=>setTimeout(r,0));editor.view.focus();
 editor.commands.setTextSelection({from:8,to:14});
});
afterEach(()=>{editor.destroy();document.body.innerHTML='';vi.restoreAllMocks();});
function key(type:string,key:string,extra:KeyboardEventInit={}) {const e=new KeyboardEvent(type,{key,bubbles:true,cancelable:true,...extra});editor.view.dom.dispatchEvent(e);return e;}
function nativeCaret(offset=6){const node=editor.view.dom.querySelectorAll('p')[1].firstChild!;document.getSelection()!.collapse(node,offset);}
function primeNavigation(){key('keydown','ArrowRight',{keyCode:39});nativeCaret();}
it.each(['keyup','next keydown'])('keeps selected text when native navigation is followed by Enter before selectionchange (%s)',stage=>{
 const before=editor.getJSON();primeNavigation();
 if(stage==='keyup')key('keyup','ArrowRight',{keyCode:39});
 // This intentionally runs synchronously before jsdom emits selectionchange.
 key('keydown','Enter',{keyCode:13});
 expect(editor.state.doc.textContent).toBe('FirstSecond 中文 العربية');
 expect(editor.state.doc.childCount).toBe(3);
 expect(editor.commands.undo()).toBe(true);expect(editor.getJSON()).toEqual(before);
});
it('preserves backward native ranges without changing document or undo depth',()=>{
 const before=editor.getJSON();const node=editor.view.dom.querySelectorAll('p')[1].firstChild!;
 document.getSelection()!.setBaseAndExtent(node,6,node,2);syncNativeTextSelection(editor.view);
 expect(editor.state.selection.anchor).toBe(14);expect(editor.state.selection.head).toBe(10);expect(editor.getJSON()).toEqual(before);expect(editor.can().undo()).toBe(false);
});
it('does not synchronize an IME candidate navigation or commit key',()=>{
 primeNavigation();const selected=editor.state.selection.toJSON();Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>true});
 key('keyup','ArrowRight',{keyCode:229,isComposing:true});syncNativeTextSelection(editor.view);
 expect(editor.state.selection.toJSON()).toEqual(selected);
});
it('does not replace a table cell selection with its DOM text highlight',()=>{
 editor.commands.setContent('<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table>');
 const cells:number[]=[];editor.state.doc.descendants((node,pos)=>{if(node.type.name==='tableCell')cells.push(pos);});
 editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,cells[0],cells[1])));
 const before=editor.state.selection.toJSON();syncNativeTextSelection(editor.view);expect(editor.state.selection.toJSON()).toEqual(before);
});
it('does not import a DOM selection from a field outside the editor',()=>{
 const outside=document.createElement('p');outside.textContent='Another field';document.body.appendChild(outside);document.getSelection()!.collapse(outside.firstChild,3);
 const before=editor.state.selection.toJSON();syncNativeTextSelection(editor.view);expect(editor.state.selection.toJSON()).toEqual(before);
});
it('keeps a model selection when no native navigation preceded the input',()=>{
 nativeCaret();const before=editor.state.selection.toJSON();key('keyup','Shift',{keyCode:16});expect(editor.state.selection.toJSON()).toEqual(before);
});
it('retains pending native navigation when Shift is released before the arrow',()=>{
 primeNavigation();key('keyup','Shift',{keyCode:16});key('keydown','Enter',{keyCode:13});
 expect(editor.state.doc.textContent).toBe('FirstSecond 中文 العربية');
});
it('accepts a native text caret after leaving Select all, while preserving the body',()=>{
 editor.commands.selectAll();primeNavigation();key('keyup','ArrowRight',{keyCode:39});
 expect(editor.state.selection.empty).toBe(true);key('keydown','Enter',{keyCode:13});
 expect(editor.state.doc.textContent).toBe('FirstSecond 中文 العربية');
});
