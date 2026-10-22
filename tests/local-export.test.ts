import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { downloadBlob } from '../lib/editor/storage';
import { exportLocalDocument } from '../components/editor/local-export';

const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: notices }));
let editor: Editor;
let createUrl: ReturnType<typeof vi.fn>, revokeUrl: ReturnType<typeof vi.fn>;
const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
const clicks: { name: string; href: string; connected: boolean }[] = [];
beforeEach(() => {
  vi.useFakeTimers(); notices.success.mockReset(); notices.error.mockReset(); clicks.length = 0;
  createUrl = vi.fn(() => 'blob:test-download'); revokeUrl = vi.fn();
  URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ name: this.download, href: this.href, connected: this.isConnected });
  });
  editor = new Editor({ extensions: createExtensions(), content: '<p>中文 العربية 👩‍💻</p>' });
});
afterEach(() => {
  editor.destroy(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
});

it('keeps a requested URL alive for download while removing the temporary link', () => {
  downloadBlob('Document.txt', new Blob(['text']));
  expect(clicks).toEqual([{ name: 'Document.txt', href: 'blob:test-download', connected: true }]);
  expect(document.querySelector('a[download]')).toBeNull();
  vi.advanceTimersByTime(59_999); expect(revokeUrl).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:test-download');
});

it.each(['click', 'appendChild'] as const)('cleans up and reports a failed %s without losing the draft or preventing retry', operation => {
  const before = editor.getJSON();
  if (operation === 'click') vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => { throw new Error('Download failed'); });
  else vi.spyOn(document.body, 'appendChild').mockImplementationOnce(() => { throw new Error('Append failed'); });
  expect(exportLocalDocument(editor, 'Draft', 'json')).toBe(false);
  expect(notices.error).toHaveBeenCalledOnce(); expect(notices.success).not.toHaveBeenCalled();
  expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:test-download');
  expect(document.querySelector('a[download]')).toBeNull(); expect(editor.getJSON()).toEqual(before);
  expect(exportLocalDocument(editor, 'Draft', 'json')).toBe(true); expect(notices.success).toHaveBeenCalledExactlyOnceWith('Download requested');
});

it('reports URL creation failure without a success message or an unhandled rejection', () => {
  createUrl.mockImplementationOnce(() => { throw new Error('No resources'); });
  expect(exportLocalDocument(editor, 'Draft', 'html')).toBe(false);
  expect(notices.error).toHaveBeenCalledWith(expect.stringContaining('Please try again'));
  expect(notices.success).not.toHaveBeenCalled(); expect(revokeUrl).not.toHaveBeenCalled(); expect(clicks).toHaveLength(0);
});

it('reports serialization failure before requesting a download', () => {
  vi.spyOn(editor, 'getHTML').mockImplementationOnce(() => { throw new Error('Serialization failed'); });
  expect(exportLocalDocument(editor, 'Draft', 'html')).toBe(false);
  expect(createUrl).not.toHaveBeenCalled(); expect(notices.error).toHaveBeenCalledOnce();
});

it.each([
  ['json', '  中文: draft / العربية  ', '中文_ draft _ العربية.vdoc.json', 'application/json'],
  ['html', '  ', 'Untitled document.html', 'text/html;charset=utf-8'],
  ['txt', 'Draft', 'Draft.txt', 'text/plain;charset=utf-8'],
] as const)('exports %s with a usable filename and encoding', (format, title, expectedName, mime) => {
  const before = editor.getJSON(); expect(exportLocalDocument(editor, title, format)).toBe(true);
  expect(clicks[0].name).toBe(expectedName); expect(createUrl.mock.calls[0][0].type).toBe(mime);
  expect(editor.getJSON()).toEqual(before); expect(notices.success).toHaveBeenCalledWith('Download requested');
});

it('downloads the readable text serializer output through the real export entry without changing history', async () => {
  editor.commands.setContent('<ol start="7"><li><p>中文</p></li></ol><table><tr><td><p>日本語</p></td><td><p>العربية</p></td></tr></table><p>End</p>');
  const before = editor.getJSON(), canUndo = editor.can().undo();
  expect(exportLocalDocument(editor, 'Readable export', 'txt')).toBe(true);
  // FileReader uses scheduled events; download timing is covered separately above.
  vi.clearAllTimers(); vi.useRealTimers();
  const payload = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject;
    reader.readAsText(createUrl.mock.calls[0][0]);
  });
  expect(payload).toBe('7. 中文\n\n日本語\tالعربية\n\nEnd');
  expect(editor.getJSON()).toEqual(before); expect(editor.can().undo()).toBe(canUndo);
});

it.each(['json', 'html', 'txt'] as const)('bounds a multilingual %s download name without changing the draft', format => {
  const title = '多语言👩‍💻café'.repeat(25), before = editor.getJSON();
  expect(exportLocalDocument(editor, title, format)).toBe(true);
  const suffix = format === 'json' ? '.vdoc.json' : `.${format}`;
  const name = clicks[0].name, stem = name.slice(0, -suffix.length);
  expect(name.endsWith(suffix)).toBe(true);
  expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(240);
  const boundaries = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(title), part => part.index + part.segment.length);
  expect(title.startsWith(stem)).toBe(true); expect(boundaries).toContain(stem.length);
  expect(editor.getJSON()).toEqual(before);
});

it.each([
  ['CON', '_CON.vdoc.json'],
  ['lpt¹.notes', '_lpt¹.notes.vdoc.json'],
  ['Report\u0000\r\n... ', 'Report___.vdoc.json'],
  ['... ', 'Untitled document.vdoc.json'],
  ['a' + '\u0301'.repeat(300), 'Untitled document.vdoc.json'],
])('uses a portable backup filename for %j', (title, name) => {
  expect(exportLocalDocument(editor, title, 'json')).toBe(true);
  expect(clicks[0].name).toBe(name);
});

it('keeps the full long title inside a backup even when its download name is shortened', async () => {
  const title = '中文👩‍💻café'.repeat(25), before = editor.getJSON();
  expect(exportLocalDocument(editor, title, 'json')).toBe(true);
  expect(new TextEncoder().encode(clicks[0].name).length).toBeLessThanOrEqual(240);
  vi.clearAllTimers(); vi.useRealTimers();
  const payload = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject;
    reader.readAsText(createUrl.mock.calls[0][0]);
  });
  const { parseDocument } = await import('../lib/editor/storage');
  const restored = parseDocument(payload);
  expect(restored.title).toBe(title); expect(restored.content).toEqual(before);
});
