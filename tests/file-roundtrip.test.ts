import { writeFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { exportWord, importWord } from '../lib/infrastructure/word/word';
import { parseDocument } from '../lib/infrastructure/persistence/storage';
import type { JSONContent } from '@tiptap/core';
import { cellBorder, borderSides } from '../lib/editor/table/table-borders';
import { colorToHex } from '../lib/domain/text/color';
import { languageSamples } from './multilingual-fixtures';
// Use the actual browser build: production receives ArrayBuffer rather than Node Buffer.
vi.mock('mammoth', () => vi.importActual('mammoth/mammoth.browser.js'));
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);});
it.each([0,2])('retains explicit pinned header count %s through real Word bytes and reimport',async pinnedRows=>{
  const input:JSONContent={type:'doc',content:[{type:'table',attrs:{pinnedRows},content:['标题 العربية','日本語 한국어','20','3'].map((text,i)=>({type:'tableRow',content:[{type:i<2?'tableHeader':'tableCell',content:[{type:'paragraph',content:[{type:'text',text}]}]}]}))}]};
  const buffer=await bytes(await exportWord(input,'Pinned headers'));
  const {default:JSZip}=await import('jszip');const zip=await JSZip.loadAsync(buffer);
  const xml=new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'),'application/xml');
  expect(xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','tblHeader').length).toBe(pinnedRows);
  const output=await importWord(buffer);expect(output.content.content![0].attrs!.pinnedRows).toBe(pinnedRows);
  expect(JSON.stringify(output.content)).toContain('日本語 한국어');
  parseDocument(JSON.stringify({version:1,title:'Pins',content:output.content}));
});
it('preserves four different cell edges through actual Word export and reimport, including a removed edge',async()=>{
  const borders={top:{width:4,color:'#FF0000',style:'dashed'},right:{width:0,color:'#000000',style:'solid'},bottom:{width:2,color:'#0000FF',style:'dotted'},left:{width:1,color:'#00AA00',style:'solid'}};
  const input:JSONContent={type:'doc',content:[{type:'table',content:[{type:'tableRow',content:[{type:'tableCell',attrs:{borders,colwidth:[180]},content:[{type:'paragraph',content:[{type:'text',text:'边框 العربية 日本語'}]}]}]}]}]};
  const buffer=await bytes(await exportWord(input,'Individual borders'));
  const output=await importWord(buffer),cell=output.content.content![0].content![0].content![0];
  for(const side of borderSides){const actual=cellBorder(cell.attrs!,side);expect({...actual,color:colorToHex(actual.color)}).toEqual(borders[side]);}
  parseDocument(JSON.stringify({version:1,title:'Borders',content:output.content}));
  if(process.env.VDOC_WRITE_QA_FIXTURE) writeFileSync('/private/tmp/vdoc-individual-borders.docx',Buffer.from(buffer));
});
it('preserves narrow centered tables, row heights and dashed/dotted borders in actual Word bytes and import',async()=>{
  const p=(text:string):JSONContent=>({type:'paragraph',content:[{type:'text',text}]});
  const input:JSONContent={type:'doc',content:[{type:'table',attrs:{alignment:'center'},content:[
    {type:'tableRow',attrs:{minHeight:70},content:[{type:'tableHeader',attrs:{colspan:2,colwidth:[90,150],borderStyle:'dashed',borderWidth:2},content:[p('标题 / عنوان')]}]},
    {type:'tableRow',attrs:{minHeight:70},content:[{type:'tableCell',attrs:{colwidth:[90],borderStyle:'dotted',borderWidth:3},content:[p('日本語')]},{type:'tableCell',attrs:{colwidth:[150],borderWidth:0},content:[p('العربية')]}]},
  ]}]};
  const buffer=await bytes(await exportWord(input,'Table layout'));
  const {default:JSZip}=await import('jszip'); const zip=await JSZip.loadAsync(buffer);
  const xml=new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'),'application/xml');
  const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const props=xml.getElementsByTagNameNS(w,'tblPr')[0];
  expect(props.getElementsByTagNameNS(w,'jc')[0].getAttributeNS(w,'val')).toBe('center');
  expect(props.getElementsByTagNameNS(w,'tblW')[0].getAttributeNS(w,'w')).toBe('3600');
  expect(Array.from(xml.getElementsByTagNameNS(w,'gridCol')).map(n=>n.getAttributeNS(w,'w'))).toEqual(['1350','2250']);
  const output=await importWord(buffer);
  const table=output.content.content!.find(n=>n.type==='table')!;
  expect(table.attrs!.alignment).toBe('center');
  expect(table.content!.map(row=>row.attrs!.minHeight)).toEqual([70,70]);
  expect(table.content![0].content![0].attrs).toMatchObject({borderStyle:'dashed',colwidth:[90,150]});
  expect(table.content![1].content![0].attrs).toMatchObject({borderStyle:'dotted',borderWidth:3,colwidth:[90]});
  expect(table.content![1].content![1].attrs).toMatchObject({borderWidth:0,colwidth:[150]});
  expect(JSON.stringify(table)).toContain('العربية');
  parseDocument(JSON.stringify({version:1,title:'Table layout',content:output.content}));
  if(process.env.VDOC_WRITE_QA_FIXTURE) writeFileSync('/private/tmp/vdoc-table-layout.docx',Buffer.from(buffer));
});
it('round trips a real DOCX through the complete importer with paragraphs, lists, links and footnotes',async()=>{
  const input:JSONContent={type:'doc',content:[
    {type:'paragraph',content:[{type:'text',text:'Styled',marks:[{type:'bold'},{type:'textStyle',attrs:{fontSize:'24px',fontFamily:'Georgia'}}]}]},
    {type:'paragraph',content:[{type:'text',text:'Link',marks:[{type:'link',attrs:{href:'https://example.com'}}]},{type:'footnote',attrs:{number:1,text:'Keep note'}}]},
    {type:'orderedList',attrs:{start:3},content:[{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'Third item'}]}]},{type:'listItem',content:[{type:'paragraph',content:[{type:'text',text:'Fourth item'}]}]}]},
  ]};
  const buffer=await bytes(await exportWord(input,'Roundtrip'));
  if (process.env.VDOC_WRITE_QA_FIXTURE) writeFileSync('/private/tmp/vdoc-full-roundtrip.docx', Buffer.from(buffer));
  const output=await importWord(buffer);
  const valid=parseDocument(JSON.stringify({version:1,title:'Roundtrip',content:output.content})).content;
  expect(valid.content![0].content![0].marks).toEqual(expect.arrayContaining([{type:'bold'},expect.objectContaining({type:'textStyle',attrs:expect.objectContaining({fontSize:'24px',fontFamily:'Georgia'})})]));
  expect(JSON.stringify(valid)).toContain('https://example.com');expect(JSON.stringify(valid)).toContain('Keep note');
  expect(valid.content!.find(n=>n.type==='orderedList')?.attrs?.start).toBe(3);
});

it('retains independent list starts and nested levels in a real Word round trip',async()=>{
  const p=(text:string):JSONContent=>({type:'paragraph',content:[{type:'text',text}]});
  const list=(start:number,text:string,nested?:JSONContent):JSONContent=>({type:'orderedList',attrs:{start},content:[{type:'listItem',content:[p(text),...(nested?[nested]:[])]}]});
  const output=await importWord(await bytes(await exportWord({type:'doc',content:[list(3,'Outer',list(7,'Nested')),p('Separator'),list(9,'Later') ]},'Lists')));
  const lists: number[]=[];const visit=(n:JSONContent)=>{if(n.type==='orderedList')lists.push(n.attrs!.start);n.content?.forEach(visit);};visit(output.content);
  expect(lists).toEqual([3,7,9]);
});
it('retains merged table structure and explicit page breaks in a real Word round trip',async()=>{
  const p=(text:string):JSONContent=>({type:'paragraph',content:[{type:'text',text}]});
  const output=await importWord(await bytes(await exportWord({type:'doc',content:[{type:'table',content:[{type:'tableRow',content:[{type:'tableHeader',attrs:{colspan:2},content:[p('Wide')]}]},{type:'tableRow',content:[{type:'tableCell',content:[p('Left')]},{type:'tableCell',content:[p('Right')]}]}]},{type:'pageBreak'},p('Next page')]},'Table')));
  const content=parseDocument(JSON.stringify({version:1,title:'Table',content:output.content})).content;
  expect(content.content!.find(n=>n.type==='table')!.content![0].content![0].attrs!.colspan).toBe(2);
  expect(content.content!.filter(n=>n.type==='pageBreak')).toHaveLength(1);
  expect(JSON.stringify(content)).toContain('Next page');
});
it('preserves multiple footnotes as editable note nodes without superscript text duplicates',async()=>{
  const output=await importWord(await bytes(await exportWord({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Body'},{type:'footnote',attrs:{number:1,text:'First note'}},{type:'text',text:'More'},{type:'footnote',attrs:{number:2,text:'Second note'}}]}]},'Notes')));
  const notes=output.content.content![0].content!.filter(n=>n.type==='footnote');
  expect(notes.map(n=>n.attrs)).toEqual([{number:1,text:'First note'},{number:2,text:'Second note'}]);
  expect(notes.every(n=>!n.marks?.length)).toBe(true);
  expect(output.content.content).toHaveLength(1);
});

it('round trips 40 language samples and Unicode edge cases through actual DOCX paragraphs and table cells',async()=>{
  const {languageSamples,unicodeSamples}=await import('./multilingual-fixtures');
  const samples=[...languageSamples,...unicodeSamples.map((text,i)=>[`unicode-${i}`,text])];
  const rtl=new Set(['ar','he','fa','ur']);
  const paragraphs:JSONContent[]=samples.map(([locale,text])=>({type:'paragraph',attrs:{direction:rtl.has(locale)?'rtl':'ltr'},content:[{type:'text',text}]}));
  const input:JSONContent={type:'doc',content:[...paragraphs,{type:'table',content:[{type:'tableRow',content:paragraphs.slice(5,9).map(p=>({type:'tableCell',content:[p]}))}]}]};
  const buffer=await bytes(await exportWord(input,'Multilingual acceptance'));
  if(process.env.VDOC_WRITE_QA_FIXTURE) {
    writeFileSync('/private/tmp/vdoc-multilingual.docx',Buffer.from(buffer));
    writeFileSync('/private/tmp/vdoc-multilingual.vdoc.json',JSON.stringify({version:1,title:'VDOC-MULTILINGUAL-ACCEPTANCE',content:input}));
  }
  const output=await importWord(buffer);
  const valid=parseDocument(JSON.stringify({version:1,title:'Multilingual',content:output.content})).content;
  expect(valid.content!.slice(0,samples.length).map(p=>p.content!.map(n=>n.text||'').join(''))).toEqual(samples.map(s=>s[1]));
  expect(valid.content!.slice(0,samples.length).map(p=>p.attrs!.direction)).toEqual(samples.map(([locale])=>rtl.has(locale)?'rtl':'ltr'));
  const table=valid.content!.find(n=>n.type==='table')!;
  expect(table.content![0].content!.map(c=>c.content![0].attrs!.direction)).toEqual(['rtl','rtl','rtl','rtl']);
});

// Each language is an independent file round trip. Report its failure directly,
// without putting 40 unrelated export/import transactions under one deadline.
it.each(languageSamples)('retains %s document language metadata and exact text in actual Word files',async(language,text)=>{
  const input:JSONContent={type:'doc',attrs:{language},content:[{type:'paragraph',content:[{type:'text',text}]}]};
  const output=await importWord(await bytes(await exportWord(input,language)));
  expect(output.content.attrs?.language,language).toBe(language);
  expect(output.content.content![0].content![0].text,language).toBe(text);
});

it.each(['ltr','rtl'])('retains %s table column order separately from paragraph direction through Word bytes',async columnDirection=>{
 const input:JSONContent={type:'doc',content:[{type:'table',attrs:{columnDirection},content:[{type:'tableRow',content:['العربية','עברית','日本語'].map((text,i)=>({type:'tableCell',attrs:{colwidth:[100+i*50]},content:[{type:'paragraph',attrs:{direction:i===2?'ltr':'rtl'},content:[{type:'text',text}]}]}))}]}]};
 const buffer=await bytes(await exportWord(input,'Column order'));
 const {default:JSZip}=await import('jszip');const zip=await JSZip.loadAsync(buffer);
 const xml=new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'),'application/xml');
 const flag=xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','bidiVisual')[0];
 expect(flag.getAttribute('w:val')).toBe(columnDirection==='rtl'?null:'off');
 const output=await importWord(buffer),table=output.content.content![0];expect(table.attrs!.columnDirection).toBe(columnDirection);
 expect(table.content![0].content!.map(c=>c.content![0].content![0].text)).toEqual(['العربية','עברית','日本語']);
 expect(table.content![0].content!.map(c=>c.attrs!.colwidth)).toEqual([[100],[150],[200]]);
 expect(table.content![0].content!.map(c=>c.content![0].attrs!.direction)).toEqual(['rtl','rtl','ltr']);
});

it('preserves mixed row page-break settings in real Word bytes, including legacy defaults',async()=>{
 const input:JSONContent={type:'doc',content:[{type:'table',attrs:{pinnedRows:0},content:[undefined,true,false].map((allowSplit,i)=>({type:'tableRow',attrs:allowSplit===undefined?{}:{allowSplit},content:[{type:'tableCell',content:[{type:'paragraph',content:[{type:'text',text:['Legacy','العربية 日本語','Keep'][i]}]}]}]}))}]};
 const buffer=await bytes(await exportWord(input,'Row pagination'));
 const {default:JSZip}=await import('jszip');const zip=await JSZip.loadAsync(buffer),xml=new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'),'application/xml');
 const flags=Array.from(xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','cantSplit'));
 expect(flags.map(el=>el.getAttribute('w:val'))).toEqual([null,'off',null]);
 const output=await importWord(buffer);expect(output.content.content![0].content!.map(r=>r.attrs!.allowSplit)).toEqual([false,true,false]);
 parseDocument(JSON.stringify({version:1,title:'Row pagination',content:output.content}));
});
it.each(['absent','0','false','off'])('imports Word cantSplit=%s as allowed, independently of adjacent rows',async value=>{
 const input:JSONContent={type:'doc',content:[{type:'table',content:['A','B'].map(text=>({type:'tableRow',content:[{type:'tableCell',content:[{type:'paragraph',content:[{type:'text',text}]}]}]}))}]};
 const {default:JSZip}=await import('jszip');const zip=await JSZip.loadAsync(await bytes(await exportWord(input,'Import flags')));
 const xml=await zip.file('word/document.xml')!.async('string');zip.file('word/document.xml',xml.replace('<w:cantSplit/>',value==='absent'?'':`<w:cantSplit w:val="${value}"/>`));
 const output=await importWord(await zip.generateAsync({type:'arraybuffer'}));expect(output.content.content![0].content!.map(r=>r.attrs!.allowSplit)).toEqual([true,false]);
});
it('does not apply nested table row settings to the next outer row during Word import',async()=>{
 const p=(text:string):JSONContent=>({type:'paragraph',content:[{type:'text',text}]});
 const nested:JSONContent={type:'table',attrs:{pinnedRows:0},content:[{type:'tableRow',attrs:{allowSplit:true,minHeight:90},content:[{type:'tableCell',content:[p('Nested العربية')]}]}]};
 const input:JSONContent={type:'doc',content:[{type:'table',attrs:{pinnedRows:0},content:[{type:'tableRow',attrs:{allowSplit:false,minHeight:130},content:[{type:'tableCell',content:[p('Outer A'),nested]}]},{type:'tableRow',attrs:{allowSplit:false,minHeight:60},content:[{type:'tableCell',content:[p('Outer B')]}]}]}]};
 const output=await importWord(await bytes(await exportWord(input,'Nested rows'))),outer=output.content.content![0];
 expect(outer.content!.map(r=>[r.attrs!.allowSplit,r.attrs!.minHeight])).toEqual([[false,130],[false,60]]);
 const inner=outer.content![0].content![0].content!.find(n=>n.type==='table')!;expect(inner.content![0].attrs).toMatchObject({allowSplit:true,minHeight:90});
});
