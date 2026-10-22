import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { generateJSON, type JSONContent } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { exportWord } from '../lib/editor/word';
import JSZip from 'jszip';
import { restoreWordFormatting } from '../lib/editor/word-import-formatting';
import { exportHTML } from '../lib/editor/html-export';
const bytes = (blob: Blob) => new Promise<ArrayBuffer>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result as ArrayBuffer);reader.onerror=reject;reader.readAsArrayBuffer(blob);});
it('exports absolute CSS font units at the correct Word size and restores equivalent pixels',async()=>{
 const sizes=['12pt','1pc','0.25in','0.635cm','6.35mm','101.6q','24px'];
 const content:JSONContent={type:'doc',content:sizes.map((fontSize,i)=>({type:'paragraph',content:[{type:'text',text:`Sample ${i} 中文 العربية`,marks:[{type:'textStyle',attrs:{fontSize}}]}]}))};
 const before=structuredClone(content),output=await bytes(await exportWord(content,'Font units')),zip=await JSZip.loadAsync(output);
 const xml=new DOMParser().parseFromString(await zip.file('word/document.xml')!.async('string'),'application/xml');
 expect(Array.from(xml.getElementsByTagName('w:sz'),n=>n.getAttribute('w:val'))).toEqual(['24','24','36','36','36','144','36']);
 const html=new DOMParser().parseFromString(sizes.map((_,i)=>`<p>Sample ${i} 中文 العربية</p>`).join(''),'text/html');await restoreWordFormatting(output,html);
 expect(Array.from(html.querySelectorAll('p span'),n=>(n as HTMLElement).style.fontSize)).toEqual(['16px','16px','24px','24px','24px','96px','24px']);expect(content).toEqual(before);
});
it('refuses unresolved font sizes rather than silently exporting the wrong size',async()=>{
 for(const fontSize of ['12em','125%','bad','0px']){
  const content:JSONContent={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Imported',marks:[{type:'textStyle',attrs:{fontSize}}]}]}]};
  const before=structuredClone(content);await expect(exportWord(content,'Invalid size')).rejects.toThrow('Set an explicit font size');expect(content).toEqual(before);
 }
});
it('exports formatted text, page layout, links and merged table cells to real DOCX XML', async () => {
  const blob = await exportWord({type:'doc',attrs:{pageSize:'letter',orientation:'landscape',pageMargin:15,header:'Local draft',footer:'Confidential',pageNumbers:true},content:[
    {type:'heading',attrs:{level:2},content:[{type:'text',text:'Test heading'}]},
    {type:'paragraph',content:[{type:'text',text:'Styled text',marks:[{type:'bold'},{type:'underline'},{type:'textStyle',attrs:{fontSize:'24px',fontFamily:'Georgia',color:'#E65656'}},{type:'highlight',attrs:{color:'#FFF0AD'}}]}]},
    {type:'table',content:[{type:'tableRow',content:[{type:'tableHeader',attrs:{colspan:2,rowspan:1,backgroundColor:'#FFF0AD'},content:[{type:'paragraph',content:[{type:'text',text:'Wide header'}]}]}]},{type:'tableRow',content:[{type:'tableCell',content:[{type:'paragraph',content:[{type:'text',text:'A'}]}]},{type:'tableCell',content:[{type:'paragraph',content:[{type:'text',text:'B'}]}]}]}]},
    {type:'pageBreak'},
  ]},'Export test');
  const output = await bytes(blob);
  if (process.env.VDOC_WRITE_QA_FIXTURE) writeFileSync('/private/tmp/vdoc-word-roundtrip.docx', Buffer.from(output));
  const zip = await JSZip.loadAsync(output);
  const xml = await zip.file('word/document.xml')!.async('string');
  expect(xml).toContain('Styled text'); expect(xml).toContain('w:fill="FFF0AD"'); expect(xml).toContain('w:sz w:val="36"');expect(xml).toContain('w:gridSpan w:val="2"');expect(xml).toContain('w:orient="landscape"');expect(xml).toContain('w:type="page"');
  expect(await zip.file('word/header1.xml')!.async('string')).toContain('Local draft');
  expect(await zip.file('word/footer1.xml')!.async('string')).toContain('PAGE');
  const html = new DOMParser().parseFromString('<h2>Test heading</h2><p>Styled text</p><table><tr><th colspan="2">Wide header</th></tr><tr><td>A</td><td>B</td></tr></table>', 'text/html');
  expect(await restoreWordFormatting(output, html)).toMatchObject({pageSize:'letter',orientation:'landscape',pageMargin:15});
  expect(html.querySelector('p span')!.getAttribute('style')).toContain('font-size: 24px');
  expect(html.querySelector('mark')!.getAttribute('data-color')).toBe('#FFF0AD');
  expect(html.querySelector('p u strong')).not.toBeNull();
});
it('includes footnote text and safely escapes metadata in standalone HTML', () => {
  const html = exportHTML('<script>name</script>', '<p>Body<sup>1</sup></p>', {type:'doc',attrs:{header:'<script>alert(1)</script>'},content:[{type:'paragraph',content:[{type:'footnote',attrs:{number:1,text:'A & B'}}]}]});
  expect(html).toContain('A &amp; B'); expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>');
});
it('restores the actual Word image size, alternative text, cell width and row height', async () => {
  const d = await import('docx');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6x8AAAAASUVORK5CYII=', 'base64');
  const file = new d.Document({sections:[{children:[
    new d.Paragraph({children:[new d.ImageRun({data:png,type:'png',transformation:{width:180,height:90},altText:{title:'Test image',name:'Test image',description:'Blue rectangle'}})]}),
    new d.Table({rows:[new d.TableRow({height:{value:1200,rule:d.HeightRule.ATLEAST},children:[new d.TableCell({width:{size:2700,type:d.WidthType.DXA},children:[new d.Paragraph('Cell')]})]})]})
  ]}]});
  const output = await bytes(await d.Packer.toBlob(file));
  if (process.env.VDOC_WRITE_QA_FIXTURE) writeFileSync('/private/tmp/vdoc-dimensions-roundtrip.docx', Buffer.from(output));
  const html = new DOMParser().parseFromString('<p><img src="data:image/png;base64,AAAA"></p><table><tr><td><p>Cell</p></td></tr></table>', 'text/html');
  await restoreWordFormatting(output, html);
  expect(html.querySelector('img')!.getAttribute('width')).toBe('180');
  expect(html.querySelector('img')!.getAttribute('alt')).toBe('Blue rectangle');
  expect(html.querySelector('td')!.getAttribute('colwidth')).toBe('180');
  expect(html.querySelector('td')!.style.height).toBe('80px');
  const content: JSONContent = generateJSON(html.body.innerHTML, createExtensions());
  const table = content.content!.find(n=>n.type==='table')!;
  expect(table.content![0].content![0].attrs).toMatchObject({colwidth:[180],minHeight:80});
  expect(content.content!.find(n=>n.type==='image')!.attrs).toMatchObject({width:180,alt:'Blue rectangle'});
});
