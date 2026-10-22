import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/editor/engine';
import { ParagraphDialog } from '../components/editor/document-dialogs';
let editor: Editor, engine: DocumentEngine, root: Root, host: HTMLDivElement, close: ReturnType<typeof vi.fn>;
beforeEach(async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  editor=new Editor({extensions:createExtensions(),content:'<p style="background-color:#fff2cc">中文</p><p dir="rtl" style="background-color:#ddeeff">العربية עברית</p>'});
  await new Promise(r=>setTimeout(r,0)); engine=new DocumentEngine(editor);editor.commands.selectAll();
  host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);close=vi.fn();
  await act(async()=>root.render(createElement(ParagraphDialog,{open:true,close,editor,engine})));
});
afterEach(()=>{act(()=>root.unmount());host.remove();engine.destroy();editor.destroy();vi.unstubAllGlobals();});
const fill=()=>Array.from(document.querySelectorAll('select')).find(node=>node.closest('label')?.textContent?.startsWith('Paragraph background'))!;
async function choose(value:string){await act(async()=>{fill().value=value;fill().dispatchEvent(new Event('change',{bubbles:true}));});}
async function submit(){await act(async()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
it('keeps mixed values unchanged on Apply',async()=>{
  const before=editor.getJSON();expect(fill().value).toBe('mixed');await submit();expect(editor.getJSON()).toEqual(before);expect(close).toHaveBeenCalledOnce();
});
it('clears mixed backgrounds and restores both colors in one Undo',async()=>{
  const before=editor.getJSON();await choose('none');await submit();
  expect(editor.state.doc.child(0).attrs.paragraphBackground).toBeNull();expect(editor.state.doc.child(1).attrs.paragraphBackground).toBeNull();
  expect(editor.state.doc.child(1).attrs.direction).toBe('rtl');engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('applies custom background through the common operation and retains other attributes',async()=>{
  await choose('color');expect(document.querySelector<HTMLInputElement>('[aria-label="Paragraph background HEX"]')!.value).toBe('#FFF2CC');await submit();
  expect(editor.state.doc.child(1).attrs.paragraphBackground).toBe('#FFF2CC');expect(editor.state.doc.child(1).attrs.direction).toBe('rtl');
});
it('allows switching back to Mixed before Apply to discard a pending background change',async()=>{
  const before=editor.getJSON();await choose('color');await choose('mixed');await submit();expect(editor.getJSON()).toEqual(before);
});
