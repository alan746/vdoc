import { expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import JSZip from 'jszip';
import { exportWord, importWord } from '../lib/editor/word';
import { parseDocument } from '../lib/editor/storage';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));

const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = reject; reader.readAsArrayBuffer(blob);
});
const code = (text: string): JSONContent => ({type:'codeBlock', ...(text ? {content:[{type:'text',text}]} : {})});
const paragraph = (text: string): JSONContent => ({type:'paragraph', content:[{type:'text',text}]});
async function roundtrip(content: JSONContent) {
  const before = structuredClone(content), buffer = await bytes(await exportWord(content, 'Code QA'));
  const zip = await JSZip.loadAsync(buffer);
  const xml = new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'), 'application/xml');
  const imported = await importWord(buffer);
  expect(content).toEqual(before);
  expect(imported.warnings).toEqual([]);
  return {xml, content:parseDocument(JSON.stringify({version:1,title:'Code QA',content:imported.content})).content};
}
const textOf = (node: JSONContent): string => node.text || (node.content || []).map(textOf).join('');

it.each(['\n','\r\n','\r'])('preserves code lines, indentation and multilingual text with %j input breaks', async newline => {
  const lines = ['', '\tif 中文 < 3:', '  print("العربية 👩‍💻 café कि")', '', '\t\treturn 日本語', ''];
  const {xml,content} = await roundtrip({type:'doc',content:[code(lines.join(newline))]});
  expect(xml.getElementsByTagName('parsererror')).toHaveLength(0);
  expect(xml.getElementsByTagName('w:cr')).toHaveLength(5);
  expect(xml.getElementsByTagName('w:tab')).toHaveLength(3);
  expect(content.content).toHaveLength(1);
  expect(content.content![0].type).toBe('codeBlock');
  expect(textOf(content.content![0])).toBe(lines.join('\n'));
});
it('retains an empty editable code block between normal paragraphs', async () => {
  const {content} = await roundtrip({type:'doc',content:[paragraph('Before'),code(''),paragraph('After')]});
  expect(content.content!.map(node => node.type)).toEqual(['paragraph','codeBlock','paragraph']);
  expect(content.content!.map(textOf)).toEqual(['Before','','After']);
});
it('does not steal formatting from a following paragraph with identical text', async () => {
  const following = paragraph('Same 中文'); following.attrs = {spaceAfter:23}; following.content![0].marks=[{type:'bold'}];
  const {content} = await roundtrip({type:'doc',content:[code('Same 中文'),following]});
  expect(content.content!.map(node=>node.type)).toEqual(['codeBlock','paragraph']);
  expect(content.content![1].attrs?.spaceAfter).toBe(23);
  expect(content.content![1].content![0].marks).toContainEqual({type:'bold'});
});
it('keeps a code block inside a merged table cell through two Word round trips', async () => {
  const value='\t中文\n\n  العربية 👩‍💻\n';
  let content: JSONContent = {type:'doc',content:[{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colspan:2},content:[paragraph('Before code'),code(value),paragraph('After code')]}]},{type:'tableRow',content:[{type:'tableCell',content:[paragraph('A')]},{type:'tableCell',content:[paragraph('B')]}]}]}]};
  for(let pass=0;pass<2;pass++) {
    content=(await roundtrip(content)).content;
    const cell=content.content![0].content![0].content![0];
    expect(cell.attrs?.colspan).toBe(2);
    expect(cell.content!.map(node=>node.type)).toEqual(['paragraph','codeBlock','paragraph']);
    expect(cell.content!.map(textOf)).toEqual(['Before code',value,'After code']);
  }
});
