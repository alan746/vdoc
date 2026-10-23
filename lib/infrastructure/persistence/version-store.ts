import type { SavedDocument, DocumentVersion, VersionSnapshot } from '../../domain/entities/document';
import { parseDocument } from './document-codec';
import { documentChanges } from './document-change-channel';
import { CURRENT_DOCUMENT_VERSION } from '../../domain/rules/document-migrations';
import { openDatabase as database, requestResult as result, transactionDone as completed, writeTransaction } from './indexed-db';
import { summary, withWritableDocument } from './document-records';

/** A `versions` row. Rows written before snapshots existed hold the whole document and may lack a sequence.
 * `format` is the document format version of the snapshot; rows without it are version 1. */
type VersionRecord = Omit<DocumentVersion, 'sequence' | 'snapshot'> & { sequence?: number; snapshot?: VersionSnapshot; document?: SavedDocument; format?: number };
const recordFormat = (record: VersionRecord) => record.format ?? record.document?.version ?? 1;
const versionFromRecord = ({ document, snapshot, sequence, format: _format, ...version }: VersionRecord): DocumentVersion =>
  ({ ...version, sequence: sequence ?? 0, snapshot: snapshot ?? { title: document!.title, content: document!.content } });
const snapshotOf = ({ title, content }: SavedDocument): VersionSnapshot => ({ title, content });
const nextSequence = (entries: DocumentVersion[]) => Math.max(0, ...entries.map(entry => entry.sequence)) + 1;
const newestVersionFirst = (a: DocumentVersion, b: DocumentVersion) => b.sequence - a.sequence || b.createdAt.localeCompare(a.createdAt);
const versionsNewestFirst = (records: VersionRecord[]) => records.map(versionFromRecord).sort(newestVersionFirst);
export async function saveVersion(document: SavedDocument, label: string): Promise<DocumentVersion> {
  const db = await database();
  const tx = writeTransaction(db, ['versions', 'documents', 'libraryMetadata']), done = completed(tx), store = tx.objectStore('versions');
  const version: DocumentVersion = { key: crypto.randomUUID(), documentId: document.id, label: label.trim() || 'Saved version', createdAt: new Date().toISOString(), sequence: 0, snapshot: snapshotOf(document) };
  let failure: unknown;
  const abort = (error: unknown) => { failure = error; tx.abort(); };
  withWritableDocument(tx, document.id, () => {
    const request = store.index('documentId').getAll(document.id);
    request.onsuccess = () => {
      try {
        const entries = versionsNewestFirst(request.result);
        // Allocate order within this write transaction, independent of clock precision
        // or clock changes. Always keep the version the user just saved.
        version.sequence = nextSequence(entries);
        store.put({ ...version, format: CURRENT_DOCUMENT_VERSION });
        for (const old of entries.slice(39)) store.delete(old.key);
      } catch (error) { abort(error); }
    };
  }, abort);
  try { await done; } catch (error) { throw failure || error; }
  return version;
}
export async function listVersions(documentId: string): Promise<DocumentVersion[]> {
  const db = await database();
  return versionsNewestFirst(await result(db.transaction('versions').objectStore('versions').index('documentId').getAll(documentId)));
}
export async function restoreVersion(key: string, current: SavedDocument): Promise<SavedDocument> {
  const db = await database();
  const parsed = parseDocument(JSON.stringify(current), Infinity);
  if (!parsed.id) throw new Error('Save the current document before restoring a version.');
  const previous: SavedDocument = { ...parsed, id: parsed.id };
  // The recovery checkpoint, retention pruning and restored document must
  // commit together. A failed restore must not consume an older checkpoint.
  const tx = writeTransaction(db, ['versions', 'documents', 'summaries', 'settings', 'libraryMetadata']), done = completed(tx);
  let restored: SavedDocument | undefined, failure: unknown;
  const abort = (error: unknown) => { failure = error; tx.abort(); };
  const request = tx.objectStore('versions').get(key);
  request.onsuccess = () => {
    try {
      const record: VersionRecord | undefined = request.result;
      if (!record || record.documentId !== previous.id) throw new Error('This version is not available for the current document.');
      if (record.document && record.document.id !== previous.id) throw new Error('This version contains a different document. The current document has not been changed.');
      const { snapshot } = versionFromRecord(record), savedAt = new Date().toISOString();
      // Validate the checkpoint as a full document before it replaces the current one.
      restored = { ...parseDocument(JSON.stringify({ version: recordFormat(record), id: previous.id, title: snapshot.title, content: snapshot.content, savedAt }), Infinity), id: previous.id, savedAt };
      withWritableDocument(tx, previous.id, () => {
        const active = tx.objectStore('settings').get('active');
        active.onsuccess = () => {
          if (active.result !== previous.id) { abort(new Error('The active document changed. Reopen this document before restoring a version.')); return; }
          const versions = tx.objectStore('versions');
          const all = versions.index('documentId').getAll(previous.id);
          all.onsuccess = () => {
            try {
              const entries = versionsNewestFirst(all.result);
              const backup: DocumentVersion = { key: crypto.randomUUID(), documentId: previous.id, label: 'Before restoring a version',
                createdAt: new Date().toISOString(), sequence: nextSequence(entries), snapshot: snapshotOf(previous) };
              versions.put({ ...backup, format: CURRENT_DOCUMENT_VERSION });
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
  documentChanges.announce(previous.id);
  return restored!;
}

