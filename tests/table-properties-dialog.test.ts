import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { TableTools } from '../components/editor/editing-panels';

let editor: Editor, engine: DocumentEngine, root: Root, mount: HTMLDivElement;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(() => { act(() => root?.unmount()); mount?.remove(); engine?.destroy(); editor?.destroy(); vi.unstubAllGlobals(); });
const input = (label: string) => Array.from(document.querySelectorAll('label')).find(e => e.textContent?.startsWith(label))!.querySelector('input')!;
async function change(label: string, value: string) {
  const field = input(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function open(attrs: Record<string, unknown> = {}, column = 0) {
  const cell = (text: string, width: number, extra = {}) => ({ type: 'tableCell', attrs: { colwidth: [width], ...extra }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  editor = new Editor({ extensions: createExtensions(), content: { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [cell('中文', 25, attrs), cell('العربية', 150)] }] }] } });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, 1 + TableMap.get(editor.state.doc.firstChild!).map[column])));
  mount = document.body.appendChild(document.createElement('div')); root = createRoot(mount);
  await act(async () => root.render(createElement(TableTools, { editor, engine, run: operation => { engine.execute({ source: 'toolbar', operations: [operation] }); } })));
  await act(async () => Array.from(mount.querySelectorAll('button')).find(b => b.textContent === 'Table properties')!.click());
}
async function apply() { await act(async () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()); }
it.each([{}, { colwidth: [150], padding: 0.4 }, { colwidth: [150], borderWidth: 0.5 }, { colwidth: [150], minHeight: 1400.5 }])('preserves imported dimensions %j while applying an unrelated edit and undoing exactly', async attrs => {
  await open(attrs); const before = editor.getJSON() as JSONContent;
  expect(input('Column width').value).toBe(String(editor.state.doc.firstChild!.firstChild!.firstChild!.attrs.colwidth[0]));
  expect(document.querySelector('form')!.checkValidity()).toBe(true);
  const alignment = Array.from(document.querySelectorAll('label')).find(e => e.textContent?.startsWith('Table alignment'))!.querySelector('select')!;
  await act(async () => { alignment.value = 'center'; alignment.dispatchEvent(new Event('change', { bubbles: true })); });
  await apply(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  const expected = structuredClone(before); expected.content![0].attrs!.alignment = 'center'; expect(editor.getJSON()).toEqual(expected);
  expect(engine.history('undo').ok).toBe(true); expect(editor.getJSON()).toEqual(before);
});
it('resizes a selected normal column without rejecting or modifying an imported narrow neighbour', async () => {
  await open({}, 1); const before = editor.getJSON() as JSONContent; await change('Column width', '190'); await apply();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const expected = structuredClone(before); expected.content![0].content![0].content![1].attrs!.colwidth = [190]; expect(editor.getJSON()).toEqual(expected);
  expect(engine.history('undo').ok).toBe(true); expect(editor.getJSON()).toEqual(before);
});
it.each([['Column width', '30'], ['Column width', '150.5'], ['Cell padding', '0.5'], ['Border width', '9'], ['Minimum row height', '1001']])('still rejects an edited %s value %s without partial changes', async (label, value) => {
  await open(); const before = editor.getJSON() as JSONContent; await change(label, value);
  expect(document.querySelector('form')!.checkValidity()).toBe(false); await apply();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull(); expect(editor.getJSON()).toEqual(before);
});
