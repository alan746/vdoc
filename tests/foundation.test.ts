import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { TableMap } from '@tiptap/pm/tables';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/editor/engine';
import { activateDocument, archiveDocument, listDocuments, openArchivedDocument, parseDocument, readSavedDocument, saveDocument, STORAGE_KEY } from '../lib/editor/storage';
let editor: Editor, engine: DocumentEngine;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<p>First paragraph</p><p>Second paragraph</p><p>Third paragraph</p>' });
  await new Promise(r => setTimeout(r, 0)); engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); localStorage.clear(); vi.restoreAllMocks(); });
const range = (from: number, to: number) => ({ target: { kind: 'range', from, to }, expectedRevision: engine.revision });
function tableTarget(row = 0, col = 0, endRow = row, endCol = col) {
  const table = engine.snapshot().blocks.find(b => b.type === 'table')!;
  return { kind: 'cells', tableId: table.id, row, col, endRow, endCol };
}
function tableNode() { let result: typeof editor.state.doc | undefined; editor.state.doc.descendants(n => { if (n.type.name === 'table') result = n; }); return result!; }
describe('foundation acceptance', () => {
  it('deletes and replaces selected text with exact undo', () => {
    const before = editor.getJSON();
    expect(engine.execute({ ...range(1, 6), operations: [{ type: 'text.replace', text: 'Changed' }] }).ok).toBe(true);
    expect(editor.getText()).toContain('Changed paragraph');
    engine.history('undo'); expect(editor.getJSON()).toEqual(before);
    expect(engine.execute({ ...range(1, 6), operations: [{ type: 'text.delete' }] }).ok).toBe(true);
    expect(editor.state.doc.firstChild!.textContent).toBe(' paragraph');
    engine.history('undo'); expect(editor.getJSON()).toEqual(before);
  });
  it('moves top-level blocks in either direction without changing IDs or losing content', () => {
    const before = editor.getJSON(), ids = engine.snapshot().blocks.map(b => b.id);
    expect(engine.execute({ operations: [{ type: 'block.move', id: ids[2], beforeId: ids[0] }] }).ok).toBe(true);
    expect(engine.snapshot().blocks.map(b => b.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(engine.execute({ operations: [{ type: 'block.move', id: ids[2], beforeId: null }] }).ok).toBe(true);
    expect(editor.getJSON()).toEqual(before);
    engine.history('undo'); engine.history('undo'); expect(editor.getJSON()).toEqual(before);
  });
  it('edits a precise rectangular cell selection and preserves it through merge/split/undo', () => {
    engine.execute({ operations: [{ type: 'table.insert', rows: 3, cols: 3 }] });
    const before = editor.getJSON();
    const target = tableTarget(0, 0, 1, 1);
    expect(engine.execute({ target, operations: [{ type: 'table.background', color: '#FFF0AD' }] }).ok).toBe(true);
    let colored = 0; tableNode().descendants(n => { if (n.attrs.backgroundColor) colored++; }); expect(colored).toBe(4);
    expect(engine.execute({ target, operations: [{ type: 'table.edit', action: 'merge' }] }).ok).toBe(true);
    expect(tableNode().firstChild!.firstChild!.attrs).toMatchObject({ colspan: 2, rowspan: 2 });
    expect(engine.execute({ target: tableTarget(), operations: [{ type: 'table.edit', action: 'split' }] }).ok).toBe(true);
    expect(TableMap.get(tableNode()).problems).toBeNull();
    engine.history('undo'); engine.history('undo'); engine.history('undo'); expect(editor.getJSON()).toEqual(before);
  });
  it('rejects a table region outside the table without partial formatting', () => {
    engine.execute({ operations: [{ type: 'table.insert', rows: 2, cols: 2 }] });
    const before = editor.getJSON();
    expect(engine.execute({ target: tableTarget(0, 0, 8, 8), operations: [{ type: 'table.background', color: '#FFF0AD' }] }).ok).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });
  it.each(['deleteRow', 'deleteColumn', 'deleteTable'])('handles %s at the final row/column and undoes exactly', action => {
    engine.execute({ operations: [{ type: 'table.insert', rows: 1, cols: 1 }] });
    const before = editor.getJSON();
    expect(engine.execute({ target: tableTarget(), operations: [{ type: 'table.edit', action }] }).ok).toBe(true);
    expect(engine.snapshot().blocks.some(b => b.type === 'table')).toBe(false);
    engine.history('undo'); expect(editor.getJSON()).toEqual(before);
  });
  it('stores column widths and cell styles and restores them from backup', () => {
    engine.execute({ operations: [{ type: 'table.insert', rows: 2, cols: 3 }] });
    expect(engine.execute({ target: tableTarget(0, 0, 1, 2), operations: [
      { type: 'table.widths', widths: [100, 180, 220] },
      { type: 'table.style', borderColor: '#222F43', borderWidth: 2, padding: 8, verticalAlign: 'top' },
    ] }).ok).toBe(true);
    expect(tableNode().firstChild!.child(1).attrs).toMatchObject({ colwidth: [180], padding: 8, verticalAlign: 'top' });
    const saved = saveDocument('Table', editor.getJSON());
    expect(parseDocument(JSON.stringify(saved)).content).toEqual(editor.getJSON());
  });
  it('restores structured HTML pasted into the editor including table spans and rich text', () => {
    editor.commands.insertContent('<table><tbody><tr><td colspan="2"><p><strong>Copied</strong></p></td></tr><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table>');
    expect(TableMap.get(tableNode()).width).toBe(2);
    expect(editor.getHTML()).toContain('<strong>Copied</strong>');
    expect(TableMap.get(tableNode()).problems).toBeNull();
  });
  it('preserves previous documents when creating, importing and reopening local documents', () => {
    const first = saveDocument('Original', editor.getJSON()); archiveDocument(first);
    const second = activateDocument({ ...first, id: crypto.randomUUID(), title: 'Imported copy' });
    expect(listDocuments()).toHaveLength(2);
    expect(readSavedDocument().data!.title).toBe('Imported copy');
    activateDocument(openArchivedDocument(first.id!));
    expect(readSavedDocument().data!.content).toEqual(first.content);
    expect(openArchivedDocument(second.id!).title).toBe('Imported copy');
  });
  it('rejects damaged and unsafe backups before changing storage', () => {
    const before = saveDocument('Original', editor.getJSON());
    for (const raw of ['{}', '{bad', JSON.stringify({ ...before, content: { type: 'doc', content: [{ type: 'unknown' }] } }), JSON.stringify({ ...before, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] } })]) expect(() => parseDocument(raw)).toThrow();
    expect(readSavedDocument().data!.content).toEqual(before.content);
  });
  it('leaves the current document intact if storage is full', () => {
    const before = saveDocument('Original', editor.getJSON());
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    expect(() => activateDocument({ ...before, id: crypto.randomUUID(), title: 'New' })).toThrow();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).title).toBe('Original');
  });
});
it('subdivides an ordinary cell without losing neighboring cells and undoes the grid expansion', () => {
  editor.commands.setContent('<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>');
  const before=editor.getJSON();
  expect(engine.execute({target:tableTarget(0,0),operations:[{type:'table.split',rows:2,cols:3}]}).ok).toBe(true);
  const table=tableNode(), map=TableMap.get(table);
  expect(map.width).toBe(4);expect(map.height).toBe(3);expect(map.problems).toBeNull();
  expect(table.textContent).toBe('ABCD');
  expect(table.firstChild!.lastChild!.attrs.rowspan).toBe(2);
  expect(table.lastChild!.firstChild!.attrs.colspan).toBe(3);
  engine.history('undo');expect(editor.getJSON()).toEqual(before);
});
