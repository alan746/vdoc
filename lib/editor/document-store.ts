import type { JSONContent } from '@tiptap/core';
import { parseDocument, STORAGE_KEY, type SavedDocument, type LibraryEntry } from './storage';
export { STORAGE_KEY } from './storage';
export type { SavedDocument, LibraryEntry } from './storage';
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

const summary = (doc: SavedDocument) => ({ id: doc.id!, title: doc.title, savedAt: doc.savedAt });
// Read membership and trash state in the same transaction as the eventual
// write. A previously opened editor must not mutate a discarded document or
// recreate one that is no longer in storage. Include both stores in tx scope.
function withWritableDocument(tx: IDBTransaction, id: string, write: () => void, fail: (error: unknown) => void) {
  const document = tx.objectStore('documents').get(id);
  const metadata = tx.objectStore('libraryMetadata').get(id);
  metadata.onsuccess = () => {
    try {
      if (!document.result) throw new Error('The local document no longer exists. Download a backup of your changes.');
      if (metadata.result?.trashedAt) throw new Error('This document is in Trash. Restore it from your library before saving, or download a backup of your changes.');
      write();
    } catch (error) { fail(error); }
  };
}
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

async function migrateLegacy(db: IDBDatabase) {
  if (await result(db.transaction('settings').objectStore('settings').get('legacyMigrated'))) return;
  // Import the whole batch, active selection and completion marker together.
  // Rechecking the marker inside this transaction also serializes startup calls.
  const tx = writeTransaction(db, ['documents', 'summaries', 'settings']), done = completed(tx);
  let failure: unknown;
  const abort = (error: unknown) => { failure = error; tx.abort(); };
  const settings = tx.objectStore('settings');
  const migrated = settings.get('legacyMigrated'), active = settings.get('active');
  active.onsuccess = () => {
    try {
      if (migrated.result) return;
      const raw = localStorage.getItem(STORAGE_KEY);
      const entries = new Map<string, SavedDocument>();
      let current: SavedDocument | undefined;
      if (raw) {
        try { current = parseDocument(raw); current.id ||= crypto.randomUUID(); entries.set(current.id, current); }
        catch (error) { if (!active.result) throw error; }
      }
      let legacy: LibraryEntry[] = [];
      try { const parsed = JSON.parse(localStorage.getItem('vdoc.library.v1') || '[]'); if (Array.isArray(parsed)) legacy = parsed; }
      catch { /* Retain the original index for recovery. */ }
      for (const entry of legacy) {
        if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
        const archived = localStorage.getItem(`vdoc.archive.${entry.id}`);
        if (archived) {
          try {
            const document = parseDocument(archived); document.id ||= entry.id;
            // The current draft takes precedence over an older archive copy.
            if (!entries.has(document.id)) entries.set(document.id, document);
          } catch { /* Retain the original archive for recovery. */ }
        }
      }
      for (const entry of entries.values()) {
        const existing = tx.objectStore('documents').get(entry.id!);
        existing.onsuccess = () => {
          try {
            if (existing.result) return;
            tx.objectStore('documents').put(entry);
            tx.objectStore('summaries').put(summary(entry));
          } catch (error) { abort(error); }
        };
      }
      if (!active.result && current) settings.put(current.id, 'active');
      settings.put(true, 'legacyMigrated');
    } catch (error) { abort(error); }
  };
  try { await done; } catch (error) { throw failure || error; }
}
// Select an existing document without writing a possibly stale copy back over it.
// Validation and activation share a transaction with library trash operations.
async function readLinkedDocument(db: IDBDatabase, id: string): Promise<SavedDocument> {
  const tx = writeTransaction(db, ['documents', 'libraryMetadata', 'settings']);
  const done = completed(tx);
  let data: SavedDocument | undefined, failure: unknown;
  const document = tx.objectStore('documents').get(id);
  const metadata = tx.objectStore('libraryMetadata').get(id);
  metadata.onsuccess = () => {
    try {
      if (!document.result) throw new Error('This document is not available in this browser. Open a document from your library or import a backup.');
      if (metadata.result?.trashedAt) throw new Error('This document is in Trash. Restore it from your library before opening it.');
      data = parseDocument(JSON.stringify(document.result), Infinity);
      if (data.id !== id) throw new Error('The document link does not match the saved document. The original data has been preserved.');
      tx.objectStore('settings').put(id, 'active');
    } catch (error) { failure = error; tx.abort(); }
  };
  try { await done; } catch (error) { throw failure || error; }
  return data!;
}
// Opening an existing document only selects its latest stored value. It must
// never rewrite a snapshot read before another save or library operation.
export async function selectDocument(id: string): Promise<SavedDocument> {
  return readLinkedDocument(await database(), id);
}
export async function readSavedDocument(requestedId?: string): Promise<{ data: SavedDocument | null; error?: string }> {
  try {
    const db = await database(); await migrateLegacy(db);
    if (requestedId !== undefined) return { data: await readLinkedDocument(db, requestedId) };
    const id = await result(db.transaction('settings').objectStore('settings').get('active'));
    if (!id) return { data: null };
    const doc = await result(db.transaction('documents').objectStore('documents').get(id));
    if (!doc) throw new Error('Missing document.');
    return { data: parseDocument(JSON.stringify(doc), Infinity) };
  } catch (error) { return { data: null, error: requestedId !== undefined && error instanceof Error
    ? `Could not open the document link. ${error.message}`
    : 'The local document could not be opened. Autosave is paused. The original data is preserved; open another document or import a backup.' }; }
}
export async function saveDocument(title: string, content: JSONContent, id: string): Promise<SavedDocument> {
  const db = await database();
  const tx = writeTransaction(db, ['documents', 'summaries', 'settings', 'libraryMetadata']);
  const done = completed(tx);
  let failure: unknown;
  const request = tx.objectStore('settings').get('active');
  const data: SavedDocument = { version: 1, id, title, content, savedAt: new Date().toISOString() };
  withWritableDocument(tx, id, () => {
    if (request.result && request.result !== id) throw new Error('The active document changed. Your unsaved changes remain in this tab; download a backup.');
    tx.objectStore('documents').put(data); tx.objectStore('summaries').put(summary(data)); tx.objectStore('settings').put(id, 'active');
  }, error => { failure = error; tx.abort(); });
  try { await done; } catch (error) { throw failure || error; }
  return data;
}
export async function archiveDocument(document: SavedDocument) {
  const db = await database(), data = { ...document, id: document.id || crypto.randomUUID() };
  const tx = writeTransaction(db, ['documents', 'summaries']), done = completed(tx);
  await commitWrites(tx, done, () => { tx.objectStore('documents').put(data); tx.objectStore('summaries').put(summary(data)); });
  return data;
}
export async function listDocuments(): Promise<LibraryEntry[]> {
  const db = await database(); const records = await result(db.transaction('summaries').objectStore('summaries').getAll());
  return records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export async function openArchivedDocument(id: string): Promise<SavedDocument> {
  const db = await database(); const document = await result(db.transaction('documents').objectStore('documents').get(id));
  if (!document) throw new Error('The local document no longer exists.');
  return parseDocument(JSON.stringify(document), Infinity);
}
export async function activateDocument(document: SavedDocument) {
  const db = await database(), data = { ...document, id: document.id || crypto.randomUUID() };
  const tx = writeTransaction(db, ['documents', 'summaries', 'settings']), done = completed(tx);
  await commitWrites(tx, done, () => { tx.objectStore('documents').put(data); tx.objectStore('summaries').put(summary(data)); tx.objectStore('settings').put(data.id, 'active'); });
  return data;
}

export type DocumentVersion = { key: string; documentId: string; label: string; createdAt: string; sequence?: number; document: SavedDocument };
const newestVersionFirst = (a: DocumentVersion, b: DocumentVersion) => (b.sequence || 0) - (a.sequence || 0) || b.createdAt.localeCompare(a.createdAt);
export async function saveVersion(document: SavedDocument, label: string): Promise<DocumentVersion> {
  if (!document.id) throw new Error('Save the document before creating a version.');
  const db = await database();
  const tx = writeTransaction(db, ['versions', 'documents', 'libraryMetadata']), done = completed(tx), store = tx.objectStore('versions');
  const version: DocumentVersion = { key: crypto.randomUUID(), documentId: document.id, label: label.trim() || 'Saved version', createdAt: new Date().toISOString(), document };
  let failure: unknown;
  const abort = (error: unknown) => { failure = error; tx.abort(); };
  withWritableDocument(tx, document.id, () => {
    const request = store.index('documentId').getAll(document.id!);
    request.onsuccess = () => {
      try {
        const entries = (request.result as DocumentVersion[]).sort(newestVersionFirst);
        // Allocate order within this write transaction, independent of clock precision
        // or clock changes. Always keep the version the user just saved.
        version.sequence = Math.max(0, ...entries.map(entry => entry.sequence || 0)) + 1;
        store.put(version);
        for (const old of entries.slice(39)) store.delete(old.key);
      } catch (error) { abort(error); }
    };
  }, abort);
  try { await done; } catch (error) { throw failure || error; }
  return version;
}
export async function listVersions(documentId: string): Promise<DocumentVersion[]> {
  const db = await database();
  const versions = await result(db.transaction('versions').objectStore('versions').index('documentId').getAll(documentId));
  return versions.sort(newestVersionFirst);
}
export async function restoreVersion(key: string, current: SavedDocument): Promise<SavedDocument> {
  const db = await database();
  const previous = parseDocument(JSON.stringify(current), Infinity);
  if (!previous.id) throw new Error('Save the current document before restoring a version.');
  // The recovery checkpoint, retention pruning and restored document must
  // commit together. A failed restore must not consume an older checkpoint.
  const tx = writeTransaction(db, ['versions', 'documents', 'summaries', 'settings', 'libraryMetadata']), done = completed(tx);
  let restored: SavedDocument | undefined, failure: unknown;
  const abort = (error: unknown) => { failure = error; tx.abort(); };
  const request = tx.objectStore('versions').get(key);
  request.onsuccess = () => {
    try {
      const version: DocumentVersion | undefined = request.result;
      if (!version || version.documentId !== previous.id) throw new Error('This version is not available for the current document.');
      const valid = parseDocument(JSON.stringify(version.document), Infinity);
      if (valid.id !== previous.id) throw new Error('This version contains a different document. The current document has not been changed.');
      restored = { ...valid, savedAt: new Date().toISOString() };
      withWritableDocument(tx, previous.id!, () => {
        const active = tx.objectStore('settings').get('active');
        active.onsuccess = () => {
          if (active.result !== previous.id) { abort(new Error('The active document changed. Reopen this document before restoring a version.')); return; }
          const versions = tx.objectStore('versions');
          const all = versions.index('documentId').getAll(previous.id);
          all.onsuccess = () => {
            try {
              const entries = (all.result as DocumentVersion[]).sort(newestVersionFirst);
              const backup: DocumentVersion = { key: crypto.randomUUID(), documentId: previous.id!, label: 'Before restoring a version',
                createdAt: new Date().toISOString(), sequence: Math.max(0, ...entries.map(entry => entry.sequence || 0)) + 1, document: previous };
              versions.put(backup);
              for (const old of entries.slice(39)) versions.delete(old.key);
              tx.objectStore('documents').put(restored!);
              tx.objectStore('summaries').put(summary(restored!));
              tx.objectStore('settings').put(previous.id, 'active');
            } catch (error) { abort(error); }
          };
        };
      }, abort);
    } catch (error) { abort(error); }
  };
  try { await done; } catch (error) { throw failure || error; }
  return restored!;
}

export { database as openDatabase, result as requestResult, completed as transactionDone };
