import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLocalPdfHandler } from '../scripts/local-pdf-handler.mjs';

let server: Server, origin: string;
const render = vi.fn<(input: unknown, options?: { signal?: AbortSignal }) => Promise<Buffer>>();
const snapshot = { title: 'QA 中文', html: '<div id="preview-pages"><div class="pagedjs_page">QA</div></div>', css: '', pages: 1, pageSize: 'a4', orientation: 'portrait' };
beforeEach(async () => {
  render.mockReset().mockResolvedValue(Buffer.from('%PDF-test'));
  const handler = createLocalPdfHandler({ render, findBrowser: async () => '/local/chrome' });
  server = createServer((req, res) => { void handler(req, res, () => { res.writeHead(404); res.end(); }); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No listener');
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
async function credentials() { return await (await fetch(origin + '/__vdoc/local-pdf')).json() as { token: string }; }
async function submit(token: string, body: unknown = snapshot, headers: Record<string, string> = {}) {
  return fetch(origin + '/__vdoc/local-pdf', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-VDoc-PDF-Token': token, ...headers }, body: JSON.stringify(body) });
}
it('returns a PDF without caching or altering the submitted document', async () => {
  const { token } = await credentials(); const result = await submit(token);
  expect(result.status).toBe(200); expect(result.headers.get('cache-control')).toBe('no-store');
  expect(result.headers.get('content-type')).toBe('application/pdf');
  expect(await result.text()).toBe('%PDF-test'); expect(render.mock.calls[0][0]).toEqual(snapshot);
});
it('rejects cross-origin, stale-token and cross-site requests before rendering', async () => {
  const { token } = await credentials();
  expect((await submit(token, snapshot, { Origin: 'https://example.com' })).status).toBe(403);
  expect((await submit('stale')).status).toBe(403);
  expect((await submit(token, snapshot, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
  expect(render).not.toHaveBeenCalled();
});
it('rejects invalid pages and oversized payloads before launching a renderer', async () => {
  const { token } = await credentials();
  expect((await submit(token, { ...snapshot, pages: 201 })).status).toBe(400);
  expect((await submit(token, { ...snapshot, html: 'x'.repeat(16 * 1024 * 1024 + 1) })).status).toBe(413);
  expect(render).not.toHaveBeenCalled();
});
it('rejects concurrent renders and releases the slot after a renderer failure', async () => {
  const { token } = await credentials();
  let reject!: (reason: Error) => void;
  render.mockImplementationOnce(() => new Promise<Buffer>((_resolve, rejectJob) => { reject = rejectJob; }));
  const first = submit(token);
  await vi.waitFor(() => expect(render).toHaveBeenCalledOnce());
  expect((await submit(token)).status).toBe(409);
  reject(Error('Test renderer failure')); expect((await first).status).toBe(503);
  expect((await submit(token)).status).toBe(200);
});
