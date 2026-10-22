import { expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
import * as d from 'docx';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const bytes=(blob:Blob)=>new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});
const p=(text=''):JSONContent=>({type:'paragraph',...(text?{content:[{type:'text',text}]}:{})});
const rule=():JSONContent=>({type:'horizontalRule'});
async function roundtrip(content:JSONContent) {
  const before=structuredClone(content),result=await importWord(await bytes(await exportWord(content,'Divider QA')));
  expect(result.warnings).toEqual([]);expect(content).toEqual(before);
  return parseDocument(JSON.stringify({version:1,title:'Divider QA',content:result.content})).content;
}
it('preserves leading, adjacent and trailing dividers without adding empty paragraphs',async()=>{
  const content=await roundtrip({type:'doc',content:[rule(),p('中文 العربية 👩‍💻'),rule(),rule(),p('日本語 café कि'),rule()]});
  expect(content.content!.map(n=>n.type)).toEqual(['horizontalRule','paragraph','horizontalRule','horizontalRule','paragraph','horizontalRule']);
  expect(content.content![1].content![0].text).toBe('中文 العربية 👩‍💻');
  expect(content.content![4].content![0].text).toBe('日本語 café कि');
});
it('keeps the following empty paragraph layout instead of assigning divider borders to it',async()=>{
  const empty=p();empty.attrs={spaceAfter:29,textAlign:'right'};
  const content=await roundtrip({type:'doc',content:[rule(),empty,p('After')]});
  expect(content.content!.map(n=>n.type)).toEqual(['horizontalRule','paragraph','paragraph']);
  expect(content.content![1].attrs).toMatchObject({spaceAfter:29,textAlign:'right',paragraphBorders:null});
});
it.each(['bulletList','orderedList'])('retains dividers and following continuation text inside %s items',async type=>{
  let content:JSONContent={type:'doc',content:[{type,content:[{type:'listItem',content:[p('First'),rule(),p('Still first')]},{type:'listItem',content:[p('Second')]}]}]};
  for(let pass=0;pass<2;pass++) {
    content=await roundtrip(content);
    expect(content.content).toHaveLength(1);expect(content.content![0].type).toBe(type);
    expect(content.content![0].content).toHaveLength(2);
    expect(content.content![0].content![0].content!.map(n=>n.type)).toEqual(['paragraph','horizontalRule','paragraph']);
    expect(content.content![0].content![0].content![2].content![0].text).toBe('Still first');
  }
});
it('preserves a divider inside a merged table across two Word round trips',async()=>{
  let content:JSONContent={type:'doc',content:[{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colspan:2},content:[p('Before'),rule(),p('After')]}]},{type:'tableRow',content:[{type:'tableCell',content:[p('A')]},{type:'tableCell',content:[p('B')]}]}]}]};
  for(let pass=0;pass<2;pass++) {content=await roundtrip(content);const cell=content.content![0].content![0].content![0];expect(cell.attrs?.colspan).toBe(2);expect(cell.content!.map(n=>n.type)).toEqual(['paragraph','horizontalRule','paragraph']);}
});
it('keeps a divider within a nested list without moving the outer continuation',async()=>{
  const content=await roundtrip({type:'doc',content:[{type:'bulletList',content:[{type:'listItem',content:[p('Outer'),{type:'orderedList',content:[{type:'listItem',content:[p('Inner'),rule(),p('Inner tail')]}]},p('Outer tail')]}]}]});
  const outer=content.content![0].content![0];
  expect(outer.content!.map(n=>n.type)).toEqual(['paragraph','orderedList','paragraph']);
  expect(outer.content![1].content![0].content!.map(n=>n.type)).toEqual(['paragraph','horizontalRule','paragraph']);
  expect(outer.content![2].content![0].text).toBe('Outer tail');
});
it('keeps dividers distinct from adjacent page breaks through repeated conversion',async()=>{
  let content:JSONContent={type:'doc',content:[p('Before'),rule(),{type:'pageBreak'},rule(),p('After')]};
  for(let pass=0;pass<2;pass++) {content=await roundtrip(content);expect(content.content!.map(n=>n.type)).toEqual(['paragraph','horizontalRule','pageBreak','horizontalRule','paragraph']);}
});
it('does not reinterpret ordinary bordered paragraphs as dividers',async()=>{
  const file=new d.Document({sections:[{children:[new d.Paragraph({border:{bottom:{style:d.BorderStyle.SINGLE,color:'DCE3ED',size:6}}}),new d.Paragraph({text:'Keep text',border:{bottom:{style:d.BorderStyle.SINGLE,color:'DCE3ED',size:6}}})]}]});
  const result=await importWord(await bytes(await d.Packer.toBlob(file)));
  expect(result.content.content!.map(n=>n.type)).toEqual(['paragraph','paragraph']);
  expect(result.content.content![0].attrs?.paragraphBorders?.bottom).toBeDefined();
  expect(result.content.content![1].content![0].text).toBe('Keep text');
});
it('preserves text added externally to a divider-styled paragraph',async()=>{
  const file=new d.Document({styles:{paragraphStyles:[{id:'VDocDivider',name:'VDoc Divider'}]},sections:[{children:[new d.Paragraph({style:'VDocDivider',text:'Do not discard 中文'})]}]});
  const result=await importWord(await bytes(await d.Packer.toBlob(file)));
  expect(result.warnings).toEqual([]);expect(result.content.content![0].type).toBe('paragraph');
  expect(result.content.content![0].content![0].text).toBe('Do not discard 中文');
});
