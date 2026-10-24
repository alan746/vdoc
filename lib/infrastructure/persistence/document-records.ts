import type { DocumentSummary, LibraryMetadata, SavedDocument } from '../../domain/entities/document';
import { normalizeDocument } from './document-codec';

// Shared record helpers for stores that read or write document rows.
export const summary = (doc: SavedDocument): DocumentSummary => ({ id: doc.id, title: doc.title, savedAt: doc.savedAt });

/** Shape of a `libraryMetadata` row. Stored rows keep flat trash fields; the domain uses `LibraryMetadata.trash`. */
export type MetadataRecord = { id: string; parentId: string | null; starred: boolean; trashedAt?: string; trashGroup?: string };
export const metadataFromRecord = ({ id, parentId, starred, trashedAt, trashGroup }: MetadataRecord): LibraryMetadata =>
  ({ id, parentId, starred, ...(trashedAt ? { trash: { at: trashedAt, ...(trashGroup ? { group: trashGroup } : {}) } } : {}) });
export const metadataToRecord = ({ id, parentId, starred, trash }: LibraryMetadata): MetadataRecord =>
  ({ id, parentId, starred, ...(trash ? { trashedAt: trash.at, ...(trash.group ? { trashGroup: trash.group } : {}) } : {}) });

/** Requests a document row and its library metadata in `tx`; `handle` runs once both are read. Errors thrown by `handle` go to `fail`. */
export function withDocumentRecord(tx: IDBTransaction, id: string, handle: (document: SavedDocument | undefined, metadata: MetadataRecord | undefined) => void, fail: (error: unknown) => void) {
  const document = tx.objectStore('documents').get(id);
  const metadata = tx.objectStore('libraryMetadata').get(id);
  metadata.onsuccess = () => {
    try { handle(document.result, metadata.result); } catch (error) { fail(error); }
  };
}

// Read membership and trash state in the same transaction as the eventual
// write. A previously opened editor must not mutate a discarded document or
// recreate one that is no longer in storage. Include both stores in tx scope.
export function withWritableDocument(tx: IDBTransaction, id: string, write: () => void, fail: (error: unknown) => void) {
  withDocumentRecord(tx, id, (document, metadata) => {
    if (!document) throw new Error('The local document no longer exists. Download a backup of your changes.');
    if (metadata?.trashedAt) throw new Error('This document is in Trash. Restore it from your library before saving, or download a backup of your changes.');
    write();
  }, fail);
}

/** Validates a stored document row and confirms it is the document `id`, without rewriting it. */
export function verifiedStoredDocument(stored: unknown, id: string): SavedDocument {
  if (!stored) throw new Error('The local document no longer exists.');
  const document = normalizeDocument(stored);
  if (document.id !== id) throw new Error('The saved document identity does not match. The original data has been preserved.');
  return { ...document, id };
}
