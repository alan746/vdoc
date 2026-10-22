import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/editor/engine';
import { PageDialog, ImageDialog } from '../components/editor/document-dialogs';

let editor: Editor, engine: DocumentEngine, root: Root, mount: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  editor = new Editor({ extensions: createExtensions(), content: '<p>Keep body 中文 العربية</p><img src="data:image/png;base64,QQ==" alt="Original" width="320">' });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
});
afterEach(() => { act(() => root.unmount()); mount.remove(); engine.destroy(); editor.destroy(); vi.unstubAllGlobals(); });
it.each([
  ['page header', 'Escape'], ['image description', 'Escape'],
  ['page header', 'submit'], ['image description', 'submit'],
])('retains unfinished %s on candidate %s, then applies once and undoes exactly', async (kind, action) => {
  if (kind === 'image description') {
    let imagePos = 0; editor.state.doc.descendants((node, pos) => { if (node.type.name === 'image') imagePos = pos; });
    editor.commands.setNodeSelection(imagePos);
  }
  const before = editor.getJSON();
  function Harness() {
    const [open, setOpen] = useState(true);
    return createElement(kind === 'page header' ? PageDialog : ImageDialog, { open, close: () => setOpen(false), editor, engine });
  }
  await act(async () => root.render(createElement(Harness)));
  const label = Array.from(document.querySelectorAll('label')).find(label => label.textContent === (kind === 'page header' ? 'Header' : 'Alternative text'))!;
  const input = label.querySelector('input')!;
  await act(async () => {
    input.focus(); input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '草稿 日本語 العربية');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    if (action === 'Escape') input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true, cancelable: true }));
    else input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull(); expect(input.value).toBe('草稿 日本語 العربية');
  expect(editor.getJSON()).toEqual(before);
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await act(async () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(kind === 'page header' ? editor.state.doc.attrs.header : editor.getAttributes('image').alt).toBe('草稿 日本語 العربية');
  expect(editor.commands.undo()).toBe(true); expect(editor.getJSON()).toEqual(before);
});
