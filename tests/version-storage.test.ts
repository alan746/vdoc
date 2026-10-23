import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, createElement, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor, type JSONContent } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createExtensions } from '../lib/editor/extensions';
import type { SavedDocument } from '../lib/domain/entities/document';
import type { startAutosave } from '../lib/composition/autosave';

const messages = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: messages }));
let store: typeof import('../lib/infrastructure/persistence/document-store');
let versionStore: typeof import('../lib/infrastructure/persistence/version-store');
let autosave: typeof import('../lib/composition/autosave');
let VersionHistory: typeof import('../components/editor/version-history').VersionHistory;
let navigation: typeof import('../lib/usecases/document-navigation').documentNavigation;
let editor: Editor, controller: ReturnType<typeof startAutosave>, root: Root, mount: HTMLDivElement;
let initial: SavedDocument, generation: number;
const report = vi.fn();
const mixed: JSONContent = { type: 'doc', attrs: { header: 'Header 中文', footer: 'Footer العربية' }, content: [
  { type: 'paragraph', content: [{ type: 'text', text: 'Original 日本語 café 👩‍💻' }] },
  { type: 'orderedList', attrs: { start: 7, type: 'I' }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'List العربية' }] }] }] },
  { type: 'table', content: [
    { type: 'tableRow', content: [
      { type: 'tableCell', attrs: { rowspan: 2 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Merged 中文' }] }] },
      { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cell 日本語' }] }] },
    ] },
    { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph' }] }] },
  ] },
] };
function Workspace({ saved, open }: { saved: SavedDocument; open: (value: SavedDocument) => void }) {
  const [instance] = useState(() => new Editor({ extensions: createExtensions(), content: saved.content }));
  editor = instance;
  useEffect(() => {
    controller = autosave.startAutosave(instance, saved.id!, { getTitle: () => saved.title, blocked: { current: false }, report });
    return () => { controller.dispose(); instance.destroy(); };
  }, [instance, saved]);
  return createElement(VersionHistory, { editor: instance, title: saved.title, documentId: saved.id!, onOpen: open });
}
function Harness() {
  const [state, setState] = useState({ saved: initial, generation: 0 });
  generation = state.generation;
  return createElement(Workspace, { key: state.generation, saved: state.saved, open: saved => setState(previous => ({ saved, generation: previous.generation + 1 })) });
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetModules(); localStorage.clear(); globalThis.indexedDB = new IDBFactory();
  messages.error.mockReset(); messages.success.mockReset(); report.mockReset();
  store = await import('../lib/infrastructure/persistence/document-store'); versionStore = await import('../lib/infrastructure/persistence/version-store'); autosave = await import('../lib/composition/autosave');
  VersionHistory = (await import('../components/editor/version-history')).VersionHistory;
  navigation = (await import('../lib/usecases/document-navigation')).documentNavigation;
  initial = await store.activateDocument({ version: 1, id: 'version-storage', title: 'Version 中文', content: mixed, savedAt: new Date().toISOString() });
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await act(async () => root.render(createElement(Harness)));
  await new Promise(resolve => setTimeout(resolve, 0));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  await act(async () => controller.flush());
  initial = await store.openArchivedDocument(initial.id!);
});
afterEach(() => {
  act(() => root.unmount()); mount.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function settle() { await act(async () => { await vi.waitFor(() => expect(navigation(editor).getSnapshot()).toBe('idle')); }); }
async function show() { await act(async () => mount.querySelector<HTMLButtonElement>('.secondary-button')!.click()); await settle(); }
async function name(value: string) {
  const field = document.querySelector<HTMLInputElement>('form input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function submit(wait = true) {
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  if (wait) await settle();
}
async function restore(label: string) {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('.local-documents button')).find(node => node.querySelector('strong')?.textContent === label)!;
  await act(async () => button.click()); await settle();
}
async function edit(text: string) { await act(async () => editor.commands.insertContentAt(1, text)); }
async function savedContent() { return (await store.openArchivedDocument(initial.id!)).content; }
async function autosaveSettled() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2200); await controller.flush();
    await vi.waitFor(() => expect(report.mock.lastCall![0]).toBe('Saved locally'));
  });
}
async function seedFullHistory() {
  for (let i = 0; i < 40; i++) await versionStore.saveVersion(initial, `Baseline ${i}`);
  return versionStore.listVersions(initial.id!);
}
it('saves a multilingual checkpoint, restores it, recovers the replaced draft and survives pending autosaves', async () => {
  await show(); await name('Baseline 中文 العربية'); await submit();
  const baseline = editor.getJSON(), entries = await versionStore.listVersions(initial.id!);
  expect(entries).toHaveLength(1); expect(entries[0].snapshot.content).toEqual(baseline);
  await edit('Latest 日本語 '); const latest = editor.getJSON();
  await restore('Baseline 中文 العربية'); expect(generation).toBe(1); expect(editor.getJSON()).toEqual(baseline);
  await autosaveSettled(); expect(await savedContent()).toEqual(baseline);
  expect((await versionStore.listVersions(initial.id!))[0].snapshot.content).toEqual(latest);
  await show(); await restore('Before restoring a version'); expect(generation).toBe(2);
  expect(editor.getJSON()).toEqual(latest); await autosaveSettled(); expect(await savedContent()).toEqual(latest);
  expect((await store.listDocuments())[0].title).toBe(initial.title); expect(messages.error).not.toHaveBeenCalled();
});
it('keeps the name and all 40 versions when checkpoint storage aborts, then saves the newest retry exactly once', async () => {
  const before = await seedFullHistory(); await show(); await name('Retry 中文'); await edit('Before failure ');
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    if (this.name === 'versions') return this.add({ ...value, key: before[0].key });
    return key === undefined ? put.call(this, value) : put.call(this, value, key);
  });
  await submit(); failure.mockRestore();
  expect(await versionStore.listVersions(initial.id!)).toEqual(before); expect(await savedContent()).toEqual(editor.getJSON());
  expect(document.querySelector<HTMLInputElement>('form input')!.value).toBe('Retry 中文'); expect(editor.isEditable).toBe(true);
  expect(messages.error).toHaveBeenCalledOnce(); await edit('Newest retry العربية '); const latest = editor.getJSON(); await submit();
  const after = await versionStore.listVersions(initial.id!); expect(after).toHaveLength(40);
  expect(after[0]).toMatchObject({ label: 'Retry 中文', snapshot: { content: latest } }); expect(after.slice(1)).toEqual(before.slice(0, 39));
  expect(document.querySelector<HTMLInputElement>('form input')!.value).toBe(''); await autosaveSettled(); expect(await savedContent()).toEqual(latest);
});
it('rolls back a restore request error without pruning history, then recovers edits made after the failure', async () => {
  const before = await seedFullHistory(); await show(); await edit('Current draft '); const draft = editor.getJSON();
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    // Only fail the restore transaction, after its recovery checkpoint and document writes have been queued.
    if (this.name === 'summaries' && this.transaction.objectStoreNames.contains('versions')) return this.add(value);
    return key === undefined ? put.call(this, value) : put.call(this, value, key);
  });
  await restore('Baseline 0'); failure.mockRestore();
  expect(generation).toBe(0); expect(editor.getJSON()).toEqual(draft); expect(editor.isEditable).toBe(true);
  expect(await versionStore.listVersions(initial.id!)).toEqual(before); expect(await savedContent()).toEqual(draft); expect(messages.error).toHaveBeenCalledOnce();
  await edit('After failure 日本語 '); const latest = editor.getJSON(); await restore('Baseline 0');
  expect(generation).toBe(1); expect(editor.getJSON()).toEqual(initial.content);
  const after = await versionStore.listVersions(initial.id!); expect(after).toHaveLength(40); expect(after[0].snapshot.content).toEqual(latest);
  await show(); await restore('Before restoring a version'); await autosaveSettled(); expect(await savedContent()).toEqual(latest);
});
it('keeps the checkpoint at its requested snapshot while later typing is eventually saved as the current draft', async () => {
  await show(); await name('Snapshot at click'); const baseline = editor.getJSON();
  const save = store.saveDocument; let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  vi.spyOn(store, 'saveDocument').mockImplementationOnce(async (...args) => { await gate; return save(...args); });
  await submit(false); await edit('Typed while saving 中文 '); const latest = editor.getJSON();
  await submit(false); // A second event before the first commit must not create another version.
  await act(async () => finish()); await settle();
  const entries = await versionStore.listVersions(initial.id!); expect(entries).toHaveLength(1); expect(entries[0].snapshot.content).toEqual(baseline);
  expect(editor.getJSON()).toEqual(latest); await autosaveSettled(); expect(await savedContent()).toEqual(latest);
});
it('ignores an old autosave completion after restoration remounts the editor', async () => {
  await versionStore.saveVersion(initial, 'Baseline'); await show(); await edit('Old callback draft '); const draft = editor.getJSON();
  const save = store.saveDocument; let finish!: () => void, written!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; }), committed = new Promise<void>(resolve => { written = resolve; });
  vi.spyOn(store, 'saveDocument').mockImplementationOnce(async (...args) => { const data = await save(...args); written(); await gate; return data; });
  let pending!: Promise<void>;
  await act(async () => { pending = controller.flush(); await committed; });
  await restore('Baseline'); expect(generation).toBe(1); const restored = editor.getJSON();
  await act(async () => { finish(); await pending; }); await autosaveSettled();
  expect(editor.getJSON()).toEqual(restored); expect(await savedContent()).toEqual(initial.content);
  expect((await versionStore.listVersions(initial.id!))[0].snapshot.content).toEqual(draft);
  expect(messages.error).not.toHaveBeenCalled();
});
