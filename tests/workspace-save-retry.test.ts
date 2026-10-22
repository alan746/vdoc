import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { documentNavigation } from '../lib/editor/document-navigation';
import VdocWorkspace from '../components/editor/workspace';

const calls = vi.hoisted(() => ({ save: vi.fn() }));
let editor: Editor, root: Root, mount: HTMLDivElement;
let writes: { resolve: () => void; reject: (error: Error) => void }[];
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep 中文 العربية' }] }] };
vi.mock('@tiptap/react', () => ({ useEditor: () => editor, EditorContent: () => null }));
vi.mock('../lib/editor/browser-tools', () => ({ registerDocumentTools: () => () => {} }));
vi.mock('../lib/editor/document-store', () => ({
  STORAGE_KEY: 'vdoc.document.v1', saveDocument: calls.save,
  readSavedDocument: async () => ({ data: { version: 1, id: 'retry-qa', title: 'Retry QA', savedAt: '2026-10-05T12:00:00.000Z', content } }),
}));
const retry = () => Array.from(mount.querySelectorAll('button')).find(button => button.textContent === 'Retry save');
const warning = () => mount.querySelector('.warning-banner');
async function fail(index = 0) { await act(async () => writes[index].reject(new Error('Temporary storage failure'))); }
async function finish(index: number) { await act(async () => writes[index].resolve()); }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, '', '/#document=retry-qa');
  const element = document.createElement('div'); document.body.appendChild(element);
  editor = new Editor({ element, extensions: createExtensions(), content });
  await new Promise(resolve => setTimeout(resolve, 0));
  writes = []; calls.save.mockReset().mockImplementation(() => new Promise<void>((resolve, reject) => writes.push({ resolve, reject })));
  vi.useFakeTimers();
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await act(async () => root.render(createElement(VdocWorkspace)));
  await act(async () => vi.advanceTimersByTimeAsync(450)); await fail();
});
afterEach(() => {
  act(() => root.unmount()); editor.destroy(); document.body.innerHTML = ''; window.history.replaceState(null, '', '/');
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
it('retries an unchanged failed draft from the visible warning without claiming success early', async () => {
  const before = editor.getJSON(), selection = editor.state.selection.toJSON(), canUndo = editor.can().undo();
  expect(warning()?.textContent).toContain('Temporary storage failure'); expect(retry()?.disabled).toBe(false);
  act(() => retry()!.click());
  expect(calls.save).toHaveBeenCalledTimes(2); expect(calls.save.mock.lastCall).toEqual(['Retry QA', before, 'retry-qa']);
  expect(retry()?.disabled).toBe(true); expect(warning()).not.toBeNull(); expect(mount.textContent).not.toContain('Saved locally');
  await finish(1);
  expect(warning()).toBeNull(); expect(mount.textContent).toContain('Saved locally');
  expect(editor.getJSON()).toEqual(before); expect(editor.state.selection.toJSON()).toEqual(selection); expect(editor.can().undo()).toBe(canUndo);
});
it('keeps another failed attempt recoverable without an automatic retry loop', async () => {
  act(() => retry()!.click()); await fail(1);
  expect(retry()?.disabled).toBe(false); expect(warning()?.textContent).toContain('Temporary storage failure');
  await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(calls.save).toHaveBeenCalledTimes(2);
  act(() => retry()!.click()); await finish(2); expect(warning()).toBeNull();
});
it('coalesces double clicks into one pending retry', async () => {
  const button = retry()!; act(() => { button.click(); button.click(); }); expect(calls.save).toHaveBeenCalledTimes(2);
  await finish(1); await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(calls.save).toHaveBeenCalledTimes(2);
});
it('hides retry on a conflict and keeps the backup action available', async () => {
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'vdoc.document.v1' })));
  expect(retry()).toBeUndefined(); expect(warning()?.textContent).toContain('another tab');
  const backup = Array.from(mount.querySelectorAll('button')).find(button => button.textContent === 'Download backup');
  expect(backup?.disabled).toBe(false);
  await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(calls.save).toHaveBeenCalledOnce();
});
it('does not let an in-flight retry clear a newer conflict warning', async () => {
  act(() => retry()!.click());
  act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'vdoc.document.v1' })));
  await finish(1); expect(retry()).toBeUndefined(); expect(warning()?.textContent).toContain('another tab');
  expect(mount.textContent).not.toContain('Saved locally');
});
it('disables retries during navigation and its automatic recheck, then allows retry if that recheck fails', async () => {
  const navigation = documentNavigation(editor); act(() => { navigation.acquire(); });
  expect(retry()?.disabled).toBe(true); act(() => retry()!.click()); expect(calls.save).toHaveBeenCalledOnce();
  act(() => navigation.release()); expect(retry()?.disabled).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(450)); expect(calls.save).toHaveBeenCalledTimes(2);
  await fail(1); expect(retry()?.disabled).toBe(false);
  act(() => retry()!.click()); await finish(2); expect(warning()).toBeNull();
});
it('continues saving newer edits after a retry instead of acknowledging an older snapshot', async () => {
  act(() => retry()!.click()); act(() => editor.commands.insertContent('New work ')); const latest = editor.getJSON();
  await finish(1); expect(warning()).not.toBeNull(); expect(mount.textContent).not.toContain('Saved locally');
  await act(async () => vi.advanceTimersByTimeAsync(450)); expect(calls.save.mock.lastCall?.[1]).toEqual(latest);
  await finish(2); expect(warning()).toBeNull(); expect(mount.textContent).toContain('Saved locally');
});
