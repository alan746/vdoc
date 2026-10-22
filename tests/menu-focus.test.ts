import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Editor} from '@tiptap/core';
import {createExtensions} from '../lib/editor/extensions';
import {restoreEditorFocusAfterMenu} from '../lib/editor/menu-focus';
let editor:Editor,trigger:HTMLButtonElement,frame:FrameRequestCallback;
beforeEach(async()=>{
 const mount=document.createElement('div');document.body.appendChild(mount);editor=new Editor({element:mount,extensions:createExtensions(),content:'<p>Keep selection 中文</p>'});
 await new Promise(r=>setTimeout(r,0));editor.commands.setTextSelection({from:6,to:15});
 trigger=document.createElement('button');document.body.appendChild(trigger);trigger.focus();trigger.blur();
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frame=callback;return 1;});
});
afterEach(()=>{editor.destroy();document.body.innerHTML='';vi.unstubAllGlobals();vi.restoreAllMocks();});
it('returns keyboard focus to the editor after a menu releases it, preserving selection and document',()=>{
 const content=editor.getJSON(),selection=editor.state.selection.toJSON();restoreEditorFocusAfterMenu(editor,trigger);frame(0);
 expect(document.activeElement).toBe(editor.view.dom);expect(editor.state.selection.toJSON()).toEqual(selection);expect(editor.getJSON()).toEqual(content);
});
it('does not take focus from a search or title input focused during menu close',()=>{
 restoreEditorFocusAfterMenu(editor,trigger);const input=document.createElement('input');document.body.appendChild(input);input.focus();frame(0);expect(document.activeElement).toBe(input);
});
it.each(['dialog','menu','popover'])('does not interfere with a newly opening %s before its autofocus',kind=>{
 const overlay=document.createElement('div');overlay.dataset.state='open';if(kind==='popover')overlay.dataset.slot='popover-content';else overlay.setAttribute('role',kind);document.body.appendChild(overlay);
 const focus=vi.spyOn(editor.view,'focus');restoreEditorFocusAfterMenu(editor,trigger);frame(0);expect(focus).not.toHaveBeenCalled();
});
it('does not move focus while composing or after a navigation destroys the editor',()=>{
 const focus=vi.spyOn(editor.view,'focus');Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>true});restoreEditorFocusAfterMenu(editor,trigger);frame(0);expect(focus).not.toHaveBeenCalled();editor.destroy();restoreEditorFocusAfterMenu(editor,trigger);expect(()=>frame(0)).not.toThrow();
});
