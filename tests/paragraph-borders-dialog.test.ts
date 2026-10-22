import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/editor/engine';
import { ParagraphBordersDialog } from '../components/editor/paragraph-borders-dialog';
let editor: Editor, engine: DocumentEngine, root: Root, host: HTMLDivElement, close: ReturnType<typeof vi.fn>;
beforeEach(async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  editor=new Editor({extensions:createExtensions(),content:'<p style="background-color:#fff2cc;border-left:2px solid #112233;padding-left:8px">中文</p><p dir="rtl" style="background-color:#ddeeff;border-bottom:3px dashed #aabbcc;padding-bottom:12px">العربية עברית</p>'});
  await new Promise(r=>setTimeout(r,0)); engine=new DocumentEngine(editor);editor.commands.selectAll();
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);close=vi.fn();
  await act(async()=>root.render(createElement(ParagraphBordersDialog,{open:true,close,editor,engine})));
});
afterEach(()=>{act(()=>root.unmount());host.remove();engine.destroy();editor.destroy();vi.unstubAllGlobals();});
async function select(label:string,value:string){await act(async()=>{const node=document.querySelector(`[aria-label="${label}"]`)! as unknown as HTMLSelectElement;node.value=value;node.dispatchEvent(new Event('change',{bubbles:true}));});}
async function submit(){await act(async()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
it('opens mixed edges and applies unchanged values without rewriting the document',async()=>{
  const before=editor.getJSON();expect((document.querySelector('[aria-label="Left border"]') as unknown as HTMLSelectElement).value).toBe('mixed');await submit();expect(editor.getJSON()).toEqual(before);expect(close).toHaveBeenCalledOnce();
});
it('changes only line style across asymmetric borders and undoes once',async()=>{
  const before=editor.getJSON();await select('Border line','dotted');await submit();
  expect(editor.state.doc.child(0).attrs.paragraphBorders).toEqual({left:{width:2,color:'#112233',style:'dotted',padding:6}});
  expect(editor.state.doc.child(1).attrs.paragraphBorders).toEqual({bottom:{width:3,color:'#AABBCC',style:'dotted',padding:9}});
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('removes every border without clearing shading or RTL',async()=>{
  await act(async()=>Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Remove all borders')!.click());await submit();
  expect(editor.state.doc.child(0).attrs.paragraphBorders).toBeNull();expect(editor.state.doc.child(1).attrs.paragraphBorders).toBeNull();
  expect(editor.state.doc.child(0).attrs.paragraphBackground).toBe('#FFF2CC');expect(editor.state.doc.child(1).attrs.direction).toBe('rtl');
});
it('enables a new side on all selected paragraphs while preserving different existing edges',async()=>{
  await select('Top border','true');await submit();
  expect(Object.keys(editor.state.doc.child(0).attrs.paragraphBorders).sort()).toEqual(['left','top']);
  expect(Object.keys(editor.state.doc.child(1).attrs.paragraphBorders).sort()).toEqual(['bottom','top']);
});
