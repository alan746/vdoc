import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { toast } from 'sonner';
import VdocWorkspace from '../components/editor/workspace';

// Keep the real library, import handler, workspace navigation, and Sonner renderer.
// A loading editor ensures notices also survive the gap before Tiptap is ready.
vi.mock('@tiptap/react', () => ({ useEditor: () => null, EditorContent: () => null }));
vi.mock('../lib/editor/document-store', () => ({
  readSavedDocument: async () => ({ data: null }),
  activateDocument: async (value: unknown) => value,
}));
vi.mock('../lib/editor/library-store', () => ({
  listLibrary: async () => [],
  createLibraryDocument: async (value: Record<string, unknown>) => ({ ...value, id: crypto.randomUUID() }),
}));
vi.mock('../lib/editor/word', () => ({ importWord: async () => ({
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  warnings: ['Custom tab positions need review. 中文 العربية'],
}) }));
let root: Root, mount: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  sessionStorage.clear(); window.history.replaceState(null, '', '/');
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await act(async () => root.render(createElement(VdocWorkspace)));
});
afterEach(async () => {
  act(() => root.unmount()); toast.dismiss(); mount.remove();
  await new Promise(resolve => setTimeout(resolve, 30)); vi.unstubAllGlobals();
});
it('keeps import details visible across the real home-to-editor remount until dismissed', async () => {
  const input = mount.querySelector('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'Review.docx', size: 1, arrayBuffer: async () => new ArrayBuffer(1) }] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  expect(window.location.hash).toMatch(/^#document=/);
  expect(mount.querySelector('input[type="file"]')).toBeNull();
  const details = mount.querySelector('[aria-label="Word import details"]');
  expect(details?.textContent).toContain('Custom tab positions need review. 中文 العربية');
  expect(details?.getAttribute('tabindex')).toBe('0');
  expect(mount.querySelectorAll('[data-sonner-toaster]')).toHaveLength(1);
  const close = mount.querySelector<HTMLButtonElement>('[data-close-button]');
  expect(close).not.toBeNull();
  await act(async () => close!.click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
  expect(mount.querySelector('[aria-label="Word import details"]')).toBeNull();
});
