import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import JSZip from 'jszip';
import * as docx from 'docx';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { listStyles, orderedStyles, orderedType, bulletGlyphs, listStyleContext } from '../lib/editor/list/list-style';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
import { exportHTML } from '../lib/infrastructure/export/html-export';
import { previewSource } from '../lib/infrastructure/preview/paged-preview';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
let editor:Editor, engine:DocumentEngine;
beforeEach(async()=>{editor=new Editor({extensions:createExtensions(),content:'<ol start="4"><li><p>中文</p></li><li><p>العربية</p></li></ol><p>Gap</p><ol data-continue-numbering="true" start="6"><li><p>हिन्दी</p></li></ol>'});await new Promise(r=>setTimeout(r,0));engine=new DocumentEngine(editor);});
afterEach(()=>{engine.destroy();editor.destroy();});
const select=(text:string)=>{let p=-1;editor.state.doc.descendants((n,pos)=>{if(n.isText&&n.text===text)p=pos;});if(p<0)throw Error(text);editor.commands.setTextSelection(p);};
const run=(style:unknown)=>engine.execute({operations:[{type:'list.style',style}]});
const bytes=(blob:Blob)=>new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);});
it.each(listStyles)('preserves %s markers through HTML, backup, preview and real Word bytes',async style=>{
  const ordered=orderedStyles.includes(style as typeof orderedStyles[number]),tag=ordered?'ol':'ul';
  editor.commands.setContent(`<${tag} start="4"><li><p><strong>中文</strong></p></li><li><p>العربية हिन्दी</p></li></${tag}>`);select('中文');const before=editor.getJSON();
  expect(run(style).ok).toBe(true);const after=editor.getJSON();
  const dom=new DOMParser().parseFromString(editor.getHTML(),'text/html');expect((dom.querySelector(tag)! as HTMLElement).style.listStyleType).toBe(style);
  const other=new Editor({extensions:createExtensions(),content:editor.getHTML()});expect(other.getJSON()).toEqual(after);other.destroy();
  expect(parseDocument(JSON.stringify({version:1,title:'Styles',content:after})).content).toEqual(after);
  expect(exportHTML('Styles',editor.getHTML(),after)).toContain(`list-style-type: ${style}`);
  const preview=new DOMParser().parseFromString(previewSource('Styles',editor.getHTML(),after).html,'text/html');expect((preview.querySelector(tag)! as HTMLElement).style.listStyleType).toBe(style);
  const buffer=await bytes(await exportWord(after,'Styles')),zip=await JSZip.loadAsync(buffer),xml=await zip.file('word/numbering.xml')!.async('string');
  const formats={'decimal':'decimal','lower-alpha':'lowerLetter','upper-alpha':'upperLetter','lower-roman':'lowerRoman','upper-roman':'upperRoman'};
  if(ordered)expect(xml).toContain(`w:numFmt w:val="${formats[style as keyof typeof formats]}"`);else expect(xml).toContain(`w:lvlText w:val="${bulletGlyphs[style as keyof typeof bulletGlyphs]}"`);
  const result=await importWord(buffer);expect(result.warnings).toEqual([]);const restored=new Editor({extensions:createExtensions(),content:result.content});
  expect(restored.state.doc.firstChild!.attrs).toMatchObject(ordered?{start:4,type:style==='decimal'?null:orderedType(style)}:{bulletStyle:style});expect(restored.state.doc.textContent).toBe(editor.state.doc.textContent);expect(restored.state.doc.firstChild!.firstChild!.firstChild!.firstChild!.marks.some(m=>m.type.name==='bold')).toBe(true);restored.destroy();
  if(JSON.stringify(before)!==JSON.stringify(after)){engine.history('undo');expect(editor.getJSON()).toEqual(before);engine.history('redo');expect(editor.getJSON()).toEqual(after);}
});
it('styles the connected series from its continued part, preserving starts and unrelated nested lists',async()=>{
  editor.commands.setContent('<ol start="4"><li><p>A</p><ol type="a"><li><p>Nested</p></li></ol></li><li><p>B</p></li></ol><p>Gap</p><ol start="6" data-continue-numbering="true"><li><p>C</p></li></ol><p>Gap</p><ol start="9"><li><p>Independent</p></li></ol>');select('C');const before=editor.getJSON();expect(run('upper-roman').ok).toBe(true);
  const styles:{type:unknown;start:number}[]=[];editor.state.doc.descendants(n=>{if(n.type.name==='orderedList')styles.push({type:n.attrs.type,start:n.attrs.start});});expect(styles).toEqual([{type:'I',start:4},{type:'a',start:1},{type:'I',start:6},{type:null,start:9}]);
  const result=await importWord(await bytes(await exportWord(editor.getJSON(),'Series')));const lists=result.content.content!.filter(n=>n.type==='orderedList');expect(lists.map(n=>[n.attrs!.type,n.attrs!.start,n.attrs!.continuePrevious])).toEqual([['I',4,false],['I',6,true],[null,9,false]]);
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('continues with the preceding marker style and updates the following series',()=>{
  editor.commands.setContent('<ol type="I" start="3"><li><p>A</p></li></ol><p>Gap</p><ol type="a"><li><p>B</p></li></ol><p>Gap</p><ol data-continue-numbering="true" type="a" start="2"><li><p>C</p></li></ol>');select('B');const before=editor.getJSON();engine.execute({operations:[{type:'list.continue'}]});expect(editor.getJSON().content!.filter(n=>n.type==='orderedList').map(n=>[n.attrs!.start,n.attrs!.type])).toEqual([[3,'I'],[4,'I'],[5,'I']]);engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('changes only a nested bullet list, then supports direct lists across cells',()=>{
  editor.commands.setContent('<table><tr><td><ul><li><p>A</p><ul><li><p>Nested</p></li></ul></li></ul></td><td><ul><li><p>B</p></li></ul></td></tr></table>');select('Nested');expect(run('square').ok).toBe(true);const values:string[]=[];editor.state.doc.descendants(n=>{if(n.type.name==='bulletList')values.push(n.attrs.bulletStyle);});expect(values).toEqual(['disc','square','disc']);
  const before=editor.getJSON(),map=TableMap.get(editor.state.doc.firstChild!);editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,1+map.map[0],1+map.map[1])));expect(run('circle').ok).toBe(true);const updated:string[]=[];editor.state.doc.descendants(n=>{if(n.type.name==='bulletList')updated.push(n.attrs.bulletStyle);});expect(updated).toEqual(['circle','square','circle']);engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('does not silently convert list kind, style checklists or accept arbitrary CSS; batches stay atomic',()=>{
  select('中文');const before=editor.getJSON();expect(run('circle').ok).toBe(false);expect(engine.execute({operations:[{type:'text.insert',text:'No write'},{type:'list.style',style:'url(https://invalid.test/)'}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);
  editor.commands.setContent('<ul data-type="taskList"><li data-type="taskItem"><p>Task</p></li></ul>');select('Task');expect(listStyleContext(editor.state.doc,editor.state.selection)).toBeNull();expect(run('square').ok).toBe(false);
});
it('unchanged style does not change revision or create an undo entry',()=>{select('中文');const revision=engine.revision,undo=engine.canUndo;expect(run('decimal').ok).toBe(true);expect(engine.revision).toBe(revision);expect(engine.canUndo).toBe(undo);});
it('normalizes HTML marker styles and rejects unsupported backup marker attributes',()=>{
  editor.commands.setContent('<ol style="list-style-type:lower-latin"><li><p>A</p></li></ol><ul type="square"><li><p>B</p></li></ul>');expect(editor.state.doc.firstChild!.attrs.type).toBe('a');expect(editor.state.doc.child(1).attrs.bulletStyle).toBe('square');
  for(const [index,key,value] of [[0,'type','garbage'],[1,'bulletStyle','url(x)']] as const){const content=editor.getJSON();content.content![index].attrs![key]=value;expect(()=>parseDocument(JSON.stringify({version:1,title:'Bad',content}))).toThrow('style');}
});
it('preserves adjacent different bullet markers through Word import boundaries',async()=>{
  editor.commands.setContent('<ul style="list-style-type:circle"><li><p>A</p></li></ul><ul style="list-style-type:square"><li><p>B</p></li></ul>');const result=await importWord(await bytes(await exportWord(editor.getJSON(),'Bullets')));expect(result.content.content!.filter(n=>n.type==='bulletList').map(n=>n.attrs!.bulletStyle)).toEqual(['circle','square']);
});
it('reports unsupported external Word multilevel marker patterns instead of claiming identical numbering',async()=>{
  const file=new docx.Document({numbering:{config:[{reference:'test',levels:[{level:0,format:docx.LevelFormat.DECIMAL,text:'%1.%2)',start:4}]}]},sections:[{children:[new docx.Paragraph({text:'Original',numbering:{reference:'test',level:0}})]}]});
  const result=await importWord(await bytes(await docx.Packer.toBlob(file)));expect(result.warnings.some(w=>w.includes('marker appearance'))).toBe(true);expect(result.content.content![0].attrs!.start).toBe(4);
});
