import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import JSZip from 'jszip';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import type { ParagraphBorderOperation } from '../lib/domain/rules/paragraph-borders';
import { parseDocument } from '../lib/infrastructure/persistence/document-codec';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { exportHTML } from '../lib/infrastructure/export/html-export';
import { previewSource } from '../lib/infrastructure/preview/paged-preview';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
let editor: Editor, engine: DocumentEngine;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<h2>Heading 中文</h2><p dir="rtl">العربية עברית</p><p>日本語 ไทย हिन्दी</p>' });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); });
const apply = (patch: Omit<ParagraphBorderOperation,'type'>) => engine.execute({operations:[{type:'paragraph.border',...patch}]});
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob); });
function setup(join=true,between=true){
  editor.commands.setContent('<p>Alpha 中文</p><p>Beta 日本語</p><p>Gamma ไทย</p>');editor.commands.selectAll();
  expect(apply({top:true,right:true,bottom:true,left:true,join,between,color:'#335577',width:2,style:'solid',padding:6}).ok).toBe(true);
}
const flags=()=>Array.from(editor.view.dom.querySelectorAll('p')).map(p=>[p.getAttribute('data-vdoc-border-prev'),p.getAttribute('data-vdoc-border-next')]);
it('draws one connected group with only internal separators and leaves content/marks unchanged',()=>{
  setup();expect(flags()).toEqual([[null,'true'],['true','true'],['true',null]]);
  expect(editor.getText()).toBe('Alpha 中文\n\nBeta 日本語\n\nGamma ไทย');
  expect(editor.view.dom.querySelector('p')!.style.getPropertyValue('--vdoc-between-border')).toBe('2px solid #335577');
});
it('turns off internal lines independently of the connected outer frame',()=>{
  setup();apply({between:false});expect(flags()).toEqual([[null,'true'],['true','true'],['true',null]]);
  expect(editor.state.doc.firstChild!.attrs.paragraphBorders.between).toBeUndefined();
  expect(editor.state.doc.firstChild!.attrs.paragraphBorders.top.width).toBe(2);
});
it('keeps the old separate-paragraph layout unless joining is enabled',()=>{
  setup(false);expect(flags()).toEqual([[null,null],[null,null],[null,null]]);apply({join:true});expect(flags()[1]).toEqual(['true','true']);
  apply({join:false});expect(flags()).toEqual([[null,null],[null,null],[null,null]]);
});
it('updates joining after a local style change and one Undo',()=>{
  setup();editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize+1);apply({color:'#AA1122'});
  expect(flags()).toEqual([[null,null],[null,null],[null,null]]);engine.history('undo');expect(flags()[1]).toEqual(['true','true']);
});
it.each([{indentStart:24},{indentEnd:12},{direction:'rtl'},{paragraphBackground:'#FFF2CC'}])('does not join incompatible layout %j',attrs=>{
  setup();const json=editor.getJSON();Object.assign(json.content![1].attrs!,attrs);editor.commands.setContent(json);expect(flags()).toEqual([[null,null],[null,null],[null,null]]);
});
it('does not connect across objects or different table cells',()=>{
  editor.commands.setContent('<p>A</p><hr><p>B</p><table><tr><td><p>C</p><p>D</p></td><td><p>E</p></td></tr></table>');editor.commands.selectAll();apply({left:true,join:true,between:true});
  expect(flags().slice(0,5)).toEqual([[null,null],[null,null],[null,'true'],['true',null],[null,null]]);
});
it('maps decorations during ordinary typing and regenerates them when Enter adds a paragraph',()=>{
  setup();editor.commands.setTextSelection(3);engine.execute({operations:[{type:'text.insert',text:'more'}]});expect(flags()[1]).toEqual(['true','true']);
  editor.commands.splitBlock();expect(flags()).toEqual([[null,'true'],['true','true'],['true','true'],['true',null]]);
});
it('recalculates group endpoints when a whole paragraph is deleted',()=>{
  setup();editor.view.dispatch(editor.state.tr.delete(0,editor.state.doc.firstChild!.nodeSize));
  expect(flags()).toEqual([[null,'true'],['true',null]]);
});
it('joins newly adjacent paragraphs after deleting the separating object',()=>{
  editor.commands.setContent('<p>A</p><hr><p>B</p>');editor.commands.selectAll();apply({left:true,top:true,bottom:true,join:true});
  expect(flags()).toEqual([[null,null],[null,null]]);
  const from=editor.state.doc.firstChild!.nodeSize;editor.view.dispatch(editor.state.tr.delete(from,from+editor.state.doc.child(1).nodeSize));
  expect(flags()).toEqual([[null,'true'],['true',null]]);
});
it('retains source edges when grouped HTML is exported and reimported',()=>{
  setup();const original=editor.getJSON(),html=exportHTML('Grouped',editor.getHTML(),original);
  const parsed=new DOMParser().parseFromString(html,'text/html');expect(parsed.querySelectorAll('[data-vdoc-border-prev="true"]')).toHaveLength(2);
  expect(html).toContain('border-top:var(--vdoc-between-border');
  const other=new Editor({extensions:createExtensions(),content:parsed.body.innerHTML});expect(other.getJSON()).toEqual(original);other.destroy();
  const preview=previewSource('Grouped',editor.getHTML(),original);expect(new DOMParser().parseFromString(preview.html,'text/html').querySelectorAll('[data-vdoc-border-next="true"]')).toHaveLength(2);
  expect(parseDocument(JSON.stringify({version:1,title:'Group',content:original})).content).toEqual(original);
});
it.each([true,false])('round-trips joined Word borders with separator enabled=%s',async between=>{
  setup(true,between);const original=editor.getJSON(),data=await bytes(await exportWord(original,'Grouped'));
  const zip=await JSZip.loadAsync(data),xml=await zip.file('word/document.xml')!.async('string');expect(xml).toContain('<w:between');
  const result=await importWord(data);expect(result.warnings).toEqual([]);editor.commands.setContent(result.content);
  expect(editor.state.doc.childCount).toBe(3);for(let i=0;i<3;i++){expect(editor.state.doc.child(i).attrs.paragraphBorders).toEqual(original.content![i].attrs!.paragraphBorders);expect(editor.state.doc.child(i).attrs.paragraphBorderJoin).toBe(true);}
  expect(flags()).toEqual([[null,'true'],['true','true'],['true',null]]);
});
it('validates grouping parameters and new between-edge backup metadata',()=>{
  setup();const before=editor.getJSON();expect(engine.execute({operations:[{type:'paragraph.border',join:'yes'}]}).ok).toBe(false);expect(editor.getJSON()).toEqual(before);
  const invalid=structuredClone(before);invalid.content![0].attrs!.paragraphBorderJoin='yes';expect(()=>parseDocument(JSON.stringify({version:1,title:'Bad',content:invalid}))).toThrow('grouping');
});
