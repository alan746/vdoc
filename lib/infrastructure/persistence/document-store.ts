import type { JSONContent } from '@tiptap/core';
import { parseDocument, STORAGE_KEY, type SavedDocument, type LibraryEntry } from './storage';
import { openDatabase as database, requestResult as result, transactionDone as completed, writeTransaction, commitWrites } from './indexed-db';
import { summary, withWritableDocument } from './document-records';
export { STORAGE_KEY } from './storage';
export type { SavedDocument, LibraryEntry } from './storage';
// Connection primitives and version history are separate modules; re-exported for existing callers.
export { openDatabase, requestResult, transactionDone, writeTransaction } from './indexed-db';
export { saveVersion, listVersions, restoreVersion } from './version-store';
export type { DocumentVersion } from '../../domain/entities/document';


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
