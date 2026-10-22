import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, createElement, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createExtensions } from '../lib/editor/extensions';
import type { SavedDocument } from '../lib/editor/storage';
import type { startAutosave } from '../lib/editor/autosave';

const messages = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast: messages }));
let store: typeof import('../lib/editor/document-store');
let library: typeof import('../lib/editor/library-store');
let autosave: typeof import('../lib/editor/autosave');
let LocalDocuments: typeof import('../components/editor/local-documents').LocalDocuments;
let navigation: typeof import('../lib/editor/document-navigation').documentNavigation;
let editor: Editor, controller: ReturnType<typeof startAutosave>, root: Root, mount: HTMLDivElement;
let initial: SavedDocument, activeId: string, generation: number;
const report = vi.fn();
function Workspace({ saved, open }: { saved: SavedDocument; open: (value: SavedDocument) => void }) {
  const [instance] = useState(() => new Editor({ extensions: createExtensions(), content: saved.content }));
  editor = instance; activeId = saved.id!;
  useEffect(() => {
    const saving = autosave.startAutosave(instance, saved.id!, { getTitle: () => saved.title, blocked: { current: false }, report });
    controller = saving;
    return () => { saving.dispose(); instance.destroy(); };
  }, [instance, saved]);
  return createElement(LocalDocuments, { editor: instance, title: saved.title, documentId: saved.id!, blocked: false, onOpen: open,
    capture: () => {}, exportDoc: () => {}, onLanguage: () => {}, onPrint: () => {} });
}
function Harness() {
  const [state, setState] = useState({ saved: initial, generation: 0 }); generation = state.generation;
  return createElement(Workspace, { key: state.generation, saved: state.saved, open: saved => setState(previous => ({ saved, generation: previous.generation + 1 })) });
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetModules(); localStorage.clear(); globalThis.indexedDB = new IDBFactory();
  messages.error.mockReset(); messages.info.mockReset(); report.mockReset();
  store = await import('../lib/editor/document-store'); library = await import('../lib/editor/library-store');
  autosave = await import('../lib/editor/autosave'); LocalDocuments = (await import('../components/editor/local-documents')).LocalDocuments;
  navigation = (await import('../lib/editor/document-navigation')).documentNavigation;
  const source = new Editor({ extensions: createExtensions(), content: '<h2>Original 中文</h2><p>日本語 العربية café 👩‍💻</p><ol start="7"><li>Keep numbering</li></ol><table><tr><td rowspan="2"><p>Merged</p></td><td><p>A</p></td></tr><tr><td><p>B</p></td></tr></table>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  initial = await store.activateDocument({ version: 1, id: 'import-storage-original', title: 'Original 中文', content: source.getJSON(), savedAt: new Date().toISOString() }); source.destroy();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await act(async () => { root.render(createElement(Harness)); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); await controller.flush(); });
});
afterEach(() => { act(() => root.unmount()); mount.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const backup = () => JSON.stringify({ ...initial, title: 'Imported 中文 العربية' });
async function settle() { await act(async () => { await vi.waitFor(() => expect(navigation(editor).getSnapshot()).toBe('idle')); }); }
async function choose(read: () => Promise<string> = async () => backup(), wait = true) {
  const input = mount.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'Restore.vdoc.json', size: backup().length, arrayBuffer: async () => new TextEncoder().encode(await read()).buffer }] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  if (wait) await settle();
}
async function edit(text: string) { await act(async () => editor.commands.insertContentAt(1, text)); }
async function saved() {
  await act(async () => { await vi.advanceTimersByTimeAsync(2200); await controller.flush(); await vi.waitFor(() => expect(report.mock.lastCall![0]).toBe('Saved locally')); });
}
async function menuItem(name: string) {
  await act(async () => mount.querySelector('[aria-label="File"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(node => node.textContent === name)!;
  await act(async () => item.click()); await settle();
}
it('imports a backup with the current identity as an independent document without replacing its latest edits or history', async () => {
  const checkpoint = await store.saveVersion(initial, 'Keep original history');
  await edit('Latest source edits '); const latest = editor.getJSON(); await choose();
  expect(generation).toBe(1); expect(activeId).not.toBe(initial.id); const importedId = activeId;
  expect(editor.getJSON()).toEqual(initial.content); await saved();
  expect((await store.openArchivedDocument(initial.id!)).content).toEqual(latest);
  expect((await store.readSavedDocument()).data).toMatchObject({ id: importedId, title: 'Imported 中文 العربية', content: initial.content });
  expect(await store.listVersions(initial.id!)).toEqual([checkpoint]); expect(await store.listVersions(importedId)).toEqual([]);
  expect(await store.listDocuments()).toHaveLength(2);
  await edit('Independent new edits '); await saved(); expect((await store.openArchivedDocument(initial.id!)).content).toEqual(latest);
  expect(messages.error).not.toHaveBeenCalled();
});
it('preserves edits made during slow file reading and ignores a second selection until the first import finishes', async () => {
  let finish!: (raw: string) => void; const reading = new Promise<string>(resolve => { finish = resolve; });
  await choose(() => reading, false); expect(editor.isEditable).toBe(true); await edit('Typed during import 日本語 '); const latest = editor.getJSON();
  const second = vi.fn(async () => backup()); await choose(second, false); expect(second).not.toHaveBeenCalled();
  await act(async () => finish(backup())); await settle(); await saved();
  expect(generation).toBe(1); expect(await store.listDocuments()).toHaveLength(2);
  expect((await store.openArchivedDocument(initial.id!)).content).toEqual(latest); expect(editor.getJSON()).toEqual(initial.content);
});
it.each(['original save', 'import activation'] as const)('keeps the draft and creates no orphan after %s aborts, then imports once with the latest retry edits', async stage => {
  await edit('Unsaved first draft '); const draft = editor.getJSON();
  const before = await store.openArchivedDocument(initial.id!); const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    const shouldFail = this.name === 'summaries' && (stage === 'original save' ? value.id === initial.id : value.id !== initial.id);
    if (shouldFail) {
      // A duplicate add creates an asynchronous ConstraintError; all queued writes must roll back.
      const existing = stage === 'original save' ? value : { ...value, id: initial.id };
      return this.add(existing);
    }
    return key === undefined ? put.call(this, value) : put.call(this, value, key);
  });
  await choose(); failure.mockRestore();
  expect(generation).toBe(0); expect(activeId).toBe(initial.id); expect(editor.isEditable).toBe(true); expect(editor.getJSON()).toEqual(draft);
  expect((await store.readSavedDocument()).data!.id).toBe(initial.id); expect(await store.listDocuments()).toHaveLength(1);
  const db = await store.openDatabase(); expect(await store.requestResult(db.transaction('documents').objectStore('documents').getAllKeys())).toEqual([initial.id]);
  expect((await store.openArchivedDocument(initial.id!)).content).toEqual(stage === 'original save' ? before.content : draft);
  expect(messages.error).toHaveBeenCalledOnce(); await edit('Retry newest العربية '); const latest = editor.getJSON(); await choose(); await saved();
  expect(generation).toBe(1); expect(await store.listDocuments()).toHaveLength(2); expect((await store.openArchivedDocument(initial.id!)).content).toEqual(latest);
  expect(editor.getJSON()).toEqual(initial.content);
});
it('rejects a malformed backup without touching stored data, then accepts a corrected file while preserving the draft', async () => {
  const before = await store.openArchivedDocument(initial.id!); await edit('Keep unsaved draft '); const draft = editor.getJSON();
  await choose(async () => JSON.stringify({ ...initial, content: { type: 'doc', content: [{ type: 'unknownNode' }] } }));
  expect(generation).toBe(0); expect(editor.getJSON()).toEqual(draft); expect(await store.openArchivedDocument(initial.id!)).toEqual(before);
  expect(await store.listDocuments()).toHaveLength(1); expect(messages.error).toHaveBeenCalledOnce();
  await choose(); await saved(); expect(generation).toBe(1); expect((await store.openArchivedDocument(initial.id!)).content).toEqual(draft);
});
it('refuses a listed document that moved to Trash and opens it after restoration without overwriting either document', async () => {
  const other = await store.archiveDocument({ ...initial, id: 'other-existing', title: 'Other existing' });
  await menuItem('Open local document'); await library.updateLibraryItem(other.id!, { trash: true });
  await edit('Latest before selection '); const latest = editor.getJSON();
  const pick = async () => {
    const choice = Array.from(document.querySelectorAll<HTMLButtonElement>('.local-documents button')).find(node => node.querySelector('strong')?.textContent === other.title)!;
    await act(async () => choice.click()); await settle();
  };
  await pick(); expect(generation).toBe(0); expect(editor.isEditable).toBe(true); expect(messages.error).toHaveBeenCalledWith(expect.stringContaining('Trash'));
  expect((await store.readSavedDocument()).data!.id).toBe(initial.id); expect(await store.openArchivedDocument(other.id!)).toEqual(other);
  expect((await store.openArchivedDocument(initial.id!)).content).toEqual(latest);
  await library.updateLibraryItem(other.id!, { trash: false }); await pick(); await saved();
  expect(generation).toBe(1); expect(activeId).toBe(other.id); expect(editor.getJSON()).toEqual(other.content);
  expect((await store.openArchivedDocument(initial.id!)).content).toEqual(latest); expect(await store.listDocuments()).toHaveLength(2);
});
