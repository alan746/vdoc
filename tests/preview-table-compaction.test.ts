import { expect,it } from 'vitest';
import { compactPreviewTables } from '../lib/editor/preview-table-compaction';
const parse=(html:string)=>{const root=document.createElement('div');root.innerHTML=html;return root;};
const head='<thead><tr><th><p data-preview-block="h">Header</p></th></tr></thead>';
function fixture(){
  const source=parse(`<p data-preview-block="intro">Intro</p><table data-preview-table="t">${head}<tbody><tr data-preview-row="r"><td data-preview-cell="a" rowspan="2"><p data-preview-block="a">中文 العربية</p></td><td data-preview-cell="b"><p data-preview-block="b">Right</p></td></tr><tr data-preview-row="s"><td data-preview-cell="c"><p data-preview-block="c">Next</p></td></tr></tbody></table><div class="page-break"></div><p data-preview-block="end">End</p>`);
  const repeated=head.replace('<thead>','<thead data-repeated-header="true">');
  const pages=parse(`<div class="pagedjs_page"><table data-preview-table="t" data-preview-repaired="true">${head}<tbody><tr data-preview-row="r" style="height:800px"><td data-preview-cell="a" rowspan="2" style="padding:10px 10px 0"><p data-preview-block="a" data-ref="old" data-split-to="x">中文 </p></td><td data-preview-cell="b"><p data-preview-block="b">Right</p></td></tr></tbody></table></div><div class="pagedjs_page"><table data-preview-table="t">${repeated}<tbody><tr data-preview-row="r" style="height:800px"><td data-preview-cell="a" rowspan="2"><p data-preview-block="a" data-split-from="x">العربية</p></td><td data-preview-cell="b"></td></tr></tbody></table></div><div class="pagedjs_page"><table data-preview-table="t">${repeated}<tbody><tr data-preview-row="r" style="height:800px"><td data-preview-cell="a" rowspan="2"></td><td data-preview-cell="b"></td></tr><tr data-preview-row="s" style="height:100px"><td data-preview-cell="c"><p data-preview-block="c">Next</p></td></tr></tbody></table></div>`);
  return {source,pages};
}
it('removes empty continuation rows, carries a spanning empty cell forward and preserves original document outside the table',()=>{
  const {source,pages}=fixture(),original=source.innerHTML,rendered=pages.innerHTML;
  const result=parse(compactPreviewTables(source,pages)!);const rows=result.querySelectorAll<HTMLTableRowElement>('tbody tr');
  expect(rows).toHaveLength(3);expect(rows[0].cells[0].rowSpan).toBe(1);expect(rows[1].cells[0].rowSpan).toBe(2);
  expect(Array.from(rows[2].cells).map(cell=>cell.dataset.previewCell)).toEqual(['c']);
  expect(result.textContent).toBe('IntroHeader中文 RightالعربيةNextEnd');
  expect(result.querySelectorAll('thead')).toHaveLength(1);expect(result.querySelector('.page-break')).not.toBeNull();
  expect(source.innerHTML).toBe(original);expect(pages.innerHTML).toBe(rendered);
});
it('discards paginator identity and measured heights while preserving split padding and atomic row breaks',()=>{
  const {source,pages}=fixture(),result=parse(compactPreviewTables(source,pages)!);
  expect(result.querySelector('[data-ref],[data-split-to],[data-split-from],[data-preview-repaired]')).toBeNull();
  const row=result.querySelector<HTMLTableRowElement>('tbody tr')!;
  expect(row.style.height).toBe('');expect(row.dataset.breakBefore).toBe('page');expect(row.style.breakInside).toBe('avoid');
  expect(row.cells[0].style.paddingBottom).toBe('0px');expect(row.cells[0].style.getPropertyPriority('padding-bottom')).toBe('important');
});
it('keeps intentional empty paragraphs instead of treating them as paginator placeholders',()=>{
  const {source,pages}=fixture();const last=pages.querySelectorAll('tbody')[2];last.querySelectorAll('td')[1].innerHTML='<p data-preview-block="empty"></p>';
  const result=parse(compactPreviewTables(source,pages)!);expect(result.querySelectorAll('tbody tr')).toHaveLength(4);expect(result.querySelector('[data-preview-block="empty"]')).not.toBeNull();
});
it.each(['height','min-height'])('leaves explicit %s tables on the existing path',property=>{
  const {source,pages}=fixture();source.querySelector<HTMLElement>('tbody tr')!.style.setProperty(property,'80px');
  expect(compactPreviewTables(source,pages)).toBeNull();
});
it('does not touch tables that did not require cell repair',()=>{
  const {source,pages}=fixture();pages.querySelector('[data-preview-repaired]')!.removeAttribute('data-preview-repaired');expect(compactPreviewTables(source,pages)).toBeNull();
});
it('leaves nested tables and explicit in-table page breaks for their separate layout policy',()=>{
  const {source,pages}=fixture();source.querySelector('td')!.insertAdjacentHTML('beforeend','<table><tr><td>Nested</td></tr></table>');expect(compactPreviewTables(source,pages)).toBeNull();
  source.querySelector('td table')!.replaceWith(Object.assign(document.createElement('div'),{className:'page-break'}));expect(compactPreviewTables(source,pages)).toBeNull();
});
it('rejects a damaged rendered header instead of losing or inventing content during reconstruction',()=>{
  const {source,pages}=fixture();pages.querySelector('th p')!.textContent='Damaged';expect(()=>compactPreviewTables(source,pages)).toThrow('Table content could not be preserved');
});
it('rejects a missing logical column instead of silently shifting the remaining cells left',()=>{
  const {source,pages}=fixture();pages.querySelectorAll('tbody')[2].querySelector('[data-preview-cell="a"]')!.remove();
  expect(()=>compactPreviewTables(source,pages)).toThrow('Table columns could not be preserved');
});
it('preserves colspan coverage when joining a vacated rowspan continuation',()=>{
  const {source,pages}=fixture();for(const root of [source,pages])root.querySelectorAll<HTMLTableCellElement>('[data-preview-cell="b"],[data-preview-cell="c"]').forEach(cell=>{cell.colSpan=2;});
  const result=parse(compactPreviewTables(source,pages)!);const rows=result.querySelectorAll<HTMLTableRowElement>('tbody tr');
  expect(rows[1].cells[0].rowSpan).toBe(2);expect(rows[2].cells[0].colSpan).toBe(2);expect(rows[2].cells[0].dataset.previewCell).toBe('c');
});
it('does not merge a short cell through the forced break between fragments of the same logical row',()=>{
  const {source,pages}=fixture(),result=parse(compactPreviewTables(source,pages)!);
  const rows=result.querySelectorAll<HTMLTableRowElement>('tbody tr');
  expect(rows[0].cells[1].dataset.previewCell).toBe('b');expect(rows[0].cells[1].rowSpan).toBe(1);
  expect(rows[1].cells[1].dataset.previewCell).toBe('b');expect(rows[1].cells[1].textContent).toBe('');
});
it('preserves image-only content and its source payload while compacting',()=>{
  const {source,pages}=fixture();const image='<img src="data:image/png;base64,AAAA" alt="Figure">';
  source.querySelector('[data-preview-block="c"]')!.innerHTML=image;pages.querySelector('[data-preview-block="c"]')!.innerHTML=image;
  const result=parse(compactPreviewTables(source,pages)!);expect(result.querySelectorAll('img')).toHaveLength(1);expect(result.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
});
