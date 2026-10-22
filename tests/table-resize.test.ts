import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { TableMap } from '@tiptap/pm/tables';
import { undoDepth } from '@tiptap/pm/history';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { parseDocument } from '../lib/infrastructure/persistence/storage';

let editor: Editor, engine: DocumentEngine;
const fixture = '<table><tr style="height:60px"><th colspan="2" colwidth="100,150">标题 العربية</th></tr><tr style="height:70px"><td rowspan="2" colwidth="100" style="height:130px">日本語</td><td colwidth="150" style="height:70px">한국어</td></tr><tr style="height:60px"><td colwidth="150">हिन्दी</td></tr></table>';
beforeEach(async () => {
  const element = document.body.appendChild(document.createElement('div'));
  editor = new Editor({ element, extensions: createExtensions(undefined, request => { expect(engine.execute(request).ok).toBe(true); }), content: fixture });
  await new Promise(r => setTimeout(r, 0)); engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); document.body.innerHTML = ''; vi.restoreAllMocks(); });
const table = () => editor.state.doc.firstChild!;
const target = () => ({ kind: 'cells', tableId: table().attrs.blockId, row: 0, col: 0 });
const event = (target: EventTarget, type: string, x: number, y: number) => target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1 }));
function geometry(scale = 1, rtl = false) {
  const dom = editor.view.dom.querySelector('table')!;
  const rect = (left: number, top: number, width: number, height: number) => ({ x: (rtl ? 290-left-width : left)*scale, y: top*scale, left:(rtl ? 290-left-width : left)*scale,top:top*scale,right:(rtl ? 290-left : left+width)*scale,bottom:(top+height)*scale,width:width*scale,height:height*scale,toJSON(){} });
  vi.spyOn(dom, 'offsetWidth', 'get').mockReturnValue(250);
  vi.spyOn(dom, 'getBoundingClientRect').mockReturnValue(rect(20,20,250,190));
  const rows = [...dom.rows];
  for (const [i,row] of rows.entries()) vi.spyOn(row,'getBoundingClientRect').mockReturnValue(rect(20,[20,80,150][i],250,[60,70,60][i]));
  const cells = [...dom.querySelectorAll('th,td')];
  [[20,20,250,60],[20,80,100,130],[120,80,150,70],[120,150,150,60]].forEach((r,i)=>vi.spyOn(cells[i],'getBoundingClientRect').mockReturnValue(rect(...r as [number,number,number,number])));
  const cols=[...dom.querySelectorAll('col')];
  vi.spyOn(cols[0],'getBoundingClientRect').mockReturnValue(rect(20,20,100,190));
  vi.spyOn(cols[1],'getBoundingClientRect').mockReturnValue(rect(120,20,150,190));
  return {dom,cells};
}

it('resizes one row across a rowspan without altering spanning content, neighbours, or other row heights',()=>{
  const before=editor.getJSON(), spanning=table().child(1).child(0).toJSON(), last=table().child(2).toJSON();
  expect(engine.execute({target:target(),operations:[{type:'table.rowHeight',row:1,height:95}]}).ok).toBe(true);
  expect(table().child(1).attrs.minHeight).toBe(95); expect(table().child(1).child(1).attrs.minHeight).toBeNull();
  expect(table().child(1).child(0).toJSON()).toEqual(spanning); expect(table().child(2).toJSON()).toEqual(last);
  expect(TableMap.get(table()).problems).toBeNull();
  const after=editor.getJSON(), html=editor.getHTML();
  expect(parseDocument(JSON.stringify({version:1,title:'Resized',content:after})).content).toEqual(after);
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
  engine.history('redo');expect(editor.getJSON()).toEqual(after);
  editor.commands.setContent(html);expect(table().child(1).attrs.minHeight).toBe(95);
});

it('resizes one logical column inside merged cells and preserves an imported narrow neighbouring column',()=>{
  editor.commands.setContent('<table><tr><th colspan="2" colwidth="25,150">Header</th></tr><tr><td colwidth="25">A</td><td colwidth="150">B</td></tr></table>');
  const before=editor.getJSON();
  expect(engine.execute({target:target(),operations:[{type:'table.columnWidth',column:1,width:190}]}).ok).toBe(true);
  expect(table().child(0).child(0).attrs.colwidth).toEqual([25,190]);
  expect(table().child(1).child(0).attrs.colwidth).toEqual([25]);
  expect(table().child(1).child(1).attrs.colwidth).toEqual([190]);
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
});

it.each([{type:'table.rowHeight',row:3,height:90},{type:'table.columnWidth',column:2,width:90},{type:'table.rowHeight',row:1,height:1001},{type:'table.columnWidth',column:1,width:39}])('rejects invalid resize %j atomically',operation=>{
  const before=editor.getJSON();
  expect(engine.execute({target:target(),operations:[{type:'table.layout',alignment:'right'},operation]}).ok).toBe(false);
  expect(editor.getJSON()).toEqual(before);
});

it.each([0.75,1,1.25])('previews and commits scaled row and column drags once at zoom %s',scale=>{
  const {dom,cells}=geometry(scale),before=editor.getJSON(),depth=undoDepth(editor.state),revision=engine.revision;
  event(cells[2],'mousedown',180*scale,149*scale);
  event(window,'mousemove',180*scale,179*scale);
  expect(editor.getJSON()).toEqual(before);expect(engine.revision).toBe(revision);expect(undoDepth(editor.state)).toBe(depth);
  expect(dom.rows[1].style.getPropertyValue('--vdoc-preview-height')).toBe('100px');expect(cells[2].classList.contains('table-cell-resizing')).toBe(true);
  event(window,'mouseup',180*scale,179*scale);
  expect(table().child(1).attrs.minHeight).toBe(100);expect(undoDepth(editor.state)).toBe(depth+1);
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
  event(cells[0],'mousedown',269*scale,45*scale);event(window,'mousemove',309*scale,45*scale);
  expect(editor.getJSON()).toEqual(before);expect(dom.querySelectorAll('col')[1].style.width).toBe('190px');
  event(window,'mouseup',309*scale,45*scale);
  expect(table().child(0).child(0).attrs.colwidth).toEqual([100,190]);
  expect(table().child(2).child(0).attrs.colwidth).toEqual([190]);
  expect(document.querySelector('.table-resize-badge')).toBeNull();
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
});

it.each(['Escape','blur','scroll','compositionstart'])('cancels row and column previews on %s without history or document changes',reason=>{
  const {dom,cells}=geometry(),before=editor.getJSON(),depth=undoDepth(editor.state);
  for(const axis of ['row','column']) {
    const x=axis==='row'?180:269,y=axis==='row'?149:45;
    event(axis==='row'?cells[2]:cells[0],'mousedown',x,y);event(window,'mousemove',x+30,y+30);
    if(reason==='Escape')window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    else (reason==='compositionstart'?editor.view.dom:window).dispatchEvent(new Event(reason));
    event(window,'mouseup',x+30,y+30);
    expect(editor.getJSON()).toEqual(before);expect(undoDepth(editor.state)).toBe(depth);
    expect(dom.rows[1].style.height).toBe('70px');expect(dom.querySelectorAll('col')[1].style.width).toBe('150px');
    expect(document.querySelector('.table-resize-badge')).toBeNull();
    if(reason==='compositionstart') editor.view.dom.dispatchEvent(new CompositionEvent('compositionend'));
  }
});

it('cancels a drag when the document changes and retains the new document dimensions',()=>{
  const {dom,cells}=geometry();
  event(cells[0],'mousedown',269,45);event(window,'mousemove',309,45);
  expect(engine.execute({target:target(),operations:[{type:'table.columnWidth',column:1,width:220}]}).ok).toBe(true);
  event(window,'mouseup',319,45);
  expect(table().child(0).child(0).attrs.colwidth).toEqual([100,220]);expect(dom.querySelectorAll('col')[1].style.width).toBe('220px');
});

it('uses the last row of a rowspan edge and ignores a click without movement',()=>{
  const {cells}=geometry(),before=editor.getJSON();
  event(cells[1],'mousedown',60,209);event(window,'mouseup',60,209);expect(editor.getJSON()).toEqual(before);
  event(cells[1],'mousedown',60,209);event(window,'mousemove',60,239);event(window,'mouseup',60,239);
  expect(table().child(2).attrs.minHeight).toBe(90);expect(table().child(1).attrs.minHeight).toBe(70);
});

it.each([0.75,1,1.25])('resizes the physical left edge of an RTL merged header at zoom %s',scale=>{
 expect(engine.execute({target:target(),operations:[{type:'table.direction',direction:'rtl'}]}).ok).toBe(true);
 const {dom,cells}=geometry(scale,true),before=editor.getJSON(),revision=engine.revision;
 event(cells[0],'mousedown',21*scale,45*scale);event(window,'mousemove',-19*scale,45*scale);
 expect(editor.getJSON()).toEqual(before);expect(engine.revision).toBe(revision);expect(dom.querySelectorAll('col')[1].style.width).toBe('190px');
 event(window,'mouseup',-19*scale,45*scale);expect(table().child(0).child(0).attrs.colwidth).toEqual([100,190]);
 engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
