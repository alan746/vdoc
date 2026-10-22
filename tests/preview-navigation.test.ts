import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { trackPreviewPage } from '../lib/infrastructure/preview/preview-navigation';

let root: HTMLDivElement, offset: number, report: ReturnType<typeof vi.fn>, stop: () => void;
const pending = new Map<number, FrameRequestCallback>();
let sequence = 0;
function tick() { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(0)); }
beforeEach(() => {
  offset = 0; sequence = 0; pending.clear(); report = vi.fn();
  vi.stubGlobal('innerHeight', 500);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { pending.set(++sequence, callback); return sequence; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { pending.delete(id); });
  root = document.createElement('div'); document.body.appendChild(root);
  for (let i = 0; i < 3; i++) {
    const page = document.createElement('div'); page.className = 'pagedjs_page'; root.appendChild(page);
    vi.spyOn(page, 'getBoundingClientRect').mockImplementation(() => ({ top: i * 724 - offset, bottom: i * 724 + 700 - offset } as DOMRect));
  }
  stop = trackPreviewPage(root, report);
});
afterEach(() => { stop(); root.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('reports the initial visible page and tracks scrolling in both directions', () => {
  expect(report.mock.calls).toEqual([[1]]);
  for (const [position, expected] of [[1448, 3], [724, 2], [0, 1]]) {
    offset = position; window.dispatchEvent(new Event('scroll')); tick(); expect(report).toHaveBeenLastCalledWith(expected);
  }
});
it('chooses the largest visible page at a boundary, retaining the earlier page on a tie', () => {
  offset = 500; window.dispatchEvent(new Event('scroll')); tick(); expect(report).toHaveBeenLastCalledWith(2);
  offset = 462; window.dispatchEvent(new Event('scroll')); tick(); expect(report).toHaveBeenLastCalledWith(1);
});
it('coalesces scroll events and does not report the same page repeatedly', () => {
  offset = 760;
  for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('scroll'));
  expect(pending.size).toBe(1); tick(); expect(report.mock.calls).toEqual([[1], [2]]);
  offset = 780; window.dispatchEvent(new Event('scroll')); tick(); expect(report).toHaveBeenCalledTimes(2);
});
it('recalculates when the viewport is resized', () => {
  offset = 500; window.dispatchEvent(new Event('resize')); tick(); expect(report).toHaveBeenLastCalledWith(2);
  vi.stubGlobal('innerHeight', 200); window.dispatchEvent(new Event('resize')); tick(); expect(report).toHaveBeenLastCalledWith(1);
});
it('retains the last page when no page is measurable or visible', () => {
  offset = 9999; window.dispatchEvent(new Event('scroll')); tick(); expect(report.mock.calls).toEqual([[1]]);
});
it('cancels queued work and detaches both listeners on close', () => {
  offset = 1448; window.dispatchEvent(new Event('scroll')); expect(pending.size).toBe(1);
  stop(); expect(pending.size).toBe(0); tick();
  window.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize'));
  expect(pending.size).toBe(0); expect(report.mock.calls).toEqual([[1]]);
});
