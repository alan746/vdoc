import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, expect, it, vi } from 'vitest';

// vdoc#69: every committed write of a document record is announced to other
// tabs, and only after the transaction commits.
beforeEach(() => { localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules(); });
const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }] };
async function fixture() {
  const channel = await import('../lib/infrastructure/persistence/document-change-channel');
  const announce = vi.spyOn(channel.documentChanges, 'announce');
  const store = await import('../lib/infrastructure/persistence/document-store');
  const library = await import('../lib/infrastructure/persistence/library-store');
  const versions = await import('../lib/infrastructure/persistence/version-store');
  const original = await store.activateDocument({ version: 1, id: 'notice-doc', title: 'Notice', savedAt: '2026-10-17T00:00:00.000Z', content });
  announce.mockClear();
  return { announce, store, library, versions, original };
}

it('announces a saved document after the save commits', async () => {
  const { announce, store, original } = await fixture();
  await store.saveDocument('Edited', content, original.id);
  expect(announce).toHaveBeenCalledWith(original.id);
});

it('does not announce a save that failed', async () => {
  const { announce, store, library, original } = await fixture();
  await library.updateLibraryItem(original.id, { trash: true });
  await expect(store.saveDocument('Edited', content, original.id)).rejects.toThrow();
  expect(announce).not.toHaveBeenCalled();
});

it('announces a rename, which rewrites the document record, but not a move to Trash', async () => {
  const { announce, library, original } = await fixture();
  await library.updateLibraryItem(original.id, { title: 'Renamed' });
  expect(announce).toHaveBeenCalledWith(original.id);
  announce.mockClear();
  await library.updateLibraryItem(original.id, { trash: true });
  expect(announce).not.toHaveBeenCalled();
});

it('announces a version restore and a permanent delete', async () => {
  const { announce, store, library, versions, original } = await fixture();
  const version = await versions.saveVersion(original, 'Checkpoint');
  await versions.restoreVersion(version.key, await store.openArchivedDocument(original.id));
  expect(announce).toHaveBeenCalledWith(original.id);
  announce.mockClear();
  await library.updateLibraryItem(original.id, { trash: true });
  const trash = (await library.listLibrary()).find(item => item.id === original.id)!.trash!;
  await library.deleteTrashedDocument(original.id, trash);
  expect(announce).toHaveBeenCalledWith(original.id);
});
