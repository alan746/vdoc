import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseDocument } from '../lib/infrastructure/persistence/storage';

beforeEach(() => { localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules(); });
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const store = await import('../lib/infrastructure/persistence/document-store'), versionStore = await import('../lib/infrastructure/persistence/version-store'), idb = await import('../lib/infrastructure/persistence/indexed-db'), library = await import('../lib/infrastructure/persistence/library-store');
  const folder = await library.createFolder('Projects 中文', null);
  const original = await store.activateDocument({ ...parseDocument(JSON.stringify({ version: 1, title: 'Source العربية', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '中文 👩‍💻 עברית', marks: [{ type: 'bold' }, { type: 'highlight', attrs: { color: '#FEF08A' } }] }] }] } })), id: 'copy-source' });
  await library.updateLibraryItem(original.id, { parentId: folder, starred: true });
  await versionStore.saveVersion(original, 'Before copy');
  return { store, versionStore, idb, library, original, folder };
}
it('copies exact content to the same folder with a fresh identity and keeps the original active', async () => {
  const { store, versionStore, library, original, folder } = await fixture();
  const copy = await library.copyLibraryDocument(original.id);
  expect(copy.id).not.toBe(original.id); expect(copy.title).toBe(`Copy of ${original.title}`);
  expect((await store.openArchivedDocument(copy.id)).content).toEqual(original.content);
  expect((await library.listLibrary()).find(item => item.id === copy.id)).toMatchObject({ parentId: folder, starred: false });
  expect((await store.readSavedDocument()).data).toEqual(original);
  expect(await versionStore.listVersions(copy.id)).toEqual([]); expect(await versionStore.listVersions(original.id)).toHaveLength(1);
});
it.each(['documents', 'summaries', 'libraryMetadata'])('rolls back the whole copy when writing %s fails, then allows retry', async target => {
  const { store, versionStore, library, original } = await fixture();
  const before = await library.listLibrary(), versions = await versionStore.listVersions(original.id);
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
    if (this.name === target && value.id !== original.id) request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await expect(library.copyLibraryDocument(original.id)).rejects.toThrow();
  failure.mockRestore();
  expect(await library.listLibrary()).toEqual(before);
  expect(await store.listDocuments()).toHaveLength(1);
  expect((await store.readSavedDocument()).data).toEqual(original);
  expect(await versionStore.listVersions(original.id)).toEqual(versions);
  await library.copyLibraryDocument(original.id); expect(await store.listDocuments()).toHaveLength(2);
});
it('does not leave a copy in Workspace when the destination folder is unavailable', async () => {
  const { store, idb, library, original, folder } = await fixture();
  // Simulate incomplete legacy metadata without moving the source to Trash.
  const db = await idb.openDatabase(), tx = db.transaction('folders', 'readwrite'), done = idb.transactionDone(tx);
  tx.objectStore('folders').delete(folder); await done;
  const before = await library.listLibrary();
  await expect(library.copyLibraryDocument(original.id)).rejects.toThrow('destination folder');
  expect(await library.listLibrary()).toEqual(before); expect(await store.listDocuments()).toHaveLength(1);
});
it('rejects corrupt source content without creating a copy or changing the original bytes', async () => {
  const { store, idb, library, original } = await fixture();
  const corrupt = { ...original, content: { type: 'doc', content: [{ type: 'unknown' }] } };
  await store.archiveDocument(corrupt);
  const before = await library.listLibrary();
  await expect(library.copyLibraryDocument(original.id)).rejects.toThrow();
  expect(await library.listLibrary()).toEqual(before);
  const db = await idb.openDatabase();
  expect(await idb.requestResult(db.transaction('documents').objectStore('documents').get(original.id))).toEqual(corrupt);
});

it.each(['😀', 'e\u0301', '👩‍💻', 'कि'])('keeps %s intact when a copied title reaches its length limit', async cluster => {
  const { store, library, original } = await fixture();
  const source = { ...original, title: 'a'.repeat(111) + cluster + ' Z' };
  await store.activateDocument(source);
  const copy = await library.copyLibraryDocument(source.id);
  expect(copy.title).toBe('Copy of ' + 'a'.repeat(111));
  expect((await store.openArchivedDocument(copy.id)).title).toBe(copy.title);
  expect((await store.openArchivedDocument(copy.id)).content).toEqual(source.content);
  expect((await store.readSavedDocument()).data).toEqual(source);
});
