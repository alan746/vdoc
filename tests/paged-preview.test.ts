import { expect, it } from 'vitest';
import { preparePrintTables } from '../lib/editor/print-tables';
import { previewSource, previewTextMatches, repeatTableHeaders } from '../lib/editor/paged-preview';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
const parse=(html:string)=>{const el=document.createElement('div');el.innerHTML=html;return el;};
const fixture='<table dir="rtl"><colgroup><col style="width:100px"><col style="width:200px"></colgroup><tbody><tr><th colspan="2">Title</th></tr><tr><th>A</th><th>B</th></tr><tr data-allow-split="true" style="break-inside:auto"><td>العربية</td><td>日本語</td></tr></tbody></table>';
it.each([0,1,2])('serializes explicit %s pinned rows into one thead without changing cell order or styles',count=>{
 const html=fixture.replace('<table ',`<table data-pinned-rows="${count}" `),out=parse(preparePrintTables(html)),table=out.querySelector('table')!;
 expect(table.tHead?.rows.length||0).toBe(count);expect(table.rows.length).toBe(3);expect(table.dir).toBe('rtl');expect(table.querySelectorAll('col').length).toBe(2);expect(table.rows[2].dataset.allowSplit).toBe('true');expect(table.rows[2].style.breakInside).toBe('auto');expect(table.textContent).toBe('TitleABالعربية日本語');
});
it('preserves legacy header inference but never treats ordinary th styling after body as pinned',()=>{
 const table=parse(preparePrintTables(fixture.replace('</tbody>','<tr><th>Later</th><th>Styles</th></tr></tbody>'))).querySelector('table')!;expect(table.tHead!.rows.length).toBe(2);expect(table.tBodies[0].rows.length).toBe(2);
});
it('expands a rowspan header boundary and handles nested tables independently',()=>{
 const html='<table data-pinned-rows="1"><tr><td rowspan="2">Merged</td><td>A</td></tr><tr><td><p>B</p><table data-pinned-rows="0"><tr><th>Inner</th></tr></table></td></tr><tr><td>C</td><td>D</td></tr></table>';
 const tables=parse(preparePrintTables(html)).querySelectorAll('table');expect(tables[0].tHead!.rows.length).toBe(2);expect(tables[0].tBodies[0].rows.length).toBe(1);expect(tables[1].tHead).toBeNull();expect(tables[1].rows.length).toBe(1);
});
it('is idempotent for serialized output and can round-trip all rows back into the editor',()=>{
 const output=preparePrintTables(fixture);expect(preparePrintTables(output)).toBe(output);
 const editor=new Editor({extensions:createExtensions(),content:output});expect(editor.state.doc.firstChild!.childCount).toBe(3);expect(editor.state.doc.firstChild!.attrs.pinnedRows).toBe(2);expect(editor.state.doc.textContent).toBe('TitleABالعربية日本語');editor.destroy();
});
it('inserts a repeated header and colgroup once before a continued body is measured',()=>{
 const original=parse(preparePrintTables(fixture)),target=parse('<table><tbody><tr><td>Continuation</td></tr></tbody></table>');
 const node=target.querySelector('td')!,source=original.querySelector('tbody td')!;repeatTableHeaders(node,source);repeatTableHeaders(node,source);
 expect(target.querySelectorAll('thead').length).toBe(1);expect(target.querySelector('thead')!.dataset.repeatedHeader).toBe('true');expect(target.querySelectorAll('colgroup').length).toBe(1);expect(target.querySelector('tbody')!.textContent).toBe('Continuation');
});
it('does not repeat unpinned headers or duplicate the first page header',()=>{
 const source=parse(preparePrintTables(fixture)),first=parse(preparePrintTables(fixture));repeatTableHeaders(first.querySelector('td')!,source.querySelector('td')!);expect(first.querySelector('thead')!.dataset.repeatedHeader).toBeUndefined();
 const plain=parse('<table><tbody><tr><td>No headers</td></tr></tbody></table>');repeatTableHeaders(plain.querySelector('td')!,plain.querySelector('td')!);expect(plain.querySelector('thead')).toBeNull();
});
it('accepts split Unicode text while ignoring deliberately repeated headers',()=>{
 const source=parse('<p data-block-id="a">Hello العربية 👨‍👩‍👧‍👦</p><p data-block-id="h">Header</p>');
 const pages=parse('<p data-block-id="a">Hello </p><p data-block-id="a">العربية 👨‍👩‍👧‍👦</p><p data-block-id="h">Header</p><div data-repeated-header="true"><p data-block-id="h">Header</p></div>');expect(previewTextMatches(source,pages)).toBe(true);
});
it.each(['missing','duplicate','changed','missing-image'])('rejects %s preview content',kind=>{
 const source=parse('<p data-block-id="a">Original</p><img data-block-id="i" src="data:image/png;base64,AA==">'),target=source.cloneNode(true) as HTMLElement;
 if(kind==='missing')target.querySelector('p')!.remove();if(kind==='duplicate')target.appendChild(target.querySelector('p')!.cloneNode(true));if(kind==='changed')target.querySelector('p')!.textContent='Altered';if(kind==='missing-image')target.querySelector('img')!.remove();expect(previewTextMatches(source,target)).toBe(false);
});
it('uses page settings, escapes generated margin text, excludes live controls, and retains explicit breaks',()=>{
 const source=previewSource('Preview','<p data-block-id="p">Body</p><input type="checkbox" checked><div class="page-break"><span>Page break</span></div>',{type:'doc',attrs:{pageSize:'letter',orientation:'landscape',pageMargin:15,pageColor:'#FFFFFF',header:'Title "quoted"\\end',footer:'Line\nTwo',pageNumbers:true,language:'ar'}});
 expect(source.css).toContain('size:letter landscape; margin:15mm');expect(source.css).toContain('counter(page)');expect(source.css).toContain('Title \\"quoted\\"\\\\end');expect(source.css).toContain('Line\\A Two');expect(source.language).toBe('ar');expect(parse(source.html).querySelector('header')).toBeNull();expect(parse(source.html).querySelector('input')!.disabled).toBe(true);expect(source.html).toContain('page-break');
});
it('segments long mixed-direction text only in the preview, preserving marks, Unicode and paragraph identity',()=>{
 const text='English العربية עברית 日本語 हिन्दी 👨‍👩‍👧‍👦 é '.repeat(80);
 const input=`<p data-block-id="long" dir="auto"><strong>${text}</strong></p>`;
 const source=previewSource('Long text',input,{type:'doc'}),out=parse(source.html),paragraph=out.querySelector('p')!;
 expect(paragraph.textContent).toBe(text);expect(paragraph.dataset.blockId).toBe('long');expect(paragraph.querySelectorAll('strong > span[data-preview-run]').length).toBeGreaterThan(1);
 expect(Array.from(paragraph.querySelectorAll('span')).every(span=>!span.textContent!.startsWith('\u200d')&&!span.textContent!.endsWith('\u200d'))).toBe(true);
 expect(previewTextMatches(parse(input),out)).toBe(true);
});
it('rejects reordered text blocks even when each individual block retains its text',()=>{
 expect(previewTextMatches(parse('<p data-block-id="a">A</p><p data-block-id="b">B</p>'),parse('<p data-block-id="b">B</p><p data-block-id="a">A</p>'))).toBe(false);
});
it('rejects reordered images while excluding intentional repeated header images',()=>{
 const a='<img data-block-id="a" src="data:image/png;base64,AA==">',b='<img data-block-id="b" src="data:image/png;base64,BB==">';
 expect(previewTextMatches(parse(a+b),parse(b+a))).toBe(false);
 expect(previewTextMatches(parse(a+b),parse(a+b+'<div data-repeated-header="true">'+a+'</div>'))).toBe(true);
});

it.each([
 ['missing', '<p data-block-id="a">AB</p>'],
 ['duplicated', '<p data-block-id="a">A<br><br>B</p>'],
 ['moved', '<p data-block-id="a"><br>AB</p>'],
 ['replaced by literal newline', '<p data-block-id="a">A\nB</p>'],
])('rejects a %s hard break even when ordinary text is otherwise intact', (_kind, output) => {
 expect(previewTextMatches(parse('<p data-block-id="a">A<br>B</p>'),parse(output))).toBe(false);
});
it.each(['h2','pre'])('rejects missing hard breaks in %s blocks', tag => {
 expect(previewTextMatches(parse(`<${tag} data-block-id="a">中文<br>العربية</${tag}>`),parse(`<${tag} data-block-id="a">中文العربية</${tag}>`))).toBe(false);
});
it('accepts hard breaks across page fragments, inline wrappers and intentionally repeated headers', () => {
 const source=parse('<p data-block-id="a">中文<br><br><strong>العربية</strong><br></p>');
 const pages=parse('<p data-block-id="a"><span>中文</span><br></p><p data-block-id="a"><br><strong>العربية</strong></p><p data-block-id="a"><br></p><div data-repeated-header="true"><p data-block-id="a">Repeated<br>Header</p></div>');
 expect(previewTextMatches(source,pages)).toBe(true);
});
it('keeps literal newlines, tabs and inline markup independent from hard break boundaries', () => {
 const source=parse('<pre data-block-id="a">A\nB\tC</pre><p data-block-id="b">D<br>E</p>');
 const pages=parse('<pre data-block-id="a"><code>A\n</code></pre><pre data-block-id="a"><span>B\tC</span></pre><p data-block-id="b"><em>D</em><br><strong>E</strong></p>');
 expect(previewTextMatches(source,pages)).toBe(true);
});

it.each(['missing','duplicate','moved'])('rejects a %s horizontal rule although paragraph text is unchanged', kind => {
 const before=parse('<p data-block-id="a">A</p><hr data-block-id="rule"><p data-block-id="b">B</p>');
 const after=before.cloneNode(true) as HTMLElement, rule=after.querySelector('hr')!;
 if(kind==='missing')rule.remove();else if(kind==='duplicate')rule.parentNode!.insertBefore(rule.cloneNode(),rule.nextSibling);else after.appendChild(rule);
 expect(previewTextMatches(before,after)).toBe(false);
});
it('rejects an image moved past a paragraph despite keeping the image-only order',()=>{
 const image='<img data-block-id="i" src="data:image/png;base64,AA==">';
 expect(previewTextMatches(parse('<p data-block-id="a">A</p>'+image+'<p data-block-id="b">B</p>'),parse('<p data-block-id="a">A</p><p data-block-id="b">B</p>'+image))).toBe(false);
});
it('rejects a text fragment resumed after a different body paragraph',()=>{
 expect(previewTextMatches(parse('<p data-block-id="a">AC</p><p data-block-id="b">B</p>'),parse('<p data-block-id="a">A</p><p data-block-id="b">B</p><p data-block-id="a">C</p>'))).toBe(false);
});
it('accepts interleaved page fragments from separate table cells with images and rules',()=>{
 const first='<p data-preview-block="a">A</p><hr data-block-id="r"><img data-block-id="i" src="data:image/png;base64,AA==">',second='<p data-preview-block="b">B</p>';
 const table=(a:string,b:string)=>`<table data-preview-table="t"><tbody><tr><td data-preview-cell="a">${a}</td><td data-preview-cell="b">${b}</td></tr></tbody></table>`;
 const source=parse(table(first.replace('>A<','>AC<'),second.replace('>B<','>BD<')));
 const pages=parse(table('<p data-preview-block="a">A</p>',second)+table(first.replace('>A<','>C<'),'<p data-preview-block="b">D</p>'));
 expect(previewTextMatches(source,pages)).toBe(true);
});
it('ignores deliberately repeated header rules and images but retains the original ones',()=>{
 const header='<p data-block-id="h">Header</p><hr data-block-id="r"><img data-block-id="i" src="data:image/png;base64,AA==">';
 expect(previewTextMatches(parse(header),parse(header+'<div data-repeated-header="true">'+header+'</div>'))).toBe(true);
});
it('rejects an image moved into another logical table cell',()=>{
 const image='<img data-block-id="i" src="data:image/png;base64,AA==">';
 const table=(a:string,b:string)=>`<table data-preview-table="t"><tr><td data-preview-cell="a"><p data-block-id="a">A</p>${a}</td><td data-preview-cell="b"><p data-block-id="b">B</p>${b}</td></tr></table>`;
 expect(previewTextMatches(parse(table(image,'')),parse(table('',image)))).toBe(false);
});
