import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import VdocWorkspace from '../components/editor/workspace';
import { documentStatistics } from '../lib/domain/text/unicode';

let editor: Editor, root: Root, mount: HTMLDivElement;
const renders = vi.hoisted(() => ({ toolbar: vi.fn() }));
vi.mock('@tiptap/react', () => ({ useEditor: () => editor, EditorContent: () => null }));
vi.mock('../components/editor/use-document-autosave', () => ({ useDocumentAutosave: () => () => {} }));
vi.mock('../lib/usecases/browser-tools', () => ({ registerDocumentTools: () => () => {} }));
vi.mock('../components/editor/toolbar', async importOriginal => {
  const actual = await importOriginal<typeof import('../components/editor/toolbar')>();
  return { ...actual, EditorToolbar: (props: Parameters<typeof actual.EditorToolbar>[0]) => {
    renders.toolbar(); return createElement(actual.EditorToolbar, props);
  } };
});
vi.mock('../lib/infrastructure/persistence/document-store', () => ({
  readSavedDocument: async () => ({ data: { id: 'subscriptions', title: 'Subscriptions', content: editor.getJSON() } }),
}));
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); }); };
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  window.history.replaceState(null, '', '/#document=subscriptions');
  const element = document.createElement('div'); document.body.appendChild(element);
  editor = new Editor({ element, extensions: createExtensions(), content: {
    type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Destination' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Last paragraph' }] },
    ],
  } });
  await new Promise(resolve => setTimeout(resolve, 0));
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await act(async () => root.render(createElement(VdocWorkspace)));
  await settle(); renders.toolbar.mockClear();
});
afterEach(() => {
  act(() => root.unmount()); editor.destroy(); document.body.innerHTML = '';
  vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/');
});

it('updates counts while stable typing skips toolbar renders, then refreshes pending formatting and undo state', async () => {
  act(() => editor.commands.insertContent('x')); await settle(); // enables undo
  renders.toolbar.mockClear();
  act(() => editor.commands.insertContent('yz')); await settle();
  expect(renders.toolbar).not.toHaveBeenCalled();
  expect(mount.querySelector('.statusbar')?.textContent).toContain(`${documentStatistics(editor.state.doc).characters} characters`);
  act(() => editor.commands.toggleBold()); await settle();
  expect(renders.toolbar).toHaveBeenCalled();
  expect(mount.querySelector('[aria-label="Bold · ⌘B"]')?.getAttribute('aria-pressed')).toBe('true');
  act(() => editor.commands.undo()); await settle();
  expect((mount.querySelector('[aria-label="Undo · ⌘Z"]') as HTMLButtonElement).disabled).toBe(true);
});

it('keeps outline jumps current after preceding text shifts a heading without changing its label', async () => {
  const heading = mount.querySelector<HTMLButtonElement>('.outline-item')!;
  act(() => editor.commands.insertContent('A longer prefix')); await settle();
  let position = 0;
  editor.state.doc.descendants((node, pos) => { if (node.type.name === 'heading') position = pos; });
  const element = editor.view.nodeDOM(position) as HTMLElement;
  element.scrollIntoView = vi.fn();
  act(() => heading.click()); await settle();
  expect(editor.state.selection.from).toBe(position + 1);
  expect(element.scrollIntoView).toHaveBeenCalled();
  expect(mount.querySelector('.outline-item')?.classList.contains('current')).toBe(true);
  expect(mount.querySelector('[aria-label="Document formatting toolbar"]')?.textContent).toContain('Heading 2');
});

it('refreshes selection counts and toolbar formatting across marks and nonempty selections', async () => {
  act(() => { editor.commands.setTextSelection({ from: 1, to: 6 }); editor.commands.toggleBold(); });
  await settle();
  expect(mount.querySelector('.statusbar')?.textContent).toContain('5 characters selected');
  expect(mount.querySelector('[aria-label="Bold · ⌘B"]')?.getAttribute('aria-pressed')).toBe('true');
  act(() => editor.commands.setTextSelection(10)); await settle();
  expect(mount.querySelector('.statusbar')?.textContent).not.toContain('characters selected');
  expect(mount.querySelector('[aria-label="Bold · ⌘B"]')?.getAttribute('aria-pressed')).toBe('false');
});
