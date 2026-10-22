import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';
import { parseDocument } from '../lib/infrastructure/persistence/storage';

beforeEach(() => { localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules(); });
async function fixture() {
  const store = await import('../lib/infrastructure/persistence/document-store');
  const library = await import('../lib/infrastructure/persistence/library-store');
  const original = await store.activateDocument(parseDocument(JSON.stringify({ version: 1, id: 'trash-guard', title: 'Preserved 中文', savedAt: '2026-10-10T00:00:00.000Z',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original العربية' }] }] } }))); 
  const version = await store.saveVersion(original, 'Keep checkpoint');
  const draft = parseDocument(JSON.stringify({ ...original, title: 'Unsaved draft', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Late draft 日本語' }] }] } }));
  return { store, library, original, version, draft };
}

it.each(['save', 'checkpoint', 'restore'] as const)('rejects late %s after Trash without changing the document, summaries or versions, then retries after restore', async action => {
  const { store, library, original, version, draft } = await fixture();
  await library.updateLibraryItem(original.id, { trash: true });
  const summaries = await store.listDocuments(), versions = await store.listVersions(original.id), items = await library.listLibrary();
  const run = () => action === 'save' ? store.saveDocument(draft.title, draft.content, original.id)
    : action === 'checkpoint' ? store.saveVersion(draft, 'Late checkpoint') : store.restoreVersion(version.key, draft);
  await expect(run()).rejects.toThrow('Trash');
  expect(await store.openArchivedDocument(original.id)).toEqual(original);
  expect(await store.listDocuments()).toEqual(summaries);
  expect(await store.listVersions(original.id)).toEqual(versions);
  expect(await library.listLibrary()).toEqual(items);
  await library.updateLibraryItem(original.id, { trash: false });
  await expect(run()).resolves.toBeDefined();
  if (action === 'save') expect((await store.openArchivedDocument(original.id)).content).toEqual(draft.content);
  if (action === 'checkpoint') expect((await store.listVersions(original.id))[0].document.content).toEqual(draft.content);
});

it('blocks saving a descendant when its parent folder is moved to Trash', async () => {
  const { store, library, original, draft } = await fixture();
  const folder = await library.createFolder('Folder', null);
  await library.updateLibraryItem(original.id, { parentId: folder });
  await library.updateLibraryItem(folder, { trash: true });
  await expect(store.saveDocument(draft.title, draft.content, original.id)).rejects.toThrow('Trash');
  expect(await store.openArchivedDocument(original.id)).toEqual(original);
  await library.updateLibraryItem(folder, { trash: false });
  await store.saveDocument(draft.title, draft.content, original.id);
  expect((await store.openArchivedDocument(original.id)).content).toEqual(draft.content);
});

it.each(['save', 'checkpoint', 'restore'] as const)('does not recreate a missing document during late %s', async action => {
  const { store, original, version, draft } = await fixture();
  const db = await store.openDatabase(), tx = db.transaction(['documents', 'summaries'], 'readwrite');
  const done = store.transactionDone(tx);
  tx.objectStore('documents').delete(original.id); tx.objectStore('summaries').delete(original.id); await done;
  const versions = await store.listVersions(original.id);
  const run = () => action === 'save' ? store.saveDocument(draft.title, draft.content, original.id)
    : action === 'checkpoint' ? store.saveVersion(draft, 'Late') : store.restoreVersion(version.key, draft);
  await expect(run()).rejects.toThrow('no longer exists');
  expect(await store.listDocuments()).toEqual([]);
  await expect(store.openArchivedDocument(original.id)).rejects.toThrow();
  expect(await store.listVersions(original.id)).toEqual(versions);
});

it('keeps a rejected editor draft and its unload guard, then saves it after restoring the document', async () => {
  const { store, library, original } = await fixture();
  const { Editor } = await import('@tiptap/core');
  const { createExtensions } = await import('../lib/editor/extensions');
  const { startAutosave } = await import('../lib/composition/autosave');
  const editor = new Editor({ extensions: createExtensions(), content: original.content });
  const report = vi.fn();
  const controller = startAutosave(editor, original.id, { getTitle: () => original.title, blocked: { current: false }, report });
  try {
    await controller.flush();
    const baseline = await store.openArchivedDocument(original.id);
    await library.updateLibraryItem(original.id, { trash: true });
    editor.commands.insertContent('Unsaved 中文 '); const draft = editor.getJSON();
    await controller.flush();
    expect(report).toHaveBeenLastCalledWith('Save failed. Download a backup.', expect.stringContaining('Trash'));
    expect(editor.getJSON()).toEqual(draft);
    expect(await store.openArchivedDocument(original.id)).toEqual(baseline);
    const leave = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith('Save failed. Download a backup.', expect.stringContaining('Trash')));
    await library.updateLibraryItem(original.id, { trash: false }); await controller.flush();
    expect(report).toHaveBeenLastCalledWith('Saved locally', '');
    expect((await store.openArchivedDocument(original.id)).content).toEqual(draft);
  } finally { controller.dispose(); editor.destroy(); }
});
