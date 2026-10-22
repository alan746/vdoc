import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { TableHandles } from '../components/editor/table-handles';
let editor: Editor, engine: DocumentEngine, root: Root, canvas: HTMLElement, wrapper: HTMLElement, table: HTMLTableElement;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
const rect=(left:number,top:number,width:number,height:number)=>({x:left,y:top,left,top,right:left+width,bottom:top+height,width,height,toJSON:()=>({})}) as DOMRect;
const emit=(el:EventTarget,type:string,x=120,y=400)=>act(()=>{el.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,button:0,buttons:type==='mousemove'?1:0,clientX:x,clientY:y}));});
function ticks(count=40) { act(()=>{for(let i=0;i<count;i++){const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(100+i*16));}}); }
beforeEach(async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); frames=new Map();nextFrame=0;
  vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{const id=++nextFrame;frames.set(id,fn);return id;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>frames.delete(id));
  canvas=document.createElement('div');canvas.className='canvas-scroll';document.body.appendChild(canvas);
  const mount=document.createElement('div');canvas.appendChild(mount);
  editor=new Editor({element:mount,extensions:createExtensions(),content:'<table data-pinned-rows="0">'+Array.from({length:20},(_,r)=>'<tr><td colwidth="200">Row '+r+'</td><td colwidth="200">日本語 '+r+'</td><td colwidth="200">العربية '+r+'</td></tr>').join('')+'</table>'});
  await new Promise(r=>setTimeout(r,0)); engine=new DocumentEngine(editor);
  table=editor.view.dom.querySelector('table')!;wrapper=table.closest('.tableWrapper')!;
  canvas.getBoundingClientRect=()=>rect(0,100,600,300);
  wrapper.getBoundingClientRect=()=>rect(100,200-canvas.scrollTop,400,1200);
  table.getBoundingClientRect=()=>rect(100-wrapper.scrollLeft,200-canvas.scrollTop,600,1200);
  for(const [key,value] of Object.entries({scrollHeight:1500,clientHeight:300}))Object.defineProperty(canvas,key,{value});
  for(const [key,value] of Object.entries({scrollWidth:600,clientWidth:400,offsetWidth:400}))Object.defineProperty(wrapper,key,{value});
  Array.from(table.rows).forEach((row,r)=>{
    row.getBoundingClientRect=()=>rect(100,200+r*60-canvas.scrollTop,600,60);
    Array.from(row.cells).forEach((cell,c)=>{cell.getBoundingClientRect=()=>rect(100+c*200-wrapper.scrollLeft,200+r*60-canvas.scrollTop,200,60);});
  });
  table.querySelectorAll('col').forEach((col,c)=>{col.getBoundingClientRect=()=>rect(100+c*200-wrapper.scrollLeft,200-canvas.scrollTop,200,1200);});
  const reactMount=document.createElement('div');document.body.appendChild(reactMount);root=createRoot(reactMount);
  await act(async()=>{root.render(createElement(TableHandles,{editor,engine}));});
});
afterEach(()=>{act(()=>root.unmount());engine.destroy();editor.destroy();document.body.innerHTML='';vi.unstubAllGlobals();});
function begin(axis:'row'|'column'='row') {
  act(()=>{table.rows[0].cells[0].dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:120,clientY:220}));});
  const grip=document.querySelector(`[aria-label="Drag ${axis} 1"]`)!; expect(grip).not.toBeNull();
  emit(grip,'mousedown',axis==='row'?55:120,axis==='row'?220:180);
  emit(document,'mousemove',axis==='row'?120:498,axis==='row'?398:180);
}
it('anchors pinned-row tools to the translated cell instead of the offscreen row box',()=>{
  canvas.scrollTop=400;
  const cell=table.rows[0].cells[0];
  table.rows[0].classList.add('vdoc-pinned-row');
  cell.getBoundingClientRect=()=>rect(100,160,200,60);
  act(()=>{cell.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:120,clientY:180}));});
  const actions=document.querySelector<HTMLElement>('[aria-label="Row 1 actions"]')!;
  expect(actions.style.top).toBe('166px');
});
it('recomputes a distant row drop during stationary autoscroll and commits once with exact Undo',()=>{
  const before=editor.getJSON(),revision=engine.revision;begin();const initial=document.querySelector('.table-drop-status')!.textContent;
  ticks();expect(canvas.scrollTop).toBeGreaterThan(300);expect(document.querySelector('.table-drop-status')!.textContent).not.toBe(initial);
  expect(editor.getJSON()).toEqual(before);expect(engine.revision).toBe(revision);
  const preview=document.querySelector('.table-drop-status')!.textContent!,position=Number(preview.match(/position (\d+)/)![1])-1;
  emit(document,'mouseup',120,398);expect(engine.records).toHaveLength(1);expect(editor.state.doc.firstChild!.child(position).firstChild!.textContent).toBe('Row 0');
  const stopped=canvas.scrollTop;ticks();expect(canvas.scrollTop).toBe(stopped);act(()=>{engine.history('undo','api');});expect(editor.getJSON()).toEqual(before);
});
it('tracks horizontal scroll and moves the first column beyond its initially visible destination',()=>{
  const before=editor.getJSON();begin('column');ticks();expect(wrapper.scrollLeft).toBe(200);expect(editor.getJSON()).toEqual(before);
  emit(document,'mouseup',498,180);expect(editor.state.doc.firstChild!.firstChild!.child(2).textContent).toBe('Row 0');act(()=>{engine.history('undo','api');});expect(editor.getJSON()).toEqual(before);
});
it.each(['Escape','blur','compositionstart','document-change','outside-scroll'])('cancels %s without a late drop or continuing scroll',reason=>{
  begin();ticks(3);
  act(()=>{
    if(reason==='Escape')document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    else if(reason==='blur')window.dispatchEvent(new Event('blur'));
    else if(reason==='document-change')editor.commands.insertContent('Changed');
    else if(reason==='outside-scroll')document.dispatchEvent(new Event('scroll'));
    else document.dispatchEvent(new Event(reason,{bubbles:true}));
  });
  const before=editor.getJSON(),scroll=canvas.scrollTop;emit(document,'mouseup',120,398);ticks();
  expect(editor.getJSON()).toEqual(before);expect(canvas.scrollTop).toBe(scroll);expect(engine.records).toHaveLength(0);expect(document.querySelector('.table-drop-status')).toBeNull();
});
it('keeps a drag active when its own scroll container emits a scroll event',()=>{
  begin();act(()=>{canvas.scrollTop=120;canvas.dispatchEvent(new Event('scroll'));});
  expect(document.querySelector('.table-drop-status')).not.toBeNull();emit(document,'mouseup',120,398);expect(engine.records).toHaveLength(1);
});
function rtlGeometry() {
 act(()=>{engine.execute({target:{kind:'cells',tableId:editor.state.doc.firstChild!.attrs.blockId,row:0,col:0},operations:[{type:'table.direction',direction:'rtl'}]});});
 Array.from(table.rows).forEach((row,r)=>Array.from(row.cells).forEach((cell,c)=>{cell.getBoundingClientRect=()=>rect(100+(2-c)*200-wrapper.scrollLeft,200+r*60-canvas.scrollTop,200,60);}));
 table.querySelectorAll('col').forEach((col,c)=>{col.getBoundingClientRect=()=>rect(100+(2-c)*200-wrapper.scrollLeft,200-canvas.scrollTop,200,1200);});
 wrapper.scrollLeft=200;
 act(()=>{table.rows[0].cells[0].dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:400,clientY:220}));});
}
it('autoscrolls physically left and moves the rightmost RTL column to the leftmost position',()=>{
 rtlGeometry();const before=editor.getJSON();const grip=document.querySelector('[aria-label="Drag column 1"]')!;expect(grip).not.toBeNull();
 emit(grip,'mousedown',400,180);emit(document,'mousemove',102,180);ticks();expect(wrapper.scrollLeft).toBe(0);expect(editor.getJSON()).toEqual(before);
 emit(document,'mouseup',102,180);expect(editor.state.doc.firstChild!.firstChild!.child(2).textContent).toBe('Row 0');
 act(()=>{engine.history('undo','api');});expect(editor.getJSON()).toEqual(before);
});
it('uses physical left for RTL keyboard column movement',()=>{
 rtlGeometry();const before=editor.getJSON();const grip=document.querySelector('[aria-label="Drag column 1"]')!;
 act(()=>{grip.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));});
 expect(editor.state.doc.firstChild!.firstChild!.child(1).textContent).toBe('Row 0');act(()=>{engine.history('undo','api');});expect(editor.getJSON()).toEqual(before);
});
