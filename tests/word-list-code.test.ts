import { expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const bytes=(blob:Blob)=>new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});
const p=(text:string):JSONContent=>({type:'paragraph',content:[{type:'text',text}]});
const code=(text='\t中文 العربية 👩‍💻 café कि\n\n  日本語\n'):JSONContent=>({type:'codeBlock',...(text?{content:[{type:'text',text}]}:{})});
const item=(...content:JSONContent[]):JSONContent=>({type:'listItem',content});
const doc=(...content:JSONContent[]):JSONContent=>({type:'doc',content});
const shape=(n:JSONContent):unknown=>({type:n.type,...(n.text?{text:n.text}:{}),...(n.content?.length?{content:n.content.map(shape)}:{})});
async function roundtrip(source:JSONContent) {
  const before=structuredClone(source),result=await importWord(await bytes(await exportWord(source,'List code QA')));
  expect(source).toEqual(before);expect(result.warnings).toEqual([]);
  const content=parseDocument(JSON.stringify({version:1,title:'List code QA',content:result.content})).content;
  expect(shape(content)).toEqual(shape(source));return content;
}
it.each(['bulletList','orderedList'])('keeps code and continuation text in the same %s item through two conversions',async type=>{
  let content=doc({type,content:[item(p('First'),code(),p('Still first')),item(p('Second'))]});
  for(let pass=0;pass<2;pass++)content=await roundtrip(content);
});
it('preserves the numbered start, Roman style and custom marker around code',async()=>{
  const attrs={start:7,type:'I',numberPrefix:'(',numberSuffix:')'};
  const content=await roundtrip(doc({type:'orderedList',attrs,content:[item(p('Seven'),code(),p('Tail')),item(p('Eight'))]}));
  expect(content.content![0].attrs).toMatchObject(attrs);
});
it('keeps nested code and both inner and outer continuation paragraphs',async()=>{
  await roundtrip(doc({type:'bulletList',content:[item(p('Outer'),{type:'orderedList',attrs:{start:4},content:[item(p('Inner'),code(),p('Inner tail'))]},p('Outer tail'))]}));
});
it('retains adjacent empty and nonempty code blocks within a list',async()=>{
  await roundtrip(doc({type:'bulletList',content:[item(p('Before'),code(''),code('next()\n'),p('After'))]}));
});
it('preserves code in a quote nested in a list and a list nested in a quote',async()=>{
  await roundtrip(doc({type:'orderedList',content:[item(p('Item'),{type:'blockquote',content:[p('Quote'),code(),p('Quote tail')]},p('Item tail'))]},
    {type:'blockquote',content:[p('Outer quote'),{type:'bulletList',content:[item(p('Nested list'),code(),p('Nested tail'))]}]}));
});
it('keeps list code inside a merged cell',async()=>{
  const content=await roundtrip(doc({type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colspan:2},content:[{type:'orderedList',content:[item(p('First'),code(),p('Tail')),item(p('Second'))]}]}]},{type:'tableRow',content:[{type:'tableCell',content:[p('A')]},{type:'tableCell',content:[p('B')]}]}]}));
  expect(content.content![0].content![0].content![0].attrs?.colspan).toBe(2);
});
it('keeps later continued numbering after a code-containing list',async()=>{
  const attrs={start:4,type:'a',numberPrefix:'[',numberSuffix:']'};
  const content=await roundtrip(doc({type:'orderedList',attrs,content:[item(p('Four'),code()),item(p('Five'))]},p('Between'),{type:'orderedList',attrs:{...attrs,start:6,continuePrevious:true},content:[item(p('Six'))]}));
  expect(content.content![0].attrs).toMatchObject(attrs);
  expect(content.content![2].attrs).toMatchObject({...attrs,start:6,continuePrevious:true});
});
it.each(['bulletList','orderedList'])('keeps a manual page break within the same %s item',async type=>{
  let content=doc({type,content:[item(p('Before'),{type:'pageBreak'},p('After')),item(p('Second'))]});
  for(let pass=0;pass<2;pass++)content=await roundtrip(content);
});
it('preserves code, consecutive page breaks and continuation in a nested list',async()=>{
  await roundtrip(doc({type:'orderedList',content:[item(p('Outer'),{type:'bulletList',content:[item(p('Inner'),code(),{type:'pageBreak'},{type:'pageBreak'},p('Inner tail'))]},p('Outer tail'))]}));
});
it('keeps a page break inside a quote within a list',async()=>{
  await roundtrip(doc({type:'orderedList',content:[item(p('Item'),{type:'blockquote',content:[p('Quote'),{type:'pageBreak'},p('Quote tail')]},p('Item tail')),item(p('Next'))]}));
});
it('retains later continued numbering when a list item contains a page break',async()=>{
  const attrs={start:7,type:'I',numberPrefix:'(',numberSuffix:')'};
  const content=await roundtrip(doc({type:'orderedList',attrs,content:[item(p('Seven'),{type:'pageBreak'},p('Seven tail')),item(p('Eight'))]},p('Between'),{type:'orderedList',attrs:{...attrs,start:9,continuePrevious:true},content:[item(p('Nine'))]}));
  expect(content.content![0].attrs).toMatchObject(attrs);
  expect(content.content![2].attrs).toMatchObject({...attrs,start:9,continuePrevious:true});
});
