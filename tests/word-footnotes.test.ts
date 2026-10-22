import { expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import * as d from 'docx';
import JSZip from 'jszip';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve,reject) => {
  const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);
});
const note=(text:string,number=1):JSONContent=>({type:'footnote',attrs:{text,number}});
const p=(...content:JSONContent[]):JSONContent=>({type:'paragraph',content});
const text=(text:string):JSONContent=>({type:'text',text});
const notes=(node:JSONContent):string[]=>[...(node.type==='footnote'?[node.attrs!.text]:[]),...(node.content||[]).flatMap(notes)];
async function roundtrip(content:JSONContent) {
  const before=structuredClone(content),buffer=await bytes(await exportWord(content,'Footnote QA'));
  const imported=await importWord(buffer);
  expect(content).toEqual(before);expect(imported.warnings).toEqual([]);
  return {buffer,content:parseDocument(JSON.stringify({version:1,title:'Footnote QA',content:imported.content})).content};
}
it.each(['\n','\r\n','\r'])('preserves multiline footnotes, blank lines and tabs with %j breaks',async newline=>{
  const lines=['','\t中文 العربية 👩‍💻 café कि','','  日本語 <tag> & text',''];
  const {content,buffer}=await roundtrip({type:'doc',content:[p(text('Before'),note(lines.join(newline)),text('After'))]});
  expect(notes(content)).toEqual([lines.join('\n')]);
  expect(content.content![0].content!.map(n=>n.type)).toEqual(['text','footnote','text']);
  const zip=await JSZip.loadAsync(buffer),xml=new DOMParser().parseFromString(await zip.file('word/footnotes.xml')!.async('string'),'application/xml');
  expect(xml.getElementsByTagName('w:tab')).toHaveLength(1);
  expect(xml.getElementsByTagName('w:cr')).toHaveLength(4);
});
it('retains user whitespace and arrow characters without a generated backlink',async()=>{
  const value='  Keep ↑ and trailing spaces  ';
  const {content}=await roundtrip({type:'doc',content:[p(note(value))]});
  expect(notes(content)).toEqual([value]);
});
it('keeps an empty note without absorbing the next note',async()=>{
  const {content}=await roundtrip({type:'doc',content:[p(note('',1),text('Between'),note('Second 中文',2))]});
  expect(notes(content)).toEqual(['','Second 中文']);
});
it('preserves separate external Word note paragraphs including an empty middle paragraph',async()=>{
  const file=new d.Document({footnotes:{1:{children:[new d.Paragraph('First 中文'),new d.Paragraph(''),new d.Paragraph('Last العربية')]}},sections:[{children:[new d.Paragraph({children:[new d.TextRun('Body'),new d.FootnoteReferenceRun(1)]})]}]});
  const result=await importWord(await bytes(await d.Packer.toBlob(file)));
  expect(notes(result.content)).toEqual(['First 中文\n\nLast العربية']);
});
it('reads external line breaks and carriage returns inside formatted footnote runs',async()=>{
  const file=new d.Document({footnotes:{1:{children:[new d.Paragraph({children:[new d.TextRun({children:['First',new d.CarriageReturn(),'第二行',new d.Tab(),'العربية'],bold:true}),new d.TextRun({break:1,text:'Last'})]})]}},sections:[{children:[new d.Paragraph({children:[new d.FootnoteReferenceRun(1)]})]}]});
  const buffer=await bytes(await d.Packer.toBlob(file)),before=new Uint8Array(buffer).slice();
  const result=await importWord(buffer);
  expect(notes(result.content)).toEqual(['First\n第二行\tالعربية\nLast']);
  expect(new Uint8Array(buffer)).toEqual(before);
});
it('retains note text in lists and tables as separate plain-text lines and columns',async()=>{
  // The docx package's note API accepts only paragraphs. Move a real generated
  // table into footnotes.xml to represent a valid external Word note instead.
  const file=new d.Document({footnotes:{1:{children:[new d.Paragraph('Before'),new d.Paragraph({text:'Listed 中文',bullet:{level:0}})]}},sections:[{children:[new d.Paragraph({children:[new d.FootnoteReferenceRun(1)]}),new d.Table({rows:[new d.TableRow({children:[new d.TableCell({children:[new d.Paragraph('Left')]}),new d.TableCell({children:[new d.Paragraph('Right العربية')]})]})]})]}]});
  const zip=await JSZip.loadAsync(await bytes(await d.Packer.toBlob(file))),ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const body=new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'),'application/xml');
  const footnotes=new DOMParser().parseFromString(await zip.file('word/footnotes.xml')!.async('string'),'application/xml');
  const table=body.getElementsByTagNameNS(ns,'tbl')[0];
  Array.from(footnotes.getElementsByTagNameNS(ns,'footnote')).find(n=>n.getAttributeNS(ns,'id')==='1')!.appendChild(table.cloneNode(true));table.remove();
  zip.file('word/document.xml',new XMLSerializer().serializeToString(body));zip.file('word/footnotes.xml',new XMLSerializer().serializeToString(footnotes));
  const result=await importWord(await zip.generateAsync({type:'arraybuffer'}));
  expect(notes(result.content)).toEqual(['Before\nListed 中文\nLeft\tRight العربية']);
});
it('retains external leading and trailing empty note paragraphs',async()=>{
  const file=new d.Document({footnotes:{1:{children:[new d.Paragraph(''),new d.Paragraph('Middle'),new d.Paragraph('')]}},sections:[{children:[new d.Paragraph({children:[new d.FootnoteReferenceRun(1)]})]}]});
  const result=await importWord(await bytes(await d.Packer.toBlob(file)));
  expect(notes(result.content)).toEqual(['\nMiddle\n']);
});
it('keeps distinct multiline notes in body and merged cells through two Word round trips',async()=>{
  let content:JSONContent={type:'doc',content:[p(text('Body'),note('Body\nNote',1)),{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colspan:2},content:[p(text('Merged'),note('\tCell\n\nNote\n',2))]}]},{type:'tableRow',content:[{type:'tableCell',content:[p(text('A'))]},{type:'tableCell',content:[p(text('B'))]}]}]}]};
  for(let pass=0;pass<2;pass++) {content=(await roundtrip(content)).content;expect(notes(content)).toEqual(['Body\nNote','\tCell\n\nNote\n']);expect(content.content![1].content![0].content![0].attrs?.colspan).toBe(2);}
});
