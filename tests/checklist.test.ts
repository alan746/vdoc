import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import JSZip from 'jszip';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/editor/engine';
import { checklistContext } from '../lib/editor/checklist';
import { parseDocument } from '../lib/editor/storage';
import { exportHTML } from '../lib/editor/html-export';
import { previewSource } from '../lib/editor/paged-preview';
import { exportWord, importWord } from '../lib/editor/word';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
let editor:Editor, engine:DocumentEngine;
const task=(text:string,checked=false)=>`<li data-type="taskItem" data-checked="${checked}"><p>${text}</p></li>`;
const checklist=(body:string,mode?:boolean)=>`<ul data-type="taskList"${mode===undefined?'':` data-strike-completed="${mode}"`}>${body}</ul>`;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:checklist(task('First',true)+task('中文 second'))});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
function pos(text:string){let found=-1;editor.state.doc.descendants((node,pos)=>{if(node.isText&&node.text===text)found=pos;});if(found<0)throw new Error(text);return found;}
const select=(text:string)=>editor.commands.setTextSelection(pos(text));
const run=(strikeCompleted:boolean)=>engine.execute({operations:[{type:'list.checklistStyle',strikeCompleted}]});
const bytes=(blob:Blob)=>new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);});
it('defaults old checklists to strike mode and changes only the list attribute, with exact undo/redo',()=>{
  select('First'); const before=editor.getJSON(), revision=engine.revision;
  expect(run(true).ok).toBe(true);expect(engine.revision).toBe(revision);
  expect(run(false).ok).toBe(true);const after=editor.getJSON();expect(after.content![0].attrs!.strikeCompleted).toBe(false);
  expect(after.content![0].content).toEqual(before.content![0].content);expect(after.content![0].attrs!.blockId).toBe(before.content![0].attrs!.blockId);
  engine.history('undo');expect(editor.getJSON()).toEqual(before);engine.history('redo');expect(editor.getJSON()).toEqual(after);
});
it('keeps nested and independent checklist settings separate',()=>{
  editor.commands.setContent(checklist('<li data-type="taskItem"><p>Outer</p>'+checklist(task('Inner',true),false)+'</li>')+'<p>Gap</p>'+checklist(task('Separate',true)));
  select('Outer');run(false);const lists:unknown[]=[];editor.state.doc.descendants(n=>{if(n.type.name==='taskList')lists.push(n.attrs.strikeCompleted);});expect(lists).toEqual([false,false,true]);
  select('Inner');run(true);expect(editor.state.doc.firstChild!.attrs.strikeCompleted).toBe(false);expect(checklistContext(editor.state.doc,editor.state.selection)!.node.attrs.strikeCompleted).toBe(true);
});
it('does not target an outer checklist from a regular list or table cell',()=>{
  editor.commands.setContent(checklist('<li data-type="taskItem"><p>Outer</p><ol><li><p>Regular</p></li></ol><table><tr><td><p>Cell</p></td></tr></table></li>'));
  for(const text of ['Regular','Cell']){select(text);const before=editor.getJSON();expect(run(false).ok).toBe(false);expect(editor.getJSON()).toEqual(before);}
});
it('supports multi-item selections within one list and a whole-list node selection',()=>{
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc,pos('First'),pos('中文 second')+2)));expect(run(false).ok).toBe(true);
  editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc,0)));expect(run(true).ok).toBe(true);
});
it('rejects cross-list selections and rolls back earlier operations in the batch',()=>{
  editor.commands.setContent(checklist(task('First'))+'<p>Gap</p>'+checklist(task('Last')));
  editor.commands.setTextSelection({from:pos('First'),to:pos('Last')});const before=editor.getJSON();expect(run(false).ok).toBe(false);expect(editor.getJSON()).toEqual(before);
  select('Gap');expect(engine.execute({operations:[{type:'text.insert',text:'Transient'},{type:'list.checklistStyle',strikeCompleted:false}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);
});
it.each([false,true])('preserves mode %s, checkbox state, marks and multilingual text in HTML, backup and preview',mode=>{
  editor.commands.setContent(checklist(task('<strong>中文 العربية हिन्दी 日本語 é 👩🏽‍💻</strong>',true)+task('<s>Manual strike</s>'),mode));
  const before=editor.getJSON();expect(parseDocument(JSON.stringify({version:1,title:'Checklist',content:before})).content).toEqual(before);
  const other=new Editor({extensions:createExtensions(),content:editor.getHTML()});expect(other.getJSON()).toEqual(before);other.destroy();
  for(const source of [exportHTML('Checklist',editor.getHTML(),before),previewSource('Checklist',editor.getHTML(),before).html]){
    const html=new DOMParser().parseFromString(source,'text/html');expect(html.querySelector('ul[data-type=taskList]')!.getAttribute('data-strike-completed')).toBe(String(mode));expect(html.querySelector('[data-checked=true] strong')?.textContent).toContain('中文 العربية');expect(html.querySelector('s')?.textContent).toBe('Manual strike');
  }
});
it('inherits the chosen mode on a new nested checklist and preserves the existing destination mode',()=>{
  select('First');run(false);select('中文 second');expect(engine.execute({operations:[{type:'list.indent',direction:'in'}]}).ok).toBe(true);
  expect(editor.state.doc.firstChild!.firstChild!.lastChild!.attrs.strikeCompleted).toBe(false);
  editor.commands.setContent(checklist('<li data-type="taskItem"><p>Parent</p>'+checklist(task('Child'),true)+'</li>'+task('Next'),false));select('Next');engine.execute({operations:[{type:'list.indent',direction:'in'}]});expect(editor.state.doc.firstChild!.firstChild!.lastChild!.attrs.strikeCompleted).toBe(true);
});
it.each(['false',null,1])('rejects invalid mode %s atomically in operations and backups',value=>{
  select('First');const before=editor.getJSON();expect(engine.execute({operations:[{type:'text.insert',text:'No write'},{type:'list.checklistStyle',strikeCompleted:value}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);
  const bad:JSONContent=structuredClone(before);bad.content![0].attrs!.strikeCompleted=value;expect(()=>parseDocument(JSON.stringify({version:1,title:'Invalid',content:bad}))).toThrow('checklist style');
  bad.content![0].attrs!.strikeCompleted=true;bad.content![0].content![0].attrs!.checked=value;expect(()=>parseDocument(JSON.stringify({version:1,title:'Invalid',content:bad}))).toThrow('checklist state');
});
it.each([false,true])('Word mode %s strikes completed text appropriately and emits only one checkbox per multi-paragraph item',async mode=>{
  editor.commands.setContent(checklist('<li data-type="taskItem" data-checked="true"><p>Done 中文</p><p><strong>Second paragraph</strong></p><h2>Task heading</h2></li>'+task('<s>Manual strike</s>'),mode));
  const buffer=await bytes(await exportWord(editor.getJSON(),'Checklist')),zip=await JSZip.loadAsync(buffer),raw=await zip.file('word/document.xml')!.async('string');
  const xml=new DOMParser().parseFromString(raw,'application/xml'),W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const texts=[...xml.getElementsByTagNameNS(W,'t')].map(n=>n.textContent).join('');expect(texts.match(/☑/g)).toHaveLength(1);expect(texts.match(/☐/g)).toHaveLength(1);
  for(const text of ['Done 中文','Second paragraph','Task heading']){
    const run=[...xml.getElementsByTagNameNS(W,'r')].find(r=>r.textContent===text)!;const strike=run.getElementsByTagNameNS(W,'strike')[0];expect(!!strike&&!['false','0'].includes(strike.getAttributeNS(W,'val')||'1')).toBe(mode);
  }
  const manual=[...xml.getElementsByTagNameNS(W,'r')].find(r=>r.textContent==='Manual strike')!;expect(manual.getElementsByTagNameNS(W,'strike')).toHaveLength(1);
  const imported=await importWord(buffer);expect(imported.warnings).toEqual([expect.stringContaining('static checklist symbols')]);editor.commands.setContent(imported.content);
  expect(editor.state.doc.textContent).toBe('☑ Done 中文Second paragraphTask heading☐ Manual strike');expect(editor.state.doc.child(2).type.name).toBe('heading');
});
it('rejects stale external updates and preserves an explicit existing text strike when mode changes',()=>{
  editor.commands.setContent(checklist(task('<s>Manual strike</s>',true)));select('Manual strike');const snap=engine.snapshot(),target=snap.blocks.find(b=>b.text==='Manual strike')!;
  const request={source:'api',expectedSessionId:snap.sessionId,expectedRevision:snap.revision,target:{kind:'block',id:target.id},operations:[{type:'list.checklistStyle',strikeCompleted:false}]};
  expect(engine.execute(request).ok).toBe(true);const after=editor.getJSON();expect(editor.getHTML()).toContain('<s>Manual strike</s>');expect(engine.execute(request).ok).toBe(false);expect(editor.getJSON()).toEqual(after);
});
