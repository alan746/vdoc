import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import JSZip from 'jszip';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { selectedParagraphBorders, paragraphBorderChanges, type ParagraphBorderOperation } from '../lib/editor/paragraph/paragraph-borders';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { exportHTML } from '../lib/infrastructure/export/html-export';
import { previewSource } from '../lib/infrastructure/preview/paged-preview';
import { finishPreviewParagraphBorders } from '../lib/infrastructure/preview/preview-paragraph-borders';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
let editor: Editor, engine: DocumentEngine;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<h2>Heading 中文</h2><p dir="rtl">العربية עברית</p><p>日本語 ไทย हिन्दी</p>' });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); });
const apply = (patch: Omit<ParagraphBorderOperation,'type'>) => engine.execute({operations:[{type:'paragraph.border',...patch}]});
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
it('adds a border to the current complete paragraph, preserves text and reverses one transaction',()=>{
  const before=editor.getJSON();editor.commands.setTextSelection({from:2,to:4});
  expect(apply({left:true,color:'#AA1122',width:2,style:'dashed',padding:9}).ok).toBe(true);
  expect(editor.state.doc.firstChild!.attrs.paragraphBorders).toEqual({left:{color:'#AA1122',width:2,style:'dashed',padding:9}});
  expect(editor.state.doc.child(1).attrs.paragraphBorders).toBeNull();engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
it('changes only requested properties on active edges without adding missing edges across mixed paragraphs',()=>{
  apply({left:true,color:'#AA1122',width:2});editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize+1);apply({bottom:true,color:'#334455',width:3});
  editor.commands.selectAll();const initial=selectedParagraphBorders(editor);expect(initial).toMatchObject({left:null,bottom:null,width:null,color:null});
  const changed=paragraphBorderChanges(initial,{...initial,style:'dotted'})!;
  expect(changed).toEqual({type:'paragraph.border',style:'dotted'});engine.execute({operations:[changed]});
  expect(editor.state.doc.child(0).attrs.paragraphBorders.left).toMatchObject({color:'#AA1122',width:2,style:'dotted'});
  expect(editor.state.doc.child(1).attrs.paragraphBorders).toEqual({bottom:{color:'#334455',width:3,style:'dotted',padding:6}});
  expect(editor.state.doc.child(2).attrs.paragraphBorders).toBeNull();
});
it('keeps unchanged mixed values and uses visible shared properties on newly enabled edges',()=>{
  apply({bottom:true,color:'#AA1122',width:3,padding:8});const values=selectedParagraphBorders(editor);
  expect(paragraphBorderChanges(values,values)).toBeNull();const change=paragraphBorderChanges(values,{...values,top:true})!;
  engine.execute({operations:[change]});expect(editor.state.doc.firstChild!.attrs.paragraphBorders.top).toEqual(editor.state.doc.firstChild!.attrs.paragraphBorders.bottom);
});
it('removes borders independently of paragraph background, highlighting and cell borders',()=>{
  editor.commands.setContent('<table><tr><td style="border:3px solid #112233;background-color:#ddeeff"><p style="background-color:#fff2cc;border-left:2px dashed #aabbcc;padding-left:12px"><mark data-color="#00FF00">Text</mark></p></td></tr></table>');
  editor.commands.setTextSelection(4);expect(apply({left:false,top:false,right:false,bottom:false}).ok).toBe(true);
  const cell=editor.state.doc.firstChild!.firstChild!.firstChild!, p=cell.firstChild!;
  expect(p.attrs.paragraphBorders).toBeNull();expect(p.attrs.paragraphBackground).toBe('#FFF2CC');expect(p.firstChild!.marks[0].type.name).toBe('highlight');expect(cell.attrs.borderWidth).toBe(3);
});
it('targets only a disjoint table column and preserves RTL physical edge meaning',()=>{
  editor.commands.setContent('<table><tr><td><p dir="rtl">א</p></td><td><p>B</p></td></tr><tr><td><p dir="rtl">ع</p></td><td><p>D</p></td></tr></table>');
  const map=TableMap.get(editor.state.doc.firstChild!);editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc,1+map.map[0],1+map.map[2])));
  apply({left:true});const values:unknown[]=[];editor.state.doc.firstChild!.descendants(n=>{if(n.type.name==='paragraph')values.push(n.attrs.paragraphBorders);});
  expect(values.map(Boolean)).toEqual([true,false,true,false]);expect((values[0] as { left?: unknown }).left).toBeDefined();
});
it('preserves asymmetric edge settings in HTML, backups and preview without expanding outside the paragraph',()=>{
  editor.commands.setContent('<p style="border-left:2px dashed #aabbcc;padding-left:12px;border-bottom:1px dotted #112233;padding-bottom:8px">中文 العربية</p>');
  const original=editor.getJSON(),html=editor.getHTML();const other=new Editor({extensions:createExtensions(),content:html});expect(other.getJSON()).toEqual(original);other.destroy();
  expect(parseDocument(JSON.stringify({version:1,title:'Border',content:original})).content).toEqual(original);
  const p=new DOMParser().parseFromString(exportHTML('Border',html,original),'text/html').querySelector('p')!;
  expect(p.style.borderLeftStyle).toBe('dashed');expect(p.style.borderBottomStyle).toBe('dotted');expect(p.style.paddingLeft).toBe('12px');
  const preview=document.createElement('div');preview.innerHTML=`<div class="pagedjs_page">${previewSource('Border',html,original).html}</div>`;
  finishPreviewParagraphBorders(preview);
  expect(preview.querySelector('p')!.style.borderLeftStyle).toBe('dashed');expect(preview.querySelector('p')!.style.paddingLeft).toBe('12px');
  expect(preview.querySelector<HTMLElement>('[data-preview-border-line="bottom"]')!.style.borderTopStyle).toBe('dotted');
  expect(preview.querySelector('[data-preview-border-line="top"]')).toBeNull();
});
it.each([{width:0},{width:9},{padding:32},{padding:1.5},{color:'red'},{top:'yes'},{}])('rejects invalid border request %j atomically',patch=>{
  const before=editor.getJSON();expect(engine.execute({operations:[{type:'text.insert',text:'no'},{type:'paragraph.border',...patch}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);
});
it('rejects malformed backup borders and leaves old documents unbordered',()=>{
  for(const paragraphBorders of [{diagonal:{}},{left:{width:2,color:'red',style:'solid',padding:6}},[]]) expect(()=>parseDocument(JSON.stringify({version:1,title:'bad',content:{type:'doc',content:[{type:'paragraph',attrs:{paragraphBorders}}]}}))).toThrow('paragraph borders');
  editor.commands.setContent(parseDocument(JSON.stringify({version:1,title:'old',content:{type:'doc',content:[{type:'paragraph'}]}})).content);expect(editor.state.doc.firstChild!.attrs.paragraphBorders).toBeNull();
});
it('round-trips direct asymmetric borders on headings, RTL, lists and table paragraphs in actual DOCX bytes',async()=>{
  editor.commands.setContent('<h2 style="border-bottom:2px solid #112233;padding-bottom:8px">中文</h2><p dir="rtl" style="border-left:1px dashed #aabbcc;padding-left:12px">العربية עברית</p><ul><li><p style="border-top:3px dotted #334455;padding-top:4px">ไทย हिन्दी</p></li></ul><table><tr><td><p style="border-right:2px solid #667788;padding-right:16px">日本語</p></td></tr></table><p>Plain</p>');
  const before:unknown[]=[];editor.state.doc.descendants(n=>{if(['paragraph','heading'].includes(n.type.name))before.push(n.attrs.paragraphBorders);});
  const data=await bytes(await exportWord(editor.getJSON(),'Borders'));const zip=await JSZip.loadAsync(data),xml=await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('w:space="9"');expect(xml).toContain('w:sz="12"');
  const result=await importWord(data);expect(result.warnings).toEqual([]);editor.commands.setContent(result.content);
  const after:unknown[]=[];editor.state.doc.descendants(n=>{if(['paragraph','heading'].includes(n.type.name))after.push(n.attrs.paragraphBorders);});expect(after).toEqual(before);
});
