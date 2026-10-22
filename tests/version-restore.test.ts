import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original 中文 العربية' }] }] };
beforeEach(() => { localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules(); });
afterEach(() => vi.restoreAllMocks());
async function fixture(count = 1) {
  const store = await import('../lib/editor/document-store');
  const original = await store.activateDocument({ version: 1, id: 'restore-current', title: 'Original', content, savedAt: new Date().toISOString() });
  const first = await store.saveVersion(original, 'First draft');
  for (let i = 1; i < count; i++) await store.saveVersion({ ...original, title: `Draft ${i}` }, `Draft ${i}`);
  const current = await store.saveDocument('Latest title', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Latest 日本語' }] }] }, original.id);
  return { store, original, first, current };
}
it('restores the oldest of 40 checkpoints and can recover the exact work it replaced', async () => {
  const { store, first, current } = await fixture(40);
  const restored = await store.restoreVersion(first.key, current);
  expect(restored.title).toBe('Original'); expect((await store.readSavedDocument()).data!.content).toEqual(restored.content);
  const versions = await store.listVersions(current.id!); expect(versions).toHaveLength(40);
  expect(versions[0].label).toBe('Before restoring a version'); expect(versions[0].document.title).toBe('Latest title');
  const recovered = await store.restoreVersion(versions[0].key, restored);
  expect(recovered.title).toBe(current.title); expect(recovered.content).toEqual((await store.openArchivedDocument(current.id!)).content);
  expect(recovered.content.content![0].content![0].text).toBe('Latest 日本語');
});
it('rolls back recovery checkpoint and retention pruning when the document write fails', async () => {
  const { store, first, current } = await fixture(40); const before = await store.listVersions(current.id!);
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
    const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
    if (this.name === 'summaries' && value.title === 'Original') this.transaction.abort();
    return request;
  });
  await expect(store.restoreVersion(first.key, current)).rejects.toThrow();
  expect(await store.listVersions(current.id!)).toEqual(before);
  expect((await store.readSavedDocument()).data!.title).toBe(current.title);
  expect((await store.listDocuments())[0].title).toBe(current.title);
});
it('rejects a version whose embedded document identity disagrees with its index', async () => {
  const { store, first, current } = await fixture(); const db = await store.openDatabase();
  const tx = db.transaction('versions', 'readwrite'), done = store.transactionDone(tx);
  tx.objectStore('versions').put({ ...first, document: { ...first.document, id: 'another-document' } }); await done;
  const before = await store.listVersions(current.id!);
  await expect(store.restoreVersion(first.key, current)).rejects.toThrow('different document');
  expect(await store.listVersions(current.id!)).toEqual(before); expect((await store.readSavedDocument()).data!.id).toBe(current.id);
  expect(await store.listDocuments()).toHaveLength(1);
});
it('does not reactivate a document when a restore arrives after another document was opened', async () => {
  const { store, first, current } = await fixture(); const before = await store.listVersions(current.id!);
  await store.activateDocument({ ...current, id: 'other', title: 'Other' });
  await expect(store.restoreVersion(first.key, current)).rejects.toThrow('active document changed');
  expect((await store.readSavedDocument()).data!.id).toBe('other'); expect(await store.listVersions(current.id!)).toEqual(before);
});

it.each(['put', 'delete'] as const)('keeps all 40 checkpoints when checkpoint %s fails, then prunes only once on retry', async method => {
  const { store, first, current } = await fixture(40);
  const before = await store.listVersions(current.id!), document = await store.openArchivedDocument(current.id!);
  const failAfterRequest = <T>(objectStore: IDBObjectStore, request: IDBRequest<T>) => {
    if (objectStore.name === 'versions') request.addEventListener('success', () => objectStore.transaction.abort());
    return request;
  };
  const put = IDBObjectStore.prototype.put, remove = IDBObjectStore.prototype.delete;
  const failure = method === 'put'
    ? vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
      return failAfterRequest(this, key === undefined ? put.call(this, value) : put.call(this, value, key));
    })
    : vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function(this: IDBObjectStore, key) {
      return failAfterRequest(this, remove.call(this, key));
    });
  await expect(store.saveVersion(current, 'Latest checkpoint')).rejects.toThrow(); failure.mockRestore();
  expect(await store.listVersions(current.id!)).toEqual(before);
  expect(await store.openArchivedDocument(current.id!)).toEqual(document);
  const checkpoint = await store.saveVersion(current, 'Latest checkpoint');
  const after = await store.listVersions(current.id!);
  expect(after).toHaveLength(40); expect(after[0]).toEqual(checkpoint);
  expect(after.slice(1)).toEqual(before.slice(0, 39));
  expect(after.some(entry => entry.key === first.key)).toBe(false);
  expect(await store.openArchivedDocument(current.id!)).toEqual(document);
});

it.each([
  ['unsupported page settings', { type: 'doc', attrs: { pageMargin: 200 }, content: [{ type: 'paragraph' }] }],
  ['unknown content', { type: 'doc', content: [{ type: 'unknownNode' }] }],
  ['broken merged table', { type: 'doc', content: [{ type: 'table', content: [
    { type: 'tableRow', content: [{ type: 'tableCell', attrs: { rowspan: 3 }, content: [{ type: 'paragraph' }] }] },
  ] }] }],
] as const)('rejects a stored version with %s without altering current data or pruning history, then recovers after repair', async (_, badContent) => {
  const { store, first, current } = await fixture(40), db = await store.openDatabase();
  const replace = async (document: unknown) => {
    const tx = db.transaction('versions', 'readwrite'), done = store.transactionDone(tx);
    tx.objectStore('versions').put({ ...first, document }); await done;
  };
  await replace({ ...first.document, content: badContent });
  const versions = await store.listVersions(current.id!), summaries = await store.listDocuments();
  const previous = await store.openArchivedDocument(current.id!);
  await expect(store.restoreVersion(first.key, current)).rejects.toThrow();
  expect(await store.listVersions(current.id!)).toEqual(versions);
  expect(await store.openArchivedDocument(current.id!)).toEqual(previous);
  expect(await store.listDocuments()).toEqual(summaries);
  expect((await store.readSavedDocument()).data!.id).toBe(current.id);
  await replace(first.document);
  const restored = await store.restoreVersion(first.key, current), after = await store.listVersions(current.id!);
  expect(restored.title).toBe(first.document.title); expect(after).toHaveLength(40);
  expect(after[0].document.content).toEqual(previous.content);
  expect((await store.restoreVersion(after[0].key, restored)).content).toEqual(previous.content);
});

it('does not change the current document if the selected checkpoint was deleted after listing', async () => {
  const { store, first, current } = await fixture(2), db = await store.openDatabase();
  const tx = db.transaction('versions', 'readwrite'), done = store.transactionDone(tx);
  tx.objectStore('versions').delete(first.key); await done;
  const before = await store.listVersions(current.id!), previous = await store.openArchivedDocument(current.id!);
  await expect(store.restoreVersion(first.key, current)).rejects.toThrow('not available');
  expect(await store.listVersions(current.id!)).toEqual(before);
  expect(await store.openArchivedDocument(current.id!)).toEqual(previous);
  const restored = await store.restoreVersion(before[0].key, current);
  expect(restored.title).toBe(before[0].document.title);
  expect((await store.listVersions(current.id!))[0].document.content).toEqual(previous.content);
});

it.each(['versions', 'documents', 'summaries', 'settings'])('rolls back all restoration writes if %s.put throws, then succeeds once on retry', async target => {
  const { store, first, current } = await fixture(40);
  const versions = await store.listVersions(current.id!), summaries = await store.listDocuments();
  const previous = await store.openArchivedDocument(current.id!);
  const put = IDBObjectStore.prototype.put, error = new DOMException('Simulated restore quota failure', 'QuotaExceededError');
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    if (this.name === target) throw error;
    return key === undefined ? put.call(this, value) : put.call(this, value, key);
  });
  await expect(store.restoreVersion(first.key, current)).rejects.toBe(error); failure.mockRestore();
  expect(await store.listVersions(current.id!)).toEqual(versions);
  expect(await store.openArchivedDocument(current.id!)).toEqual(previous);
  expect(await store.listDocuments()).toEqual(summaries);
  expect((await store.readSavedDocument()).data!.id).toBe(current.id);
  await store.restoreVersion(first.key, current);
  const after = await store.listVersions(current.id!);
  expect(after).toHaveLength(40); expect(after.slice(1)).toEqual(versions.slice(0, 39));
  expect(after[0].label).toBe('Before restoring a version'); expect(after[0].document.content).toEqual(previous.content);
});
