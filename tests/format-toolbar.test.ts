import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {createElement,act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {Editor} from '@tiptap/core';
import {CellSelection,TableMap} from '@tiptap/pm/tables';
import {createExtensions} from '../lib/editor/extensions';
import {DocumentEngine} from '../lib/editor/engine';
import {copyTextFormat,canPasteTextFormat,type TextFormat} from '../lib/editor/format-copy';
import {EditorToolbar} from '../components/editor/toolbar';
import {TooltipProvider} from '../components/ui/tooltip';
let editor:Editor,engine:DocumentEngine,root:Root,clipboard:TextFormat|null,unsubscribe:()=>void;
const copyName='Copy text formatting · ⌘⌥C',pasteName='Paste text formatting · ⌘⌥V';
const button=(name:string)=>document.querySelector(`[aria-label="${name}"]`) as HTMLButtonElement;
function render(){root.render(createElement(TooltipProvider,null,createElement(EditorToolbar,{editor,engine,zoom:100,setZoom:()=>{},link:()=>{},insertTable:()=>{},onPrint:()=>{},run:operations=>{engine.execute({operations:Array.isArray(operations)?operations:[operations]});},formatting:{canCopy:copyTextFormat(editor)!==null,canPaste:!!clipboard&&canPasteTextFormat(editor),copy:()=>{clipboard=copyTextFormat(editor);render();},paste:()=>{if(clipboard)engine.execute({source:'toolbar',operations:[{type:'format.apply',format:clipboard}]});}}})));}
function select(text:string,caret=false){let p=-1;editor.state.doc.descendants((n,pos)=>{if(n.isText&&n.text===text)p=pos;});act(()=>editor.commands.setTextSelection({from:p,to:caret?p:p+text.length}));}
function click(name:string){act(()=>{const e=new MouseEvent('mousedown',{bubbles:true,cancelable:true});button(name).dispatchEvent(e);expect(e.defaultPrevented).toBe(true);button(name).click();});}
beforeEach(async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});clipboard=null;
 const mount=document.createElement('div');document.body.appendChild(mount);editor=new Editor({element:mount,extensions:createExtensions(),content:'<p><strong><span style="color:#cc2233">Source</span></strong></p><p><em>Target</em></p>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);
 const reactMount=document.createElement('div');document.body.appendChild(reactMount);root=createRoot(reactMount);unsubscribe=engine.subscribe(render);await act(async()=>render());
});
afterEach(()=>{unsubscribe();act(()=>root.unmount());engine.destroy();editor.destroy();document.body.innerHTML='';vi.unstubAllGlobals();vi.restoreAllMocks();});
it('disables paste before copy and for an empty target, enabling it after target selection',()=>{
 expect(button(pasteName).disabled).toBe(true);select('Source');click(copyName);select('Target',true);expect(button(pasteName).disabled).toBe(true);select('Target');expect(button(pasteName).disabled).toBe(false);
});
it('keeps the source selection when clicking copy, applies to the target and supports exact history',()=>{
 select('Source');const sourceSelection=editor.state.selection.toJSON(),before=editor.getJSON(),revision=engine.revision;click(copyName);expect(editor.state.selection.toJSON()).toEqual(sourceSelection);expect(engine.revision).toBe(revision);select('Target');const targetSelection=editor.state.selection.toJSON();click(pasteName);expect(editor.state.selection.toJSON()).toEqual(targetSelection);expect(copyTextFormat(editor)).toMatchObject({bold:true,italic:false,color:'#CC2233'});const after=editor.getJSON();act(()=>{engine.history('undo');});expect(editor.getJSON()).toEqual(before);act(()=>{engine.history('redo');});expect(editor.getJSON()).toEqual(after);
});
it('updates copy state for Select all and applies its first format across table cells',()=>{
 act(()=>editor.commands.selectAll());expect(button(copyName).disabled).toBe(false);click(copyName);act(()=>{editor.commands.setContent('<table><tr><td><p>A</p></td><td><p>B</p></td></tr></table>');const map=TableMap.get(editor.state.doc.firstChild!);editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,1+map.map[1],1+map.map[0])));});const grid=engine.snapshot().tables;expect(button(copyName).disabled).toBe(false);click(pasteName);expect(engine.snapshot().tables).toEqual(grid);editor.state.doc.descendants(n=>{if(n.isText)expect(n.marks.some(m=>m.type.name==='bold')).toBe(true);});
});
it('does not steal selection or write history when the same format is pasted again',()=>{
 select('Source');click(copyName);select('Target');click(pasteName);const before=editor.getJSON(),revision=engine.revision,records=engine.records.length;click(pasteName);expect(editor.getJSON()).toEqual(before);expect(engine.revision).toBe(revision);expect(engine.records).toHaveLength(records);
});
it('keeps repeated identical paragraph operations out of visible history while retaining the first edit',()=>{
 select('Target');act(()=>{engine.execute({operations:[{type:'paragraph.style',indentStart:24}]});});const revision=engine.revision;expect(engine.records).toHaveLength(1);act(()=>{engine.execute({operations:[{type:'paragraph.style',indentStart:24}]});});expect(engine.revision).toBe(revision);expect(engine.records).toHaveLength(1);act(()=>{engine.history('undo');});expect(editor.state.selection.$from.parent.attrs.indentStart).toBeNull();
});
it('still records changes to typing marks even when no document characters change',()=>{
 select('Target',true);const revision=engine.revision;act(()=>{engine.execute({operations:[{type:'text.style',style:{bold:true}}]});});expect(engine.revision).toBe(revision);expect(engine.records).toHaveLength(1);act(()=>{engine.execute({operations:[{type:'text.style',style:{bold:true}}]});});expect(engine.records).toHaveLength(1);
});
it('does not log materializing unchanged implicit typing marks as a formatting change',()=>{
 select('Target',true);const before=editor.getJSON(),revision=engine.revision;act(()=>{engine.execute({operations:[{type:'text.style',style:{bold:false}}]});});expect(editor.getJSON()).toEqual(before);expect(engine.revision).toBe(revision);expect(engine.records).toHaveLength(0);
});
it('displays imported points as pixels and increases from the actual size with exact undo',()=>{
 act(()=>editor.commands.setContent('<p><span style="font-size:12pt">Imported</span></p>'));select('Imported');
 expect((document.querySelector('[aria-label="Font size (px)"]') as HTMLInputElement).value).toBe('16');
 const before=editor.getJSON();click('Increase font size');expect(editor.state.doc.firstChild!.firstChild!.marks.find(m=>m.type.name==='textStyle')?.attrs.fontSize).toBe('17px');
 act(()=>{engine.history('undo');});expect(editor.getJSON()).toEqual(before);expect((document.querySelector('[aria-label="Font size (px)"]') as HTMLInputElement).value).toBe('16');
});
it('copies from selected text after an unselected paragraph end without changing the document',()=>{
 act(()=>editor.commands.setContent('<p><strong>Before</strong></p><p><em>日本語</em></p><p>Target</p>'));
 act(()=>editor.commands.setTextSelection({from:7,to:11}));const before=editor.getJSON(),selection=editor.state.selection.toJSON();click(copyName);expect(editor.getJSON()).toEqual(before);expect(editor.state.selection.toJSON()).toEqual(selection);
 select('Target');click(pasteName);expect(copyTextFormat(editor)).toMatchObject({bold:false,italic:true});
});

it.each([
 ['120px','Decrease font size',96],['6px','Increase font size',8],
 ['72.75pt','Decrease font size',96],['5.25pt','Increase font size',8],
 ['8.5px','Decrease font size',8],['95.5px','Increase font size',96],
] as const)('adjusts imported %s using %s into the supported range with exact history',(size,action,expected)=>{
 act(()=>editor.commands.setContent(`<p><span style="font-size:${size}">Imported</span></p><p>Keep</p>`));select('Imported');
 const before=editor.getJSON(),selection=editor.state.selection.toJSON();expect(button(action).disabled).toBe(false);click(action);
 expect(editor.state.doc.firstChild!.firstChild!.marks.find(m=>m.type.name==='textStyle')?.attrs.fontSize).toBe(`${expected}px`);
 expect(editor.state.selection.toJSON()).toEqual(selection);expect(editor.state.doc.child(1).toJSON()).toEqual(before.content![1]);
 const after=editor.getJSON();act(()=>{engine.history('undo');});expect(editor.getJSON()).toEqual(before);act(()=>{engine.history('redo');});expect(editor.getJSON()).toEqual(after);
});

it.each([
 {key:'Enter',isComposing:true},{key:'Escape',isComposing:true},
 {key:'Enter',keyCode:229},{key:'Escape',keyCode:229},
])('keeps IME candidate keys in the font size input: %j', flags=>{
 select('Target');
 const input=document.querySelector<HTMLInputElement>('[aria-label="Font size (px)"]')!;
 act(()=>input.focus());
 const before=editor.getJSON(),selection=editor.state.selection.toJSON();
 const event=new KeyboardEvent('keydown',{...flags,bubbles:true,cancelable:true});
 act(()=>input.dispatchEvent(event));
 expect(document.activeElement).toBe(input);expect(event.defaultPrevented).toBe(false);
 expect(editor.getJSON()).toEqual(before);expect(editor.state.selection.toJSON()).toEqual(selection);
 expect(engine.records).toHaveLength(0);
});
it('still leaves the font size input on an ordinary Enter after composition',()=>{
 select('Target');const input=document.querySelector<HTMLInputElement>('[aria-label="Font size (px)"]')!;
 act(()=>input.focus());const event=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
 act(()=>input.dispatchEvent(event));expect(event.defaultPrevented).toBe(true);expect(document.activeElement).toBe(editor.view.dom);
});
it.each(['Enter','Escape'])('keeps an unflagged candidate %s in an actively composing font size field',key=>{
 select('Target');const input=document.querySelector<HTMLInputElement>('[aria-label="Font size (px)"]')!;
 act(()=>{input.focus();input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));});
 const before=editor.getJSON(),selection=editor.state.selection.toJSON();
 const event=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});
 act(()=>input.dispatchEvent(event));
 expect(document.activeElement).toBe(input);expect(event.defaultPrevented).toBe(false);
 expect(editor.getJSON()).toEqual(before);expect(editor.state.selection.toJSON()).toEqual(selection);
 act(()=>input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
 const after=new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});act(()=>input.dispatchEvent(after));
 expect(document.activeElement).toBe(editor.view.dom);expect(editor.getJSON()).toEqual(before);
});
