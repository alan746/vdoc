import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import JSZip from 'jszip';
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6x8AAAAASUVORK5CYII=';
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.onerror = reject; reader.readAsArrayBuffer(blob);
});
const p = (text: string): JSONContent => ({type:'paragraph',content:[{type:'text',text}]});
const image = (alt = '图片 العربية 👩‍💻 café कि'): JSONContent => ({type:'image',attrs:{src:png,width:180,height:90,alt}});
const item = (...content: JSONContent[]): JSONContent => ({type:'listItem',content});
const doc = (...content: JSONContent[]): JSONContent => ({type:'doc',content});
const shape = (node: JSONContent): unknown => ({type:node.type,...(node.text ? {text:node.text} : {}),...(node.type === 'image' ? {image:node.attrs && {src:node.attrs.src,width:node.attrs.width,height:node.attrs.height,alt:node.attrs.alt || ''}} : {}),...(node.content?.length ? {content:node.content.map(shape)} : {})});
const images = (node: JSONContent): JSONContent[] => [...(node.type === 'image' ? [node] : []),...(node.content || []).flatMap(images)];

beforeEach(() => {
  // jsdom has no bitmap decoder. Only supply this fixture's known dimensions;
  // media bytes, DOCX generation, Mammoth and schema parsing are real.
  vi.stubGlobal('Image', class { naturalWidth=1; naturalHeight=1; onload:(()=>void)|null=null; set src(_:string) { queueMicrotask(()=>this.onload?.()); } });
});
afterEach(() => vi.unstubAllGlobals());
async function roundtrip(source: JSONContent) {
  const before = structuredClone(source);
  const imported = await importWord(await bytes(await exportWord(source,'List image QA')));
  expect(source).toEqual(before); expect(imported.warnings).toEqual([]);
  const content = parseDocument(JSON.stringify({version:1,title:'List image QA',content:imported.content})).content;
  expect(shape(content)).toEqual(shape(source));
  return content;
}

it.each(['bulletList','orderedList'])('keeps an image and continuation within the same %s item through two conversions', async type => {
  let content = doc({type,content:[item(p('Before'),image(),p('Same item after image')),item(p('Next'))]});
  for(let pass=0;pass<2;pass++) content=await roundtrip(content);
});
it('retains adjacent images and empty alternative text without extra list items', async () => {
  await roundtrip(doc({type:'bulletList',content:[item(p('Before'),image(''),image('Second 日本語'),p('After'))]}));
});
it('preserves nested list and outer continuation around an image', async () => {
  await roundtrip(doc({type:'orderedList',content:[item(p('Outer'),{type:'bulletList',content:[item(p('Inner'),image(),p('Inner tail'))]},p('Outer tail')),item(p('Next'))]}));
});
it('preserves images in a list inside a quote and a quote inside a list', async () => {
  await roundtrip(doc({type:'blockquote',content:[p('Quote'),{type:'bulletList',content:[item(p('Item'),image(),p('Item tail'))]}]},
    {type:'orderedList',content:[item(p('Item'),{type:'blockquote',content:[p('Quote'),image(),p('Quote tail')]},p('Item tail'))]}));
});
it('retains Roman numbering, custom markers and continuation across mixed image and page-break content', async () => {
  const attrs={start:7,type:'I',numberPrefix:'(',numberSuffix:')'};
  const content=await roundtrip(doc({type:'orderedList',attrs,content:[item(p('Seven'),image(),{type:'pageBreak'},p('Seven tail')),item(p('Eight'))]},p('Between'),{type:'orderedList',attrs:{...attrs,start:9,continuePrevious:true},content:[item(p('Nine'))]}));
  expect(content.content![0].attrs).toMatchObject(attrs);
  expect(content.content![2].attrs).toMatchObject({...attrs,start:9,continuePrevious:true});
});
it('keeps an image-containing list in a merged cell and supports resize undo/redo after import', async () => {
  const content=await roundtrip(doc({type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{colspan:2},content:[{type:'bulletList',content:[item(p('Cell item'),image(),p('Tail'))]}]}]},{type:'tableRow',content:[{type:'tableCell',content:[p('A')]},{type:'tableCell',content:[p('B')]}]}]}));
  expect(content.content![0].content![0].content![0].attrs?.colspan).toBe(2);
  const editor=new Editor({extensions:createExtensions(),content}),engine=new DocumentEngine(editor);
  try {
    let pos=-1; editor.state.doc.descendants((node,at)=>{if(node.type.name==='image')pos=at;});
    editor.commands.setNodeSelection(pos); const before=editor.getJSON();
    expect(engine.execute({operations:[{type:'image.update',width:360,alt:'Updated 中文'}]}).ok).toBe(true);
    expect(images(editor.getJSON())[0].attrs).toMatchObject({width:360,height:180,alt:'Updated 中文'});
    const after=editor.getJSON();
    expect(engine.history('undo').ok).toBe(true);expect(editor.getJSON()).toEqual(before);
    expect(engine.history('redo').ok).toBe(true);expect(editor.getJSON()).toEqual(after);
    await roundtrip(after);
  } finally {engine.destroy();editor.destroy();}
});
it('preserves text added by an external editor to the image carrier', async () => {
  const zip=await JSZip.loadAsync(await bytes(await exportWord(doc({type:'bulletList',content:[item(p('Before'),image(),p('Tail'))]}),'External image text')));
  const xml=new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'),'application/xml');
  const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const drawing=xml.getElementsByTagNameNS(w,'drawing')[0];
  const carrier=drawing.parentElement!.parentElement!;
  const run=xml.createElementNS(w,'w:r'), text=xml.createElementNS(w,'w:t');
  text.textContent='External caption 中文';run.appendChild(text);carrier.appendChild(run);
  zip.file('word/document.xml',new XMLSerializer().serializeToString(xml));
  const result=await importWord(await zip.generateAsync({type:'arraybuffer'}));
  const content=parseDocument(JSON.stringify({version:1,title:'External',content:result.content})).content;
  expect(result.warnings).toEqual([]);expect(images(content)).toHaveLength(1);
  const listItem=content.content![0].content![0];
  expect(images(listItem)).toHaveLength(1);
  expect(JSON.stringify(listItem)).toContain('External caption 中文');
  expect(JSON.stringify(listItem)).toContain('Tail');
});
it('does not shift formatting onto the paragraph following an image', async () => {
  const tail=p('Same text'); tail.attrs={spaceBefore:17,spaceAfter:23};tail.content![0].marks=[{type:'bold'}];
  const content=await roundtrip(doc({type:'orderedList',content:[item(p('Same text'),image(),tail)]}));
  const result=content.content![0].content![0].content![2];
  expect(result.attrs).toMatchObject({spaceBefore:17,spaceAfter:23});
  expect(result.content![0].marks).toContainEqual({type:'bold'});
});
