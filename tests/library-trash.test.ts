import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules(); });
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const store = await import('../lib/infrastructure/persistence/document-store'), library = await import('../lib/infrastructure/persistence/library-store');
  const root = await library.createFolder('Root 中文', null), child = await library.createFolder('Child العربية', root);
  const document = await store.archiveDocument({ version: 1, id: 'nested-document', title: '日本語 document', savedAt: '2026-10-05T12:00:00.000Z', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '中文 العربية 👩‍💻', marks: [{ type: 'bold' }] }] }] } });
  await library.updateLibraryItem(document.id, { parentId: child, starred: true });
  await store.saveVersion(document, 'Before trash');
  return { store, library, root, child, document };
}
it.each(['root', 'child'] as const)('keeps the original recovery group when an already trashed %s receives another trash request', async target => {
  const { library, root, child } = await fixture();
  await library.updateLibraryItem(root, { trash: true }); const before = await library.listLibrary();
  await library.updateLibraryItem(target === 'root' ? root : child, { trash: true });
  expect(await library.listLibrary()).toEqual(before);
  await library.updateLibraryItem(root, { trash: false });
  const restored = await library.listLibrary(); expect(restored.every(item => !item.trashedAt && !item.trashGroup)).toBe(true);
  expect(restored.find(item => item.id === child)?.parentId).toBe(root);
  expect(restored.find(item => item.id === 'nested-document')).toMatchObject({ parentId: child, starred: true });
});
it('serializes repeated trash requests and restores the entire subtree', async () => {
  const { library, root } = await fixture();
  await Promise.all([library.updateLibraryItem(root, { trash: true }), library.updateLibraryItem(root, { trash: true })]);
  const trashed = await library.listLibrary(); expect(new Set(trashed.map(item => item.trashGroup)).size).toBe(1);
  await library.updateLibraryItem(root, { trash: false }); expect((await library.listLibrary()).every(item => !item.trashedAt)).toBe(true);
});
it('does not revive an earlier discarded document and preserves its content and version history', async () => {
  const { store, library, root, document } = await fixture();
  const original = await store.openArchivedDocument(document.id), versions = await store.listVersions(document.id);
  await library.updateLibraryItem(document.id, { trash: true });
  const discarded = (await library.listLibrary()).find(item => item.id === document.id)!;
  await library.updateLibraryItem(root, { trash: true }); await library.updateLibraryItem(root, { trash: true });
  await library.updateLibraryItem(root, { trash: false });
  expect((await library.listLibrary()).find(item => item.id === document.id)).toEqual(discarded);
  expect(await store.openArchivedDocument(document.id)).toEqual(original);
  expect(await store.listVersions(document.id)).toEqual(versions);
});
it('restores a child folder with its document to Workspace while its parent remains in Trash', async () => {
  const { library, root, child, document } = await fixture();
  await library.updateLibraryItem(root, { trash: true }); await library.updateLibraryItem(child, { trash: false });
  const partial = await library.listLibrary();
  expect(partial.find(item => item.id === root)?.trashedAt).toBeTruthy();
  expect(partial.find(item => item.id === child)).toMatchObject({ parentId: null });
  expect(partial.find(item => item.id === document.id)).toMatchObject({ parentId: child, starred: true });
  expect(partial.filter(item => item.id !== root).every(item => !item.trashedAt)).toBe(true);
  await library.updateLibraryItem(child, { trash: false }); expect(await library.listLibrary()).toEqual(partial);
  await library.updateLibraryItem(root, { trash: false });
  expect((await library.listLibrary()).find(item => item.id === child)?.parentId).toBeNull();
});
it('rolls back every descendant when restore fails, then restores once on retry', async () => {
  const { store, library, root, document } = await fixture();
  const moved = await library.updateLibraryItem(root, { trash: true }); const before = await library.listLibrary();
  const undo = { trash: false, expectedTrashGroup: moved.trashGroup };
  const original = await store.openArchivedDocument(document.id), versions = await store.listVersions(document.id);
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
    if (this.name === 'libraryMetadata' && value.id === document.id) request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await expect(library.updateLibraryItem(root, undo)).rejects.toThrow(); failure.mockRestore();
  expect(await library.listLibrary()).toEqual(before); expect(await store.openArchivedDocument(document.id)).toEqual(original);
  expect(await store.listVersions(document.id)).toEqual(versions);
  await library.updateLibraryItem(root, undo); expect((await library.listLibrary()).every(item => !item.trashedAt)).toBe(true);
});
it('rejects an old Undo after a folder has been restored and moved to Trash again', async () => {
  const { library, root } = await fixture();
  const moved = await library.updateLibraryItem(root, { trash: true });
  const firstGroup = (await library.listLibrary()).find(item => item.id === root)!.trashGroup!;
  expect(moved.trashGroup).toBe(firstGroup);
  await library.updateLibraryItem(root, { trash: false });
  await library.updateLibraryItem(root, { trash: true }); const later = await library.listLibrary();
  const secondGroup = later.find(item => item.id === root)!.trashGroup!; expect(secondGroup).not.toBe(firstGroup);
  const oldUndo = { trash: false, expectedTrashGroup: firstGroup };
  await expect(library.updateLibraryItem(root, oldUndo)).rejects.toThrow('changed');
  expect(await library.listLibrary()).toEqual(later);
  const currentUndo = { trash: false, expectedTrashGroup: secondGroup };
  await library.updateLibraryItem(root, currentUndo); expect((await library.listLibrary()).every(item => !item.trashedAt)).toBe(true);
});
it('does not apply an old Undo to an item that has already been restored and moved elsewhere', async () => {
  const { library, root, document } = await fixture();
  await library.updateLibraryItem(document.id, { trash: true });
  const group = (await library.listLibrary()).find(item => item.id === document.id)!.trashGroup!;
  await library.updateLibraryItem(document.id, { trash: false, parentId: root }); const before = await library.listLibrary();
  const undo = { trash: false, expectedTrashGroup: group };
  await expect(library.updateLibraryItem(document.id, undo)).rejects.toThrow('changed'); expect(await library.listLibrary()).toEqual(before);
});
