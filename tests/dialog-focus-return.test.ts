import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {Dialog,DialogTrigger,DialogContent,DialogTitle,DialogDescription,DialogFocusReturnProvider} from '../components/ui/dialog';
let root:Root,mount:HTMLDivElement,origin:HTMLButtonElement,destination:HTMLTextAreaElement;
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);mount=document.createElement('div');document.body.appendChild(mount);root=createRoot(mount);
 origin=document.createElement('button');document.body.appendChild(origin);destination=document.createElement('textarea');document.body.appendChild(destination);origin.focus();
});
afterEach(()=>{act(()=>root.unmount());document.body.innerHTML='';vi.unstubAllGlobals();});
async function render(open:boolean,provided?:((event:Event)=>void),explicit?:((event:Event)=>void)){
 const dialog=createElement(Dialog,{open},createElement(DialogTrigger,null,'Open'),createElement(DialogContent,{onCloseAutoFocus:explicit},createElement(DialogTitle,null,'Focus test'),createElement(DialogDescription,null,'Temporary editor dialog')));
 await act(async()=>{root.render(provided?createElement(DialogFocusReturnProvider,{value:provided},dialog):dialog);});
 await act(async()=>{await new Promise(r=>setTimeout(r,30));});
}
it('uses the scoped return target when the opening menu item has been removed',async()=>{
 const callback=vi.fn((event:Event)=>{event.preventDefault();destination.focus();});await render(true,callback);origin.remove();await render(false,callback);expect(callback).toHaveBeenCalledOnce();expect(document.activeElement).toBe(destination);
});
it('preserves an explicit dialog close handler instead of overriding its focus',async()=>{
 const callback=vi.fn(),explicit=vi.fn((event:Event)=>{event.preventDefault();origin.focus();});await render(true,callback,explicit);await render(false,callback,explicit);expect(explicit).toHaveBeenCalledOnce();expect(callback).not.toHaveBeenCalled();expect(document.activeElement).toBe(origin);
});
it('preserves normal trigger restoration outside the editor scope',async()=>{
 await render(false);const trigger=document.querySelector('[data-slot=dialog-trigger]') as HTMLButtonElement;trigger.focus();await render(true);await render(false);expect(document.activeElement).toBe(trigger);
});
