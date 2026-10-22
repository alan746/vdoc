import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { ColorPicker } from '../components/editor/toolbar';

let root: Root, editor: Editor, engine: DocumentEngine, mount: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  editor = new Editor({ extensions: createExtensions(), content: '<p>Target 中文</p><table><tr><td><p>Cell العربية</p></td><td><p>Keep 日本語</p></td></tr></table>' });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
});
afterEach(() => { act(() => root.unmount()); mount.remove(); engine.destroy(); editor.destroy(); vi.unstubAllGlobals(); });
async function open(kind: 'color' | 'highlight' | 'cell') {
  let from = 0, length = 0;
  editor.state.doc.descendants((n, pos) => { if (n.isText && n.text === (kind === 'cell' ? 'Cell العربية' : 'Target 中文')) { from = pos; length = n.nodeSize; } });
  editor.commands.setTextSelection({ from, to: from + length });
  await act(async () => root.render(createElement(ColorPicker, { kind, engine, run: operations => { engine.execute({ source: 'toolbar', operations: Array.isArray(operations) ? operations : [operations] }); } })));
  const label = kind === 'color' ? 'Text color' : kind === 'highlight' ? 'Highlight' : 'Cell background';
  await act(async () => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${label} custom hex"]`)!;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '#334455');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return input;
}
for (const kind of ['color', 'highlight', 'cell'] as const) {
  it.each(['tracked Escape', 'flagged Escape', 'candidate submit'])('protects %s in '+kind+' and retains exact apply/undo/redo', async action => {
    const input = await open(kind);
    const before: JSONContent = editor.getJSON();
    await act(async () => {
      if (action !== 'flagged Escape') input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      if (action === 'candidate submit') input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: action === 'flagged Escape' ? 229 : 27, bubbles: true, cancelable: true }));
    });
    expect(input.isConnected).toBe(true); expect(input.value).toBe('#334455'); expect(editor.getJSON()).toEqual(before);
    await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await act(async () => input.form!.querySelector<HTMLButtonElement>('button')!.click());
    expect(input.isConnected).toBe(false);
    const after = editor.getJSON(); expect(after).not.toEqual(before);
    if (kind === 'cell') {
      expect(editor.getAttributes('tableCell').backgroundColor).toBe('#334455');
      expect(editor.state.doc.child(1).firstChild!.child(1).toJSON()).toEqual(before.content![1].content![0].content![1]);
    } else {
      expect(editor.getAttributes(kind === 'color' ? 'textStyle' : 'highlight').color).toBe('#334455');
      expect(editor.state.doc.child(1).toJSON()).toEqual(before.content![1]);
    }
    act(() => { engine.history('undo'); }); expect(editor.getJSON()).toEqual(before);
    act(() => { engine.history('redo'); }); expect(editor.getJSON()).toEqual(after);
  });
}
it('restores ordinary Escape after composition ends, and after reopening', async () => {
  const input = await open('highlight'), before = editor.getJSON();
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(input.isConnected).toBe(false); expect(editor.getJSON()).toEqual(before);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Highlight"]')!.click());
  const reopened = document.querySelector<HTMLInputElement>('[aria-label="Highlight custom hex"]')!;
  await act(async () => reopened.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(reopened.isConnected).toBe(false); expect(editor.getJSON()).toEqual(before);
});
it('allows explicit Apply after leaving the composing color field', async () => {
  const input = await open('color');
  await act(async () => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await act(async () => { const button = input.form!.querySelector<HTMLButtonElement>('button')!; button.focus(); button.click(); });
  expect(input.isConnected).toBe(false); expect(editor.getAttributes('textStyle').color).toBe('#334455');
});
