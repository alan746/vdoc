import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { VersionHistory } from '../components/editor/version-history';
import { BackToDocuments } from '../components/editor/back-to-documents';
import { documentNavigation } from '../lib/usecases/document-navigation';

const calls = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), restore: vi.fn(), checkpoint: vi.fn(), error: vi.fn() }));
vi.mock('../lib/infrastructure/persistence/document-store', () => ({ saveDocument: calls.save }));
vi.mock('../lib/infrastructure/persistence/version-store', () => ({ listVersions: calls.list, restoreVersion: calls.restore, saveVersion: calls.checkpoint }));
vi.mock('sonner', () => ({ toast: { error: calls.error, success: vi.fn() } }));
let editor: Editor, root: Root, mount: HTMLDivElement, onOpen: ReturnType<typeof vi.fn>, onHome: ReturnType<typeof vi.fn>;
const saved = { version: 1, id: 'current', title: 'Current', content: { type: 'doc', content: [{ type: 'paragraph' }] }, savedAt: '2026-10-02T00:00:00.000Z' };
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  calls.list.mockReset().mockResolvedValue([{ key: 'v1', label: 'Before changes', createdAt: saved.savedAt }]);
  calls.save.mockReset().mockResolvedValue(saved); calls.restore.mockReset().mockResolvedValue(saved); calls.error.mockReset(); calls.checkpoint.mockReset().mockResolvedValue({});
  editor = new Editor({ extensions: createExtensions(), content: '<p>Keep current work</p>' }); await new Promise(resolve => setTimeout(resolve, 0));
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount); onOpen = vi.fn(); onHome = vi.fn();
  await render();
});
afterEach(() => { act(() => root.unmount()); editor.destroy(); mount.remove(); vi.unstubAllGlobals(); });
async function showVersions() { await act(async () => { mount.querySelector<HTMLButtonElement>('.secondary-button')!.click(); }); }
async function restore() { await act(async () => { document.querySelector<HTMLButtonElement>('.local-documents button')!.click(); }); }
it('keeps current work during registered input composition and restores only after composition ends',async()=>{
 let composing=false;const unregister=documentNavigation(editor).registerCompositionGuard(()=>composing);
 const before=editor.getJSON();await showVersions();composing=true;await restore();
 expect(calls.save).not.toHaveBeenCalled();expect(calls.restore).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
 expect(editor.getJSON()).toEqual(before);expect(editor.isEditable).toBe(true);
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('Finish composing'));
 composing=false;await restore();expect(onOpen).toHaveBeenCalledOnce();unregister();
});
it.each(['body','registered input'] as const)('does not open saved versions over an active %s candidate, then allows retry',async kind=>{
 let composing=true;
 const unregister=documentNavigation(editor).registerCompositionGuard(()=>kind==='registered input'&&composing);
 if(kind==='body')Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>composing});
 const before=editor.getJSON();await showVersions();
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(calls.list).not.toHaveBeenCalled();
 expect(calls.save).not.toHaveBeenCalled();expect(calls.checkpoint).not.toHaveBeenCalled();
 expect(editor.getJSON()).toEqual(before);expect(documentNavigation(editor).getSnapshot()).toBe('idle');
 expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('Finish composing'));
 composing=false;await showVersions();expect(document.querySelector('[role="dialog"]')).not.toBeNull();unregister();
});
it.each(['body','registered input'] as const)('refuses a checkpoint while a %s candidate is active without clearing the version name',async kind=>{
 await showVersions();let composing=true;
 const unregister=documentNavigation(editor).registerCompositionGuard(()=>kind==='registered input'&&composing);
 if(kind==='body')Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>composing});
 const input=document.querySelector<HTMLInputElement>('form input')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Keep name 中文');input.dispatchEvent(new Event('input',{bubbles:true}));});
 const before=editor.getJSON();await checkpoint();
 expect(calls.save).not.toHaveBeenCalled();expect(calls.checkpoint).not.toHaveBeenCalled();expect(input.value).toBe('Keep name 中文');
 expect(editor.getJSON()).toEqual(before);expect(editor.isEditable).toBe(true);expect(documentNavigation(editor).getSnapshot()).toBe('idle');
 composing=false;await checkpoint();expect(calls.checkpoint).toHaveBeenCalledExactlyOnceWith(saved,'Keep name 中文');unregister();
});
it.each([
 ['checkpoint','body'],['checkpoint','registered input'],['restore','body'],['restore','registered input'],
] as const)('rechecks a new %s %s candidate after the initial save and keeps the draft retryable',async(action,kind)=>{
 await showVersions();let composing=false,finish!:(value:unknown)=>void;
 const unregister=documentNavigation(editor).registerCompositionGuard(()=>kind==='registered input'&&composing);
 if(kind==='body')Object.defineProperty(editor.view,'composing',{configurable:true,get:()=>composing});
 calls.save.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const before=editor.getJSON();if(action==='restore')await restore();else await checkpoint();
 composing=true;await act(async()=>finish(saved));
 expect(calls.checkpoint).not.toHaveBeenCalled();expect(calls.restore).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
 expect(editor.getJSON()).toEqual(before);expect(editor.isEditable).toBe(true);expect(documentNavigation(editor).getSnapshot()).toBe('idle');
 expect(document.querySelector('[role="dialog"]')).not.toBeNull();expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('Finish composing'));
 composing=false;if(action==='restore')await restore();else await checkpoint();
 if(action==='restore')expect(onOpen).toHaveBeenCalledOnce();else expect(calls.checkpoint).toHaveBeenCalledOnce();unregister();
});
it('holds editing and home navigation through restoration, then releases them', async () => {
  let finish!: (value: unknown) => void; calls.restore.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await showVersions(); await restore(); const before = editor.getJSON();
  expect(editor.isEditable).toBe(false); editor.commands.insertContent('Must not enter'); expect(editor.getJSON()).toEqual(before);
  const back = mount.querySelector<HTMLButtonElement>('[aria-label="Back to documents"]')!; expect(back.disabled).toBe(true);
  expect(calls.restore).toHaveBeenCalledWith('v1', saved);
  await act(async () => { finish(saved); }); expect(onOpen).toHaveBeenCalledWith(saved); expect(onHome).not.toHaveBeenCalled(); expect(editor.isEditable).toBe(true);
});
it('retains the current work and permits retry after restore failure', async () => {
  calls.restore.mockRejectedValueOnce(new Error('Restore failed')); const before = editor.getJSON(); await showVersions(); await restore();
  expect(calls.error).toHaveBeenCalledWith('Restore failed'); expect(onOpen).not.toHaveBeenCalled(); expect(editor.getJSON()).toEqual(before); expect(editor.isEditable).toBe(true);
  await restore(); expect(onOpen).toHaveBeenCalledOnce();
});
it('does not start restoration after the panel unmounts during the final save', async () => {
  let finish!: (value: unknown) => void; calls.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await showVersions(); await restore(); act(() => root.unmount()); await act(async () => { finish(saved); });
  expect(calls.restore).not.toHaveBeenCalled(); expect(onOpen).not.toHaveBeenCalled(); expect(editor.isEditable).toBe(true);
});

async function render(blocked: boolean | { current: boolean } = false) {
  await act(async () => root.render(createElement(Fragment, null,
    createElement(BackToDocuments, { editor, title: 'Current', documentId: 'current', blocked, onHome }),
    createElement(VersionHistory, { editor, title: 'Current', documentId: 'current', blocked, onOpen }))));
}
async function checkpoint() {
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
}
it('retains the version name during composition without writing a checkpoint, then saves the final name once', async () => {
  await showVersions(); const input = document.querySelector<HTMLInputElement>('form input')!;
  const before = editor.getJSON();
  await act(async () => {
    input.focus(); input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '草稿版本');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await checkpoint();
  expect(calls.save).not.toHaveBeenCalled(); expect(calls.checkpoint).not.toHaveBeenCalled();
  expect(input.value).toBe('草稿版本'); expect(input.disabled).toBe(false); expect(editor.getJSON()).toEqual(before);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '最终版本 中文');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  await checkpoint();
  expect(calls.checkpoint).toHaveBeenCalledExactlyOnceWith(saved, '最终版本 中文');
  expect(input.value).toBe(''); expect(editor.getJSON()).toEqual(before);
});
it.each(['restore', 'checkpoint'])('allows listing versions but refuses %s while autosave is paused', async action => {
  const before = editor.getJSON(); await render(true); await showVersions();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Before changes');
  if (action === 'restore') await restore(); else await checkpoint();
  expect(calls.save).not.toHaveBeenCalled(); expect(calls.restore).not.toHaveBeenCalled(); expect(calls.checkpoint).not.toHaveBeenCalled();
  expect(onOpen).not.toHaveBeenCalled(); expect(editor.getJSON()).toEqual(before); expect(editor.isEditable).toBe(true);
  expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('Autosave is paused'));
});
it.each(['restore', 'checkpoint'])('does not continue %s when autosave pauses during its initial save', async action => {
  let finish!: (value: unknown) => void; calls.save.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await showVersions(); if (action === 'restore') await restore(); else await checkpoint();
  await render(true); await act(async () => finish(saved));
  expect(calls.restore).not.toHaveBeenCalled(); expect(calls.checkpoint).not.toHaveBeenCalled(); expect(onOpen).not.toHaveBeenCalled(); expect(editor.isEditable).toBe(true);
});
it('retains the visible draft when a pause arrives after storage restoration started', async () => {
  let finish!: (value: unknown) => void; calls.restore.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const before = editor.getJSON(); await showVersions(); await restore(); await render(true); await act(async () => finish(saved));
  expect(onOpen).not.toHaveBeenCalled(); expect(editor.getJSON()).toEqual(before); expect(editor.isEditable).toBe(true);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('download a VDoc backup'));
});

it('observes a pause before restoration without waiting for a React render', async () => {
 const blocked={current:false};await render(blocked);await showVersions();blocked.current=true;
 await restore();expect(calls.save).not.toHaveBeenCalled();expect(calls.restore).not.toHaveBeenCalled();expect(onOpen).not.toHaveBeenCalled();
 expect(editor.isEditable).toBe(true);expect(calls.error).toHaveBeenCalledWith(expect.stringContaining('Autosave is paused'));
});

const retryList = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(button => button.textContent === 'Retry loading');
it('reports a saved checkpoint separately from a failed refresh and retries only the list', async () => {
  await showVersions(); calls.list.mockRejectedValueOnce(new Error('Read unavailable'));
  await checkpoint();
  expect(calls.checkpoint).toHaveBeenCalledOnce(); expect(calls.error).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('version was saved');
  expect(document.querySelector<HTMLButtonElement>('form button')!.disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('.local-documents button')!.disabled).toBe(true);
  // Synthetic submit must also respect the stale-list guard.
  await checkpoint(); expect(calls.checkpoint).toHaveBeenCalledOnce();
  calls.list.mockResolvedValue([{ key: 'new', label: 'Just saved', createdAt: saved.savedAt }]);
  await act(async () => retryList()!.click());
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(document.querySelector('.local-documents')?.textContent).toContain('Just saved');
  expect(calls.save).toHaveBeenCalledOnce(); expect(calls.checkpoint).toHaveBeenCalledOnce(); expect(calls.restore).not.toHaveBeenCalled();
});
it('retains the committed-version explanation across failed list retries', async () => {
  await showVersions(); calls.list.mockRejectedValueOnce(new Error('Read unavailable')); await checkpoint();
  calls.list.mockRejectedValueOnce(new Error('Still unavailable'));
  await act(async () => retryList()!.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('version was saved');
  expect(retryList()!.disabled).toBe(false); expect(calls.error).not.toHaveBeenCalled();
  await act(async () => retryList()!.click()); expect(retryList()).toBeUndefined(); expect(calls.checkpoint).toHaveBeenCalledOnce();
});
it('opens a retryable dialog after the initial list read fails without claiming the history is empty', async () => {
  calls.list.mockRejectedValueOnce(new Error('Read unavailable')); await showVersions();
  const dialog = document.querySelector('[role="dialog"]'); expect(dialog).not.toBeNull();
  expect(dialog?.textContent).not.toContain('No saved versions yet.');
  let finish!: (value: unknown) => void; calls.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const button = retryList()!; await act(async () => { button.click(); button.click(); });
  expect(calls.list).toHaveBeenCalledTimes(2); expect(button.disabled).toBe(true);
  await act(async () => finish([])); expect(dialog?.textContent).toContain('No saved versions yet.');
  expect(calls.save).not.toHaveBeenCalled(); expect(calls.checkpoint).not.toHaveBeenCalled();
});
it('keeps the entered version name on write failure and creates only one checkpoint on retry', async () => {
  await showVersions(); const input = document.querySelector<HTMLInputElement>('form input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Before edits 中文');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  calls.checkpoint.mockRejectedValueOnce(new Error('Checkpoint write failed'));
  await checkpoint(); expect(input.value).toBe('Before edits 中文'); expect(calls.error).toHaveBeenCalledWith('Checkpoint write failed');
  let finish!: (value: unknown) => void; calls.checkpoint.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await checkpoint(); expect(input.disabled).toBe(true);
  await act(async () => finish({})); expect(input.value).toBe(''); expect(input.disabled).toBe(false);
  expect(calls.checkpoint).toHaveBeenNthCalledWith(2, saved, 'Before edits 中文');
});
it('ignores a list retry that fails after the version panel unmounts', async () => {
  await showVersions(); calls.list.mockRejectedValueOnce(new Error('Read unavailable')); await checkpoint();
  let fail!: (reason: Error) => void; calls.list.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  await act(async () => retryList()!.click()); act(() => root.unmount());
  await act(async () => fail(new Error('Late failure')));
  expect(calls.error).not.toHaveBeenCalled(); expect(onOpen).not.toHaveBeenCalled(); expect(editor.isEditable).toBe(true);
});
