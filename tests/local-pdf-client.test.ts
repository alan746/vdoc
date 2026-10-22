import { afterEach, expect, it, vi } from 'vitest';
import { captureLocalPdf, requestLocalPdf, requestLocalPdfToken } from '../lib/editor/local-pdf';

const details = { title: 'QA', pages: 1, pageSize: 'a4' as const, orientation: 'portrait' as const };
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });
it('copies only validated preview markup and CSS without changing the source', () => {
  const frame = document.createElement('iframe'); document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.head.innerHTML = '<style>.pagedjs_page{color:black}</style>';
  doc.body.innerHTML = '<div id="preview-pages"><div class="pagedjs_page">Final text</div></div>';
  const before = doc.documentElement.outerHTML, result = captureLocalPdf(doc, details);
  expect(result.html).toContain('Final text'); expect(result.css).toContain('color: black');
  expect(doc.documentElement.outerHTML).toBe(before);
  expect(() => captureLocalPdf(doc, { ...details, pages: 2 })).toThrow('Preview changed');
});
it('refuses external or incomplete images and preserves the document', () => {
  const doc = document.implementation.createHTMLDocument();
  doc.body.innerHTML = '<div id="preview-pages"><div class="pagedjs_page"><img src="https://example.com/image.png"></div></div>';
  const before = doc.body.innerHTML;
  expect(() => captureLocalPdf(doc, details)).toThrow('images'); expect(doc.body.innerHTML).toBe(before);
});
it('passes cancellation through and reports a service failure without returning a fake PDF', async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Renderer unavailable' }) });
  vi.stubGlobal('fetch', fetcher); const controller = new AbortController();
  await expect(requestLocalPdf({ ...details, html: '', css: '' }, 'token', controller.signal)).rejects.toThrow('Renderer unavailable');
  expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
});
it.each([
  { version: 1, token: 'a'.repeat(64) },
  { version: 2, token: 'a'.repeat(64) },
  { version: 1, token: 'not-a-service-token' },
  null,
])('validates refreshed service credentials: %j', async value => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => value });
  vi.stubGlobal('fetch', fetcher); const controller = new AbortController();
  const token = await requestLocalPdfToken(controller.signal);
  expect(token).toBe(value?.version === 1 && value.token.length === 64 ? value.token : null);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ signal: controller.signal, cache: 'no-store' });
});
