import { expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import * as d from 'docx';
import JSZip from 'jszip';
import { importWord, exportWord } from '../lib/infrastructure/word/word';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const bytes=(blob:Blob)=>new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});
const num=(id?:string,level?:number)=>`<w:numPr>${level!==undefined?`<w:ilvl w:val="${level}"/>`:''}${id!==undefined?`<w:numId w:val="${id}"/>`:''}</w:numPr>`;
const style=(id:string,props:string,base='Normal')=>`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:basedOn w:val="${base}"/><w:pPr>${props}</w:pPr></w:style>`;
const p=(text:string,id='Child',props='')=>`<w:p><w:pPr><w:pStyle w:val="${id}"/>${props}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
async function fixture(styles:string,body:string, associations: Record<string, number> = {}) {
  const config=['A','B'].map(reference=>({reference,levels:Array.from({length:3},(_,level)=>({level,format:reference==='A'?d.LevelFormat.UPPER_ROMAN:d.LevelFormat.LOWER_LETTER,text:reference==='A'?`(%${level+1})`:`[%${level+1}]`,start:reference==='A'?7:20}))}));
  const file=new d.Document({numbering:{config},sections:[{children:['A','B'].map(reference=>new d.Paragraph({text:reference,numbering:{reference,level:0}}))}]});
  const zip=await JSZip.loadAsync(await bytes(await d.Packer.toBlob(file)));
  const xml=new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'),'application/xml');
  const ids=Array.from(xml.getElementsByTagNameNS(W,'numId')).map(n=>n.getAttributeNS(W,'val')!);
  const subst=(value:string)=>value.replaceAll('ID_A',ids[0]).replaceAll('ID_B',ids[1]);
  const target=xml.getElementsByTagNameNS(W,'body')[0];Array.from(target.children).filter(n=>n.localName!=='sectPr').forEach(n=>n.remove());
  const parts=new DOMParser().parseFromString(`<w:body xmlns:w="${W}">${subst(body)}</w:body>`,'application/xml');
  for(const node of Array.from(parts.documentElement.children))target.insertBefore(xml.importNode(node,true),target.lastChild);
  zip.file('word/document.xml',new XMLSerializer().serializeToString(xml));
  zip.file('word/styles.xml',(await zip.file('word/styles.xml')!.async('string')).replace('</w:styles>',subst(styles)+'</w:styles>'));
  const numbering=new DOMParser().parseFromString(await zip.file('word/numbering.xml')!.async('string'),'application/xml');
  for(const abstract of Array.from(numbering.getElementsByTagNameNS(W,'abstractNum'))) {
    for(const [id,level] of Object.entries(associations)) {
      const target=Array.from(abstract.children).find(n=>n.localName==='lvl'&&n.getAttributeNS(W,'ilvl')===String(level));
      if(target){const linked=numbering.createElementNS(W,'w:pStyle');linked.setAttributeNS(W,'w:val',id);target.appendChild(linked);}
    }
  }
  zip.file('word/numbering.xml',new XMLSerializer().serializeToString(numbering));
  return zip.generateAsync({type:'arraybuffer'});
}
const lists=(n:JSONContent):JSONContent[]=>[...(n.type==='orderedList'?[n]:[]),...(n.content||[]).flatMap(lists)];
async function read(styles:string,body:string, associations: Record<string,number> = {}, warnings: string[] = []) {
  const result=await importWord(await fixture(styles,body,associations));
  expect(result.warnings).toEqual(warnings);
  return parseDocument(JSON.stringify({version:1,title:'Inherited numbering',content:result.content})).content;
}
const base=()=>style('Base',num('ID_A',0))+style('Child','','Base');
it('inherits a Roman numbered series through paragraph styles, including an empty first item',async()=>{
  const content=await read(base(),p('')+p('中文 العربية')+p('日本語'));
  expect(content.content).toHaveLength(1);expect(content.content![0].type).toBe('orderedList');
  expect(lists(content)[0].attrs).toMatchObject({start:7,type:'I',numberPrefix:'(',numberSuffix:')'});
  expect(lists(content)[0].content).toHaveLength(3);
});
it('uses the associated style level instead of the style ilvl and inherits the numbering id',async()=>{
  const content=await read(base()+style('Nested',num(undefined,2),'Base'),p('Outer')+p('Inner','Nested')+p('Next'),{Nested:1});
  expect(lists(content)).toHaveLength(2);expect(lists(content).map(n=>n.attrs?.start)).toEqual([7,7]);
  expect(lists(content)[0].content).toHaveLength(2);
});
it('merges a direct level override and preserves following outer items',async()=>{
  const content=await read(base(),p('Outer')+p('Inner','Child',num(undefined,1))+p('Next'));
  expect(lists(content)).toHaveLength(2);expect(lists(content)[0].content).toHaveLength(2);
});
it('honors a direct numbering id override while inheriting the level',async()=>{
  const content=await read(base(),p('Roman')+p('Alpha','Child',num('ID_B')));
  expect(lists(content).map(n=>[n.attrs?.start,n.attrs?.type,n.attrs?.numberPrefix])).toEqual([[7,'I','('],[20,'a','[']]);
});
it('keeps a direct numId zero as body text, then resumes the inherited series',async()=>{
  const content=await read(base(),p('Before')+p('Disabled','Child',num('0'))+p('After'),{},["Unrecognised paragraph style: 'Child' (Style ID: Child)"]);
  expect(content.content!.map(n=>n.type)).toEqual(['orderedList','paragraph','orderedList']);
  expect(lists(content).map(n=>[n.attrs?.start,n.attrs?.continuePrevious])).toEqual([[7,false],[8,true]]);
});
it('preserves inherited heading semantics and numbering together',async()=>{
  const content=await read(style('Base',num('ID_A',0)+'<w:outlineLvl w:val="2"/>')+style('Child','','Base'),p('Heading 中文')+p('Next heading'));
  expect(lists(content)[0].attrs?.start).toBe(7);
  expect(lists(content)[0].content!.map(n=>n.content![0].attrs?.level)).toEqual([3,3]);
});
it('keeps table-cell numbering and multilingual text through a VDoc Word round trip',async()=>{
  const content=await read(base(),`<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr/>${p('Cell العربية')}${p('Cell 日本語')}</w:tc></w:tr></w:tbl>`);
  expect(lists(content)[0].attrs?.start).toBe(7);
  const result=await importWord(await bytes(await exportWord(content,'Inherited cell')));expect(result.warnings).toEqual([]);
  expect(lists(result.content)[0].attrs).toMatchObject({start:7,type:'I'});
  expect(JSON.stringify(result.content)).toContain('Cell العربية');expect(JSON.stringify(result.content)).toContain('Cell 日本語');
});
it('leaves already explicit numbering authoritative over all inherited values',async()=>{
  const content=await read(base(),p('Explicit','Child',num('ID_B',0)));
  expect(lists(content)[0].attrs).toMatchObject({start:20,type:'a',numberPrefix:'[',numberSuffix:']'});
});
it('finds an associated level on a basedOn ancestor',async()=>{
  const content=await read(base()+style('Nested','','Base')+style('Grandchild','','Nested'),p('Outer')+p('Inner','Grandchild')+p('Next'),{Nested:1});
  expect(lists(content)).toHaveLength(2);expect(lists(content)[1].content![0].content![0].content![0].text).toBe('Inner');
});
it('honors a direct level over an associated style level',async()=>{
  const content=await read(base()+style('Nested','','Base'),p('Outer')+p('Same level','Nested',num(undefined,0)),{Nested:1});
  expect(lists(content)).toHaveLength(1);expect(lists(content)[0].content).toHaveLength(2);
});
it('ignores an inherited ilvl without an associated numbering level',async()=>{
  const content=await read(style('Base',num('ID_A',2))+style('Child','','Base'),p('First')+p('Second'));
  expect(lists(content)).toHaveLength(1);expect(content.content![0].content).toHaveLength(2);
});
it('keeps a child style numId zero disabled even when its ancestor is numbered',async()=>{
  const content=await read(base()+style('Disabled',num('0'),'Child'),p('Before')+p('Body','Disabled')+p('After'),{},["Unrecognised paragraph style: 'Disabled' (Style ID: Disabled)"]);
  expect(content.content!.map(n=>n.type)).toEqual(['orderedList','paragraph','orderedList']);
  expect(content.content![1].content![0].text).toBe('Body');expect(lists(content)[1].attrs?.start).toBe(8);
});
it('ignores historical numbering and leaves the original input bytes unchanged',async()=>{
  const input=await fixture(base(),p('Current','Child',`<w:pPrChange w:id="1"><w:pPr>${num('ID_B',2)}</w:pPr></w:pPrChange>`));
  const before=Array.from(new Uint8Array(input));
  const result=await importWord(input);
  expect(result.warnings).toEqual([]);expect(lists(result.content)).toHaveLength(1);
  expect(lists(result.content)[0].attrs).toMatchObject({start:7,type:'I'});
  expect(Array.from(new Uint8Array(input))).toEqual(before);
});
