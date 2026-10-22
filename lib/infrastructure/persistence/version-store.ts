import type { SavedDocument, DocumentVersion } from '../../domain/entities/document';
import { parseDocument } from './storage';
import { openDatabase as database, requestResult as result, transactionDone as completed, writeTransaction } from './indexed-db';
import { summary, withWritableDocument } from './document-records';

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

