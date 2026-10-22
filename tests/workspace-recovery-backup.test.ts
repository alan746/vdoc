import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { readDocumentImport } from '../lib/editor/import-file';
import VdocWorkspace from '../components/editor/workspace';

const calls = vi.hoisted(() => ({ save: vi.fn(), success: vi.fn(), error: vi.fn() }));
let editor: Editor, root: Root, mount: HTMLDivElement;
let createUrl: ReturnType<typeof vi.fn>, revokeUrl: ReturnType<typeof vi.fn>;
const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Stored body 中文' }] }] };
vi.mock('@tiptap/react', () => ({ useEditor: () => editor, EditorContent: () => null }));
vi.mock('../lib/editor/browser-tools', () => ({ registerDocumentTools: () => () => {} }));
vi.mock('sonner', () => ({ toast: { success: calls.success, error: calls.error }, Toaster: () => null }));
vi.mock('../lib/editor/document-store', () => ({
  STORAGE_KEY: 'vdoc.document.v1', saveDocument: calls.save,
  readSavedDocument: async () => ({ data: { version: 1, id: 'recovery-backup', title: 'Recovery draft', savedAt: '2026-10-06T12:00:00.000Z', content } }),
}));
const backup = () => Array.from(mount.querySelectorAll('button')).find(button => button.textContent === 'Download backup')!;
const warning = () => mount.querySelector('.warning-banner')!;
const retry = () => Array.from(mount.querySelectorAll('button')).find(button => button.textContent === 'Retry save');
const clicks: { name: string; href: string }[] = [];
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, '', '/#document=recovery-backup');
  const element = document.createElement('div'); document.body.appendChild(element);
  editor = new Editor({ element, extensions: createExtensions(), content });
  await new Promise(resolve => setTimeout(resolve, 0));
  calls.save.mockReset().mockRejectedValue(new DOMException('Storage unavailable', 'QuotaExceededError'));
  calls.success.mockReset(); calls.error.mockReset(); clicks.length = 0;
  createUrl = vi.fn(() => 'blob:recovery-backup'); revokeUrl = vi.fn(); URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push({ name: this.download, href: this.href }); });
  vi.useFakeTimers(); mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await act(async () => root.render(createElement(VdocWorkspace)));
  await act(async () => vi.advanceTimersByTimeAsync(450));
  expect(warning().textContent).toContain('Storage unavailable');
});
afterEach(() => {
  act(() => root.unmount()); editor.destroy(); document.body.innerHTML = ''; window.history.replaceState(null, '', '/');
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
});
async function changeDraft() {
  await act(async () => {
    editor.commands.setContent('<h2>Recovery 中文 العربية</h2><p><strong>café 👩‍💻 हिन्दी</strong></p><ul><li><p>日本語</p></li></ul><table><tr><td><p>עברית</p></td><td><p>Unsaved cell</p></td></tr></table><img src="data:image/png;base64,QQ==" alt="Recovery image">');
    const input = mount.querySelector<HTMLInputElement>('[aria-label="Document title"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Latest: 中文 / العربية');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function readDownloadedBackup() {
  const blob = createUrl.mock.lastCall![0] as Blob;
  // Read the actual download bytes; jsdom lacks Blob.arrayBuffer().
  vi.clearAllTimers(); vi.useRealTimers();
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
  });
  const imported = await readDocumentImport({ name: clicks.at(-1)!.name, size: bytes.byteLength, arrayBuffer: async () => bytes } as File);
  return imported.document;
}
it.each(['failed', 'paused', 'saving'])('exports the latest recoverable draft through the warning button while storage is %s', async mode => {
  await changeDraft();
  let finishSaving: (() => void) | undefined;
  if (mode === 'paused') act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'vdoc.document.v1' })));
  if (mode === 'saving') {
    calls.save.mockImplementationOnce(() => new Promise<void>(resolve => { finishSaving = resolve; }));
    await act(async () => vi.advanceTimersByTimeAsync(450)); expect(retry()?.disabled).toBe(true);
  }
  if (mode === 'failed') await act(async () => vi.advanceTimersByTimeAsync(450));
  const before = editor.getJSON(), selection = editor.state.selection.toJSON(), undo = editor.can().undo(), message = warning().textContent;
  await act(async () => backup().click());
  expect(warning().textContent).toBe(message); expect(mount.textContent).not.toContain('Saved locally');
  expect(calls.success).toHaveBeenCalledExactlyOnceWith('Download requested'); expect(calls.error).not.toHaveBeenCalled();
  expect(clicks).toEqual([{ name: 'Latest_ 中文 _ العربية.vdoc.json', href: 'blob:recovery-backup' }]);
  const restored = await readDownloadedBackup();
  expect(restored.title).toBe('Latest: 中文 / العربية'); expect(restored.content).toEqual(before);
  expect(editor.getJSON()).toEqual(before); expect(editor.state.selection.toJSON()).toEqual(selection); expect(editor.can().undo()).toBe(undo);
  expect(warning().textContent).toBe(message); expect(revokeUrl).not.toHaveBeenCalled();
  if (mode === 'saving') await act(async () => finishSaving!());
  if (mode === 'failed') {
    calls.save.mockResolvedValueOnce({}); await act(async () => retry()!.click());
    expect(calls.save.mock.lastCall).toEqual(['Latest: 中文 / العربية', before, 'recovery-backup']);
  }
  if (mode !== 'paused') {
    expect(warning()).toBeNull(); expect(mount.textContent).toContain('Saved locally');
    expect(editor.getJSON()).toEqual(restored.content);
  }
});
it('keeps the recovery warning and current draft when download preparation fails, and permits a successful retry', async () => {
  await changeDraft(); const before = editor.getJSON(), message = warning().textContent;
  createUrl.mockImplementationOnce(() => { throw new Error('Download resources unavailable'); });
  await act(async () => backup().click());
  expect(calls.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Your document is still open'));
  expect(calls.success).not.toHaveBeenCalled(); expect(warning().textContent).toBe(message); expect(editor.getJSON()).toEqual(before);
  await act(async () => backup().click());
  expect((await readDownloadedBackup()).content).toEqual(before); expect(warning().textContent).toBe(message);
  expect(calls.success).toHaveBeenCalledExactlyOnceWith('Download requested');
});
