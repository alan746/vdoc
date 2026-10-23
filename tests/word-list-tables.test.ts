import { expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import JSZip from 'jszip';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { parseDocument } from '../lib/infrastructure/persistence/document-codec';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));

const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader=new FileReader(); reader.onload=()=>resolve(reader.result as ArrayBuffer);
  reader.onerror=reject; reader.readAsArrayBuffer(blob);
});
const p=(text:string):JSONContent=>({type:'paragraph',content:[{type:'text',text}]});
const item=(...content:JSONContent[]):JSONContent=>({type:'listItem',content});
const doc=(...content:JSONContent[]):JSONContent=>({type:'doc',content});
const table=():JSONContent=>({type:'table',content:[
  {type:'tableRow',content:[{type:'tableCell',attrs:{colspan:2},content:[p('Merged 中文 العربية')]}]},
  {type:'tableRow',content:[{type:'tableCell',content:[p('A 日本語')]},{type:'tableCell',content:[p('B 👩‍💻 café कि')]}]},
]});
const shape=(node:JSONContent):unknown=>({type:node.type,...(node.text?{text:node.text}:{}),...(['tableCell','tableHeader'].includes(node.type||'')?{span:[node.attrs?.colspan||1,node.attrs?.rowspan||1]}:{}),...(node.content?.length?{content:node.content.map(shape)}:{})});
async function roundtrip(source:JSONContent) {
  const before=structuredClone(source),buffer=await bytes(await exportWord(source,'List table QA'));
  const result=await importWord(buffer);expect(source).toEqual(before);expect(result.warnings).toEqual([]);
  const content=parseDocument(JSON.stringify({version:1,title:'List table QA',content:result.content})).content;
  expect(shape(content)).toEqual(shape(source));return {content,buffer};
}

it.each(['bulletList','orderedList'])('retains a merged table and continuation in one %s item through two conversions',async type=>{
  let content=doc({type,content:[item(p('First'),table(),p('Same item tail')),item(p('Next'))]});
  for(let pass=0;pass<2;pass++)content=(await roundtrip(content)).content;
});
it('retains adjacent tables without extra paragraphs or list items',async()=>{
  await roundtrip(doc({type:'bulletList',content:[item(p('Before'),table(),table(),p('After'))]}));
});
it('keeps a table within a nested list and preserves both continuation levels',async()=>{
  await roundtrip(doc({type:'orderedList',content:[item(p('Outer'),{type:'bulletList',content:[item(p('Inner'),table(),p('Inner tail'))]},p('Outer tail')),item(p('Next'))]}));
});
it('keeps tables within quotes in lists and lists within quotes',async()=>{
  await roundtrip(doc({type:'orderedList',content:[item(p('Before'),{type:'blockquote',content:[p('Quote'),table(),p('Quote tail')]},p('After'))]},
    {type:'blockquote',content:[p('Outer quote'),{type:'bulletList',content:[item(p('Item'),table(),p('Tail'))]}]}));
});
it('retains a table in a list inside an outer merged cell and isolates inner lists',async()=>{
  const inner=table();inner.content![0].content![0].content=[p('Inner merged'),{type:'bulletList',content:[item(p('Cell list'))]}];
  const outer=table();outer.content![0].content![0].content=[p('Outer merged'),{type:'orderedList',content:[item(p('Item'),inner,p('Item tail'))]},p('Outer tail')];
  await roundtrip(doc(outer));
});
it('preserves Roman markers and continued numbering across a table and manual page break',async()=>{
  const attrs={start:7,type:'I',numberPrefix:'(',numberSuffix:')'};
  const {content}=await roundtrip(doc({type:'orderedList',attrs,content:[item(p('Seven'),table(),{type:'pageBreak'},p('Seven tail')),item(p('Eight'))]},p('Between'),{type:'orderedList',attrs:{...attrs,start:9,continuePrevious:true},content:[item(p('Nine'))]}));
  expect(content.content![0].attrs).toMatchObject(attrs);
  expect(content.content![2].attrs).toMatchObject({...attrs,start:9,continuePrevious:true});
});
it('keeps the imported table editable and restores exact data with undo/redo',async()=>{
  const {content}=await roundtrip(doc({type:'bulletList',content:[item(p('Before'),table(),p('After'))]}));
  const editor=new Editor({extensions:createExtensions(),content}),engine=new DocumentEngine(editor);
  try {
    await new Promise(resolve=>setTimeout(resolve,0));
    const before=editor.getJSON();const tableId=engine.snapshot().blocks.find(block=>block.type==='table')!.id;
    expect(engine.execute({target:{kind:'cells',tableId,row:1,col:0,endRow:1,endCol:1},operations:[{type:'table.edit',action:'merge'}]}).ok).toBe(true);
    const after:JSONContent=editor.getJSON();expect(after.content![0].content![0].content![1].content![1].content).toHaveLength(1);
    expect(engine.history('undo').ok).toBe(true);expect(editor.getJSON()).toEqual(before);
    expect(engine.history('redo').ok).toBe(true);expect(editor.getJSON()).toEqual(after);
    await roundtrip(after);
  } finally {engine.destroy();editor.destroy();}
});
it('imports current external table text rather than a stored snapshot',async()=>{
  const {buffer}=await roundtrip(doc({type:'orderedList',content:[item(p('Before'),table(),p('After'))]}));
  const zip=await JSZip.loadAsync(buffer);
  zip.file('word/document.xml',(await zip.file('word/document.xml')!.async('string')).replace('Merged 中文 العربية','Edited 日本語 العربية'));
  const result=await importWord(await zip.generateAsync({type:'arraybuffer'}));
  expect(result.warnings).toEqual([]);
  expect(JSON.stringify(result.content)).toContain('Edited 日本語 العربية');
  expect(JSON.stringify(result.content)).not.toContain('Merged 中文 العربية');
  expect(result.content.content![0].content![0].content!.map(n=>n.type)).toEqual(['paragraph','table','paragraph']);
});
