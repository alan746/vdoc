import { expect, it } from 'vitest';
import { preparePreviewParagraphBorders, finishPreviewParagraphBorders } from '../lib/infrastructure/preview/preview-paragraph-borders';
import { paragraphBordersAttribute } from '../lib/editor/paragraph/paragraph-borders';
import { prepareParagraphBorderGroups } from '../lib/editor/paragraph/paragraph-border-groups';
import { previewTextMatches } from '../lib/infrastructure/preview/paged-preview';
const edge = { color:'#663399',width:3,style:'solid',padding:6 };
function paragraph(id:string, patch:Record<string,unknown>={}) {
  const p=document.createElement('p');p.textContent=`${id} 中文 العربية`;
  p.dataset.previewBlock=id;p.dataset.paragraphBorderJoin='true';
  const attrs=paragraphBordersAttribute().renderHTML({paragraphBorders:{top:edge,bottom:edge,left:edge,right:edge,...patch},paragraphBorderJoin:true});
  Object.entries(attrs).forEach(([key,value])=>p.setAttribute(key,String(value)));return p.outerHTML;
}
function source(html:string) { const root=document.createElement('div');root.innerHTML=prepareParagraphBorderGroups(html);preparePreviewParagraphBorders(root);return root; }
function pages(...html:string[]) { const root=document.createElement('div');root.innerHTML=html.map(text=>`<div class="pagedjs_page"><div class="pagedjs_area">${text}</div></div>`).join('');return root; }
const lines=(root:HTMLElement)=>Array.from(root.querySelectorAll('p')).map(p=>Array.from(p.querySelectorAll('[data-preview-border-line]')).map(e=>e.getAttribute('data-preview-border-line')));
it('caps each page of a joined group without changing text or adding flow content',()=>{
  const src=source(paragraph('A')+paragraph('B')+paragraph('C'));
  const children=Array.from(src.children);const out=pages(children[0].outerHTML+children[1].outerHTML,children[2].outerHTML);
  const before=Array.from(out.querySelectorAll<HTMLElement>('p')).map(p=>p.style.cssText);
  finishPreviewParagraphBorders(out);expect(lines(out)).toEqual([['top'],['bottom'],['top','bottom']]);
  expect(previewTextMatches(src,out)).toBe(true);
  expect(Array.from(out.querySelectorAll<HTMLElement>('p')).map(p=>p.style.cssText)).toEqual(before);
  expect(Array.from(out.querySelectorAll<HTMLElement>('[data-preview-border-line]')).every(line=>line.style.position==='absolute'&&line.getAttribute('aria-hidden')==='true')).toBe(true);
});
it('draws between lines only inside a page and uses outer styles at its start',()=>{
  const src=source(paragraph('A',{between:{...edge,color:'#112233',width:1,style:'dotted'}})+paragraph('B',{between:{...edge,color:'#112233',width:1,style:'dotted'}}));
  const same=pages(src.innerHTML);finishPreviewParagraphBorders(same);expect(lines(same)).toEqual([['top'],['top','bottom']]);
  expect(same.querySelectorAll<HTMLElement>('[data-preview-border-line="top"]')[1].style.borderTopStyle).toBe('dotted');
  const split=pages(src.children[0].outerHTML,src.children[1].outerHTML);finishPreviewParagraphBorders(split);
  expect(Array.from(split.querySelectorAll<HTMLElement>('[data-preview-border-line="top"]')).every(line=>line.style.borderTopStyle==='solid')).toBe(true);
});
it('reserves the larger asymmetric top/inner edge before layout and retains split padding',()=>{
  const patch={between:{...edge,width:8,padding:12},bottom:{...edge,width:1,padding:0}};
  const src=source(paragraph('A',patch)+paragraph('B',patch));const p=src.lastElementChild as HTMLElement;
  expect(p.style.paddingTop).toBe('24px');expect(p.style.paddingBottom).toBe('1px');
  expect(p.style.getPropertyPriority('padding-top')).toBe('important');expect(p.style.getPropertyPriority('border-bottom')).toBe('important');
});
it('reuses existing joined-paragraph padding instead of adding border widths to every paragraph',()=>{
  const src=source(paragraph('A')+paragraph('B')+paragraph('C'));const p=src.children[1] as HTMLElement;
  expect(p.style.paddingTop).toBe('8px');expect(p.style.paddingBottom).toBe('8px');
});
it('reserves safe caps even when a joined paragraph has zero padding',()=>{
  const patch={top:{...edge,width:8,padding:0},bottom:{...edge,width:8,padding:0}};
  const src=source(paragraph('A',patch)+paragraph('B',patch)+paragraph('C',patch));const p=src.children[1] as HTMLElement;
  expect(p.style.paddingTop).toBe('8px');expect(p.style.paddingBottom).toBe('8px');
});
it('closes both fragments of one long paragraph without losing text',()=>{
  const src=source(paragraph('A'));const first=src.firstElementChild!.cloneNode(true) as HTMLElement, second=first.cloneNode(true) as HTMLElement;
  first.textContent='A 中文 ';second.textContent='العربية';first.dataset.splitTo='ref';second.dataset.splitFrom='ref';
  const out=pages(first.outerHTML,second.outerHTML);finishPreviewParagraphBorders(out);
  expect(lines(out)).toEqual([['top','bottom'],['top','bottom']]);expect(previewTextMatches(src,out)).toBe(true);
});
it('keeps separate table cells and intervening objects isolated',()=>{
  const src=source('<table><tr><td>'+paragraph('A')+paragraph('B')+'</td><td>'+paragraph('C')+'</td></tr></table><hr>'+paragraph('D'));
  const out=pages(src.innerHTML);finishPreviewParagraphBorders(out);expect(lines(out)).toEqual([['top'],['bottom'],['top','bottom'],['top','bottom']]);
});
it('does not invent missing outer edges',()=>{
  const src=source(paragraph('A',{top:undefined,bottom:undefined,between:edge}));const out=pages(src.innerHTML);finishPreviewParagraphBorders(out);expect(lines(out)).toEqual([[]]);
});
it('does not group explicit join=false paragraphs',()=>{
  const src=source((paragraph('A')+paragraph('B')).replaceAll('data-paragraph-border-join="true"','data-paragraph-border-join="false"'));
  const out=pages(src.innerHTML);finishPreviewParagraphBorders(out);expect(lines(out)).toEqual([['top','bottom'],['top','bottom']]);
});
it('is repeatable and leaves source/export HTML unchanged',()=>{
  const src=source(paragraph('A')+paragraph('B'));const original=src.innerHTML,out=pages(original);
  finishPreviewParagraphBorders(out);const once=out.innerHTML;finishPreviewParagraphBorders(out);
  expect(out.innerHTML).toBe(once);expect(src.innerHTML).toBe(original);
});
it('ignores invalid metadata and ordinary paragraphs',()=>{
  const src=source('<p>Plain</p><p data-paragraph-borders="bad">Broken</p>');expect(src.querySelector('[data-preview-paragraph-border]')).toBeNull();
  const out=pages(src.innerHTML);finishPreviewParagraphBorders(out);expect(out.querySelector('[data-preview-border-line]')).toBeNull();
});
