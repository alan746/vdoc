import { expect,it } from 'vitest';
import { previewTableHeaderMismatch, previewTableRowMismatch } from '../lib/editor/preview-table-headers';
import { previewSource, repeatTableHeaders, previewTextMatches } from '../lib/editor/paged-preview';
import { finishPreviewParagraphBorders } from '../lib/editor/preview-paragraph-borders';
import { paragraphBorderGroupKey } from '../lib/editor/paragraph-borders';
const parse=(html:string)=>{const root=document.createElement('div');root.innerHTML=html;return root;};
const header='<thead><tr><th rowspan="2"><p style="border:2px solid #225588;padding:4px" data-paragraph-border-join="true">A 中文</p><p style="border:2px solid #225588;padding:4px" data-paragraph-border-join="true">العربية</p></th><th colspan="2"><p>B 日本語</p></th></tr><tr><th><p>C ไทย</p></th><th><p>D עברית</p></th></tr></thead>';
// Source HTML here uses paragraph metadata as the production editor does.
function fixture(){
  const edge={width:2,color:'#225588',style:'solid',padding:3};
  const html=('<table data-pinned-rows="2">'+header+'<tbody><tr><td rowspan="2"><p>Merged</p></td><td><p>R1</p></td><td><p>Right</p></td></tr><tr><td><p>R2</p></td><td><p>End</p></td></tr></tbody></table>').replaceAll('data-paragraph-border-join="true"',`data-paragraph-border-join="true" data-paragraph-borders='${JSON.stringify({top:edge,bottom:edge,left:edge,right:edge})}'`);
  const input=parse(html);
  input.querySelectorAll('[data-paragraph-borders]').forEach(p=>p.setAttribute('data-paragraph-border-key',paragraphBorderGroupKey({paragraphBorders:JSON.parse(p.getAttribute('data-paragraph-borders')!),paragraphBorderJoin:true})!));
  const src=parse(previewSource('Headers',input.innerHTML,{type:'doc'}).html);
  const first=src.querySelector('table')!.cloneNode(true) as HTMLTableElement;
  const second=first.cloneNode(true) as HTMLTableElement;second.querySelector('thead')!.remove();
  repeatTableHeaders(second.querySelector('td')!,src.querySelector('td')!);
  const out=parse('<div class="pagedjs_page">'+first.outerHTML+'</div><div class="pagedjs_page">'+second.outerHTML+'</div>');
  return {src,out,head:out.querySelectorAll('thead')[1]};
}
it('accepts merged multirow headers and border decorations after repetition',()=>{
  const {src,out}=fixture();finishPreviewParagraphBorders(out);
  expect(previewTableHeaderMismatch(src,out)).toBeNull();
  expect(out.querySelectorAll('thead [data-preview-border-line]')).toHaveLength(4);
});
it.each(['missing','duplicate','text','cell','rowspan','image','border','paragraph'])('rejects a %s repeated header on its actual page',kind=>{
  const {src,out,head}=fixture();
  if(kind==='missing')head.remove();
  if(kind==='duplicate')head.parentElement!.appendChild(head.cloneNode(true));
  if(kind==='text')head.querySelector('p')!.textContent='Lost text';
  if(kind==='cell')head.querySelector('th')!.remove();
  if(kind==='rowspan')head.querySelector('th')!.setAttribute('rowspan','1');
  if(kind==='image')head.querySelector('th')!.appendChild(document.createElement('img'));
  if(kind==='border')head.querySelector('p')!.removeAttribute('data-paragraph-borders');
  if(kind==='paragraph')head.querySelector('p')!.remove();
  expect(previewTableHeaderMismatch(src,out)).toBe(2);
});
it('rejects unknown table identities without confusing two similar headers',()=>{
  const {src,out}=fixture();out.querySelectorAll('table')[1].setAttribute('data-preview-table','other');expect(previewTableHeaderMismatch(src,out)).toBe(2);
});
it('does not require a header on an explicitly unpinned table',()=>{
  const src=parse(previewSource('No header','<table data-pinned-rows="0"><tr><th><p>Styled cell</p></th></tr></table>',{type:'doc'}).html);
  const out=parse('<div class="pagedjs_page">'+src.innerHTML+'</div>');expect(previewTableHeaderMismatch(src,out)).toBeNull();
  out.querySelector('table')!.insertAdjacentHTML('afterbegin','<thead><tr><th>Unexpected</th></tr></thead>');expect(previewTableHeaderMismatch(src,out)).toBe(1);
});
it('checks nested table headers independently',()=>{
  const html='<table data-pinned-rows="1"><tr><th><p>Outer</p></th></tr><tr><td><table data-pinned-rows="1"><tr><th><p>Inner</p></th></tr><tr><td><p>Text</p></td></tr></table></td></tr></table>';
  const src=parse(previewSource('Nested',html,{type:'doc'}).html),out=parse('<div class="pagedjs_page">'+src.innerHTML+'</div>');
  expect(previewTableHeaderMismatch(src,out)).toBeNull();out.querySelectorAll('thead')[1].remove();expect(previewTableHeaderMismatch(src,out)).toBe(1);
});
it('catches damage that body completeness intentionally excludes',()=>{
  const {src,out,head}=fixture();out.querySelectorAll('tbody')[1].remove();head.querySelector('p')!.textContent='Incomplete';
  expect(previewTextMatches(src,out)).toBe(true);expect(previewTableHeaderMismatch(src,out)).toBe(2);
});

it('rejects deferred sibling cells even when text completeness passes',()=>{
  const src=parse(previewSource('Split','<table><tr><td rowspan="2"><p>Long</p></td><td><p>Right</p></td></tr><tr><td><p>Next</p></td></tr></table>',{type:'doc'}).html);
  const first=src.querySelector('tr')!.cloneNode(true) as HTMLElement;
  const last=src.querySelector('table')!.cloneNode(true) as HTMLElement;
  first.children[1].textContent='';last.querySelector('td')!.textContent='';
  // Real paginator fragments retain the source table's preview identity.
  const firstTable=src.querySelector('table')!.cloneNode(false) as HTMLElement;
  firstTable.innerHTML='<tbody>'+first.outerHTML+'</tbody>';
  const out=parse('<div class="pagedjs_page">'+firstTable.outerHTML+'</div><div class="pagedjs_page">'+last.outerHTML+'</div>');
  // The first cell remains structurally present on both fragments; the right
  // cell must also be present when the row first begins.
  expect(previewTextMatches(src,out)).toBe(true);expect(previewTableRowMismatch(src,out)).toBe(1);
});
it('accepts complete row starts and their later partial fragments',()=>{
  const {src,out}=fixture();expect(previewTableRowMismatch(src,out)).toBeNull();
  out.querySelectorAll('tbody')[1].querySelector('td')!.replaceChildren();
  expect(previewTableRowMismatch(src,out)).toBeNull();
});
it('does not require earlier-row rowspan cells to start again in the next row',()=>{
  const {src,out}=fixture();expect(previewTableRowMismatch(src,out)).toBeNull();
});
it.each(['middle','bottom'])('allows intentional %s alignment to start content on a later fragment',align=>{
  const src=parse(previewSource('Aligned',`<table><tr><td><p>Long</p></td><td style="vertical-align:${align}"><p>Right</p></td></tr></table>`,{type:'doc'}).html);
  const out=parse('<div class="pagedjs_page">'+src.innerHTML+'</div>');out.querySelectorAll('td')[1].textContent='';expect(previewTableRowMismatch(src,out)).toBeNull();
});

function structuredHeader() {
 const html='<table data-pinned-rows="1"><tr><th><p>A<br>B</p><hr><p>C</p><img src="data:image/png;base64,AA==" alt="Header figure"><ol start="7"><li><p>Item</p></li></ol><table data-pinned-rows="0"><tr><td><p>Nested A</p></td><td><p>Nested B</p></td></tr></table></th></tr><tr><td><p>Body</p></td></tr></table>';
 const src=parse(previewSource('Structured header',html,{type:'doc'}).html);
 const out=parse('<div class="pagedjs_page">'+src.innerHTML+'</div><div class="pagedjs_page">'+src.innerHTML+'</div>');
 const head=out.querySelectorAll('.pagedjs_page')[1].querySelector('thead')!;
 head.setAttribute('data-repeated-header','true');
 return {src,out,head};
}
it.each(['missing-break','duplicate-break','moved-break','missing-rule','duplicate-rule','moved-image','list-start','list-flattened','nested-colspan'])('rejects repeated header structure corruption: %s',kind=>{
 const {src,out,head}=structuredHeader();
 const br=head.querySelector('br')!,rule=head.querySelector('hr')!;
 if(kind==='missing-break')br.remove();
 if(kind==='duplicate-break')br.parentNode!.insertBefore(br.cloneNode(),br);
 if(kind==='moved-break')br.parentNode!.appendChild(br);
 if(kind==='missing-rule')rule.remove();
 if(kind==='duplicate-rule')rule.parentNode!.insertBefore(rule.cloneNode(),rule);
 if(kind==='moved-image')head.querySelector('th')!.appendChild(head.querySelector('img')!);
 if(kind==='list-start')head.querySelector('ol')!.setAttribute('start','8');
 if(kind==='list-flattened'){const list=head.querySelector('ol')!;list.replaceWith(...list.querySelectorAll('p'));}
 if(kind==='nested-colspan')head.querySelector('td')!.setAttribute('colspan','2');
 expect(previewTableHeaderMismatch(src,out)).toBe(2);
});
it('accepts structured repeated headers despite generated spans and border decorations',()=>{
 const {src,out,head}=structuredHeader();
 const paragraph=head.querySelector('p')!;
 paragraph.innerHTML='<span data-preview-run>A</span><br><strong>B</strong><span data-preview-border-line="bottom"></span>';
 expect(previewTableHeaderMismatch(src,out)).toBeNull();
});
it('does not mutate source or rendered structured headers while comparing them',()=>{
 const {src,out}=structuredHeader();const before=[src.innerHTML,out.innerHTML];
 expect(previewTableHeaderMismatch(src,out)).toBeNull();
 expect([src.innerHTML,out.innerHTML]).toEqual(before);
});

function rowGrid() {
 const src=parse(previewSource('Grid','<table data-pinned-rows="0"><tr><td rowspan="2"><p>A</p></td><td colspan="2"><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td></tr></table>',{type:'doc'}).html);
 const out=parse('<div class="pagedjs_page">'+src.innerHTML+'</div>');
 return {src,out,rows:Array.from(out.querySelectorAll('tr'))};
}
it.each(['colspan','reordered-cells','duplicate-cell','unknown-cell','unknown-row','missing-empty-row','reordered-rows'])('rejects table grid corruption with preserved text: %s',kind=>{
 const {src,out,rows}=rowGrid();
 if(kind==='colspan')rows[0].cells[1].colSpan=1;
 if(kind==='reordered-cells')rows[1].appendChild(rows[1].cells[0]);
 if(kind==='duplicate-cell')rows[2].appendChild(rows[2].cells[0].cloneNode(true));
 if(kind==='unknown-cell')rows[2].cells[0].setAttribute('data-preview-cell','unknown');
 if(kind==='unknown-row')rows[2].setAttribute('data-preview-row','unknown');
 if(kind==='missing-empty-row')rows[2].remove();
 if(kind==='reordered-rows')rows[1].parentNode!.insertBefore(rows[2],rows[1]);
 expect(previewTableRowMismatch(src,out)).toBe(1);
});
it('checks colspan on later row fragments as well as the first one',()=>{
 const {src,out}=rowGrid();const second=out.firstElementChild!.cloneNode(true) as HTMLElement;
 second.querySelector('td[colspan]')!.setAttribute('colspan','1');out.appendChild(second);
 expect(previewTableRowMismatch(src,out)).toBe(2);
});
it('rejects cells moved from a different table despite retaining their IDs and text',()=>{
 const src=parse(previewSource('Two tables','<table><tr><td><p>A</p></td></tr></table><table><tr><td><p>B</p></td></tr></table>',{type:'doc'}).html);
 const out=parse('<div class="pagedjs_page">'+src.innerHTML+'</div>');const rows=out.querySelectorAll('tr');
 rows[1].appendChild(rows[0].cells[0].cloneNode(true));expect(previewTableRowMismatch(src,out)).toBe(1);
});
it('rejects an explicit carry cell when the previous physical rowspan still occupies that slot',()=>{
 const {src,out,rows}=rowGrid();const carried=rows[0].cells[0].cloneNode(true) as HTMLTableCellElement;
 carried.rowSpan=1;carried.replaceChildren();rows[1].insertBefore(carried,rows[1].firstChild);
 expect(previewTableRowMismatch(src,out)).toBe(1);
});
it('rejects a carried cell that outlives its original logical rowspan',()=>{
 const {src,out,rows}=rowGrid();const carried=rows[0].cells[0].cloneNode(true) as HTMLTableCellElement;
 carried.rowSpan=1;carried.replaceChildren();rows[2].insertBefore(carried,rows[2].firstChild);
 expect(previewTableRowMismatch(src,out)).toBe(1);
});

it.each(['ltr','rtl'])('rejects a shortened rowspan that shifts the next row into the wrong column (%s)',direction=>{
 const {src,out,rows}=rowGrid();src.querySelector('table')!.dir=direction;out.querySelector('table')!.dir=direction;
 rows[0].cells[0].rowSpan=1;
 expect(previewTableRowMismatch(src,out)).toBe(1);
});
it('rejects an overlong rowspan that shifts a later complete row',()=>{
 const {src,out,rows}=rowGrid();rows[0].cells[0].rowSpan=3;
 expect(previewTableRowMismatch(src,out)).toBe(1);
});
it('rejects a continuation missing its empty leading cell even when all cell IDs are valid',()=>{
 const {src,out}=rowGrid();const second=out.firstElementChild!.cloneNode(true) as HTMLElement;
 second.querySelector('td')!.remove();out.appendChild(second);
 expect(previewTableRowMismatch(src,out)).toBe(2);
});
it('accepts clamped rowspans and explicit empty carry cells that retain their physical column',()=>{
 const {src,out,rows}=rowGrid();const first=rows[0].cells[0];first.rowSpan=1;
 const carried=first.cloneNode(true) as HTMLTableCellElement;carried.replaceChildren();rows[1].insertBefore(carried,rows[1].firstChild);
 expect(previewTableRowMismatch(src,out)).toBeNull();
});
it('keeps physical occupancy independent between nested tables and sibling tables',()=>{
 const html='<table><tr><td rowspan="2"><p>A</p></td><td><table><tr><td rowspan="2"><p>Inner A</p></td><td><p>Inner B</p></td></tr><tr><td><p>Inner C</p></td></tr></table></td></tr><tr><td><p>C</p></td></tr></table><table><tr><td><p>Other</p></td></tr></table>';
 const src=parse(previewSource('Nested',html,{type:'doc'}).html),out=parse('<div class="pagedjs_page">'+src.innerHTML+'</div>');
 expect(previewTableRowMismatch(src,out)).toBeNull();
});
