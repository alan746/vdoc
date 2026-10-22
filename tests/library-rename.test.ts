import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseDocument } from '../lib/infrastructure/persistence/storage';

beforeEach(() => { localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules(); });
afterEach(() => vi.restoreAllMocks());
async function fixture() {
  const store = await import('../lib/infrastructure/persistence/document-store'), library = await import('../lib/infrastructure/persistence/library-store');
  const folder = await library.createFolder('Projects 中文', null);
  const original = await store.activateDocument(parseDocument(JSON.stringify({ version: 1, id: 'rename-source', title: 'Original 日本語', savedAt: '2026-10-05T12:00:00.000Z', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '中文 العربية 👩‍💻', marks: [{ type: 'bold' }, { type: 'highlight', attrs: { color: '#FEF08A' } }] }] }] } })));
  await library.updateLibraryItem(original.id, { parentId: folder, starred: true });
  await store.saveVersion(original, 'Before rename');
  const db = await store.openDatabase();
  const raw = () => store.requestResult(db.transaction('documents').objectStore('documents').get(original.id));
  return { store, library, original, folder, db, raw };
}
it('renames content and summary together while preserving formatting, location and versions', async () => {
  const { store, library, original, folder } = await fixture();
  const versions = await store.listVersions(original.id);
  await library.updateLibraryItem(original.id, { title: '  New 中文 العربية  ' });
  const renamed = await store.openArchivedDocument(original.id);
  expect(renamed).toEqual({ ...original, title: 'New 中文 العربية', savedAt: expect.any(String) });
  expect((await library.listLibrary()).find(item => item.id === original.id)).toMatchObject({ title: renamed.title, savedAt: renamed.savedAt, parentId: folder, starred: true });
  expect((await store.readSavedDocument()).data).toEqual(renamed);
  expect(await store.listVersions(original.id)).toEqual(versions);
});
it.each(['invalid content', 'unsupported version'] as const)('rejects renaming %s without changing raw data or metadata', async kind => {
  const { store, library, original, db, raw } = await fixture();
  const damaged = kind === 'invalid content' ? { ...original, content: { type: 'doc', content: [{ type: 'unknown' }] } } : { ...original, version: 2 };
  const tx = db.transaction('documents', 'readwrite'), done = store.transactionDone(tx);
  tx.objectStore('documents').put(damaged); await done;
  const before = await library.listLibrary(), versions = await store.listVersions(original.id);
  await expect(library.updateLibraryItem(original.id, { title: 'Replacement', starred: false })).rejects.toThrow();
  expect(await raw()).toEqual(damaged); expect(await library.listLibrary()).toEqual(before);
  expect(await store.listVersions(original.id)).toEqual(versions);
});
it('reports a missing body without creating a partial replacement from its summary', async () => {
  const { store, library, original, db, raw } = await fixture();
  const tx = db.transaction('documents', 'readwrite'), done = store.transactionDone(tx);
  tx.objectStore('documents').delete(original.id); await done;
  const before = await library.listLibrary();
  await expect(library.updateLibraryItem(original.id, { title: 'Replacement' })).rejects.toThrow('no longer exists');
  expect(await raw()).toBeUndefined(); expect(await library.listLibrary()).toEqual(before);
});
it.each(['documents', 'summaries', 'libraryMetadata'])('rolls back rename when %s fails and allows a complete retry', async target => {
  const { store, library, original, raw } = await fixture();
  const before = await library.listLibrary(), versions = await store.listVersions(original.id);
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
    if (this.name === target && value.id === original.id) request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await expect(library.updateLibraryItem(original.id, { title: 'Renamed', starred: false })).rejects.toThrow();
  failure.mockRestore();
  expect(await raw()).toEqual(original); expect(await library.listLibrary()).toEqual(before);
  expect(await store.listVersions(original.id)).toEqual(versions);
  await library.updateLibraryItem(original.id, { title: 'Renamed', starred: false });
  expect((await store.readSavedDocument()).data).toEqual({ ...original, title: 'Renamed', savedAt: expect.any(String) });
  expect((await library.listLibrary()).find(item => item.id === original.id)).toMatchObject({ title: 'Renamed', starred: false });
});
it('reads the latest body inside the rename transaction after a queued save', async () => {
  const { store, library, original, raw } = await fixture();
  const latest = { ...original, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Latest 中文 العربية' }] }] } };
  await Promise.all([store.archiveDocument(latest), library.updateLibraryItem(original.id, { title: 'New title' })]);
  expect(await raw()).toEqual({ ...latest, title: 'New title', savedAt: expect.any(String) });
});
