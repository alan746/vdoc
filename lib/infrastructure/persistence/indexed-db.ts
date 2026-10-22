// IndexedDB connection and transaction primitives shared by the persistence stores.
const DATABASE = 'vdoc.local.v2';
let connection: Promise<IDBDatabase> | undefined;
function database() {
  if (!connection) {
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let abandoned = false;
      const request = indexedDB.open(DATABASE, 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const name of ['folders', 'libraryMetadata']) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('summaries')) db.createObjectStore('summaries', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
        if (!db.objectStoreNames.contains('versions')) db.createObjectStore('versions', { keyPath: 'key' }).createIndex('documentId', 'documentId');
      };
      request.onsuccess = () => {
        const db = request.result;
        // A blocked request can still finish after its caller has retried. Never
        // leave that abandoned connection open and holding up future upgrades.
        if (abandoned) { db.close(); return; }
        const invalidate = () => { if (connection === opening) connection = undefined; };
        db.onversionchange = () => { db.close(); invalidate(); };
        db.onclose = invalidate;
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { abandoned = true; reject(new Error('Close other VDoc tabs to finish opening local storage.')); };
    });
    connection = opening;
    // Also handle synchronous open() exceptions captured by the Promise.
    void opening.catch(() => { if (connection === opening) connection = undefined; });
  }
  return connection;
}
const result = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
const completed = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
  // Request errors bubble before the transaction aborts and before tx.error is
  // assigned. Only terminal events establish that commit/rollback has finished;
  // a request error can also be handled without aborting the transaction.
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error || new Error('Local storage transaction was cancelled.'));
});
// User documents have no server copy. Prefer durable commits over the browser's
// default policy; completion still remains asynchronous.
export const writeTransaction = (db: IDBDatabase, stores: string | string[]) =>
  db.transaction(stores, 'readwrite', { durability: 'strict' });

// A synchronous exception does not automatically abort writes queued outside an
// IndexedDB event callback. Explicitly cancel and settle the whole transaction
// before exposing the original error to a caller that may retry.
async function commitWrites(tx: IDBTransaction, done: Promise<void>, write: () => void) {
  try { write(); }
  catch (error) {
    try { tx.abort(); } catch { /* Preserve the original error if already inactive. */ }
    await done.catch(() => undefined);
    throw error;
  }
  await done;
}

export { database as openDatabase, result as requestResult, completed as transactionDone, commitWrites };
