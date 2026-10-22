import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { Editor } from '@tiptap/core';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { closeHistory } from '@tiptap/pm/history';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createExtensions } from '../lib/editor/extensions';
import { documentNavigation } from '../lib/usecases/document-navigation';

let editor: Editor, host: HTMLDivElement;
beforeEach(async () => {
  host = document.createElement('div'); document.body.appendChild(host);
  editor = new Editor({ element: host, extensions: createExtensions(), content: '<p></p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
});
afterEach(() => { editor.destroy(); host.remove(); vi.restoreAllMocks(); });

// Exercise the editor's DOM clipboard event path, not insertContent. This is
// still a synthetic DataTransfer, not an OS clipboard/permission acceptance.
function clipboard(type: 'paste' | 'cut', text = '', html = '') {
  const data = new Map([['text/plain', text], ['text/html', html]]);
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    getData: (format: string) => data.get(format) || '',
    setData: (format: string, value: string) => data.set(format, value),
    clearData: () => data.clear(),
  } });
  editor.view.dom.dispatchEvent(event);
  return { data, event };
}
const tableHTML = '<table><tr><td colspan="2"><p><strong>中文 العربية</strong></p></td></tr><tr><td><p>café 👩‍💻</p></td><td><p>日本語 कि</p></td></tr></table>';

function seedContent(html: string) {
  editor.commands.setContent(html);
  editor.view.dispatch(closeHistory(editor.state.tr));
}

it('pastes multilingual plain text with tabs and line breaks and undoes the entire paste once', () => {
  const before = editor.getJSON(), lines = ['\t中文 cafe\u0301 👩‍💻', 'العربية\t日本語 कि'];
  expect(clipboard('paste', lines.join('\n')).event.defaultPrevented).toBe(true);
  const text: string[] = []; editor.state.doc.forEach(node => text.push(node.textContent));
  expect(text).toEqual(lines);
  const pasted = editor.getJSON(); editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
  editor.commands.redo(); expect(editor.getJSON()).toEqual(pasted);
});

it('pastes an internal merged table copy without stealing original stable IDs and restores exact history', () => {
  seedContent('<p></p>' + tableHTML + '<p></p>');
  const original = editor.state.doc.child(1);
  editor.commands.setNodeSelection(editor.state.doc.firstChild!.nodeSize);
  const copied = editor.view.serializeForClipboard(editor.state.selection.content());
  editor.commands.setTextSelection(1); const before = editor.getJSON();
  clipboard('paste', copied.text, copied.dom.innerHTML);
  const tables: typeof original[] = [], ids: string[] = [];
  editor.state.doc.descendants(node => { if (node.type.name === 'table') tables.push(node); if (node.attrs.blockId) ids.push(node.attrs.blockId); });
  expect(tables).toHaveLength(2); expect(tables[1].toJSON()).toEqual(original.toJSON());
  expect(new Set(ids).size).toBe(ids.length);
  for (const table of tables) { expect(TableMap.get(table).problems).toBeNull(); expect(TableMap.get(table).width).toBe(2); }
  expect(editor.getHTML()).toContain('<strong>中文 العربية</strong>');
  const pasted = editor.getJSON(); editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
  editor.commands.redo(); expect(editor.getJSON()).toEqual(pasted);
});

it('cuts a Unicode selection to both clipboard formats and undoes without damaging graphemes', () => {
  const text = '中文 cafe\u0301 👩‍💻 العربية कि';
  seedContent(`<p><strong>${text}</strong></p>`);
  editor.commands.setTextSelection({ from: 1, to: text.length + 1 });
  const before = editor.getJSON(), { data, event } = clipboard('cut');
  expect(event.defaultPrevented).toBe(true); expect(data.get('text/plain')).toBe(text);
  expect(data.get('text/html')).toContain(`<strong>${text}</strong>`);
  expect(editor.state.doc.textContent).toBe('');
  editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
});

it('replaces a selected cell rectangle without changing neighboring cells or table shape', () => {
  seedContent('<table>' + [0, 1, 2].map(row => '<tr>' + [0, 1, 2].map(col => `<td><p>${row}:${col}</p></td>`).join('') + '</tr>').join('') + '</table>');
  const map = TableMap.get(editor.state.doc.firstChild!);
  editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, 1 + map.map[3], 1 + map.map[7])));
  const before = editor.getJSON();
  clipboard('paste', '', '<table><tr><td>中文</td><td>العربية</td></tr><tr><td>日本語</td><td>👩‍💻</td></tr></table>');
  const table = editor.state.doc.firstChild!, result = TableMap.get(table);
  expect({ width: result.width, height: result.height, problems: result.problems }).toEqual({ width: 3, height: 3, problems: null });
  const rows: string[][] = []; table.forEach(row => { const cells: string[] = []; row.forEach(cell => cells.push(cell.textContent)); rows.push(cells); });
  expect(rows).toEqual([['0:0', '0:1', '0:2'], ['中文', 'العربية', '1:2'], ['日本語', '👩‍💻', '2:2']]);
  const pasted = editor.getJSON(); editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
  editor.commands.redo(); expect(editor.getJSON()).toEqual(pasted);
});

it('rejects paste during a committed document switch and resumes only after the lock is released', () => {
  const navigation = documentNavigation(editor), before = editor.getJSON();
  navigation.acquire(); navigation.freeze();
  clipboard('paste', 'Late clipboard text');
  editor.view.pasteHTML(tableHTML, new Event('paste') as ClipboardEvent);
  expect(editor.getJSON()).toEqual(before); expect(editor.can().undo()).toBe(false);
  navigation.release(); clipboard('paste', 'Allowed after cancellation');
  expect(editor.state.doc.textContent).toBe('Allowed after cancellation');
  editor.commands.undo(); expect(editor.getJSON()).toEqual(before);
});

it('persists pasted table content and its undo through the autosave transaction path', async () => {
  globalThis.indexedDB = new IDBFactory(); localStorage.clear(); vi.resetModules();
  const store = await import('../lib/infrastructure/persistence/document-store');
  const { startAutosave } = await import('../lib/composition/autosave');
  const original = await store.activateDocument({ version: 1, id: 'clipboard-save', title: 'Clipboard QA', content: editor.getJSON(), savedAt: new Date().toISOString() });
  const report = vi.fn();
  const autosave = startAutosave(editor, original.id, { getTitle: () => original.title, blocked: { current: false }, report });
  try {
    clipboard('paste', '', tableHTML); const pasted = editor.getJSON();
    await autosave.flush(); expect(report).toHaveBeenLastCalledWith('Saved locally', '');
    expect((await store.readSavedDocument()).data!.content).toEqual(pasted);
    editor.commands.undo(); await autosave.flush();
    expect(editor.getJSON()).toEqual(original.content);
    expect((await store.readSavedDocument()).data!.content).toEqual(original.content);
  } finally { autosave.dispose(); }
});
