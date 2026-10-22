import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { STORAGE_KEY } from '../lib/infrastructure/persistence/storage';

beforeEach(() => { localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules(); });
afterEach(() => vi.restoreAllMocks());
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '中文 العربية 👩‍💻', marks: [{ type: 'bold' }] }] }] };
const legacyDocument = (id?: string) => ({ version: 1, ...(id ? { id } : {}), title: id || 'Original without ID', content, savedAt: '2026-10-05T12:00:00.000Z' });
function seed(id?: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyDocument(id)));
  localStorage.setItem('vdoc.library.v1', JSON.stringify([{ id: 'archive', title: 'Archive' }]));
  localStorage.setItem('vdoc.archive.archive', JSON.stringify(legacyDocument('archive')));
  return { ...localStorage };
}
async function snapshot() {
  const store = await import('../lib/infrastructure/persistence/document-store'), db = await store.openDatabase();
  const tx = db.transaction(['documents', 'summaries', 'settings']);
  return Promise.all(['documents', 'summaries', 'settings'].map(name => store.requestResult(tx.objectStore(name).getAll())));
}
it.each(['documents', 'summaries', 'settings'])('rolls back the entire migration when %s fails and imports once on retry', async target => {
  const originals = seed(); const store = await import('../lib/infrastructure/persistence/document-store');
  const before = await snapshot(), put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
    if (this.name === target && (value.id === 'archive' || key === 'legacyMigrated')) request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  expect((await store.readSavedDocument()).error).toBeTruthy(); failure.mockRestore();
  expect(await snapshot()).toEqual(before); expect({ ...localStorage }).toEqual(originals);
  const recovered = await store.readSavedDocument(); expect(recovered.error).toBeUndefined(); expect(recovered.data?.title).toBe('Original without ID');
  expect(await store.listDocuments()).toHaveLength(2);
  const committed = await snapshot(); await store.readSavedDocument(); expect(await snapshot()).toEqual(committed);
  expect({ ...localStorage }).toEqual(originals);
});
it('keeps the indexed archive identity when a legacy body has no ID', async () => {
  seed('current'); localStorage.setItem('vdoc.archive.archive', JSON.stringify(legacyDocument()));
  const store = await import('../lib/infrastructure/persistence/document-store');
  expect((await store.readSavedDocument('archive')).data?.id).toBe('archive');
  expect((await store.listDocuments()).map(entry => entry.id).sort()).toEqual(['archive', 'current']);
});
it('does not duplicate ID-less current documents when startup migration runs concurrently', async () => {
  seed(); const store = await import('../lib/infrastructure/persistence/document-store');
  const results = await Promise.all([store.readSavedDocument(), store.readSavedDocument(), store.readSavedDocument()]);
  expect(results.every(result => !result.error && result.data?.id === results[0].data?.id)).toBe(true);
  expect(await store.listDocuments()).toHaveLength(2);
});
it('preserves newer stored content and its active selection while migrating other legacy documents', async () => {
  const originals = seed('current'); const store = await import('../lib/infrastructure/persistence/document-store');
  const latest = await store.activateDocument({ ...legacyDocument('current'), version: 1, title: 'Latest stored title' });
  const existing = await store.openArchivedDocument(latest.id);
  const version = await store.saveVersion(latest, 'Keep version');
  expect((await store.readSavedDocument()).data).toEqual(existing);
  expect(await store.listDocuments()).toHaveLength(2); expect(await store.listVersions(latest.id)).toEqual([version]);
  expect({ ...localStorage }).toEqual(originals);
});
it('prefers the current draft when the legacy archive lists the same document more than once', async () => {
  seed('archive');
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...legacyDocument('archive'), title: 'Current draft', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Latest 中文' }] }] } }));
  localStorage.setItem('vdoc.library.v1', JSON.stringify([{ id: 'archive' }, { id: 'archive' }]));
  const originals = { ...localStorage }, store = await import('../lib/infrastructure/persistence/document-store');
  const current = await store.readSavedDocument();
  expect(current.data?.title).toBe('Current draft');
  expect(current.data?.content.content?.[0].content?.[0].text).toBe('Latest 中文');
  expect(await store.listDocuments()).toHaveLength(1); expect({ ...localStorage }).toEqual(originals);
});
