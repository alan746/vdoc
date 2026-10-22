import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { BackToDocuments } from '../components/editor/back-to-documents';

const calls = vi.hoisted(() => ({ save: vi.fn(), error: vi.fn() }));
vi.mock('../lib/editor/document-store', () => ({ saveDocument: calls.save }));
vi.mock('sonner', () => ({ toast: { error: calls.error } }));
let editor: Editor, root: Root, mount: HTMLDivElement, onHome: ReturnType<typeof vi.fn>;
let writes: { resolve: () => void; reject: (error: Error) => void }[];
async function render(title = 'Current draft', blocked: boolean | { current: boolean } = false) {
  await act(async () => root.render(createElement(BackToDocuments, { editor, title, blocked, documentId: 'current', onHome })));
}
async function click() { await act(async () => { mount.querySelector('button')!.click(); }); }
async function complete(index: number) { await act(async () => { writes[index].resolve(); }); }
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  writes = []; calls.save.mockReset().mockImplementation(() => new Promise<void>((resolve, reject) => writes.push({ resolve, reject }))); calls.error.mockReset();
  editor = new Editor({ extensions: createExtensions(), content: '<p>Keep 中文 العربية</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount); onHome = vi.fn();
  await render();
});
afterEach(() => { act(() => root.unmount()); editor.destroy(); mount.remove(); vi.unstubAllGlobals(); });

it('waits for storage before returning home and exposes the pending state', async () => {
  await click(); expect(onHome).not.toHaveBeenCalled(); expect(mount.querySelector('button')!.disabled).toBe(true);
  expect(mount.querySelector('[role="status"]')!.textContent).toContain('Saving before returning');
  expect(calls.save).toHaveBeenCalledWith('Current draft', editor.getJSON(), 'current');
  await complete(0); expect(onHome).toHaveBeenCalledOnce();
});
it('saves edits made during each pending write before leaving', async () => {
  await click(); editor.commands.insertContent('First change '); const first = editor.getJSON();
  await complete(0); expect(onHome).not.toHaveBeenCalled(); expect(calls.save.mock.calls[1][1]).toEqual(first);
  editor.commands.insertContent('Second change '); const second = editor.getJSON();
  await complete(1); expect(onHome).not.toHaveBeenCalled(); expect(calls.save.mock.calls[2][1]).toEqual(second);
  await complete(2); expect(onHome).toHaveBeenCalledOnce(); expect(calls.save).toHaveBeenCalledTimes(3);
});
it('resaves the latest normalized title when renamed during saving', async () => {
  await click(); await render('  Renamed أثناء الحفظ  '); await complete(0);
  expect(onHome).not.toHaveBeenCalled(); expect(calls.save.mock.calls[1][0]).toBe('Renamed أثناء الحفظ');
  await render('   '); await complete(1); expect(calls.save.mock.calls[2][0]).toBe('Untitled document');
  await complete(2); expect(onHome).toHaveBeenCalledOnce();
});
it('does not perform another write for selection-only changes', async () => {
  await click(); editor.commands.setTextSelection(3); await complete(0);
  expect(calls.save).toHaveBeenCalledOnce(); expect(onHome).toHaveBeenCalledOnce();
});
it('ignores duplicate clicks before React commits the disabled state', async () => {
  const button = mount.querySelector('button')!;
  await act(async () => { button.click(); button.click(); }); expect(calls.save).toHaveBeenCalledOnce();
  await complete(0); expect(onHome).toHaveBeenCalledOnce();
});
it('retains the latest draft on a follow-up save failure and allows retry', async () => {
  await click(); editor.commands.insertContent('Unsaved change '); await complete(0);
  await act(async () => { writes[1].reject(new Error('Storage full')); });
  expect(onHome).not.toHaveBeenCalled(); expect(calls.error).toHaveBeenCalledWith('Storage full'); expect(mount.querySelector('button')!.disabled).toBe(false);
  await click(); expect(calls.save.mock.calls[2][1]).toEqual(editor.getJSON()); await complete(2); expect(onHome).toHaveBeenCalledOnce();
});
it('does not navigate or restart saving after unmount', async () => {
  await click(); editor.commands.insertContent('Later '); act(() => root.unmount()); await complete(0);
  expect(onHome).not.toHaveBeenCalled(); expect(calls.save).toHaveBeenCalledOnce();
});
it('rejects blocked storage before saving and if it becomes blocked during saving', async () => {
  await render('Current draft', true); await click(); expect(calls.save).not.toHaveBeenCalled();
  await render(); await click(); await render('Current draft', true); await complete(0);
  expect(onHome).not.toHaveBeenCalled(); expect(calls.error).toHaveBeenCalledTimes(2);
});
it('keeps an unfinished composition in the editor both before and during saving', async () => {
  Object.defineProperty(editor.view, 'composing', { configurable: true, value: true });
  await click(); expect(calls.save).not.toHaveBeenCalled();
  Object.defineProperty(editor.view, 'composing', { configurable: true, value: false }); await click();
  Object.defineProperty(editor.view, 'composing', { configurable: true, value: true }); await complete(0);
  expect(onHome).not.toHaveBeenCalled(); expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('Finish composing'));
});

it('observes a pause during saving before React rerenders the navigation button',async()=>{
 const blocked={current:false};await render('Current draft',blocked);await click();blocked.current=true;await complete(0);
 expect(onHome).not.toHaveBeenCalled();expect(mount.querySelector('button')!.disabled).toBe(false);
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('Autosave is paused'));
});
