import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { TableMap } from '@tiptap/pm/tables';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/editor/engine';
import { reorderedTable } from '../lib/editor/table-move';
let editor: Editor, engine: DocumentEngine;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<table data-pinned-rows="0"><tr style="height:55px"><th colwidth="100">标题 العربية</th><td colwidth="150">日本語</td><td colwidth="200">한국어</td></tr><tr style="height:90px"><td colwidth="100">हिन्दी</td><td colwidth="150">Français</td><td colwidth="200">Deutsch</td></tr><tr style="height:120px"><td colwidth="100">ไทย</td><td colwidth="150">עברית</td><td colwidth="200">Ελληνικά</td></tr></table>' });
  await new Promise(r => setTimeout(r, 0)); engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); });
const table = () => editor.state.doc.firstChild!;
const move = (axis: 'row' | 'column', from: number, to: number) => engine.execute({ target: { kind: 'cells', tableId: table().attrs.blockId, row: 0, col: 0 }, operations: [{ type: 'table.move', axis, from, to }] });
it.each([[0,2],[2,0],[0,1],[1,0],[1,2],[2,1]])('moves row %i to %i with complete row identity, height, cell type, and content', (from, to) => {
  const before = editor.getJSON(), rows = Array.from({ length: 3 }, (_, i) => table().child(i).toJSON());
  rows.splice(to, 0, ...rows.splice(from, 1)); expect(move('row', from, to).ok).toBe(true);
  expect(table().content.toJSON()).toEqual(rows); expect(TableMap.get(table()).problems).toBeNull();
  engine.history('undo'); expect(editor.getJSON()).toEqual(before); engine.history('redo'); expect(table().content.toJSON()).toEqual(rows);
});
it.each([[0,2],[2,0],[0,1],[1,0],[1,2],[2,1]])('moves column %i to %i with original widths, types, and attributes', (from, to) => {
  const before = editor.getJSON(), rows = Array.from({ length: 3 }, (_, i) => table().child(i).toJSON());
  for (const row of rows) row.content!.splice(to, 0, ...row.content!.splice(from, 1));
  expect(move('column', from, to).ok).toBe(true); expect(table().content.toJSON()).toEqual(rows); expect(TableMap.get(table()).problems).toBeNull();
  engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});
it('moves a row containing colspan cells without flattening them', () => {
  editor.commands.setContent('<table><tr><td colspan="2">合并</td></tr><tr><td>A</td><td>B</td></tr></table>');
  const row = table().child(0).toJSON(); expect(move('row', 0, 1).ok).toBe(true); expect(table().child(1).toJSON()).toEqual(row); expect(TableMap.get(table()).problems).toBeNull();
});
it('rejects a row move that tears a rowspan, but permits moving an ordinary row past the entire span', () => {
  editor.commands.setContent('<table><tr><td rowspan="2">合并</td><td>A</td></tr><tr><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>');
  const before = editor.getJSON(); expect(move('row', 0, 2).ok).toBe(false); expect(move('row', 2, 1).ok).toBe(false); expect(editor.getJSON()).toEqual(before);
  expect(move('row', 2, 0).ok).toBe(true); expect(TableMap.get(table()).problems).toBeNull(); expect(table().child(1).child(0).attrs.rowspan).toBe(2);
});
it('preserves rowspans during column movement', () => {
  editor.commands.setContent('<table><tr><td rowspan="2" colwidth="100">合并</td><td>A</td></tr><tr><td>B</td></tr></table>');
  expect(move('column', 0, 1).ok).toBe(true); expect(TableMap.get(table()).problems).toBeNull(); expect(table().child(0).child(1).attrs.rowspan).toBe(2);
});
it('rejects tearing a colspan but permits moving a column past it', () => {
  editor.commands.setContent('<table><tr><td colspan="2">合并</td><td>A</td></tr><tr><td>B</td><td>C</td><td>D</td></tr></table>');
  const before = editor.getJSON(); expect(move('column', 0, 2).ok).toBe(false); expect(move('column', 2, 1).ok).toBe(false); expect(editor.getJSON()).toEqual(before);
  expect(move('column', 2, 0).ok).toBe(true); expect(TableMap.get(table()).problems).toBeNull(); expect(table().child(0).child(1).attrs.colspan).toBe(2);
});
it('keeps explicit pinned rows separate and preserves pin count when reordering inside the region', () => {
  editor.commands.setContent('<table data-pinned-rows="2"><tr><td>A</td></tr><tr><td>B</td></tr><tr><td>C</td></tr></table>');
  const before = editor.getJSON(); expect(move('row', 0, 2).ok).toBe(false); expect(editor.getJSON()).toEqual(before);
  expect(move('row', 0, 1).ok).toBe(true); expect(table().attrs.pinnedRows).toBe(2);
});
it.each([[-1,1],[0,3],[1,1],[0,1.5]])('rejects invalid endpoints %i, %i', (from, to) => {
  expect(reorderedTable(table(), 'row', from, to)).toBeNull(); expect(reorderedTable(table(), 'column', from, to)).toBeNull();
});
