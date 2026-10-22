import type { SavedDocument } from '../../domain/entities/document';

// Shared record helpers for stores that write document rows.
export const summary = (doc: SavedDocument) => ({ id: doc.id!, title: doc.title, savedAt: doc.savedAt });
// Read membership and trash state in the same transaction as the eventual
// write. A previously opened editor must not mutate a discarded document or
// recreate one that is no longer in storage. Include both stores in tx scope.
export function withWritableDocument(tx: IDBTransaction, id: string, write: () => void, fail: (error: unknown) => void) {
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
