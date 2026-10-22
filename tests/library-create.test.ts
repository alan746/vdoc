import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseDocument, type SavedDocument } from '../lib/infrastructure/persistence/storage';

beforeEach(() => { localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules(); });
afterEach(() => vi.restoreAllMocks());
const imported: SavedDocument = { version: 1, id: 'current', title: 'Imported 中文', savedAt: '2026-10-05T12:00:00.000Z', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'العربية 👩‍💻 日本語', marks: [{ type: 'bold' }, { type: 'highlight', attrs: { color: '#FEF08A' } }] }] }] } };
async function fixture() {
  const store = await import('../lib/infrastructure/persistence/document-store'), library = await import('../lib/infrastructure/persistence/library-store');
  const current = await store.activateDocument({ ...parseDocument(JSON.stringify(imported)), title: 'Current', id: 'current' });
  const folder = await library.createFolder('Folder', null);
  const db = await store.openDatabase();
  const snapshot = async () => {
    const tx = db.transaction(['documents', 'summaries', 'libraryMetadata', 'settings']);
    return Promise.all(['documents', 'summaries', 'libraryMetadata', 'settings'].map(name => store.requestResult(tx.objectStore(name).getAll())));
  };
  return { store, library, current, folder, snapshot };
}
it.each(['blank', 'imported'])('creates and activates a complete %s document in its destination', async kind => {
  const { store, library, current, folder } = await fixture();
  const source: SavedDocument = kind === 'blank' ? { ...imported, title: 'Untitled document', content: { type: 'doc', content: [{ type: 'paragraph' }] } } : imported;
  const parentId = kind === 'blank' ? null : folder;
  const created = await library.createLibraryDocument(source, parentId);
  expect(created.id).not.toBe(source.id);
  expect(created.content).toEqual(parseDocument(JSON.stringify(source)).content);
  expect((await store.readSavedDocument()).data).toEqual(created);
  expect(await store.openArchivedDocument(current.id)).toEqual(current);
  expect((await library.listLibrary()).find(item => item.id === created.id)).toMatchObject({ parentId, starred: false, title: source.title });
  expect(await store.listDocuments()).toHaveLength(2);
});
it.each(['documents', 'summaries', 'libraryMetadata', 'settings'])('rolls back new content, folder and activation if %s fails, then retries once', async target => {
  const { store, library, folder, snapshot } = await fixture(); const before = await snapshot();
  const method = target === 'settings' ? 'put' : 'add';
  const original = IDBObjectStore.prototype[method];
  const failure = vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
    const request = key === undefined ? original.call(this, value) : original.call(this, value, key);
    if (this.name === target) request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  await expect(library.createLibraryDocument(imported, folder)).rejects.toThrow(); failure.mockRestore();
  expect(await snapshot()).toEqual(before);
  const created = await library.createLibraryDocument(imported, folder);
  expect(await store.listDocuments()).toHaveLength(2);
  expect((await store.readSavedDocument()).data!.id).toBe(created.id);
});
it.each(['missing', 'trashed'])('does not save or activate an import into a %s destination', async kind => {
  const { library, folder, snapshot } = await fixture();
  if (kind === 'trashed') await library.updateLibraryItem(folder, { trash: true });
  const before = await snapshot();
  await expect(library.createLibraryDocument(imported, kind === 'missing' ? 'missing' : folder)).rejects.toThrow('destination folder');
  expect(await snapshot()).toEqual(before);
});
it('does not modify storage when validation fails', async () => {
  const { library, folder, snapshot } = await fixture(); const before = await snapshot();
  await expect(library.createLibraryDocument({ ...imported, content: { type: 'doc', content: [{ type: 'unknown' }] } }, folder)).rejects.toThrow();
  expect(await snapshot()).toEqual(before);
});
