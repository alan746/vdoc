import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrintPreview } from '../components/editor/print-preview';

let mount: HTMLDivElement, root: Root, frame: HTMLIFrameElement, token: string;
const snapshot = { title: 'Navigation QA', html: '<p>QA</p>', content: { type: 'doc' } };
async function receive(data: object, origin = window.location.origin, source: Window = frame.contentWindow!) {
  await act(async () => window.dispatchEvent(new MessageEvent('message', { source, origin, data: { token, ...data } })));
}
const select = () => mount.ownerDocument.querySelector('select')!;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await act(async () => root.render(createElement(PrintPreview, { snapshot, close: vi.fn() })));
  frame = document.querySelector('iframe')!;
  const sent = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  await receive({ type: 'vdoc-preview-ready' });
  token = (sent.mock.calls.at(-1)![0] as { token: string }).token;
  await receive({ type: 'vdoc-preview-status', state: 'ready', pages: 3 });
});
afterEach(() => { act(() => root.unmount()); mount.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('updates the selector after manual scrolling and allows returning to the previously chosen page', async () => {
  const sent = vi.spyOn(frame.contentWindow!, 'postMessage');
  await act(async () => { select().value = '2'; select().dispatchEvent(new Event('change', { bubbles: true })); });
  expect(select().value).toBe('2');
  await receive({ type: 'vdoc-preview-current-page', page: 3 }); expect(select().value).toBe('3');
  await act(async () => { select().value = '2'; select().dispatchEvent(new Event('change', { bubbles: true })); });
  expect(sent).toHaveBeenLastCalledWith({ type: 'vdoc-preview-page', token, page: 2 }, window.location.origin);
  expect(select().value).toBe('2');
});
it('rejects unrelated windows, stale tokens and invalid page reports', async () => {
  for (const page of [0, 4, 1.5, '2', null]) await receive({ type: 'vdoc-preview-current-page', page });
  await receive({ type: 'vdoc-preview-current-page', page: 2, token: 'stale' });
  await receive({ type: 'vdoc-preview-current-page', page: 2 }, 'https://example.com');
  await receive({ type: 'vdoc-preview-current-page', page: 2 }, window.location.origin, window);
  expect(select().value).toBe('1');
  await receive({ type: 'vdoc-preview-current-page', page: 2 }); expect(select().value).toBe('2');
});

function shortcut(init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key: 'p', metaKey: true, bubbles: true, cancelable: true, ...init });
  act(() => select().dispatchEvent(event)); return event;
}
it.each([{ metaKey: true }, { ctrlKey: true, metaKey: false }])('prints the current preview from its page selector: %j', flags => {
  const sent = vi.spyOn(frame.contentWindow!, 'postMessage'); sent.mockClear();
  const editorShortcut = vi.fn((event: KeyboardEvent) => { if (!event.defaultPrevented) throw new Error('Editor shortcut intercepted preview print'); });
  window.addEventListener('keydown', editorShortcut);
  try {
    expect(shortcut(flags).defaultPrevented).toBe(true);
    expect(sent).toHaveBeenCalledExactlyOnceWith({ type: 'vdoc-preview-print', token }, window.location.origin);
    expect(editorShortcut).toHaveBeenCalledOnce(); expect(document.querySelector('iframe')).toBe(frame);
  } finally { window.removeEventListener('keydown', editorShortcut); }
});
it.each(['loading', 'error'])('blocks native/editor print while preview is %s', async state => {
  const sent = vi.spyOn(frame.contentWindow!, 'postMessage'); sent.mockClear();
  await receive({ type: 'vdoc-preview-status', state, error: 'Layout needs review.' });
  const event = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true });
  act(() => window.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true); expect(sent).not.toHaveBeenCalled();
});
it('does not repeat printing while the shortcut is held or composing', () => {
  const sent = vi.spyOn(frame.contentWindow!, 'postMessage'); sent.mockClear();
  for (const flags of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }]) shortcut(flags);
  expect(sent).not.toHaveBeenCalled();
});
it('keeps pages and selection on print failure and allows retry without rebuilding the iframe', async () => {
  await receive({ type: 'vdoc-preview-current-page', page: 3 });
  await receive({ type: 'vdoc-preview-print-result', error: 'Could not open the print dialog. Try again.' });
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Try again');
  expect(select().value).toBe('3'); expect(document.querySelector('iframe')).toBe(frame);
  const button = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Print / Save PDF')!;
  expect(button.disabled).toBe(false);
  const sent = vi.spyOn(frame.contentWindow!, 'postMessage'); sent.mockClear();
  act(() => button.click());
  expect(sent).toHaveBeenCalledExactlyOnceWith({ type: 'vdoc-preview-print', token }, window.location.origin);
  expect(document.querySelector('[role="alert"]')).toBeNull(); expect(select().value).toBe('3');
});
it('ignores print failures from another origin, window or token', async () => {
  const error = { type: 'vdoc-preview-print-result', error: 'Unrelated failure' };
  await receive({ ...error, token: 'old' }); await receive(error, 'https://example.com'); await receive(error, window.location.origin, window);
  expect(document.querySelector('[role="alert"]')).toBeNull();
});
it('removes the outer printing shortcut when the preview closes', () => {
  act(() => root.unmount()); root = createRoot(mount);
  const event = new KeyboardEvent('keydown', { key: 'p', metaKey: true, cancelable: true });
  window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
});

const buttonNamed = (name: string) => Array.from(document.querySelectorAll('button')).find(button => button.textContent === name)!;
async function retryFailedPreview() {
  const previousWindow = frame.contentWindow!;
  const previousToken = token;
  await receive({ type: 'vdoc-preview-status', state: 'error', error: 'Image 1 could not be loaded.' });
  expect(buttonNamed('Print / Save PDF').disabled).toBe(true);
  expect(document.querySelector('iframe')).toBeNull();
  const retry = buttonNamed('Retry preview'); expect(retry).toBeDefined();
  await act(async () => retry.click());
  frame = document.querySelector('iframe')!;
  expect(frame).not.toBeNull();
  const sent = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
  await receive({ type: 'vdoc-preview-ready' });
  token = (sent.mock.calls.at(-1)![0] as { token: string }).token;
  return { previousWindow, previousToken, sent };
}
it('retries failed pagination in a fresh frame with the exact captured document', async () => {
  const { previousToken, sent } = await retryFailedPreview();
  expect(token).not.toBe(previousToken);
  expect(sent).toHaveBeenLastCalledWith({ type: 'vdoc-preview-render', token, snapshot }, window.location.origin);
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Preparing pages…');
  expect(buttonNamed('Print / Save PDF').disabled).toBe(true);
  expect(buttonNamed('Retry preview')).toBeUndefined();
  await receive({ type: 'vdoc-preview-status', state: 'ready', pages: 2 });
  expect(select().options).toHaveLength(2); expect(select().value).toBe('1');
  act(() => buttonNamed('Print / Save PDF').click());
  expect(sent).toHaveBeenLastCalledWith({ type: 'vdoc-preview-print', token }, window.location.origin);
});
it('ignores late results from the failed preview after retry', async () => {
  const { previousWindow, previousToken } = await retryFailedPreview();
  await receive({ type: 'vdoc-preview-status', state: 'ready', pages: 99, token: previousToken }, window.location.origin, previousWindow);
  await receive({ type: 'vdoc-preview-status', state: 'ready', pages: 99, token: previousToken });
  await receive({ type: 'vdoc-preview-print-result', error: 'Old failure', token: previousToken });
  expect(buttonNamed('Print / Save PDF').disabled).toBe(true);
  expect(document.querySelector('select')).toBeNull(); expect(document.querySelector('[role="alert"]')).toBeNull();
});
it('starts a fresh timeout on retry and permits another retry after it expires', async () => {
  vi.useFakeTimers();
  try {
    await retryFailedPreview();
    await act(async () => { vi.advanceTimersByTime(59_999); });
    expect(document.querySelector('iframe')).not.toBeNull();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(document.querySelector('[role="status"]')?.textContent).toContain('taking too long');
    expect(document.querySelector('iframe')).toBeNull();
    await act(async () => buttonNamed('Retry preview').click());
    expect(document.querySelector('iframe')).not.toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Preparing pages…');
  } finally { vi.useRealTimers(); }
});
it('does not let the retry timeout invalidate a successfully prepared preview', async () => {
  vi.useFakeTimers();
  try {
    await retryFailedPreview();
    await receive({ type: 'vdoc-preview-status', state: 'ready', pages: 2 });
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(buttonNamed('Print / Save PDF').disabled).toBe(false);
    expect(select().options).toHaveLength(2); expect(document.querySelector('iframe')).toBe(frame);
  } finally { vi.useRealTimers(); }
});

it('does not expire a preview opened in a hidden tab and starts its budget when visible', async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  try {
    await retryFailedPreview();
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(document.querySelector('iframe')).toBe(frame);
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Preparing pages…');
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => { vi.advanceTimersByTime(59_999); });
    expect(document.querySelector('iframe')).toBe(frame);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(document.querySelector('[role="status"]')?.textContent).toContain('taking too long');
  } finally { vi.useRealTimers(); }
});
it('preserves the remaining visible wait budget across backgrounding without extending it', async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  try {
    await retryFailedPreview();
    await act(async () => { vi.advanceTimersByTime(20_000); });
    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => { vi.advanceTimersByTime(180_000); });
    expect(document.querySelector('iframe')).toBe(frame);
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => { vi.advanceTimersByTime(39_999); });
    expect(document.querySelector('iframe')).toBe(frame);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(document.querySelector('iframe')).toBeNull();
  } finally { vi.useRealTimers(); }
});
it('keeps a ready preview intact after a hidden-tab interval and return', async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  try {
    await retryFailedPreview();
    await act(async () => { vi.advanceTimersByTime(120_000); });
    await receive({ type: 'vdoc-preview-status', state: 'ready', pages: 5 });
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(buttonNamed('Print / Save PDF').disabled).toBe(false);
    expect(select().options).toHaveLength(5);
    expect(document.querySelector('iframe')).toBe(frame);
  } finally { vi.useRealTimers(); }
});
it('does not restart the suspended timeout after closing the preview', async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  try {
    await retryFailedPreview();
    act(() => root.unmount()); root = createRoot(mount);
    const timersAfterClosing = vi.getTimerCount();
    hidden.mockReturnValue(false);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(vi.getTimerCount()).toBe(timersAfterClosing);
  } finally { vi.useRealTimers(); }
});

it('recovers a lost initial render by probing and resending only after the frame answers', async () => {
  vi.useFakeTimers();
  try {
    const { sent } = await retryFailedPreview(); sent.mockClear();
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(sent.mock.calls.map(call => call[0])).toEqual([
      { type: 'vdoc-preview-connect', token }, { type: 'vdoc-preview-connect', token },
    ]);
    await receive({ type: 'vdoc-preview-ready' });
    expect(sent).toHaveBeenLastCalledWith({ type: 'vdoc-preview-render', token, snapshot }, window.location.origin);
    await receive({ type: 'vdoc-preview-accepted' }); sent.mockClear();
    await act(async () => { vi.advanceTimersByTime(3000); });
    await receive({ type: 'vdoc-preview-ready' });
    expect(sent).not.toHaveBeenCalled();
    expect(buttonNamed('Print / Save PDF').disabled).toBe(true);
    await receive({ type: 'vdoc-preview-status', state: 'ready', pages: 5 });
    expect(buttonNamed('Print / Save PDF').disabled).toBe(false);
  } finally { vi.useRealTimers(); }
});
it('keeps probing when acceptance comes from an old token, window or origin', async () => {
  vi.useFakeTimers();
  try {
    const { sent, previousToken, previousWindow } = await retryFailedPreview();
    await receive({ type: 'vdoc-preview-accepted', token: previousToken });
    await receive({ type: 'vdoc-preview-accepted' }, 'https://example.com');
    await receive({ type: 'vdoc-preview-accepted' }, window.location.origin, previousWindow);
    sent.mockClear();
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(sent).toHaveBeenCalledExactlyOnceWith({ type: 'vdoc-preview-connect', token }, window.location.origin);
  } finally { vi.useRealTimers(); }
});
it('does not probe a hidden frame and reconnects immediately when visible', async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  try {
    const { sent } = await retryFailedPreview(); sent.mockClear();
    await act(async () => { vi.advanceTimersByTime(120000); });
    expect(sent).not.toHaveBeenCalled();
    hidden.mockReturnValue(false); act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(sent).toHaveBeenCalledExactlyOnceWith({ type: 'vdoc-preview-connect', token }, window.location.origin);
  } finally { vi.useRealTimers(); }
});
it('stops handshake traffic after timeout and after unmount', async () => {
  vi.useFakeTimers();
  try {
    const { sent } = await retryFailedPreview();
    await act(async () => { vi.advanceTimersByTime(60000); }); sent.mockClear();
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(sent).not.toHaveBeenCalled();
    const next = await retryFailedPreview(); next.sent.mockClear();
    act(() => root.unmount()); root = createRoot(mount);
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(next.sent).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
