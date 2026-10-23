import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';

// vdoc#35 task 2: insert a whole heading/paragraph/table block next to an
// existing one, and delete a specified block, without going through target
// resolution (block.move already bypasses it the same way).

let editor: Editor, engine: DocumentEngine;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<h1>Project plan</h1><p>first</p><p>second</p>' });
  await new Promise(resolve => setTimeout(resolve, 0)); engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); vi.restoreAllMocks(); });
const ids = () => engine.snapshot().blocks.map(b => b.id);

it('inserts a paragraph immediately before a given block', () => {
  const [heading] = ids();
  expect(engine.execute({ operations: [{ type: 'block.insert', beforeId: heading, block: { kind: 'paragraph', text: 'inserted' } }] }).ok).toBe(true);
  expect(engine.snapshot().blocks.map(b => b.text)).toEqual(['inserted', 'Project plan', 'first', 'second']);
});

it('inserts a heading at the end of the document when beforeId is null', () => {
  expect(engine.execute({ operations: [{ type: 'block.insert', beforeId: null, block: { kind: 'heading', level: 2, text: 'Appendix' } }] }).ok).toBe(true);
  // TrailingNode (existing behaviour) keeps an empty paragraph after the last
  // non-paragraph block, so the heading lands second-to-last, not last.
  const blocks = engine.snapshot().blocks;
  expect(blocks[blocks.length - 2]).toMatchObject({ type: 'heading', text: 'Appendix' });
});

it('vdoc#35 example: inserts a two-column budget table with headers and data in one call', () => {
  const result = engine.execute({ operations: [{
    type: 'block.insert', beforeId: engine.snapshot().blocks[1].id, block: {
      kind: 'table', rows: 3, cols: 2, header: true,
      headerText: ['项目', '费用'], rowsText: [['场地', '2000'], ['物料', '500']],
    },
  }] });
  expect(result.ok).toBe(true);
  const table = engine.snapshot().tables[0];
  expect(table.rows).toBe(3); expect(table.columns).toBe(2);
  const textAt = (row: number, col: number) => table.cells.find(c => c.row === row && c.column === col)!.text;
  expect([textAt(0, 0), textAt(0, 1)]).toEqual(['项目', '费用']);
  expect([textAt(1, 0), textAt(1, 1)]).toEqual(['场地', '2000']);
  expect([textAt(2, 0), textAt(2, 1)]).toEqual(['物料', '500']);
});

it('fills missing header/row text with empty cells', () => {
  expect(engine.execute({ operations: [{ type: 'block.insert', beforeId: null, block: { kind: 'table', rows: 2, cols: 2, header: true } }] }).ok).toBe(true);
  expect(engine.snapshot().tables[0].cells.every(c => c.text === '')).toBe(true);
});

it('rejects headerText without a matching column count or without a header row', () => {
  expect(engine.execute({ operations: [{ type: 'block.insert', beforeId: null, block: { kind: 'table', rows: 2, cols: 2, header: true, headerText: ['only one'] } }] })).toMatchObject({ code: 'INVALID' });
  expect(engine.execute({ operations: [{ type: 'block.insert', beforeId: null, block: { kind: 'table', rows: 2, cols: 2, header: false, headerText: ['a', 'b'] } }] })).toMatchObject({ code: 'INVALID' });
});

it('rejects rowsText with the wrong column count or too many rows', () => {
  expect(engine.execute({ operations: [{ type: 'block.insert', beforeId: null, block: { kind: 'table', rows: 2, cols: 2, header: true, rowsText: [['one']] } }] })).toMatchObject({ code: 'INVALID' });
  expect(engine.execute({ operations: [{ type: 'block.insert', beforeId: null, block: { kind: 'table', rows: 2, cols: 1, header: true, rowsText: [['a'], ['b']] } }] })).toMatchObject({ code: 'INVALID' });
});

it('deletes a specified top-level block, keeping others intact', () => {
  const [heading, first, second] = ids();
  expect(engine.execute({ operations: [{ type: 'block.delete', id: first }] }).ok).toBe(true);
  expect(ids()).toEqual([heading, second]);
});

it('reports unavailable for an unknown beforeId or delete target, and does not change the document', () => {
  const before = editor.getJSON();
  expect(engine.execute({ operations: [{ type: 'block.insert', beforeId: 'missing', block: { kind: 'paragraph', text: 'x' } }] })).toMatchObject({ code: 'UNAVAILABLE' });
  expect(engine.execute({ operations: [{ type: 'block.delete', id: 'missing' }] })).toMatchObject({ code: 'UNAVAILABLE' });
  expect(editor.getJSON()).toEqual(before);
});

it('requires a document revision when relying on block-version preconditions instead of a global revision', () => {
  const target = engine.snapshot().blocks[1];
  const result = engine.execute({ target: { kind: 'block', id: target.id }, expectedBlocks: [{ id: target.id, version: target.version }], operations: [{ type: 'block.insert', beforeId: null, block: { kind: 'paragraph', text: 'x' } }] });
  expect(result).toMatchObject({ code: 'STALE' });
});

it('undoes an insert and a delete in one step each', () => {
  const before = editor.getJSON();
  engine.execute({ operations: [{ type: 'block.insert', beforeId: null, block: { kind: 'paragraph', text: 'temp' } }] });
  engine.history('undo'); expect(editor.getJSON()).toEqual(before);
  const [, first] = ids();
  engine.execute({ operations: [{ type: 'block.delete', id: first }] });
  engine.history('undo'); expect(editor.getJSON()).toEqual(before);
});
