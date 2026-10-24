import type { JSONContent } from '@tiptap/core';
import { normalizeDocument, parseDocument } from './document-codec';
import { documentChanges } from './document-change-channel';
import { CURRENT_DOCUMENT_VERSION } from '../../domain/rules/document-migrations';
import type { DocumentDraft, DocumentSummary, SavedDocument } from '../../domain/entities/document';
import type { ActiveDocumentRead } from '../../usecases/ports';
import { openDatabase as database, requestResult as result, transactionDone as completed, writeTransaction, commitWrites } from './indexed-db';
import { summary, verifiedStoredDocument, withDocumentRecord, withWritableDocument } from './document-records';


const LEGACY_DOCUMENT_KEY = 'vdoc.document.v1';
const LEGACY_LIBRARY_KEY = 'vdoc.library.v1';
const legacyArchiveKey = (id: string) => `vdoc.archive.${id}`;

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
      const raw = localStorage.getItem(LEGACY_DOCUMENT_KEY);
      const entries = new Map<string, SavedDocument>();
      let current: SavedDocument | undefined;
      if (raw) {
        try { const parsed = parseDocument(raw); current = { ...parsed, id: parsed.id || crypto.randomUUID() }; entries.set(current.id, current); }
        catch (error) { if (!active.result) throw error; }
      }
      let legacy: DocumentSummary[] = [];
      try { const parsed = JSON.parse(localStorage.getItem(LEGACY_LIBRARY_KEY) || '[]'); if (Array.isArray(parsed)) legacy = parsed; }
      catch { /* Retain the original index for recovery. */ }
      for (const entry of legacy) {
        if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
        const archived = localStorage.getItem(legacyArchiveKey(entry.id));
        if (archived) {
          try {
            const parsed = parseDocument(archived), document = { ...parsed, id: parsed.id || entry.id };
            // The current draft takes precedence over an older archive copy.
            if (!entries.has(document.id)) entries.set(document.id, document);
          } catch { /* Retain the original archive for recovery. */ }
        }
      }
      for (const entry of entries.values()) {
        const existing = tx.objectStore('documents').get(entry.id);
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
  withDocumentRecord(tx, id, (document, metadata) => {
    if (!document) throw new Error('This document is not available in this browser. Open a document from your library or import a backup.');
    if (metadata?.trashedAt) throw new Error('This document is in Trash. Restore it from your library before opening it.');
    const parsed = normalizeDocument(document);
    if (parsed.id !== id) throw new Error('The document link does not match the saved document. The original data has been preserved.');
    data = { ...parsed, id };
    tx.objectStore('settings').put(id, 'active');
  }, error => { failure = error; tx.abort(); });
  try { await done; } catch (error) { throw failure || error; }
  return data!;
}
// Opening an existing document only selects its latest stored value. It must
// never rewrite a snapshot read before another save or library operation.
export async function selectDocument(id: string): Promise<SavedDocument> {
  return readLinkedDocument(await database(), id);
}
export async function readSavedDocument(requestedId?: string): Promise<ActiveDocumentRead> {
  try {
    const db = await database(); await migrateLegacy(db);
    if (requestedId !== undefined) return { data: await readLinkedDocument(db, requestedId) };
    const id = await result(db.transaction('settings').objectStore('settings').get('active'));
    if (!id) return { data: null };
    const doc = await result(db.transaction('documents').objectStore('documents').get(id));
    if (!doc) throw new Error('Missing document.');
    return { data: verifiedStoredDocument(doc, id) };
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
  const data: SavedDocument = { version: CURRENT_DOCUMENT_VERSION, id, title, content, savedAt: new Date().toISOString() };
  withWritableDocument(tx, id, () => {
    if (request.result && request.result !== id) throw new Error('The active document changed. Your unsaved changes remain in this tab; download a backup.');
    tx.objectStore('documents').put(data); tx.objectStore('summaries').put(summary(data)); tx.objectStore('settings').put(id, 'active');
  }, error => { failure = error; tx.abort(); });
  try { await done; } catch (error) { throw failure || error; }
  documentChanges.announce(id);
  return data;
}
export async function archiveDocument(document: DocumentDraft) {
  const db = await database(), data: SavedDocument = { ...document, id: document.id || crypto.randomUUID() };
  const tx = writeTransaction(db, ['documents', 'summaries']), done = completed(tx);
  await commitWrites(tx, done, () => { tx.objectStore('documents').put(data); tx.objectStore('summaries').put(summary(data)); });
  documentChanges.announce(data.id);
  return data;
}
export async function listDocuments(): Promise<DocumentSummary[]> {
  const db = await database(); const records = await result(db.transaction('summaries').objectStore('summaries').getAll());
  return records.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export async function openArchivedDocument(id: string): Promise<SavedDocument> {
  const db = await database(); const document = await result(db.transaction('documents').objectStore('documents').get(id));
  return verifiedStoredDocument(document, id);
}
export async function activateDocument(document: DocumentDraft) {
  const db = await database(), data: SavedDocument = { ...document, id: document.id || crypto.randomUUID() };
  const tx = writeTransaction(db, ['documents', 'summaries', 'settings']), done = completed(tx);
  await commitWrites(tx, done, () => { tx.objectStore('documents').put(data); tx.objectStore('summaries').put(summary(data)); tx.objectStore('settings').put(data.id, 'active'); });
  documentChanges.announce(data.id);
  return data;
}
