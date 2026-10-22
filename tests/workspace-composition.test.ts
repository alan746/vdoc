import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import VdocWorkspace from '../components/editor/workspace';

let editor: Editor, root: Root, mount: HTMLDivElement;
const navigationCalls=vi.hoisted(()=>({save:vi.fn(),activate:vi.fn(),error:vi.fn()}));
const content={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Original 中文'}]}]};
vi.mock('@tiptap/react',()=>({useEditor:()=>editor,EditorContent:()=>null}));
vi.mock('../components/editor/use-document-autosave',()=>({useDocumentAutosave:()=>()=>{}}));
vi.mock('../lib/editor/browser-tools',()=>({registerDocumentTools:()=>()=>{}}));
vi.mock('../lib/editor/document-store',()=>({readSavedDocument:async()=>({data:{id:'ime-qa',title:'输入测试',savedAt:1,content}}),saveDocument:navigationCalls.save,activateDocument:navigationCalls.activate}));
vi.mock('../components/editor/library-home',()=>({LibraryHome:()=>createElement('div',{'data-testid':'library-home'},'Documents')}));
vi.mock('sonner',()=>({Toaster:()=>null,toast:{error:navigationCalls.error}}));
vi.mock('../components/editor/print-preview',()=>({PrintPreview:()=>createElement('div',{'data-testid':'print-preview'},'Print preview')}));
beforeEach(async()=>{
 navigationCalls.save.mockReset().mockResolvedValue({});navigationCalls.activate.mockReset().mockImplementation(async value=>value);navigationCalls.error.mockReset();
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
 vi.stubGlobal('matchMedia',()=>({matches:false,addEventListener(){},removeEventListener(){}}));
 window.history.replaceState(null,'','/#document=ime-qa');
 const editorMount=document.createElement('div');document.body.appendChild(editorMount);
 editor=new Editor({element:editorMount,extensions:createExtensions(),content});
 await new Promise(resolve=>setTimeout(resolve,0));
 mount=document.createElement('div');document.body.appendChild(mount);root=createRoot(mount);
 await act(async()=>root.render(createElement(VdocWorkspace)));
});
afterEach(()=>{
 act(()=>root.unmount());editor.destroy();document.body.innerHTML='';
 vi.unstubAllGlobals();vi.restoreAllMocks();window.history.replaceState(null,'','/');
});
function key(target:EventTarget,init:KeyboardEventInit){
 const event=new KeyboardEvent('keydown',{...init,bubbles:true,cancelable:true});
 act(()=>target.dispatchEvent(event));return event;
}
const title=()=>mount.querySelector<HTMLInputElement>('[aria-label="Document title"]')!;
function composition(target: EventTarget, type: 'compositionstart' | 'compositionend') {
 act(()=>target.dispatchEvent(new CompositionEvent(type,{bubbles:true})));
}
async function titleText(value:string){
 await act(async()=>{
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(title(),value);
  title().dispatchEvent(new Event('input',{bubbles:true}));
 });
}
it('connects title composition to the real external operation and undo entry points', async () => {
 const api=window.vdoc!, before=editor.getJSON(), snapshot=api.snapshot();
 const input={id:'title-composition-command',expectedSessionId:snapshot.sessionId,expectedRevision:snapshot.revision,target:{kind:'block',id:snapshot.blocks[0].id},operations:[{type:'text.insert',text:'External edit'}]};
 act(()=>title().focus());composition(title(),'compositionstart');
 await act(async()=>{expect(api.execute(input).code).toBe('COMPOSING');});
 expect(editor.getJSON()).toEqual(before);expect(document.activeElement).toBe(title());
 composition(title(),'compositionend');
 await act(async()=>{expect(api.execute(input).ok).toBe(true);});
 expect(editor.getText()).toBe('External edit');
 composition(title(),'compositionstart');
 await act(async()=>{expect(api.undo().code).toBe('COMPOSING');});
 expect(editor.getText()).toBe('External edit');expect(document.activeElement).toBe(title());
 composition(title(),'compositionend');
 await act(async()=>{expect(api.undo().ok).toBe(true);});
 expect(editor.getJSON()).toEqual(before);
});
it('keeps an active title composition when a pending home save finishes and saves the final title on retry',async()=>{
 let finish!:()=>void;navigationCalls.save.mockImplementationOnce(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const before=editor.getJSON();
 await act(async()=>mount.querySelector<HTMLButtonElement>('[aria-label="Back to documents"]')!.click());
 act(()=>title().focus());composition(title(),'compositionstart');
 await act(async()=>finish());
 expect(mount.querySelector('[data-testid="library-home"]')).toBeNull();
 expect(document.activeElement).toBe(title());expect(editor.getJSON()).toEqual(before);
 expect(navigationCalls.error).toHaveBeenCalledWith(expect.stringContaining('Finish composing'));
 await titleText('最终标题 中文');composition(title(),'compositionend');
 await act(async()=>mount.querySelector<HTMLButtonElement>('[aria-label="Back to documents"]')!.click());
 expect(navigationCalls.save).toHaveBeenLastCalledWith('最终标题 中文',before,'ime-qa');
 expect(mount.querySelector('[data-testid="library-home"]')).not.toBeNull();
});
it('keeps the draft if a file finishes reading during title composition and permits import after it ends',async()=>{
 const raw=JSON.stringify({version:1,title:'Imported title',content});
 let finish!:(value:ArrayBuffer)=>void;
 const file=mount.querySelector<HTMLInputElement>('[aria-label="Import document file"]')!;
 Object.defineProperty(file,'files',{configurable:true,value:[{name:'sample.vdoc.json',size:raw.length,arrayBuffer:()=>new Promise<ArrayBuffer>(resolve=>{finish=resolve;})}]});
 await act(async()=>file.dispatchEvent(new Event('change',{bubbles:true})));
 act(()=>title().focus());composition(title(),'compositionstart');
 const before=editor.getJSON();
 await act(async()=>finish(new TextEncoder().encode(raw).buffer));
 expect(navigationCalls.save).not.toHaveBeenCalled();expect(navigationCalls.activate).not.toHaveBeenCalled();
 expect(title().value).toBe('输入测试');expect(title().disabled).toBe(false);expect(editor.getJSON()).toEqual(before);
 expect(navigationCalls.error).toHaveBeenCalledWith(expect.stringContaining('Finish composing'));
 composition(title(),'compositionend');
 Object.defineProperty(file,'files',{configurable:true,value:[{name:'sample.vdoc.json',size:raw.length,arrayBuffer:async()=>new TextEncoder().encode(raw).buffer}]});
 await act(async()=>file.dispatchEvent(new Event('change',{bubbles:true})));
 expect(navigationCalls.save).toHaveBeenCalledWith('输入测试',before,'ime-qa');
 expect(navigationCalls.activate).toHaveBeenCalledOnce();expect(title().value).toBe('Imported title');
});
it('keeps flagless Enter in an active title composition, then resumes after compositionend',()=>{
 act(()=>title().focus());const before=editor.getJSON();
 composition(title(),'compositionstart');
 expect(key(title(),{key:'Enter'}).defaultPrevented).toBe(false);
 expect(document.activeElement).toBe(title());expect(editor.getJSON()).toEqual(before);
 composition(title(),'compositionend');
 expect(key(title(),{key:'Enter'}).defaultPrevented).toBe(true);
});
it.each(['p','f','h'])('ignores flagless shortcut %s while an input composition is active, then resumes',letter=>{
 act(()=>title().focus());composition(title(),'compositionstart');
 expect(key(title(),{key:letter,metaKey:true}).defaultPrevented).toBe(false);
 expect(mount.querySelector('[aria-label="Find and replace"]')).toBeNull();
 expect(mount.querySelector('[data-testid="print-preview"]')).toBeNull();
 composition(title(),'compositionend');
 expect(key(title(),{key:letter,metaKey:true}).defaultPrevented).toBe(true);
 expect(mount.querySelector(letter==='p'?'[data-testid="print-preview"]':'[aria-label="Find and replace"]')).not.toBeNull();
});
it('clears interrupted title composition on blur',()=>{
 act(()=>title().focus());composition(title(),'compositionstart');
 act(()=>{title().blur();title().focus();});
 expect(key(title(),{key:'Enter'}).defaultPrevented).toBe(true);
});
it('protects global shortcuts in the replacement field without locking later searches',()=>{
 key(title(),{key:'f',metaKey:true});
 const replacement=mount.querySelector<HTMLInputElement>('[aria-label="Replace with"]')!;
 act(()=>replacement.focus());composition(replacement,'compositionstart');
 expect(key(replacement,{key:'p',metaKey:true}).defaultPrevented).toBe(false);
 expect(mount.querySelector('[data-testid="print-preview"]')).toBeNull();
 composition(replacement,'compositionend');
 expect(key(replacement,{key:'p',metaKey:true}).defaultPrevented).toBe(true);
 expect(mount.querySelector('[data-testid="print-preview"]')).not.toBeNull();
});
it.each([{isComposing:true},{keyCode:229}])('keeps candidate-confirming Enter in the title field: %j',flags=>{
 act(()=>title().focus());const focus=vi.spyOn(editor.view,'focus'),before=editor.getJSON();
 const event=key(title(),{key:'Enter',...flags});
 expect(event.defaultPrevented).toBe(false);expect(document.activeElement).toBe(title());
 expect(focus).not.toHaveBeenCalled();expect(editor.getJSON()).toEqual(before);expect(title().value).toBe('输入测试');
});
it('still returns to the document on ordinary title Enter',async()=>{
 act(()=>title().focus());const focus=vi.spyOn(editor.view,'focus');
 expect(key(title(),{key:'Enter'}).defaultPrevented).toBe(true);
 await act(async()=>new Promise(resolve=>requestAnimationFrame(()=>resolve(undefined))));
 expect(focus).toHaveBeenCalled();expect(document.activeElement).toBe(editor.view.dom);
});
it.each(['p','f','h'])('does not open panels for IME shortcut %s from a title or body',letter=>{
 const before=editor.getJSON();act(()=>title().focus());
 for(const flags of [{isComposing:true},{keyCode:229}]){
  expect(key(title(),{key:letter,metaKey:true,...flags}).defaultPrevented).toBe(false);
 }
 Object.defineProperty(editor.view,'composing',{configurable:true,value:true});
 expect(key(editor.view.dom,{key:letter,ctrlKey:true}).defaultPrevented).toBe(false);
 expect(mount.querySelector('[aria-label="Find and replace"]')).toBeNull();
 expect(mount.querySelector('[data-testid="print-preview"]')).toBeNull();
 expect(editor.getJSON()).toEqual(before);expect(document.activeElement).toBe(title());
});
it.each(['p','f','h'])('restores ordinary shortcut %s after composition ends',letter=>{
 Object.defineProperty(editor.view,'composing',{configurable:true,value:false});
 expect(key(window,{key:letter,ctrlKey:true}).defaultPrevented).toBe(true);
 expect(mount.querySelector(letter==='p'?'[data-testid="print-preview"]':'[aria-label="Find and replace"]')).not.toBeNull();
});
it('respects a shortcut already handled by a nested control',()=>{
 const event=new KeyboardEvent('keydown',{key:'p',metaKey:true,bubbles:true,cancelable:true});event.preventDefault();
 act(()=>window.dispatchEvent(event));expect(mount.querySelector('[data-testid="print-preview"]')).toBeNull();
});
