import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLocalPdf } from '../components/editor/use-local-pdf';
const calls = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../lib/editor/local-pdf', async original => ({ ...await original<typeof import('../lib/editor/local-pdf')>(), requestLocalPdf: calls.request }));
let mount: HTMLDivElement, root: Root, frame: HTMLIFrameElement, api: ReturnType<typeof useLocalPdf>;
let tab: { document: { title: string; body: { textContent: string } }; opener: unknown; location: { replace: ReturnType<typeof vi.fn> }; closed: boolean; close: ReturnType<typeof vi.fn> };
const error = vi.fn();
function Harness() {
  const value = useLocalPdf({ getDocument: () => frame.contentDocument, details: { title: 'QA', pages: 1, pageSize: 'a4', orientation: 'portrait' }, onError: error });
  useLayoutEffect(() => { api = value; }, [value]); return null;
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); error.mockReset(); calls.request.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: 1, token: 'a'.repeat(64) }) }));
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:local-pdf'), revokeObjectURL: vi.fn() });
  tab = { document: { title: '', body: { textContent: '' } }, opener: {}, location: { replace: vi.fn() }, closed: false, close: vi.fn(() => { tab.closed = true; }) };
  vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
  frame = document.createElement('iframe'); document.body.appendChild(frame);
  frame.contentDocument!.body.innerHTML = '<div id="preview-pages"><div class="pagedjs_page">QA</div></div>';
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await act(async () => root.render(createElement(Harness)));
  expect(api.available).toBe(true);
});
afterEach(() => { act(() => root.unmount()); frame.remove(); mount.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('reports a blocked popup without uploading or changing the preview', () => {
  vi.mocked(window.open).mockReturnValue(null); const before = frame.contentDocument!.body.innerHTML;
  act(() => api.print()); expect(calls.request).not.toHaveBeenCalled(); expect(error).toHaveBeenCalledWith(expect.stringContaining('Allow a new tab'));
  expect(frame.contentDocument!.body.innerHTML).toBe(before);
});
it('prevents duplicate jobs and aborts a cancelled preview before any late navigation', async () => {
  let resolve!: (blob: Blob) => void; calls.request.mockReturnValue(new Promise<Blob>(done => { resolve = done; }));
  await act(async () => { api.print(); api.print(); }); expect(calls.request).toHaveBeenCalledOnce(); expect(window.open).toHaveBeenCalledOnce();
  const signal = calls.request.mock.calls[0][2] as AbortSignal;
  act(() => root.unmount()); root = createRoot(mount); expect(signal.aborted).toBe(true);
  await act(async () => resolve(new Blob(['%PDF-test'])));
  expect(tab.location.replace).not.toHaveBeenCalled(); expect(tab.close).toHaveBeenCalledOnce();
});
it('closes a failed export tab and enables a new attempt without changing the document', async () => {
  const before = frame.contentDocument!.body.innerHTML;
  calls.request.mockRejectedValueOnce(Error('Renderer unavailable'));
  await act(async () => api.print()); expect(error).toHaveBeenCalledWith('Renderer unavailable'); expect(api.preparing).toBe(false); expect(tab.close).toHaveBeenCalledOnce();
  tab.closed = false; calls.request.mockResolvedValueOnce(new Blob(['%PDF-test']));
  await act(async () => api.print()); expect(calls.request).toHaveBeenCalledTimes(2); expect(tab.location.replace).toHaveBeenCalledWith('blob:local-pdf');
  expect(frame.contentDocument!.body.innerHTML).toBe(before);
});
it('uses new server credentials when a still-open preview outlives a restart', async () => {
  const before = frame.contentDocument!.body.innerHTML;
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ version: 1, token: 'b'.repeat(64) }) } as Response);
  calls.request.mockResolvedValueOnce(new Blob(['%PDF-test']));
  await act(async () => api.print());
  expect(calls.request).toHaveBeenCalledOnce();
  expect(calls.request.mock.calls[0][1]).toBe('b'.repeat(64));
  expect(tab.location.replace).toHaveBeenCalledWith('blob:local-pdf');
  expect(frame.contentDocument!.body.innerHTML).toBe(before);
});
it('allows a retry after the local service recovers without reopening the preview', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
  await act(async () => api.print());
  expect(calls.request).not.toHaveBeenCalled();
  expect(tab.close).toHaveBeenCalledOnce(); expect(api.preparing).toBe(false);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('service is unavailable'));
  tab.closed = false;
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ version: 1, token: 'c'.repeat(64) }) } as Response);
  calls.request.mockResolvedValueOnce(new Blob(['%PDF-test']));
  await act(async () => api.print());
  expect(calls.request.mock.calls[0][1]).toBe('c'.repeat(64));
  expect(tab.location.replace).toHaveBeenCalledWith('blob:local-pdf');
});
it('does not upload when the preview closes during credential refresh', async () => {
  let resolve!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>(done => { resolve = done; }));
  act(() => api.print());
  const signal = vi.mocked(fetch).mock.calls.at(-1)![1]!.signal as AbortSignal;
  act(() => root.unmount()); root = createRoot(mount); expect(signal.aborted).toBe(true);
  await act(async () => resolve({ ok: true, json: async () => ({ version: 1, token: 'b'.repeat(64) }) } as Response));
  expect(calls.request).not.toHaveBeenCalled();
  expect(tab.close).toHaveBeenCalledOnce(); expect(tab.location.replace).not.toHaveBeenCalled();
});
