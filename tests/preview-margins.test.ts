import { afterEach, expect, it, vi } from 'vitest';
import { previewMarginOverflow, previewOverflowPage } from '../lib/editor/preview-layout';
import { previewSource } from '../lib/editor/paged-preview';
afterEach(() => vi.restoreAllMocks());
const rect = (x: number, y: number, width: number, height: number) => new DOMRect(x, y, width, height);
function fixture(slot = 'top-center', page = 1) {
  const root = document.createElement('div');
  root.innerHTML = '<div class="pagedjs_page"></div>'.repeat(page - 1) + `<div class="pagedjs_page"><div class="pagedjs_area"></div><div class="pagedjs_margin-${slot} hasContent"><div class="pagedjs_margin-content"></div></div></div>`;
  const box = root.querySelector<HTMLElement>(`.pagedjs_margin-${slot}`)!;
  const text = box.firstElementChild as HTMLElement;
  vi.spyOn(root.querySelector('.pagedjs_area')!, 'getBoundingClientRect').mockReturnValue(rect(20, 40, 600, 800));
  vi.spyOn(box, 'getBoundingClientRect').mockReturnValue(rect(20, 10, 200, 20));
  vi.spyOn(text, 'getBoundingClientRect').mockReturnValue(rect(20, 12, 200, 16));
  Object.defineProperties(text, {
    clientWidth: { value: 200, configurable: true }, scrollWidth: { value: 200, configurable: true },
    clientHeight: { value: 16, configurable: true }, scrollHeight: { value: 16, configurable: true },
  });
  return { root, box, text };
}
it('accepts a fitting margin without mistaking it for body content', () => {
  const { root } = fixture(); expect(previewOverflowPage(root)).toBeNull(); expect(previewMarginOverflow(root)).toBeNull();
});
it.each([['top-center', 'Header'], ['bottom-left', 'Footer'], ['bottom-right', 'Page number']] as const)('reports the correct page and region for overflowing %s', (slot, part) => {
  const { root, text } = fixture(slot, 3); vi.mocked(text.getBoundingClientRect).mockReturnValue(rect(20, 2, 200, 40));
  expect(previewOverflowPage(root)).toBeNull(); // The previous body-only audit missed this.
  expect(previewMarginOverflow(root)).toEqual({ page: 3, part });
});
it.each(['scrollWidth', 'scrollHeight'] as const)('detects CSS generated text overflow through %s even when the box fits', property => {
  const { root, text } = fixture(); Object.defineProperty(text, property, { value: 500 });
  expect(previewMarginOverflow(root)).toEqual({ page: 1, part: 'Header' });
});
it('detects horizontal escape into a neighboring margin slot', () => {
  const { root, text } = fixture('bottom-left'); vi.mocked(text.getBoundingClientRect).mockReturnValue(rect(20, 12, 260, 16));
  expect(previewMarginOverflow(root)).toEqual({ page: 1, part: 'Footer' });
});
it('ignores empty inactive margin slots with no printable content', () => {
  const { root, box, text } = fixture(); box.classList.remove('hasContent');
  vi.mocked(text.getBoundingClientRect).mockReturnValue(rect(0, 0, 0, 0)); expect(previewMarginOverflow(root)).toBeNull();
});
it('rejects active content that has no measurable layout', () => {
  const { root, text } = fixture(); vi.mocked(text.getBoundingClientRect).mockReturnValue(rect(0, 0, 0, 0));
  expect(previewMarginOverflow(root)).toEqual({ page: 1, part: 'Header' });
});
it('rejects an active margin whose generated content container is missing', () => {
  const { root, text } = fixture(); text.remove(); expect(previewMarginOverflow(root)).toEqual({ page: 1, part: 'Header' });
});
it('detects a slot that expanded beyond the actual printable margin group', () => {
  const { root, box } = fixture(); const group = document.createElement('div'); group.className = 'pagedjs_margin-top';
  box.replaceWith(group); group.appendChild(box); vi.spyOn(group, 'getBoundingClientRect').mockReturnValue(rect(20, 10, 150, 20));
  expect(previewMarginOverflow(root)).toEqual({ page: 1, part: 'Header' });
});
it('allows subpixel rounding within the same tolerance as the body audit', () => {
  const { root, text } = fixture(); vi.mocked(text.getBoundingClientRect).mockReturnValue(rect(19.5, 9.5, 201, 21));
  Object.defineProperty(text, 'scrollWidth', { value: 201 }); expect(previewMarginOverflow(root)).toBeNull();
});
it('treats CRLF as one line break and preserves multilingual text and CSS escaping', () => {
  const source = previewSource('Header', '<p>Body</p>', { type: 'doc', attrs: { header: '中文\r\nالعربية\r日本語\n"\\End', footer: 'LongFooter' } });
  expect(source.css).toContain('中文\\A العربية\\A 日本語\\A \\"\\\\End');
  expect(source.css.match(/overflow-wrap:anywhere/g)?.length).toBeGreaterThanOrEqual(2);
});
it('uses content:none for empty headers and footers so they cannot consume the page number slot', () => {
  const source = previewSource('Empty', '<p>Body</p>', { type: 'doc', attrs: { pageNumbers: true } });
  expect(source.css).toContain('@top-center { content:none;'); expect(source.css).toContain('@bottom-left { content:none;');
  expect(source.css).toContain('counter(page) " / " counter(pages)');
  expect(source.css).toContain('white-space:nowrap; min-width:5em;');
});
it('does not reserve page number width when page numbers are disabled', () => {
  const source = previewSource('Footer only', '<p>Body</p>', { type: 'doc', attrs: { footer: 'Footer', pageNumbers: false } });
  expect(source.css).toContain('@bottom-right { content:none; white-space:nowrap; min-width:0;');
});
