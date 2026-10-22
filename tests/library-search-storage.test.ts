import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SavedDocument } from '../lib/infrastructure/persistence/storage';

const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: notices }));
let store: typeof import('../lib/infrastructure/persistence/document-store');
let library: typeof import('../lib/infrastructure/persistence/library-store');
let LibraryHome: typeof import('../components/editor/library-home').LibraryHome;
let root: Root, mount: HTMLDivElement, onOpen: ReturnType<typeof vi.fn>;
let parent: string, child: string, destination: string, original: SavedDocument;
const title = 'Café 2 中文 العربية';
const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep 日本語 café 👩‍💻 עברית', marks: [{ type: 'bold' }] }] }] };
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.resetModules(); localStorage.clear(); sessionStorage.clear(); globalThis.indexedDB = new IDBFactory();
  notices.success.mockReset(); notices.error.mockReset(); onOpen = vi.fn();
  store = await import('../lib/infrastructure/persistence/document-store'); library = await import('../lib/infrastructure/persistence/library-store');
  LibraryHome = (await import('../components/editor/library-home')).LibraryHome;
  parent = await library.createFolder('Projects 中文', null); child = await library.createFolder('Café folder', parent);
  destination = await library.createFolder('Destination 日本語', null);
  original = await store.activateDocument({ version: 1, id: 'search-original', title, content: body, savedAt: '2026-01-02T00:00:00.000Z' });
  original = await store.openArchivedDocument(original.id!);
  await library.updateLibraryItem(original.id!, { parentId: child });
  await store.archiveDocument({ ...original, id: 'search-other', title: 'Café 10 日本語', savedAt: '2026-01-01T00:00:00.000Z' });
  await store.saveVersion(original, 'Keep history');
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await remount('initial');
});
afterEach(() => { act(() => root.unmount()); mount.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const titles = () => Array.from(mount.querySelectorAll('.library-item strong'), node => node.textContent);
const field = (label: string) => document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
async function input(label: string, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(label), value); field(label).dispatchEvent(new Event('input', { bubbles: true })); });
}
async function ready() {
  // Let IndexedDB events and React commits settle together; waiting for the
  // rendered state inside one long act would defer the render until timeout.
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    if (!mount.textContent?.includes('Loading…') && !mount.querySelector<HTMLButtonElement>('[title="New document"]')!.disabled) return;
  }
  throw new Error('The file library did not finish loading or saving.');
}
async function remount(key: string) { await act(async () => root.render(createElement(LibraryHome, { key, onOpen }))); await ready(); }
async function click(label: string) {
  const button = mount.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`) || Array.from(mount.querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent === label)!;
  expect(button).toBeTruthy(); await act(async () => button.click()); await ready();
}
async function scope(label: string) { await act(async () => mount.querySelector<HTMLButtonElement>(`nav [title="${label}"]`)!.click()); await ready(); }
async function action(name: string, label: string) {
  await act(async () => mount.querySelector(`[aria-label="Actions for ${name}"]`)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  const item = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(node => node.textContent === label)!;
  await act(async () => item.click());
  // Modal actions have not started a write; non-modal actions complete asynchronously.
  await ready();
}
async function submit() { await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); await ready(); }
function selectField(label: string) {
  const element = document.querySelector(`[aria-label="${label}"]`);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`Missing select: ${label}`);
  return element;
}
async function select(label: string, value: string) {
  const element = selectField(label);
  await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); });
}
const search = (value: string) => input('Search documents and folders', value);
async function unchanged() {
  expect((await store.openArchivedDocument(original.id!)).content).toEqual(original.content);
  expect((await store.listVersions(original.id!))[0].document).toEqual(original);
  expect(notices.error).not.toHaveBeenCalled();
}
it('updates canonical multilingual search after renaming and opens the latest stored title without changing its body or versions', async () => {
  await search('CAFE\u0301 2'); expect(titles()).toEqual([title]);
  expect(mount.querySelector('.library-item-info')!.textContent).toContain('Projects 中文 / Café folder');
  await action(title, 'Rename'); await input('New name', 'Renamed 日本語 👩‍💻'); await submit();
  expect(titles()).toEqual([]); expect(mount.textContent).toContain('No matching files');
  await search('日本語 👩‍💻'); expect(titles()).toEqual(['Renamed 日本語 👩‍💻']);
  await click('Open document: Renamed 日本語 👩‍💻');
  expect(onOpen).toHaveBeenCalledOnce(); expect(onOpen.mock.calls[0][0]).toMatchObject({ id: original.id, title: 'Renamed 日本語 👩‍💻', content: original.content });
  await unchanged();
});
it('refreshes search paths after moving a result and preserves the moved folder location after clearing search', async () => {
  await search('café 2'); await action(title, 'Move to folder'); await select('Destination folder', destination); await submit();
  expect(mount.querySelector('.library-item-info')!.textContent).toContain('Destination 日本語');
  expect(mount.querySelector('.library-item-info')!.textContent).not.toContain('Projects 中文 / Café folder');
  expect((await library.listLibrary()).find(item => item.id === original.id)?.parentId).toBe(destination);
  await click('Clear search'); await click('Open folder: Destination 日本語'); expect(titles()).toEqual([title]);
  await search('café 10'); expect(titles()).toEqual(['Café 10 日本語']); await click('Clear search');
  expect(titles()).toEqual([title]); await unchanged();
});
it('removes an unstarred search result immediately and keeps the document available in All files', async () => {
  await search('café 2'); await action(title, 'Add to Starred');
  await scope('Starred'); await search('CAFE\u0301'); expect(titles()).toEqual([title]);
  await action(title, 'Remove from Starred'); expect(titles()).toEqual([]);
  expect((await library.listLibrary()).find(item => item.id === original.id)?.starred).toBe(false);
  await scope('All files'); await search('café 2'); expect(titles()).toEqual([title]); await unchanged();
});
it('keeps a starred result out of active searches while trashed and restores its search visibility, folder and star', async () => {
  await search('café 2'); await action(title, 'Add to Starred'); await action(title, 'Move to Trash'); expect(titles()).toEqual([]);
  await scope('Starred'); await search('café 2'); expect(titles()).toEqual([]);
  await scope('Trash'); await search('cafe\u0301 2'); expect(titles()).toEqual([title]);
  expect(mount.querySelector<HTMLButtonElement>(`[aria-label="Open document: ${title}"]`)!.disabled).toBe(true);
  await action(title, 'Restore'); expect(titles()).toEqual([]);
  await scope('Starred'); await search('café 2'); expect(titles()).toEqual([title]);
  expect((await library.listLibrary()).find(item => item.id === original.id)).toMatchObject({ parentId: child, starred: true }); await unchanged();
});
it('sorts numeric names and modified dates correctly after rename while keeping folder results separate', async () => {
  await search('café'); await select('Sort files', 'name'); expect(titles()).toEqual(['Café folder', title, 'Café 10 日本語']);
  await scope('Recent'); await search('café'); await select('Sort files', 'oldest'); expect(titles()).toEqual(['Café 10 日本語', title]);
  await action('Café 10 日本語', 'Rename'); await input('New name', 'Café 10 updated'); await submit();
  expect(titles()).toEqual([title, 'Café 10 updated']); await select('Sort files', 'modified'); expect(titles()).toEqual(['Café 10 updated', title]);
  await unchanged();
});
it('restores folder, query, sort and view preferences on remount without hiding the current folder after clearing search', async () => {
  await click('Open folder: Projects 中文'); await click('Open folder: Café folder');
  await search('café'); await select('Sort files', 'name'); await click('List view'); const before = titles();
  await remount('return-from-editor'); expect(titles()).toEqual(before); expect(field('Search documents and folders').value).toBe('café');
  expect(selectField('Sort files').value).toBe('name');
  expect(mount.querySelector('[aria-label="List view"]')!.getAttribute('aria-pressed')).toBe('true');
  expect(mount.querySelector('[aria-label="Folder path"]')!.textContent).toContain('Projects 中文');
  await click('Clear search'); expect(titles()).toEqual([title]);
  await unchanged(); expect(onOpen).not.toHaveBeenCalled();
});
