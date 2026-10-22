import 'fake-indexeddb/auto';
import { forceCloseDatabase, IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// fake-indexeddb's declaration expects a constructor, but this helper takes an instance.
const forceClose = forceCloseDatabase as unknown as (database: IDBDatabase) => void;
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import type { startAutosave } from '../lib/composition/autosave';

let editor: Editor, controller: ReturnType<typeof startAutosave> | undefined;
beforeEach(async () => {
  localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules();
  editor = new Editor({ extensions: createExtensions(), content: '<p>中文 العربية 日本語</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
});
afterEach(() => { controller?.dispose(); controller = undefined; editor.destroy(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('persists the deadline snapshot through real storage transactions while typing never pauses', async () => {
  const store = await import('../lib/infrastructure/persistence/document-store');
  const { startAutosave } = await import('../lib/composition/autosave');
  const original = await store.activateDocument({ version: 1, id: 'continuous', title: 'Original', content: editor.getJSON(), savedAt: new Date().toISOString() });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  let saved!: () => void;
  const committed = new Promise<void>(resolve => { saved = resolve; });
  controller = startAutosave(editor, original.id, { getTitle: () => 'Renamed العربية', blocked: { current: false }, report: status => { if (status === 'Saved locally') saved(); } });
  for (let i = 0; i < 7; i++) { editor.commands.insertContent(`输入${i} `); await vi.advanceTimersByTimeAsync(i === 6 ? 200 : 300); }
  await committed;
  const expected = editor.getJSON(); controller.dispose();
  const reopened = await store.readSavedDocument();
  expect(reopened.error).toBeUndefined(); expect(reopened.data!.content).toEqual(expected); expect(reopened.data!.title).toBe('Renamed العربية');
  expect((await store.listDocuments()).find(doc => doc.id === original.id)?.title).toBe('Renamed العربية');
});

it('cannot overwrite the active document if it changes before the typing deadline commits', async () => {
  const store = await import('../lib/infrastructure/persistence/document-store');
  const { startAutosave } = await import('../lib/composition/autosave');
  const original = await store.activateDocument({ version: 1, id: 'old-document', title: 'Original', content: editor.getJSON(), savedAt: new Date().toISOString() });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  let fail!: (message: string | undefined) => void;
  const rejected = new Promise<string | undefined>(resolve => { fail = resolve; });
  controller = startAutosave(editor, original.id, { getTitle: () => 'Stale title', blocked: { current: false }, report: (status, warning) => { if (status.startsWith('Save failed')) fail(warning); } });
  for (let i = 0; i < 4; i++) { editor.commands.insertContent('Unsaved '); await vi.advanceTimersByTimeAsync(400); }
  const next = await store.activateDocument({ ...original, id: 'next-document', title: 'Next' });
  await vi.advanceTimersByTimeAsync(400);
  expect(await rejected).toContain('active document changed'); controller.dispose();
  expect((await store.readSavedDocument()).data!.id).toBe(next.id);
  expect((await store.openArchivedDocument(original.id)).content).toEqual(original.content);
  expect(editor.getText()).toContain('Unsaved');
});

it('keeps a failed draft and saves it on retry after the storage connection closes', async () => {
  const store = await import('../lib/infrastructure/persistence/document-store');
  const { startAutosave } = await import('../lib/composition/autosave');
  const original = await store.activateDocument({ version: 1, id: 'reconnect-draft', title: 'Original', content: editor.getJSON(), savedAt: new Date().toISOString() });
  const db = await store.openDatabase();
  const closed = new Promise<void>(resolve => db.addEventListener('close', () => resolve(), { once: true }));
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
    if (this.name === 'documents') request.addEventListener('success', () => { this.transaction.abort(); forceClose(db); }, { once: true });
    return request;
  });
  const report = vi.fn();
  controller = startAutosave(editor, original.id, { getTitle: () => 'Recovered draft', blocked: { current: false }, report });
  editor.commands.insertContent('Keep this unsaved change 👩‍💻 ');
  const draft = editor.getJSON();
  await controller.flush(); await closed; failure.mockRestore();
  expect(report).toHaveBeenLastCalledWith('Save failed. Download a backup.', expect.any(String));
  expect(editor.getJSON()).toEqual(draft);
  expect(await store.openArchivedDocument(original.id)).toEqual(original);
  await controller.flush();
  expect(report).toHaveBeenLastCalledWith('Saved locally', '');
  expect((await store.readSavedDocument()).data).toEqual({ ...original, title: 'Recovered draft', content: draft, savedAt: expect.any(String) });
});

it('guards and resaves an undone draft after a separate navigation save changes the stored snapshot', async () => {
  const store = await import('../lib/infrastructure/persistence/document-store');
  const { startAutosave } = await import('../lib/composition/autosave');
  const { documentNavigation } = await import('../lib/usecases/document-navigation');
  const original = await store.activateDocument({ version: 1, id: 'manual-save-handoff', title: 'Original', content: editor.getJSON(), savedAt: new Date().toISOString() });
  const report = vi.fn();
  controller = startAutosave(editor, original.id, { getTitle: () => original.title, blocked: { current: false }, report });
  await controller.flush(); const navigation = documentNavigation(editor);
  editor.commands.insertContent('Saved by the file menu '); const manualSnapshot = editor.getJSON();
  navigation.acquire(); await store.saveDocument(original.title, manualSnapshot, original.id);
  editor.commands.undo(); navigation.release();
  expect(editor.getJSON()).toEqual(original.content);
  expect((await store.openArchivedDocument(original.id)).content).toEqual(manualSnapshot);
  const leaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  // Wait for the real IndexedDB write started by beforeunload, not just its debounce.
  await vi.waitFor(() => expect(report).toHaveBeenLastCalledWith('Saved locally', ''));
  expect((await store.openArchivedDocument(original.id)).content).toEqual(original.content);
  const savedLeave = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(savedLeave);
  expect(savedLeave.defaultPrevented).toBe(false);
});

it.each(['synchronous quota error', 'asynchronous summary failure'])('backs up the latest failed draft, keeps leave protection, retries and restores the backup after %s', async failureKind => {
  const store = await import('../lib/infrastructure/persistence/document-store');
  const { startAutosave } = await import('../lib/composition/autosave');
  const { exportLocalDocument } = await import('../components/editor/local-export');
  const { parseDocument } = await import('../lib/infrastructure/persistence/storage');
  const original = await store.activateDocument({ version: 1, id: 'backup-recovery', title: 'Original', content: editor.getJSON(), savedAt: new Date().toISOString() });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  let title = original.title, settle: (() => void) | undefined;
  const report = vi.fn((status: string, _warning?: string) => {
    if (status === 'Saved locally' || status.startsWith('Save failed')) settle?.();
  });
  controller = startAutosave(editor, original.id, { getTitle: () => title, blocked: { current: false }, report });
  await controller.flush();
  const storedBaseline = await store.openArchivedDocument(original.id), summaries = await store.listDocuments();
  const put = IDBObjectStore.prototype.put;
  const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value, key) {
    if (this.name === 'summaries') {
      if (failureKind === 'synchronous quota error') throw new DOMException('Simulated quota limit', 'QuotaExceededError');
      // The summary key exists: add fails asynchronously and aborts the entire transaction.
      return this.add(value);
    }
    return key === undefined ? put.call(this, value) : put.call(this, value, key);
  });
  title = 'Unsaved 中文 العربية 👩‍💻';
  editor.commands.insertContent('Keep this latest draft cafe\u0301 कि ');
  const backupContent = editor.getJSON();
  await controller.flush();
  expect(report).toHaveBeenLastCalledWith('Save failed. Download a backup.', expect.any(String));
  expect(await store.openArchivedDocument(original.id)).toEqual(storedBaseline);
  expect(await store.listDocuments()).toEqual(summaries);

  let blob: Blob | undefined;
  const NativeURL = URL;
  vi.stubGlobal('URL', class extends NativeURL {
    static createObjectURL(value: Blob) { blob = value; return 'blob:failed-draft'; }
    static revokeObjectURL() {}
  });
  const downloads: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { downloads.push(this.download); });
  const beforeDownloadReports = report.mock.calls.length;
  expect(exportLocalDocument(editor, title, 'json')).toBe(true);
  expect(downloads).toEqual([`${title}.vdoc.json`]);
  const backup = parseDocument(await new Promise<string>((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.onerror = reject; reader.readAsText(blob!);
  }));
  expect(backup.title).toBe(title); expect(backup.content).toEqual(backupContent);
  expect(report).toHaveBeenCalledTimes(beforeDownloadReports);
  expect(await store.openArchivedDocument(original.id)).toEqual(storedBaseline);
  const leaving = new Event('beforeunload', { cancelable: true });
  const leaveAttempt = new Promise<void>(resolve => { settle = resolve; });
  window.dispatchEvent(leaving); expect(leaving.defaultPrevented).toBe(true);
  await leaveAttempt; settle = undefined;
  expect(report).toHaveBeenLastCalledWith('Save failed. Download a backup.', expect.any(String));

  // Keep editing after downloading: retry must save the newer draft, not the backup snapshot.
  title = 'Recovered latest 日本語'; editor.commands.insertContent('After backup ');
  const latest = editor.getJSON(); failure.mockRestore(); await controller.flush();
  expect(report).toHaveBeenLastCalledWith('Saved locally', '');
  expect((await store.readSavedDocument()).data).toEqual(expect.objectContaining({ id: original.id, title, content: latest }));
  const savedLeave = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(savedLeave);
  expect(savedLeave.defaultPrevented).toBe(false);
  controller.dispose();
  const recovered = await store.activateDocument({ ...backup, id: 'restored-backup' });
  expect((await store.readSavedDocument()).data).toEqual(recovered);
  expect(recovered.content).toEqual(backupContent); expect(recovered.title).toBe(backup.title);
  expect((await store.openArchivedDocument(original.id)).content).toEqual(latest);
  expect(editor.getJSON()).toEqual(latest);
});
