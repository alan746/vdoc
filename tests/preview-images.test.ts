import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitForPreviewImages } from '../lib/editor/preview-images';
let root: HTMLDivElement, controller: AbortController;
beforeEach(() => { root = document.createElement('div'); controller = new AbortController(); vi.useFakeTimers(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
function img(complete = false, width = 0, height = 0) {
  const image = document.createElement('img'); image.src = 'data:image/png;base64,AA==';
  Object.defineProperties(image, { complete: { value: complete, configurable: true }, naturalWidth: { get: () => width, configurable: true }, naturalHeight: { get: () => height, configurable: true } });
  root.appendChild(image);
  return { image, load: () => { width = 300; height = 150; image.dispatchEvent(new Event('load')); } };
}
it('accepts a document without images', async () => { await expect(waitForPreviewImages(root, controller.signal)).resolves.toBeUndefined(); expect(vi.getTimerCount()).toBe(0); });
it('accepts cached images only when they decoded successfully', async () => {
  img(true, 300, 150); img(true, 1, 1);
  await expect(waitForPreviewImages(root, controller.signal)).resolves.toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
});
it.each([[0, 0], [300, 0], [0, 150]])('rejects a completed but broken image of intrinsic size %s×%s', async (width, height) => {
  img(true, width, height); await expect(waitForPreviewImages(root, controller.signal)).rejects.toThrow('Image 1 could not be loaded'); expect(vi.getTimerCount()).toBe(0);
});
it('waits for every image and ignores repeated load events from one image', async () => {
  const first = img(), second = img(); const done = vi.fn(); const job = waitForPreviewImages(root, controller.signal).then(done);
  first.load(); first.load(); await Promise.resolve(); expect(done).not.toHaveBeenCalled();
  second.load(); await job; expect(done).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('reports the failing image and removes listeners from all remaining images', async () => {
  const first = img(), second = img(); const remove = vi.spyOn(first.image, 'removeEventListener');
  const job = waitForPreviewImages(root, controller.signal); const check = expect(job).rejects.toThrow('Image 2 could not be loaded');
  second.image.dispatchEvent(new Event('error')); await check;
  expect(remove.mock.calls.map(args => args[0])).toEqual(['load', 'error']); expect(vi.getTimerCount()).toBe(0);
  first.load(); controller.abort();
});
it('times out an image that emits no event and releases its listeners', async () => {
  const { image } = img(); const remove = vi.spyOn(image, 'removeEventListener');
  const check = expect(waitForPreviewImages(root, controller.signal)).rejects.toThrow('taking too long');
  await vi.advanceTimersByTimeAsync(15_000); await check;
  expect(remove).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
});
it('cancels on close without waiting for the timeout or accepting late loads', async () => {
  const image = img(); const remove = vi.spyOn(image.image, 'removeEventListener');
  const check = expect(waitForPreviewImages(root, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await check; image.load();
  expect(remove).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
});
it('does no work for a preview that was already closed', async () => {
  img(); controller.abort(); await expect(waitForPreviewImages(root, controller.signal)).rejects.toMatchObject({ name: 'AbortError' }); expect(vi.getTimerCount()).toBe(0);
});

it('does not time out pending images while the preview starts in a hidden tab', async () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  const image = img(); const done = vi.fn(), failed = vi.fn();
  const job = waitForPreviewImages(root, controller.signal).then(done, failed);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(failed).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled();
  hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(14_999); image.load(); await job;
  expect(done).toHaveBeenCalledOnce(); expect(failed).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the remaining image wait budget across multiple background intervals', async () => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  img(); const failed = vi.fn(); const job = waitForPreviewImages(root, controller.signal).catch(failed);
  for (let cycle = 0; cycle < 2; cycle++) {
    await vi.advanceTimersByTimeAsync(5_000);
    hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(failed).not.toHaveBeenCalled();
    hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
  }
  await vi.advanceTimersByTimeAsync(4_999); expect(failed).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); await job;
  expect(failed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: expect.stringContaining('taking too long') }));
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['load', 'error', 'abort'] as const)('settles on %s while hidden and never restarts waiting on return', async action => {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  const image = img(); const done = vi.fn(), failed = vi.fn();
  const job = waitForPreviewImages(root, controller.signal).then(done, failed);
  if (action === 'load') image.load();
  else if (action === 'error') image.image.dispatchEvent(new Event('error'));
  else controller.abort();
  await job;
  expect(done).toHaveBeenCalledTimes(action === 'load' ? 1 : 0);
  expect(failed).toHaveBeenCalledTimes(action === 'load' ? 0 : 1);
  if (action === 'abort') expect(failed).toHaveBeenCalledWith(expect.objectContaining({ name: 'AbortError' }));
  hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange'));
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(done.mock.calls.length + failed.mock.calls.length).toBe(1);
});

it('accepts cached images in a hidden preview without waiting for visibility', async () => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); img(true, 300, 150);
  await expect(waitForPreviewImages(root, controller.signal)).resolves.toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});
