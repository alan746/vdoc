// @vitest-environment node
import { IDBCursor, IDBFactory, IDBIndex, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';
import { CloudCache, type CachedItem } from '../lib/infrastructure/cloud-sync/cache';

const clients: CloudCache[] = [];
const client = (factory = new IDBFactory(), owner = 'owner') => {
  const cache = new CloudCache(owner, factory); clients.push(cache); return cache;
};
const request = <T>(value: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error);
});
const complete = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
});
function record(id: string, state?: 'queued' | 'conflict'): CachedItem {
  const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep 中文 العربية' }] }] };
  const item = { id, kind: 'document' as const, title: id, parentId: null, starred: false, revision: 1,
    content, formatVersion: 1, trashedAt: null, trashGroup: null, deletedAt: null, updatedAt: '2026-10-22T00:00:00.000Z' };
  return { item, sequence: 3, ...(state ? { pending: { baseRevision: 1, conflict: state === 'conflict',
    document: { id, version: 1 as const, title: 'Unsaved ' + id, content, savedAt: item.updatedAt } } } : {}) };
}
async function legacy(factory: IDBFactory) {
  const opening = factory.open('vdoc.cloud.v1.owner', 1);
  opening.onupgradeneeded = () => {
    opening.result.createObjectStore('items', { keyPath: 'item.id' });
    opening.result.createObjectStore('settings');
  };
  const db = await request(opening), tx = db.transaction(['items', 'settings'], 'readwrite'), finished = complete(tx);
  for (const value of [record('saved'), record('queued', 'queued'), record('conflict', 'conflict')]) tx.objectStore('items').put(value);
  tx.objectStore('settings').put('queued', 'active');
  await finished; db.close();
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(clients.splice(0).map(cache => cache.close().catch(() => {})));
});

it('upgrades legacy drafts and conflicts in place and preserves the active document', async () => {
  const factory = new IDBFactory(); await legacy(factory);
  const cache = client(factory);
  expect(await cache.syncQueue()).toEqual({ queued: ['queued'], conflicts: ['conflict'] });
  expect(await cache.active()).toBe('queued');
  expect(await cache.get('queued')).toMatchObject(record('queued', 'queued'));
  expect(await cache.get('conflict')).toMatchObject(record('conflict', 'conflict'));
  expect(await cache.get('saved')).toEqual(record('saved'));
  await cache.close();
  expect(await client(factory).syncQueue()).toEqual({ queued: ['queued'], conflicts: ['conflict'] });
  expect(await client(factory, 'other-owner').syncQueue()).toEqual({ queued: [], conflicts: [] });
});

it('rolls back an interrupted upgrade and can retry without losing legacy rows', async () => {
  const factory = new IDBFactory(); await legacy(factory);
  const update = IDBCursor.prototype.update;
  const interruption = vi.spyOn(IDBCursor.prototype, 'update').mockImplementationOnce(function (this: globalThis.IDBCursor, value) {
    const result = update.call(this, value);
    const tx = (this.source as IDBObjectStore).transaction;
    result.addEventListener('success', () => tx.abort());
    return result;
  });
  await expect(client(factory).syncQueue()).rejects.toMatchObject({ name: 'AbortError' });
  interruption.mockRestore();
  const db = await request(factory.open('vdoc.cloud.v1.owner', 1));
  expect(db.version).toBe(1);
  const tx = db.transaction('items');
  expect(tx.objectStore('items').indexNames.contains('syncState')).toBe(false);
  expect(await request(tx.objectStore('items').get('queued'))).toEqual(record('queued', 'queued'));
  db.close();
  expect(await client(factory).syncQueue()).toEqual({ queued: ['queued'], conflicts: ['conflict'] });
});

it('reads only keys for status, and counts cached entries without reading bodies', async () => {
  const cache = client();
  await cache.mutate('saved', () => record('saved'));
  await cache.mutate('queued', () => record('queued', 'queued'));
  await cache.mutate('conflict', () => record('conflict', 'conflict'));
  const noBodies = () => { throw new Error('Document bodies must not be read'); };
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(noBodies);
  vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(noBodies);
  vi.spyOn(IDBIndex.prototype, 'getAll').mockImplementation(noBodies);
  expect(await cache.syncQueue()).toEqual({ queued: ['queued'], conflicts: ['conflict'] });
  expect(await cache.count()).toBe(3);
});

it('keeps the index current across tabs, conflicts, later edits and acknowledgements', async () => {
  const factory = new IDBFactory(), first = client(factory), second = client(factory);
  await first.mutate('doc', () => record('doc', 'queued'));
  expect(await second.syncQueue()).toEqual({ queued: ['doc'], conflicts: [] });
  await second.mutate('doc', current => ({ ...current!, pending: { ...current!.pending!, conflict: true } }));
  expect(await first.syncQueue()).toEqual({ queued: [], conflicts: ['doc'] });
  await first.mutate('doc', current => ({ ...current!, pending: { ...current!.pending!, conflict: false } }));
  expect(await second.syncQueue()).toEqual({ queued: ['doc'], conflicts: [] });
  await second.mutate('doc', current => ({ ...current!, pending: undefined }));
  expect(await first.syncQueue()).toEqual({ queued: [], conflicts: [] });
});

it('skips writes for unchanged records and commits replacements with strict durability', async () => {
  const cache = client(); await cache.mutate('doc', () => record('doc', 'queued'));
  const put = vi.spyOn(IDBObjectStore.prototype, 'put');
  await cache.mutate('doc', current => current!);
  expect(put).not.toHaveBeenCalled();
  await cache.mutate('doc', current => ({ ...current!, sequence: current!.sequence + 1 }));
  expect(put).toHaveBeenCalledOnce();
  expect((put.mock.contexts[0] as globalThis.IDBObjectStore).transaction.durability).toBe('strict');
  expect((await cache.get('doc'))!.sequence).toBe(4);
});

it('rolls back the document and index together when a write aborts', async () => {
  const cache = client(); await cache.mutate('doc', () => record('doc', 'queued'));
  const before = await cache.get('doc'), put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (this: globalThis.IDBObjectStore, value) {
    const result = put.call(this, value);
    result.addEventListener('success', () => this.transaction.abort());
    return result;
  });
  await expect(cache.mutate('doc', current => ({ ...current!, pending: undefined }))).rejects.toThrow();
  failure.mockRestore();
  expect(await cache.get('doc')).toEqual(before);
  expect(await cache.syncQueue()).toEqual({ queued: ['doc'], conflicts: [] });
});
