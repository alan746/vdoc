import { openDatabase, transactionDone, requestResult, writeTransaction } from './indexed-db';
import { parseDocument } from './storage';
import type { SavedDocument } from '../../domain/entities/document';
import { truncateGraphemePrefix } from '../../domain/text/unicode';
import type { LibraryItem } from '../../domain/entities/document';
type Metadata = { id: string; parentId: string | null; starred: boolean; trashedAt?: string; trashGroup?: string };
export async function listLibrary(): Promise<LibraryItem[]> {
  const db = await openDatabase();
  const tx = db.transaction(['summaries', 'folders', 'libraryMetadata']);
  const [documents, folders, metadata] = await Promise.all([
    requestResult(tx.objectStore('summaries').getAll()), requestResult(tx.objectStore('folders').getAll()), requestResult(tx.objectStore('libraryMetadata').getAll()),
  ]);
  const byId = new Map<string, Metadata>(metadata.map(item => [item.id, item]));
  return [...documents.map(doc => ({ ...doc, kind: 'document' as const })), ...folders.map(folder => ({ ...folder, kind: 'folder' as const }))].map(item => ({ ...item, parentId: null, starred: false, ...byId.get(item.id) }));
}
const cleanName = (name: string) => {
  const value = name.trim();
  if (!value || value.length > 120) throw new Error('Use a name between 1 and 120 characters.');
  return value;
};
// Read and validate inside the same transaction as the mutation. Parent integrity
// must not depend on a stale UI snapshot (especially when moving nested folders).
async function changeLibrary(action: (items: LibraryItem[], tx: IDBTransaction, abort: (error: unknown) => void) => void, includeSettings = false) {
  const db = await openDatabase();
  const tx = writeTransaction(db, ['summaries', 'documents', 'folders', 'libraryMetadata', ...(includeSettings ? ['settings'] : [])]);
  const done = transactionDone(tx);
  let failure: unknown;
  const abort = (error: unknown) => { failure = error; tx.abort(); };
  const summaries = tx.objectStore('summaries').getAll();
  const folders = tx.objectStore('folders').getAll();
  const metadata = tx.objectStore('libraryMetadata').getAll();
  metadata.onsuccess = () => {
    try {
      const byId = new Map<string, Metadata>(metadata.result.map(item => [item.id, item]));
      const items: LibraryItem[] = [...summaries.result.map(doc => ({ ...doc, kind: 'document' })), ...folders.result.map(folder => ({ ...folder, kind: 'folder' }))].map(item => ({ ...item, parentId: null, starred: false, ...byId.get(item.id) }));
      action(items, tx, abort);
    } catch (error) { abort(error); }
  };
  try { await done; } catch (error) { throw failure || error; }
}
function validParent(items: LibraryItem[], parentId: string | null) {
  if (parentId && !items.some(item => item.id === parentId && item.kind === 'folder' && !item.trashedAt)) throw new Error('The destination folder is unavailable.');
}
const metadataFor = (item: LibraryItem): Metadata => ({ id: item.id, parentId: item.parentId, starred: item.starred, ...(item.trashedAt ? { trashedAt: item.trashedAt, trashGroup: item.trashGroup } : {}) });
// Homepage creation and import are one operation: either a complete document is
// added to its destination and activated, or all four records remain unchanged.
export async function createLibraryDocument(document: SavedDocument, parentId: string | null) {
  const data = { ...parseDocument(JSON.stringify(document)), id: crypto.randomUUID(), savedAt: new Date().toISOString() };
  await changeLibrary((items, tx) => {
    validParent(items, parentId);
    tx.objectStore('documents').add(data);
    tx.objectStore('summaries').add({ id: data.id, title: data.title, savedAt: data.savedAt });
    tx.objectStore('libraryMetadata').add({ id: data.id, parentId, starred: false });
    tx.objectStore('settings').put(data.id, 'active');
  }, true);
  return data;
}
export async function createFolder(title: string, parentId: string | null) {
  const folder = { id: crypto.randomUUID(), title: cleanName(title), savedAt: new Date().toISOString() };
  await changeLibrary((items, tx) => {
    validParent(items, parentId);
    tx.objectStore('folders').put(folder);
    tx.objectStore('libraryMetadata').put({ id: folder.id, parentId, starred: false });
  });
  return folder.id;
}
export async function updateLibraryItem(id: string, patch: { title?: string; parentId?: string | null; starred?: boolean; trash?: boolean; expectedTrashGroup?: string }) {
  let updated: Metadata | undefined;
  await changeLibrary((items, tx, abort) => {
    const item = items.find(entry => entry.id === id);
    if (!item) throw new Error('This item no longer exists.');
    // Toast actions can outlive a restore and a later trip to Trash. Match the
    // committed operation in this transaction before applying any undo changes.
    if (patch.expectedTrashGroup !== undefined && (!item.trashedAt || item.trashGroup !== patch.expectedTrashGroup)) throw new Error('This item changed after it was moved to Trash. Open Trash to review its current state.');
    const meta = metadataFor(item);
    if (patch.title !== undefined) {
      const title = cleanName(patch.title);
      if (item.kind === 'folder') tx.objectStore('folders').put({ id, title, savedAt: new Date().toISOString() });
      else {
        const request = tx.objectStore('documents').get(id);
        request.onsuccess = () => {
          try {
            if (!request.result) throw new Error('The local document no longer exists.');
            // Renaming must not rewrite an unreadable document. Validate the
            // latest body, but preserve its exact stored fields and content.
            const original = parseDocument(JSON.stringify(request.result));
            if (original.id !== id) throw new Error('The saved document identity does not match. The original data has been preserved.');
            const document = { ...request.result, title, savedAt: new Date().toISOString() };
            tx.objectStore('documents').put(document);
            tx.objectStore('summaries').put({ id, title, savedAt: document.savedAt });
          } catch (error) { abort(error); }
        };
      }
    }
    if (patch.parentId !== undefined) {
      validParent(items, patch.parentId);
      let cursor = patch.parentId;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === id || seen.has(cursor)) throw new Error('A folder cannot be moved into itself or one of its subfolders.');
        seen.add(cursor); cursor = items.find(entry => entry.id === cursor)?.parentId || null;
      }
      meta.parentId = patch.parentId;
    }
    if (patch.starred !== undefined) meta.starred = patch.starred;
    const descendants = (root: string) => {
      const ids = new Set([root]); let changed = true;
      while (changed) { changed = false; for (const entry of items) if (entry.parentId && ids.has(entry.parentId) && !ids.has(entry.id)) { ids.add(entry.id); changed = true; } }
      return ids;
    };
    // Repeating the same request must not replace the recovery group: children
    // already in Trash would otherwise keep the old group and fail to restore.
    if (patch.trash === true && !item.trashedAt) {
      const ids = descendants(id), trashGroup = crypto.randomUUID(), trashedAt = new Date().toISOString();
      for (const entry of items) if (ids.has(entry.id) && !entry.trashedAt) tx.objectStore('libraryMetadata').put({ ...metadataFor(entry), trashedAt, trashGroup });
      meta.trashedAt = trashedAt; meta.trashGroup = trashGroup;
    } else if (patch.trash === false && item.trashedAt) {
      const ids = descendants(id);
      // Restore only the descendants removed with this folder. Previously
      // discarded items must remain in Trash.
      for (const entry of items) if (entry.id !== id && ids.has(entry.id) && item.trashGroup && entry.trashGroup === item.trashGroup) {
        const restored = metadataFor(entry); delete restored.trashedAt; delete restored.trashGroup;
        tx.objectStore('libraryMetadata').put(restored);
      }
      delete meta.trashedAt; delete meta.trashGroup;
      if (meta.parentId && !items.some(entry => entry.id === meta.parentId && !entry.trashedAt)) meta.parentId = null;
    }
    tx.objectStore('libraryMetadata').put(meta);
    updated = meta;
  });
  return updated!;
}
export async function copyLibraryDocument(id: string) {
  let copy: SavedDocument & { id: string } | undefined;
  // Content, summary and folder membership must commit together. A failed copy
  // must not leave a new document in Workspace after reporting an error.
  await changeLibrary((items, tx, abort) => {
    const item = items.find(entry => entry.id === id && entry.kind === 'document');
    if (!item || item.trashedAt) throw new Error('Restore the document before copying it.');
    validParent(items, item.parentId);
    const request = tx.objectStore('documents').get(id);
    request.onsuccess = () => {
      try {
        if (!request.result) throw new Error('The local document no longer exists.');
        const original = parseDocument(JSON.stringify(request.result));
        if (original.id !== id) throw new Error('The saved document identity does not match. The original data has been preserved.');
        copy = { ...original, id: crypto.randomUUID(), title: truncateGraphemePrefix(`Copy of ${original.title}`, 120), savedAt: new Date().toISOString() };
        tx.objectStore('documents').put(copy);
        tx.objectStore('summaries').put({ id: copy.id, title: copy.title, savedAt: copy.savedAt });
        tx.objectStore('libraryMetadata').put({ id: copy.id, parentId: item.parentId, starred: false });
      } catch (error) { abort(error); }
    };
  });
  return copy!;
}

/** Delete one confirmed Trash document and its checkpoints in one commit. */
export async function deleteTrashedDocument(id: string, expected: { trashedAt: string; trashGroup?: string }) {
  const db = await openDatabase();
  const tx = writeTransaction(db, ['documents', 'summaries', 'libraryMetadata', 'versions', 'settings']);
  const done = transactionDone(tx);
  let failure: unknown;
  const document = tx.objectStore('documents').get(id);
  const active = tx.objectStore('settings').get('active');
  const versions = tx.objectStore('versions').index('documentId').getAllKeys(id);
  const metadata = tx.objectStore('libraryMetadata').get(id);
  metadata.onsuccess = () => {
    try {
      if (!document.result) throw new Error('This document no longer exists.');
      const current = metadata.result as Metadata | undefined;
      if (!expected.trashedAt || !current?.trashedAt || current.trashedAt !== expected.trashedAt || current.trashGroup !== expected.trashGroup) {
        throw new Error('This document changed since you opened Trash. Cancel and review it again before deleting.');
      }
      tx.objectStore('documents').delete(id);
      tx.objectStore('summaries').delete(id);
      tx.objectStore('libraryMetadata').delete(id);
      for (const key of versions.result) tx.objectStore('versions').delete(key);
      if (active.result === id) tx.objectStore('settings').delete('active');
    } catch (error) { failure = error; tx.abort(); }
  };
  try { await done; } catch (error) { throw failure || error; }
}
