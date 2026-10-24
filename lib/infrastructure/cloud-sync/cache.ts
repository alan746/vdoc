import type { SavedDocument } from '../../domain/entities/document';
import type { CloudItem } from '../cloud-library/store';

export type CachedItem = { item: CloudItem; sequence: number; pending?: { document: SavedDocument; baseRevision: number; conflict?: boolean } };
// IndexedDB cannot index booleans. Derive this storage-only key at the one write boundary.
const syncState = (record: CachedItem) => record.pending ? record.pending.conflict ? 'conflict' : 'queued' : undefined;
const result = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new Error('Local cloud cache could not be saved.')); });

/** A completely separate cache per verified account; never imports anonymous files. */
export class CloudCache {
  private connection: Promise<IDBDatabase>;
  constructor(readonly owner: string, factory: IDBFactory = indexedDB) {
    this.connection = new Promise((resolve, reject) => {
      let abandoned = false;
      const request = factory.open(`vdoc.cloud.v1.${encodeURIComponent(owner)}`, 2);
      request.onupgradeneeded = event => {
        const db = request.result;
        const items = event.oldVersion === 0 ? db.createObjectStore('items', { keyPath: 'item.id' }) : request.transaction!.objectStore('items');
        if (event.oldVersion === 0) db.createObjectStore('settings');
        items.createIndex('syncState', 'syncState');
        // Upgrade in place: retain pending documents, conflicts and active selection.
        // Only legacy pending rows need rewriting; the upgrade is atomic.
        if (event.oldVersion === 1) {
          const cursor = items.openCursor();
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row) return;
            if (row.value.pending) row.update({ ...row.value, syncState: syncState(row.value) });
            row.continue();
          };
        }
      };
      request.onsuccess = () => { if (abandoned) { request.result.close(); return; } request.result.onversionchange = () => request.result.close(); resolve(request.result); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { abandoned = true; reject(new Error('Close other cloud workspace tabs and retry.')); };
    });
  }
  async all(): Promise<CachedItem[]> { return result((await this.connection).transaction('items').objectStore('items').getAll()); }
  async count(): Promise<number> { return result((await this.connection).transaction('items').objectStore('items').count()); }
  async syncQueue(): Promise<{ queued: string[]; conflicts: string[] }> {
    const index = (await this.connection).transaction('items').objectStore('items').index('syncState');
    // Both requests share one read transaction; no document values are loaded.
    const [queued, conflicts] = await Promise.all([result(index.getAllKeys('queued')), result(index.getAllKeys('conflict'))]);
    return { queued: queued as string[], conflicts: conflicts as string[] };
  }
  async get(id: string): Promise<CachedItem | undefined> { return result((await this.connection).transaction('items').objectStore('items').get(id)); }
  async mutate(id: string, change: (current: CachedItem | undefined) => CachedItem): Promise<CachedItem> {
    const db = await this.connection;
    const tx = db.transaction('items', 'readwrite', { durability: 'strict' }), completed = done(tx);
    let value: CachedItem | undefined, failure: unknown;
    const store = tx.objectStore('items');
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        value = change(request.result);
        if (!value) throw new Error('Missing cloud cache.');
        // Mutations return a replacement; returning the current record means no change.
        if (value !== request.result) store.put({ ...value, syncState: syncState(value) });
      }
      catch (error) { failure = error; tx.abort(); }
    };
    try { await completed; } catch (error) { throw failure || error; }
    return value!;
  }
  async active(id?: string) {
    const db = await this.connection;
    if (id === undefined) return result<string | undefined>(db.transaction('settings').objectStore('settings').get('active'));
    const tx = db.transaction('settings', 'readwrite', { durability: 'strict' }); const completed = done(tx);
    tx.objectStore('settings').put(id, 'active'); await completed; return id;
  }
  async close() { (await this.connection).close(); }
}
