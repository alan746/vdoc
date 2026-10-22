import { expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import JSZip from 'jszip';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
import { prepareWordBlockquotes } from '../lib/infrastructure/word/word-blockquotes';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const bytes=(blob:Blob)=>new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});
const p=(text=''):JSONContent=>({type:'paragraph',...(text?{content:[{type:'text',text}]}:{})});
const q=(...content:JSONContent[]):JSONContent=>({type:'blockquote',content});
const doc=(...content:JSONContent[]):JSONContent=>({type:'doc',content});
const structure=(n:JSONContent):unknown=>({type:n.type,...(n.text?{text:n.text}:{}),...(n.content?.length?{content:n.content.map(structure)}:{})});
async function roundtrip(content:JSONContent) {
  const before=structuredClone(content),buffer=await bytes(await exportWord(content,'Quote QA')),result=await importWord(buffer);
  expect(content).toEqual(before);expect(result.warnings).toEqual([]);
  const output=parseDocument(JSON.stringify({version:1,title:'Quote QA',content:result.content})).content;
  expect(structure(output)).toEqual(structure(content));
  return {content:output,buffer};
}
it('preserves separate adjacent quotes and empty paragraphs across two conversions',async()=>{
  let content=doc(p('Before'),q(p('中文 العربية 👩‍💻'),p('')),q(p('日本語 café कि')),p('After'));
  for(let pass=0;pass<2;pass++)content=(await roundtrip(content)).content;
});
it('preserves nested quote boundaries and surrounding text',async()=>{
  await roundtrip(doc(q(p('Outer'),q(p('Inner'),q(p('Deep'))),p('Outer tail')),p('End')));
});
it('keeps heading, paragraph indentation, RTL, tabs and formatting inside quotes',async()=>{
  const paragraph=p('العربية\t中文');paragraph.attrs={direction:'rtl',indentStart:13,indentEnd:7,firstLineIndent:-4,spaceAfter:21};paragraph.content![0].marks=[{type:'bold'},{type:'underline'}];
  const {content,buffer}=await roundtrip(doc(q({type:'heading',attrs:{level:2},content:[{type:'text',text:'Heading'}]},paragraph)));
  expect(content.content![0].content![1].attrs).toMatchObject(paragraph.attrs!);
  expect(content.content![0].content![1].content![0].marks).toEqual(expect.arrayContaining(paragraph.content![0].marks!));
  const zip=await JSZip.loadAsync(buffer),xml=await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('vdoc:blockquote:v1:list=-1');expect(xml).not.toContain('VDocQuote');
});
it('retains lists inside a quote with their following paragraph',async()=>{
  await roundtrip(doc(q(p('Start'),{type:'orderedList',content:[{type:'listItem',content:[p('One')]},{type:'listItem',content:[p('Two')]}]},p('Tail'))));
});
it.each(['bulletList','orderedList'])('keeps a quote inside a %s item without restarting numbering',async type=>{
  await roundtrip(doc({type,content:[{type:'listItem',content:[p('First'),q(p('Quoted'),p('Quoted tail')),p('First tail')]},{type:'listItem',content:[p('Second')]}]}));
});
const table=():JSONContent=>({type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colspan:2},content:[p('Merged')]}]},{type:'tableRow',content:[{type:'tableCell',content:[p('A')]},{type:'tableCell',content:[p('B')]}]}]});
it('retains a complete merged table inside a quote',async()=>{
  const {content}=await roundtrip(doc(q(p('Before'),table(),p('After'))));
  expect(content.content![0].content![1].content![0].content![0].attrs?.colspan).toBe(2);
});
it('retains a quote inside a merged cell through two conversions',async()=>{
  const grid=table();grid.content![0].content![0].content=[p('Before'),q(p('In cell'),q(p('Nested'))),p('After')];
  let content=doc(grid);for(let pass=0;pass<2;pass++)content=(await roundtrip(content)).content;
});
it('keeps code, divider and manual page break within quote boundaries',async()=>{
  await roundtrip(doc(q(p('Before'),{type:'codeBlock',content:[{type:'text',text:'\tcode()\n'}]},{type:'horizontalRule'},{type:'pageBreak'},p('After'))));
});
it('retains links and multiline footnotes inside a quote',async()=>{
  const source=p('Link');source.content![0].marks=[{type:'link',attrs:{href:'https://example.com'}}];source.content!.push({type:'footnote',attrs:{number:1,text:'Line 1\n第二行'}});
  const {content}=await roundtrip(doc(q(source)));
  expect(content.content![0].content![0].content![0].marks).toContainEqual(expect.objectContaining({type:'link',attrs:expect.objectContaining({href:'https://example.com'})}));
  expect(content.content![0].content![0].content![1].attrs?.text).toBe('Line 1\n第二行');
});
it('imports current Word edits within the quote rather than a stale source snapshot',async()=>{
  const buffer=await bytes(await exportWord(doc(q(p('Original 中文'))),'Edit QA')),zip=await JSZip.loadAsync(buffer);
  const xml=(await zip.file('word/document.xml')!.async('string')).replace('Original 中文','Edited العربية');zip.file('word/document.xml',xml);
  const result=await importWord(await zip.generateAsync({type:'arraybuffer'}));
  expect(result.warnings).toEqual([]);expect(structure(result.content)).toEqual(structure(doc(q(p('Edited العربية')))));
});
it('ignores unrecognised content control tags while keeping their content',async()=>{
  const buffer=await bytes(await exportWord(doc(q(p('Keep this text'))),'Tag QA')),zip=await JSZip.loadAsync(buffer);
  zip.file('word/document.xml',(await zip.file('word/document.xml')!.async('string')).replace('vdoc:blockquote:v1:list=-1','external:custom-control'));
  const result=await importWord(await zip.generateAsync({type:'arraybuffer'}));
  expect(structure(result.content)).toEqual(structure(doc(p('Keep this text'))));
});
it('preserves content and warns if converted quote boundaries cannot be paired',async()=>{
  const prepared=await prepareWordBlockquotes(await bytes(await exportWord(doc(q(p('Do not lose'))),'Boundary QA')));
  const html=new DOMParser().parseFromString('<p>Do not lose</p>','text/html'),warnings:string[]=[];
  prepared.restore(html,warnings);
  expect(html.body.textContent).toBe('Do not lose');expect(warnings).toHaveLength(1);expect(warnings[0]).toContain('grouping needs review');
});
