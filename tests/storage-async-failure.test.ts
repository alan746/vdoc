import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseDocument } from '../lib/editor/storage';

beforeEach(() => { localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules(); });
afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const store = await import('../lib/editor/document-store');
  const original = await store.activateDocument(parseDocument(JSON.stringify({ version: 1, id: 'async-failure', title: 'Before', savedAt: '2026-10-06T00:00:00.000Z',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep 中文 العربية 👩‍💻' }] }] } })));
  await store.readSavedDocument();
  return { store, original };
}

// Cause a real asynchronous request failure in the test IDB implementation.
// This is a duplicate-key ConstraintError, not actual browser quota exhaustion.
function failSummaryAsynchronously() {
  const put = IDBObjectStore.prototype.put;
  let aborted = false;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    if (this.name === 'summaries') {
      this.transaction.addEventListener('abort', () => { aborted = true; }, { once: true });
      return this.add(value);
    }
    return key === undefined ? put.call(this, value) : put.call(this, value, key);
  });
  return { spy, wasAborted: () => aborted };
}

it.each(['archive', 'activate', 'save', 'rename', 'restore'] as const)('waits for rollback and preserves the asynchronous error during %s, then permits retry', async action => {
  const { store, original } = await fixture();
  const library = await import('../lib/editor/library-store');
  const oldVersion = await store.saveVersion({ ...original, title: 'Earlier version' }, 'Earlier');
  const beforeItems = await library.listLibrary(), beforeVersions = await store.listVersions(original.id);
  const run = () => action === 'archive' ? store.archiveDocument({ ...original, title: 'Changed' })
    : action === 'activate' ? store.activateDocument({ ...original, title: 'Changed' })
    : action === 'save' ? store.saveDocument('Changed', original.content, original.id)
    : action === 'rename' ? library.updateLibraryItem(original.id, { title: 'Changed', starred: true })
    : store.restoreVersion(oldVersion.key, original);
  const { spy, wasAborted } = failSummaryAsynchronously();
  const failure = await run().then(() => ({ name: 'unexpected success' }), error => error);
  expect({ name: failure.name, aborted: wasAborted() }).toEqual({ name: 'ConstraintError', aborted: true });
  spy.mockRestore();
  expect(await store.openArchivedDocument(original.id)).toEqual(original);
  expect((await store.readSavedDocument()).data).toEqual(original);
  expect(await library.listLibrary()).toEqual(beforeItems);
  expect(await store.listVersions(original.id)).toEqual(beforeVersions);
  await run();
  expect((await store.openArchivedDocument(original.id)).title).toBe(action === 'restore' ? 'Earlier version' : 'Changed');
});

it('does not report failure when a request error is handled and the transaction successfully commits', async () => {
  const { store } = await fixture();
  const db = await store.openDatabase(), tx = db.transaction('settings', 'readwrite');
  const done = store.transactionDone(tx);
  // Deliberate recovery at request level: leave existing active selection intact.
  tx.objectStore('settings').add('duplicate', 'active').addEventListener('error', event => event.preventDefault());
  tx.objectStore('settings').put('Committed after handled error', 'qa-recovered');
  await expect(done).resolves.toBeUndefined();
  expect(await store.requestResult(db.transaction('settings').objectStore('settings').get('qa-recovered'))).toBe('Committed after handled error');
});

it('requests durable commits across document, history and library mutations', async () => {
  const { store, original } = await fixture();
  const library = await import('../lib/editor/library-store');
  const db = await store.openDatabase(), transaction = db.transaction.bind(db);
  const writes: IDBTransaction[] = [];
  vi.spyOn(db, 'transaction').mockImplementation((stores, mode, options) => {
    const tx = transaction(stores, mode, options);
    if (mode === 'readwrite') writes.push(tx);
    return tx;
  });
  await store.archiveDocument(original);
  await store.activateDocument(original);
  await store.saveDocument('Saved', original.content, original.id);
  const version = await store.saveVersion(original, 'Checkpoint');
  await store.restoreVersion(version.key, original);
  await store.selectDocument(original.id);
  const folder = await library.createFolder('QA durable', null);
  await library.updateLibraryItem(original.id, { parentId: folder, starred: true, title: 'Renamed' });
  await library.copyLibraryDocument(original.id);
  await library.createLibraryDocument(original, folder);
  await library.updateLibraryItem(folder, { trash: true });
  await library.updateLibraryItem(folder, { trash: false });
  expect(writes).toHaveLength(12);
  expect(writes.every(tx => tx.durability === 'strict')).toBe(true);
  expect((await library.listLibrary()).find(item => item.id === original.id)).toMatchObject({ title: 'Renamed', starred: true, parentId: folder });
});
