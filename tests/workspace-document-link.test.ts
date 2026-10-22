import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import VdocWorkspace from '../components/editor/workspace';

const { readSavedDocument, useEditor } = vi.hoisted(() => ({ readSavedDocument: vi.fn(), useEditor: vi.fn((_options: unknown) => null) }));
vi.mock('@tiptap/react', () => ({ useEditor, EditorContent: () => null }));
vi.mock('../lib/editor/document-store', () => ({ readSavedDocument }));
vi.mock('../components/editor/library-home', () => ({ LibraryHome: ({ recoveryError }: { recoveryError?: string }) =>
  createElement('div', { 'data-testid': 'library' }, recoveryError ? createElement('p', { role: 'alert' }, recoveryError) : 'Library') }));
const linked = { version: 1, id: 'linked-中文', title: 'Linked document', savedAt: '2026-10-05T12:00:00.000Z',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Requested content 中文' }] }] } };
let root: Root, mount: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  readSavedDocument.mockReset(); useEditor.mockClear();
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
});
afterEach(() => { act(() => root.unmount()); mount.remove(); window.history.replaceState(null, '', '/'); vi.unstubAllGlobals(); });
async function render(hash: string) {
  window.history.replaceState(null, '', `/${hash}`);
  await act(async () => root.render(createElement(VdocWorkspace)));
}
it('opens the document named by the URL, including an encoded ID', async () => {
  readSavedDocument.mockResolvedValue({ data: linked });
  await render(`#document=${encodeURIComponent(linked.id)}`);
  expect(readSavedDocument).toHaveBeenCalledWith(linked.id);
  expect(useEditor.mock.calls.at(-1)?.[0]).toMatchObject({ content: linked.content });
  expect(mount.querySelector('[data-testid="library"]')).toBeNull();
});
it('keeps the library as the landing page without a document link', async () => {
  readSavedDocument.mockResolvedValue({ data: linked }); await render('');
  expect(readSavedDocument).toHaveBeenCalledWith(undefined);
  expect(mount.querySelector('[data-testid="library"]')).not.toBeNull(); expect(useEditor).not.toHaveBeenCalled();
});
it('shows a failed link in the library without opening another document', async () => {
  readSavedDocument.mockResolvedValue({ data: null, error: 'Restore this document from Trash.' });
  await render('#document=trashed');
  expect(mount.querySelector('[role="alert"]')?.textContent).toContain('Restore this document');
  expect(useEditor).not.toHaveBeenCalled(); expect(window.location.hash).toBe('#document=trashed');
});
it('does not substitute the last active document for an empty document ID', async () => {
  readSavedDocument.mockResolvedValue({ data: null, error: 'Document not found.' }); await render('#document=');
  expect(readSavedDocument).toHaveBeenCalledWith(''); expect(useEditor).not.toHaveBeenCalled();
});
it('does not open a late result after the loading URL changes', async () => {
  let resolve!: (value: unknown) => void;
  readSavedDocument.mockReturnValue(new Promise(done => { resolve = done; }));
  await render(`#document=${encodeURIComponent(linked.id)}`);
  window.history.replaceState(null, '', '/');
  await act(async () => resolve({ data: linked }));
  expect(mount.querySelector('[data-testid="library"]')).not.toBeNull(); expect(useEditor).not.toHaveBeenCalled();
});
it('ignores a pending load after unmount', async () => {
  let resolve!: (value: unknown) => void;
  readSavedDocument.mockReturnValue(new Promise(done => { resolve = done; }));
  await render('#document=waiting'); act(() => root.unmount()); root = createRoot(mount);
  await act(async () => resolve({ data: linked })); expect(mount.textContent).toBe(''); expect(useEditor).not.toHaveBeenCalled();
});
