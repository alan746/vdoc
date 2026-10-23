import 'fake-indexeddb/auto';
import { forceCloseDatabase, IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// fake-indexeddb's declaration expects a constructor, but this helper takes an instance.
const forceClose = forceCloseDatabase as unknown as (database: IDBDatabase) => void;

beforeEach(() => { localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules(); });
afterEach(() => vi.restoreAllMocks());

it('reopens an abnormally closed connection once and retains documents, versions and folder metadata', async () => {
  const store = await import('../lib/infrastructure/persistence/document-store'), versionStore = await import('../lib/infrastructure/persistence/version-store'), idb = await import('../lib/infrastructure/persistence/indexed-db'), library = await import('../lib/infrastructure/persistence/library-store');
  const document = await store.activateDocument({ version: 1, id: 'reconnect', title: 'Keep 中文 العربية', savedAt: '2026-10-05T12:00:00.000Z', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '日本語 👩‍💻', marks: [{ type: 'bold' }] }] }] } });
  const folder = await library.createFolder('Projects', null);
  await library.updateLibraryItem(document.id, { parentId: folder, starred: true });
  await versionStore.saveVersion(document, 'Before disconnect');
  const content = await store.openArchivedDocument(document.id), items = await library.listLibrary(), versions = await versionStore.listVersions(document.id);
  const old = await idb.openDatabase();
  const closed = new Promise<void>(resolve => old.addEventListener('close', () => resolve(), { once: true }));
  forceClose(old); await closed;
  const open = vi.spyOn(indexedDB, 'open');
  const [next, docs, list, history] = await Promise.all([idb.openDatabase(), store.openArchivedDocument(document.id), library.listLibrary(), versionStore.listVersions(document.id)]);
  expect(next).not.toBe(old); expect(open).toHaveBeenCalledOnce();
  expect(docs).toEqual(content); expect(list).toEqual(items); expect(history).toEqual(versions);
  await store.saveDocument('After reconnect', content.content, document.id);
  expect((await store.readSavedDocument()).data?.title).toBe('After reconnect');
});

it('does not cache a synchronous open failure and permits a later retry', async () => {
  const idb = await import('../lib/infrastructure/persistence/indexed-db');
  const open = vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => { throw new DOMException('Temporarily unavailable', 'SecurityError'); });
  await expect(idb.openDatabase()).rejects.toThrow('Temporarily unavailable');
  const next = await idb.openDatabase(); expect(next.name).toBe('vdoc.local.v2'); expect(open).toHaveBeenCalledTimes(2);
});

it('retries after an asynchronous open error and obtains a usable database', async () => {
  const idb = await import('../lib/infrastructure/persistence/indexed-db');
  const open = indexedDB.open.bind(indexedDB);
  const spy = vi.spyOn(indexedDB, 'open').mockImplementationOnce((name, version) => {
    const request = open(name, version);
    request.addEventListener('upgradeneeded', () => request.transaction!.abort());
    return request;
  });
  await expect(idb.openDatabase()).rejects.toThrow();
  expect((await idb.openDatabase()).objectStoreNames.contains('documents')).toBe(true);
  expect(spy).toHaveBeenCalledTimes(2);
});

it('closes a late successful connection after its blocked open was already rejected', async () => {
  const oldRequest = indexedDB.open('vdoc.local.v2', 2);
  await new Promise<void>((resolve, reject) => { oldRequest.onsuccess = () => resolve(); oldRequest.onerror = () => reject(oldRequest.error); });
  const blocker = oldRequest.result;
  const idb = await import('../lib/infrastructure/persistence/indexed-db');
  const spy = vi.spyOn(indexedDB, 'open');
  try {
    await expect(idb.openDatabase()).rejects.toThrow('Close other VDoc tabs');
    const abandoned = spy.mock.results[0].value as IDBOpenDBRequest;
    const completed = new Promise<void>((resolve, reject) => { abandoned.addEventListener('success', () => resolve()); abandoned.addEventListener('error', () => reject(abandoned.error)); });
    blocker.close(); await completed;
    try { expect(() => abandoned.result.transaction('settings')).toThrow(); }
    finally { abandoned.result.close(); }
    const next = await idb.openDatabase();
    expect(next).not.toBe(abandoned.result); expect(next.objectStoreNames.contains('documents')).toBe(true);
  } finally { blocker.close(); }
});

it('does not let a late close notification from an older connection evict the replacement', async () => {
  const idb = await import('../lib/infrastructure/persistence/indexed-db');
  const old = await idb.openDatabase();
  const closed = new Promise<void>(resolve => old.addEventListener('close', () => resolve(), { once: true }));
  forceClose(old); await closed;
  const next = await idb.openDatabase();
  // Deliberately replay a stale notification after the replacement was cached.
  old.onclose?.call(old, new Event('close'));
  expect(await idb.openDatabase()).toBe(next); expect(next).not.toBe(old);
});
