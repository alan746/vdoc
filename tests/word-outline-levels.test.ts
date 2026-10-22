import { expect, it, vi } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import * as d from 'docx';
import { exportWord, importWord } from '../lib/editor/word';
import { parseDocument } from '../lib/editor/storage';
vi.mock('mammoth',()=>vi.importActual('mammoth/mammoth.browser.js'));
const bytes=(blob:Blob)=>new Promise<ArrayBuffer>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result as ArrayBuffer);r.onerror=reject;r.readAsArrayBuffer(blob);});
const numbering={config:[{reference:'qa',levels:[{level:0,format:d.LevelFormat.UPPER_ROMAN,text:'(%1)',start:7}]}]};
const numbered={reference:'qa',level:0};
const textNodes=(n:JSONContent):JSONContent[]=>[...(['paragraph','heading'].includes(n.type||'')?[n]:[]),...(n.content||[]).flatMap(textNodes)];
async function read(children:(d.Paragraph|d.Table)[],styles?:d.IStylesOptions) {
  const result=await importWord(await bytes(await d.Packer.toBlob(new d.Document({numbering,styles,sections:[{children}]}))));
  expect(result.warnings).toEqual([]);
  return parseDocument(JSON.stringify({version:1,title:'Outline',content:result.content})).content;
}
it.each([1,2,3,4,5,6])('preserves built-in numbered heading level %i and its numbering',async level=>{
  let content=await read([new d.Paragraph({text:'Heading 中文 العربية',heading:`Heading${level}` as (typeof d.HeadingLevel)[keyof typeof d.HeadingLevel],numbering:numbered}),new d.Paragraph({text:'Next',numbering:numbered})]);
  for(let pass=0;pass<2;pass++) {
    expect(content.content![0].type).toBe('orderedList');expect(content.content![0].attrs).toMatchObject({start:7,type:'I',numberPrefix:'(',numberSuffix:')'});
    expect(textNodes(content).map(n=>[n.type,n.attrs?.level])).toEqual([['heading',level],['paragraph',undefined]]);
    content=(await importWord(await bytes(await exportWord(content,'Numbered heading')))).content;
  }
});
it('resolves a custom numbered heading through its basedOn chain and keeps explicit unbold text',async()=>{
  const content=await read([new d.Paragraph({style:'Child',numbering:numbered,children:[new d.TextRun({text:'Custom 日本語',bold:false,italics:true})]})],{paragraphStyles:[
    {id:'Base',name:'Custom base',paragraph:{outlineLevel:2},run:{bold:true}},
    {id:'Child',name:'Custom child',basedOn:'Base'},
  ]});
  const heading=textNodes(content)[0];expect(heading.type).toBe('heading');expect(heading.attrs?.level).toBe(3);
  expect(heading.content![0].marks).toContainEqual({type:'italic'});
  expect(heading.content![0].marks).toContainEqual(expect.objectContaining({type:'formatOverride',attrs:expect.objectContaining({boldOff:true})}));
});
it('honors direct outline overrides including body text level 9',async()=>{
  const content=await read([
    new d.Paragraph({heading:d.HeadingLevel.HEADING_2,outlineLevel:4,text:'Direct fifth'}),
    new d.Paragraph({heading:d.HeadingLevel.HEADING_2,outlineLevel:9,text:'Body text'}),
    new d.Paragraph({outlineLevel:0,text:'Direct first'}),
  ]);
  expect(textNodes(content).map(n=>[n.type,n.attrs?.level])).toEqual([['heading',5],['paragraph',undefined],['heading',1]]);
});
it('keeps an empty numbered heading before an identical normal item',async()=>{
  const content=await read([new d.Paragraph({heading:d.HeadingLevel.HEADING_2,numbering:numbered}),new d.Paragraph({text:'Same',heading:d.HeadingLevel.HEADING_3,numbering:numbered}),new d.Paragraph({text:'Same',numbering:numbered})]);
  expect(textNodes(content).map(n=>[n.type,n.attrs?.level,n.content?.[0]?.text||''])).toEqual([['heading',2,''],['heading',3,'Same'],['paragraph',undefined,'Same']]);
  expect(content.content![0].attrs?.start).toBe(7);
});
it('restores custom heading outline in a merged cell without changing adjacent cell text',async()=>{
  const content=await read([new d.Table({rows:[new d.TableRow({children:[new d.TableCell({columnSpan:2,children:[new d.Paragraph({text:'Cell heading العربية',outlineLevel:1,numbering:numbered})]})]}),new d.TableRow({children:[new d.TableCell({children:[new d.Paragraph('A')]}),new d.TableCell({children:[new d.Paragraph('B')]})]})]})]);
  expect(content.content![0].content![0].content![0].attrs?.colspan).toBe(2);
  expect(textNodes(content).map(n=>[n.type,n.attrs?.level])).toEqual([['heading',2],['paragraph',undefined],['paragraph',undefined]]);
});
it.each([6,8,99])('warns about unsupported outline level %i without removing text or numbering',async outlineLevel=>{
  const file=new d.Document({numbering,sections:[{children:[new d.Paragraph({text:'Keep 中文 العربية',outlineLevel,numbering:numbered})]}]});
  const result=await importWord(await bytes(await d.Packer.toBlob(file)));
  expect(result.warnings.some(message=>message.includes('outline levels are unsupported'))).toBe(true);
  expect(textNodes(result.content)[0].content![0].text).toBe('Keep 中文 العربية');
  expect(result.content.content![0].attrs).toMatchObject({start:7,type:'I'});
  expect(()=>parseDocument(JSON.stringify({version:1,title:'Unsupported',content:result.content}))).not.toThrow();
});
