import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { TableMap } from '@tiptap/pm/tables';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { parseDocument } from '../lib/infrastructure/persistence/document-codec';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
let store: typeof import('../lib/infrastructure/persistence/document-store');
let editor: Editor, engine: DocumentEngine;
beforeEach(async () => {
  localStorage.clear(); globalThis.indexedDB = new IDBFactory(); vi.resetModules();
  store = await import('../lib/infrastructure/persistence/document-store');
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
    const saved = { version: 1, title: 'Table', content: editor.getJSON(), savedAt: '2026-10-17T00:00:00.000Z' };
    expect(parseDocument(JSON.stringify(saved)).content).toEqual(editor.getJSON());
  });
  it('restores structured HTML pasted into the editor including table spans and rich text', () => {
    editor.commands.insertContent('<table><tbody><tr><td colspan="2"><p><strong>Copied</strong></p></td></tr><tr><td><p>A</p></td><td><p>B</p></td></tr></tbody></table>');
    expect(TableMap.get(tableNode()).width).toBe(2);
    expect(editor.getHTML()).toContain('<strong>Copied</strong>');
    expect(TableMap.get(tableNode()).problems).toBeNull();
  });
  it('preserves previous documents when creating, importing and reopening local documents', async () => {
    const first = await store.activateDocument({ version: 1, id: 'original', title: 'Original', content: editor.getJSON(), savedAt: '2026-10-17T00:00:00.000Z' }); await store.archiveDocument(first);
    const second = await store.activateDocument({ ...first, id: crypto.randomUUID(), title: 'Imported copy' });
    expect(await store.listDocuments()).toHaveLength(2);
    expect((await store.readSavedDocument()).data!.title).toBe('Imported copy');
    await store.activateDocument(await store.openArchivedDocument(first.id!));
    expect((await store.readSavedDocument()).data!.content).toEqual(first.content);
    expect((await store.openArchivedDocument(second.id!)).title).toBe('Imported copy');
  });
  it('rejects damaged and unsafe backups before changing storage', async () => {
    const before = await store.activateDocument({ version: 1, id: 'original', title: 'Original', content: editor.getJSON(), savedAt: '2026-10-17T00:00:00.000Z' });
    for (const raw of ['{}', '{bad', JSON.stringify({ ...before, content: { type: 'doc', content: [{ type: 'unknown' }] } }), JSON.stringify({ ...before, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] } })]) expect(() => parseDocument(raw)).toThrow();
    expect((await store.readSavedDocument()).data!.content).toEqual(before.content);
  });
  it('leaves the current document intact if storage is full', async () => {
    const before = await store.activateDocument({ version: 1, id: 'original', title: 'Original', content: editor.getJSON(), savedAt: '2026-10-17T00:00:00.000Z' });
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    await expect(store.activateDocument({ ...before, id: crypto.randomUUID(), title: 'New' })).rejects.toThrow();
    vi.restoreAllMocks();
    expect((await store.readSavedDocument()).data!.title).toBe('Original');
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
