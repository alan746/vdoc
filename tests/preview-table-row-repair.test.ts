import { expect,it,vi } from 'vitest';
import { repairPreviewTableRows,startPreviewRowsOnNewPage } from '../lib/editor/preview-table-row-repair';
import { previewTableRowMismatch } from '../lib/editor/preview-table-headers';
const parse=(html:string)=>{const root=document.createElement('div');root.innerHTML=html;return root;};
const rect=(height=200)=>new DOMRect(0,0,200,height);
function fixture(){
  const source=parse('<table><tr data-preview-row="r"><td data-preview-cell="a"><p>Long</p></td><td data-preview-cell="b"><p><strong>右 العربية</strong></p></td></tr></table>');
  const pages=parse('<div class="pagedjs_page"><table><tr data-preview-row="r"><td data-preview-cell="a"><p>Lo</p></td><td data-preview-cell="b"></td></tr></table></div><div class="pagedjs_page"><table><tr data-preview-row="r"><td data-preview-cell="a"><p>ng</p></td><td data-preview-cell="b"><p><strong>右 العربية</strong></p></td></tr></table></div>');
  for(const root of [source,pages])root.querySelectorAll('table').forEach(table=>table.setAttribute('data-preview-table','t'));
  const rows=Array.from(pages.querySelectorAll('tr'));rows.forEach(row=>vi.spyOn(row,'getBoundingClientRect').mockReturnValue(rect()));
  const targets=pages.querySelectorAll<HTMLElement>('[data-preview-cell="b"]');
  vi.spyOn(targets[0],'getBoundingClientRect').mockReturnValue(rect());
  vi.spyOn(targets[1].firstElementChild!,'getBoundingClientRect').mockReturnValue(rect(40));
  return {source,pages,rows,target:targets[0],donor:targets[1]};
}
it('moves a complete delayed sibling into its first row fragment, preserving its actual nodes and source',()=>{
  const {source,pages,target,donor}=fixture(),original=source.innerHTML,node=donor.firstElementChild;
  expect(previewTableRowMismatch(source,pages)).toBe(1);
  expect(repairPreviewTableRows(source,pages)).toEqual([]);
  expect(target.firstElementChild).toBe(node);expect(target.textContent).toBe('右 العربية');expect(donor.childNodes).toHaveLength(0);
  expect(previewTableRowMismatch(source,pages)).toBeNull();expect(source.innerHTML).toBe(original);
});
it('rolls back and requests a new-page retry when the target fragment is too short',()=>{
  const {source,pages,target}=fixture(),before=pages.innerHTML;vi.mocked(target.getBoundingClientRect).mockReturnValue(rect(20));
  expect(repairPreviewTableRows(source,pages)).toEqual(['r']);expect(pages.innerHTML).toBe(before);
});
it('rolls back when moving content would resize an already paginated row',()=>{
  const {source,pages,rows}=fixture(),before=pages.innerHTML;
  vi.mocked(rows[0].getBoundingClientRect).mockReturnValueOnce(rect()).mockReturnValueOnce(rect(250));
  expect(repairPreviewTableRows(source,pages)).toEqual(['r']);expect(pages.innerHTML).toBe(before);
});
it.each(['middle','bottom'])('does not relocate an intentionally %s-aligned cell',alignment=>{
  const {source,pages}=fixture(),before=pages.innerHTML;(source.querySelectorAll('td')[1] as HTMLElement).style.verticalAlign=alignment;
  expect(repairPreviewTableRows(source,pages)).toEqual([]);expect(pages.innerHTML).toBe(before);
});
it('does not move a sibling whose contents are themselves split',()=>{
  const {source,pages,donor}=fixture(),before=pages.innerHTML;donor.querySelector('p')!.textContent='Partial';const split=pages.innerHTML;
  expect(repairPreviewTableRows(source,pages)).toEqual([]);expect(pages.innerHTML).toBe(split);expect(split).not.toBe(before);
});
it('recognizes complete content even if the paginator labels the late sibling as split',()=>{
  const {source,pages,donor,target}=fixture();donor.querySelector('p')!.setAttribute('data-split-from','ref');
  expect(repairPreviewTableRows(source,pages)).toEqual([]);expect(target.textContent).toBe('右 العربية');
});
it('does not move partial content distributed across several fragments',()=>{
  const {source,pages}=fixture();pages.appendChild(pages.lastElementChild!.cloneNode(true));const before=pages.innerHTML;
  expect(repairPreviewTableRows(source,pages)).toEqual([]);expect(pages.innerHTML).toBe(before);
});
it('is repeatable and never duplicates content on later repair calls',()=>{
  const {source,pages}=fixture();repairPreviewTableRows(source,pages);const once=pages.innerHTML;expect(repairPreviewTableRows(source,pages)).toEqual([]);expect(pages.innerHTML).toBe(once);
});
it('retries only the named row in a disposable source copy',()=>{
  const html='<table><tr data-preview-row="a"><td>A</td></tr><tr data-preview-row="b"><td>B</td></tr></table>';
  const result=parse(startPreviewRowsOnNewPage(html,['b']));expect(result.querySelectorAll('tr')[0].style.breakBefore).toBe('');expect(result.querySelectorAll('tr')[1].style.breakBefore).toBe('page');expect(result.textContent).toBe('AB');expect(html).not.toContain('break-before');
});

function splitFixture(){
  const source=parse('<table><tr data-preview-row="r"><td data-preview-cell="a"><p>Left</p></td><td data-preview-cell="b"><p data-preview-block="b" dir="rtl"><strong>中文 العربية👩🏽‍💻</strong></p><p data-preview-block="c">End</p></td></tr></table>');
  const contents=['','<p data-preview-block="b" dir="rtl" data-split-to="b"><strong>中文 </strong></p>','<p data-preview-block="b" dir="rtl" data-split-from="b"><strong>العربية👩🏽‍💻</strong></p><p data-preview-block="c">End</p>'];
  const pages=parse(contents.map((content,i)=>`<div class="pagedjs_page"><table><tr data-preview-row="r"><td data-preview-cell="a"><p>${i?'':'Left'}</p></td><td data-preview-cell="b">${content}</td></tr></table></div>`).join(''));
  for(const root of [source,pages])root.querySelectorAll('table').forEach(table=>table.setAttribute('data-preview-table','t'));
  const copies=Array.from(pages.querySelectorAll<HTMLElement>('[data-preview-cell="b"]'));
  pages.querySelectorAll('tr').forEach(row=>vi.spyOn(row,'getBoundingClientRect').mockReturnValue(rect()));
  copies.forEach(cell=>{
    vi.spyOn(cell,'getBoundingClientRect').mockReturnValue(rect());
    Array.from(cell.children).forEach((p,i)=>vi.spyOn(p,'getBoundingClientRect').mockReturnValue(new DOMRect(0,i*35,180,35)));
  });
  return {source,pages,copies};
}
it('moves a complete sequence of late paragraph fragments to earlier pages without cloning or changing bidi/marks',()=>{
  const {source,pages,copies}=splitFixture(),original=source.innerHTML;
  const first=copies[1].firstChild,last=Array.from(copies[2].childNodes);
  expect(repairPreviewTableRows(source,pages)).toEqual([]);
  expect(copies[0].firstChild).toBe(first);expect(Array.from(copies[1].childNodes)).toEqual(last);
  expect(copies[2].childNodes).toHaveLength(0);expect(copies.map(c=>c.textContent).join('')).toBe('中文 العربية👩🏽‍💻End');
  expect(copies[0].querySelector('p')?.dir).toBe('rtl');expect(copies[0].querySelector('strong')?.textContent).toBe('中文 ');
  expect(source.innerHTML).toBe(original);expect(previewTableRowMismatch(source,pages)).toBeNull();
  const once=pages.innerHTML;repairPreviewTableRows(source,pages);expect(pages.innerHTML).toBe(once);
});
it('restores every fragment and style if a continuation does not fit its earlier destination',()=>{
  const {source,pages,copies}=splitFixture();copies[0].innerHTML='<!-- placeholder -->';copies[1].closest('tr')!.style.color='red';
  vi.mocked(copies[1].getBoundingClientRect).mockReturnValue(rect(40));
  const before=pages.innerHTML,nodes=copies.map(cell=>Array.from(cell.childNodes));
  expect(repairPreviewTableRows(source,pages)).toEqual(['r']);expect(pages.innerHTML).toBe(before);
  copies.forEach((cell,i)=>expect(Array.from(cell.childNodes)).toEqual(nodes[i]));
});
it('does not relocate text-complete fragments whose paragraph identity order is wrong',()=>{
  const {source,pages,copies}=splitFixture();copies[2].querySelector('p')!.dataset.previewBlock='other';const before=pages.innerHTML;
  expect(repairPreviewTableRows(source,pages)).toEqual([]);expect(pages.innerHTML).toBe(before);
});
it('does not relocate a sequence with missing text even if paragraph IDs match',()=>{
  const {source,pages,copies}=splitFixture();copies[2].querySelector('strong')!.textContent='العربية';const before=pages.innerHTML;
  expect(repairPreviewTableRows(source,pages)).toEqual([]);expect(pages.innerHTML).toBe(before);
});
it('does not relocate a sequence containing lists or nested objects',()=>{
  const {source,pages,copies}=splitFixture();source.querySelector('[data-preview-cell="b"]')!.innerHTML='<ul><li>中文 العربية👩🏽‍💻End</li></ul>';const before=pages.innerHTML;
  expect(repairPreviewTableRows(source,pages)).toEqual([]);expect(pages.innerHTML).toBe(before);expect(copies[0].textContent).toBe('');
});
it('rejects a split sequence whose image payload differs from the source',()=>{
  const {source,pages,copies}=splitFixture();source.querySelector('[data-preview-block="b"]')!.appendChild(Object.assign(document.createElement('img'),{src:'data:image/png;base64,AAAA'}));copies[1].querySelector('p')!.appendChild(Object.assign(document.createElement('img'),{src:'data:image/png;base64,BBBB'}));const before=pages.innerHTML;
  expect(repairPreviewTableRows(source,pages)).toEqual([]);expect(pages.innerHTML).toBe(before);
});
it('preserves the donor fragment padding budget so a full-height piece does not expand its destination row',()=>{
  const {source,pages,copies}=splitFixture();
  copies[0].style.padding='10px';copies[1].style.padding='10px 10px 0';copies[2].style.padding='0 10px 10px';
  const row=copies[0].closest('tr')!;
  vi.mocked(row.getBoundingClientRect).mockImplementation(()=>rect(copies[0].children.length&&copies[0].style.paddingBottom!=='0px'?210:200));
  expect(repairPreviewTableRows(source,pages)).toEqual([]);
  expect(copies[0].style.paddingTop).toBe('10px');expect(copies[0].style.paddingBottom).toBe('0px');
  expect(copies[0].style.getPropertyPriority('padding-bottom')).toBe('important');
  expect(copies[1].style.paddingTop).toBe('0px');expect(copies[1].style.paddingBottom).toBe('10px');
});
it('rolls back donor padding and nodes if preserving padding still causes horizontal overflow',()=>{
  const {source,pages,copies}=splitFixture();copies.forEach((cell,i)=>{cell.style.padding=`${i+2}px`;});
  vi.mocked(copies[2].firstElementChild!.getBoundingClientRect).mockReturnValue(new DOMRect(0,0,250,35));
  const before=pages.innerHTML;
  expect(repairPreviewTableRows(source,pages)).toEqual(['r']);expect(pages.innerHTML).toBe(before);
});
