import { expect, it } from 'vitest';
import { previewSource } from '../lib/editor/paged-preview';
import { previewPageBreakMismatch } from '../lib/editor/preview-page-breaks';
const parse = (html: string) => { const root = document.createElement('div'); root.innerHTML = html; return root; };
const page = (html: string) => `<div class="pagedjs_page">${html}</div>`;
const source = () => parse(previewSource('Break QA', '<p>Before 中文</p><div class="page-break"><span>Page break</span></div><h2>After العربية</h2>', { type: 'doc' }).html);
it('rejects a lost break even when all text and the marker survive', () => {
  const original = source(); expect(previewPageBreakMismatch(original, parse(page(original.innerHTML)))).toBe(1);
});
it('accepts a following heading on its own page and does not modify editor HTML', () => {
  const original = source();
  const pages = parse(page(original.children[0].outerHTML) + page(original.children[2].outerHTML));
  expect(previewPageBreakMismatch(original, pages)).toBeNull();
});
it('checks the last page of a split preceding block against the first page of the following block', () => {
  const original = source(), before = original.children[0].outerHTML, after = original.children[2].outerHTML;
  expect(previewPageBreakMismatch(original, parse(page(before) + page(before + after)))).toBe(2);
  expect(previewPageBreakMismatch(original, parse(page(before) + page(before) + page(after)))).toBeNull();
});
it('rejects missing boundary content and ignores repeated table headers', () => {
  const original = source(), before = original.children[0].outerHTML, after = original.children[2].outerHTML;
  expect(previewPageBreakMismatch(original, parse(page(before)))).toBe(1);
  expect(previewPageBreakMismatch(original, parse(page(before) + page(after + `<div data-repeated-header="true">${before}</div>`)))).toBeNull();
});
it('preserves constraints around multiple breaks, including consecutive markers', () => {
  const original = parse(previewSource('QA','<p>A</p><div class="page-break"></div><div class="page-break"></div><p>B</p><div class="page-break"></div><p>C</p>',{type:'doc'}).html);
  const [a,b,c] = Array.from(original.querySelectorAll('p')).map(p=>p.outerHTML);
  expect(previewPageBreakMismatch(original,parse(page(a)+page(b)+page(c)))).toBeNull();
  expect(previewPageBreakMismatch(original,parse(page(a)+page(b+c)))).toBe(2);
});
it('keeps boundary markers and enforces an explicit break before following content in print CSS', () => {
  const result = previewSource('QA','<div class="page-break"></div><p>Only</p><div class="page-break"></div>',{type:'doc'});
  expect(parse(result.html).querySelectorAll('.page-break')).toHaveLength(2);
  expect(result.css).toContain('.page-break + * { break-before:page; }');
  expect(previewPageBreakMismatch(parse(result.html),parse(page(result.html)))).toBeNull();
});
