import { expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { parseDocument } from '../lib/infrastructure/persistence/document-codec';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
const bytes=(blob:Blob)=>new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);});
const p=(text=''):JSONContent=>({type:'paragraph',...(text?{content:[{type:'text',text}]}:{})});
const item=(...content:JSONContent[]):JSONContent=>({type:'listItem',content});
const doc=(...content:JSONContent[]):JSONContent=>({type:'doc',content});
const numbered=(...content:JSONContent[]):JSONContent=>({type:'orderedList',attrs:{start:7,type:'I',numberPrefix:'(',numberSuffix:')'},content});
const shape=(n:JSONContent):unknown=>({type:n.type,...(n.text!==undefined?{text:n.text}:{}),...(n.content?.length?{content:n.content.map(shape)}:{})});
const markers=(n:JSONContent):unknown[]=>[...(n.type==='orderedList'?[{start:n.attrs?.start??1,type:n.attrs?.type??null,prefix:n.attrs?.numberPrefix??'',suffix:n.attrs?.numberSuffix??'.',continued:n.attrs?.continuePrevious??false}]:n.type==='bulletList'?[{bullet:n.attrs?.bulletText??null,style:n.attrs?.bulletStyle??'disc'}]:[]),...(n.content||[]).flatMap(markers)];
async function roundtrip(source:JSONContent) {
  const before=structuredClone(source),result=await importWord(await bytes(await exportWord(source,'Empty list QA')));
  expect(source).toEqual(before);expect(result.warnings).toEqual([]);
  const content=parseDocument(JSON.stringify({version:1,title:'Empty list QA',content:result.content})).content;
  expect(shape(content)).toEqual(shape(source));expect(markers(content)).toEqual(markers(source));return content;
}
it.each(['first','middle','last'])('keeps an empty %s numbered item and its custom numbering through two conversions',async where=>{
  const entries=[item(p('中文')),item(p('العربية'))];entries.splice(where==='first'?0:where==='middle'?1:2,0,item(p()));
  let content=doc(numbered(...entries));for(let pass=0;pass<2;pass++)content=await roundtrip(content);
});
it('preserves consecutive empty numbered items and a later continued series',async()=>{
  const continued=numbered(item(p()),item(p('Ten')));continued.attrs={...continued.attrs,start:9,continuePrevious:true};
  await roundtrip(doc(numbered(item(p()),item(p())),p('Between'),continued));
});
it('preserves adjacent different bullet lists with empty leading items',async()=>{
  await roundtrip(doc({type:'bulletList',attrs:{bulletStyle:'circle'},content:[item(p()),item(p('Same'))]},
    {type:'bulletList',attrs:{bulletText:'👩🏽‍💻'},content:[item(p()),item(p('Same'))]}));
});
it('keeps empty parent items containing nested lists with empty items',async()=>{
  await roundtrip(doc(numbered(item(p(),{type:'bulletList',attrs:{bulletStyle:'square'},content:[item(p()),item(p('Nested'))]}),item(p('Parent tail')))));
});
it('keeps empty items inside a merged cell and quote isolated from surrounding numbering',async()=>{
  const list=()=>numbered(item(p()),item(p('Same')));
  await roundtrip(doc({type:'blockquote',content:[list()]},{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colspan:2},content:[list()]}]},{type:'tableRow',content:[{type:'tableCell',content:[p('A')]},{type:'tableCell',content:[p('B')]}]}]}));
});
it('keeps whitespace-only item text and its position in numbering',async()=>{
  await roundtrip(doc(numbered(item(p('  ')),item(p('\t')),item(p('Text')))));
});
it('preserves an empty numbered paragraph before continuation text in the same item',async()=>{
  await roundtrip(doc(numbered(item(p(),p('Still seventh'),p()),item(p('Eight')))));
});
it('keeps empty item paragraphs around a code block and divider',async()=>{
  await roundtrip(doc(numbered(item(p(),{type:'codeBlock',content:[{type:'text',text:'code()\n'}]},p(),{type:'horizontalRule'},p('Tail')),item(p('Eight')))));
});
it.each([6,9])('retains empty parent items through %i supported Word list levels',async levels=>{
  let nested=numbered(item(p()),item(p('Deep 日本語')));
  for(let level=1;level<levels;level++)nested=numbered(item(p(),nested),item(p(`Tail ${level}`)));
  await roundtrip(doc(nested));
});
it('imports ordinary external Word empty items without VDoc-specific styles',async()=>{
  const d=await import('docx');
  const file=new d.Document({numbering:{config:[{reference:'external',levels:[{level:0,format:d.LevelFormat.UPPER_ROMAN,text:'(%1)',start:7}]}]},sections:[{children:[
    new d.Paragraph({numbering:{reference:'external',level:0}}),
    new d.Paragraph({text:'中文 العربية',numbering:{reference:'external',level:0}}),
    new d.Paragraph({numbering:{reference:'external',level:0}}),
  ]}]});
  const result=await importWord(await bytes(await d.Packer.toBlob(file)));
  expect(result.warnings).toEqual([]);
  expect(shape(result.content)).toEqual(shape(doc(numbered(item(p()),item(p('中文 العربية')),item(p())))));
  expect(markers(result.content)).toEqual(markers(doc(numbered())));
});
