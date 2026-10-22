import { expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import JSZip from 'jszip';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));

const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob);
});
const text = (value: string, code = false): JSONContent => ({type:'text',text:value,...(code ? {marks:[{type:'code'}]} : {})});
const p = (...content: JSONContent[]): JSONContent => ({type:'paragraph',content});
const codeText = '变量\tالعربية 👩‍💻 café कि <x>';
const all = (node: JSONContent): JSONContent[] => [node,...(node.content || []).flatMap(all)];
const codeValues = (node: JSONContent) => all(node).filter(n=>n.marks?.some(m=>m.type==='code')).map(n=>n.text);
async function roundtrip(content: JSONContent) {
  const before=structuredClone(content), buffer=await bytes(await exportWord(content,'Inline code QA'));
  const imported=await importWord(buffer);
  expect(imported.warnings).toEqual([]); expect(content).toEqual(before);
  return {buffer,content:parseDocument(JSON.stringify({version:1,title:'Inline code QA',content:imported.content})).content};
}

it('preserves inline code and tabs without marking surrounding formatted text', async () => {
  const before=text('Before '); before.marks=[{type:'bold'}];
  const after=text(' After'); after.marks=[{type:'italic'}];
  const {content,buffer}=await roundtrip({type:'doc',content:[p(before,text(codeText,true),after)]});
  expect(codeValues(content)).toEqual([codeText]);
  const runs=content.content![0].content!;
  expect(runs[0].marks).toContainEqual({type:'bold'}); expect(runs[2].marks).toContainEqual({type:'italic'});
  const zip=await JSZip.loadAsync(buffer), xml=new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'),'application/xml');
  expect(Array.from(xml.getElementsByTagName('w:tab')).filter(node=>node.parentElement?.localName==='r')).toHaveLength(1);
  expect(xml.getElementsByTagName('w:rStyle')[0]?.getAttribute('w:val')).toBe('VDocInlineCode');
});
it('keeps repeated code/plain/code boundaries around a hard break', async () => {
  const {content}=await roundtrip({type:'doc',content:[p(text('Same',true),text('Same'),{type:'hardBreak'},text('Same',true))]});
  expect(codeValues(content)).toEqual(['Same','Same']);
  expect(content.content![0].content!.map(n=>n.type)).toEqual(['text','text','hardBreak','text']);
  expect(content.content![0].content![1].marks?.some(m=>m.type==='code')).not.toBe(true);
});
it('preserves code in headings and nested list paragraphs', async () => {
  const {content}=await roundtrip({type:'doc',content:[{type:'heading',attrs:{level:2},content:[text('Heading '),text('code()',true)]},{type:'bulletList',content:[{type:'listItem',content:[p(text('List '),text(codeText,true)),{type:'orderedList',content:[{type:'listItem',content:[p(text('nested()',true))]}]}]}]}]});
  expect(codeValues(content)).toEqual(['code()',codeText,'nested()']);
  expect(all(content).filter(n=>n.type==='listItem')).toHaveLength(2);
  expect(content.content![0].type).toBe('heading');
});
it('retains code in merged cells through two actual Word conversions', async () => {
  let content: JSONContent={type:'doc',content:[{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colspan:2},content:[p(text('Before '),text(codeText,true),text(' After'))]}]},{type:'tableRow',content:[{type:'tableCell',content:[p(text('A'))]},{type:'tableCell',content:[p(text('B'))]}]}]}]};
  for(let pass=0;pass<2;pass++) { content=(await roundtrip(content)).content; expect(codeValues(content)).toEqual([codeText]); expect(content.content![0].content![0].content![0].attrs?.colspan).toBe(2); }
});
it('does not reinterpret ordinary monospace text as inline code', async () => {
  const plain=text('Courier plain'); plain.marks=[{type:'textStyle',attrs:{fontFamily:'Courier New'}}];
  const {content}=await roundtrip({type:'doc',content:[p(plain,text(' code()',true))]});
  expect(codeValues(content)).toEqual([' code()']);
  expect(content.content![0].content![0].marks).toContainEqual(expect.objectContaining({type:'textStyle',attrs:expect.objectContaining({fontFamily:'Courier New'})}));
});
it('keeps block code and inline code distinct in the same document', async () => {
  const {content}=await roundtrip({type:'doc',content:[{type:'codeBlock',content:[text('\tblock()\n\n')]},p(text('inline()',true))]});
  expect(content.content!.map(n=>n.type)).toEqual(['codeBlock','paragraph']);
  expect(codeValues(content)).toEqual(['inline()']);
  expect(content.content![0].content![0].text).toBe('\tblock()\n\n');
});
