import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';

let editor: Editor, engine: DocumentEngine;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<p>甲乙👨‍👩‍👧‍👦é丙</p><p>Elsewhere</p><table><tr><td>A</td><td>B</td></tr></table>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); });
const request = (index = 0) => {
  const s = engine.snapshot(), b = s.blocks[index];
  return { expectedSessionId: s.sessionId, expectedBlocks: [{ id: b.id, version: b.version }], target: { kind: 'block', id: b.id }, operations: [{ type: 'text.style', style: { bold: true } }] };
};

it('keeps versions stable on selection changes and edits to another block', () => {
  const input = request(), before = engine.snapshot();
  editor.commands.setTextSelection(before.blocks[1].from);
  editor.commands.insertContent('New ');
  const after = engine.snapshot();
  expect(after.blocks[0].version).toBe(before.blocks[0].version);
  expect(after.blocks[1].version).not.toBe(before.blocks[1].version);
  expect(engine.executeExternal(input).ok).toBe(true);
});

it.each(['text', 'marks', 'attributes'] as const)('rejects a stale block after %s changes', kind => {
  const input = request(), block = engine.snapshot().blocks[0];
  editor.commands.setTextSelection({ from: block.from, to: block.from + 1 });
  if (kind === 'text') editor.commands.insertContent('新');
  else if (kind === 'marks') editor.commands.toggleItalic();
  else editor.commands.setTextAlign('center');
  const before = editor.getJSON();
  expect(engine.executeExternal(input).code).toBe('STALE');
  expect(editor.getJSON()).toEqual(before);
});

it('accepts a content precondition after an edit and exact revert with no intervening read', () => {
  const input = request();
  editor.commands.insertContent('x'); editor.commands.undo();
  expect(engine.executeExternal(input).ok).toBe(true);
});

it('does not recycle a version after the changed content has been observed', () => {
  const input = request();
  editor.commands.insertContent('x');
  expect(engine.snapshot().blocks[0].version).not.toBe(input.expectedBlocks[0].version);
  editor.commands.undo();
  expect(engine.executeExternal(input).code).toBe('STALE');
});

it('still rejects a strict revision after an unread edit and exact revert', () => {
  const input = { ...request(), expectedRevision: engine.revision };
  editor.commands.insertContent('x'); editor.commands.undo();
  expect(engine.executeExternal(input).code).toBe('STALE');
});

it('requires coverage and validates all supplied preconditions, including strict revision', () => {
  const input = request(), other = request(1).expectedBlocks;
  const { expectedBlocks: _, ...bare } = input;
  expect(engine.executeExternal(bare).code).toBe('STALE');
  expect(engine.executeExternal({ ...input, expectedBlocks: other }).code).toBe('STALE');
  expect(engine.executeExternal({ ...input, expectedBlocks: [...input.expectedBlocks, { id: 'missing', version: 1 }] }).code).toBe('STALE');
  const revision = engine.revision;
  editor.commands.setTextSelection(engine.snapshot().blocks[1].from); editor.commands.insertContent('x');
  expect(engine.executeExternal({ ...input, expectedRevision: revision }).code).toBe('STALE');
});

it('requires a table version for cell and rectangle targets', () => {
  const s = engine.snapshot(), table = s.tables[0], block = s.blocks.find(b => b.id === table.id)!;
  for (const target of [{ kind: 'cell', tableId: table.id, cellId: table.cells[0].id }, { kind: 'cells', tableId: table.id, row: 0, col: 0 }]) {
    const input = { expectedSessionId: s.sessionId, target, operations: [{ type: 'table.background', color: '#FFF0AD' }] };
    expect(engine.executeExternal({ ...input, expectedBlocks: request().expectedBlocks }).code).toBe('STALE');
    expect(engine.executeExternal({ ...input, expectedBlocks: [{ id: table.id, version: block.version }] }).ok).toBe(target.kind === 'cell');
  }
});

it('keeps absolute ranges and global operations in strict revision mode', () => {
  const input = request(), b = engine.snapshot().blocks[0];
  expect(engine.executeExternal({ ...input, target: { kind: 'range', from: b.from, to: b.from + 1 } }).code).toBe('STALE');
  expect(engine.executeExternal({ ...input, operations: [{ type: 'text.findReplace', query: 'A', replacement: 'C' }] }).code).toBe('STALE');
});

it('resolves UTF-16 block text targets after preceding content shifts', () => {
  const s = engine.snapshot(), b = s.blocks[1], input = request(1);
  editor.commands.setTextSelection(s.blocks[0].from); editor.commands.insertContent('前缀');
  expect(engine.executeAgent({ ...input, target: { kind: 'text', blockId: b.id, start: 0, end: 4 }, operations: [{ type: 'text.replace', text: 'Here' }] }, { actor: 'a', turnId: 't' }).ok).toBe(true);
  expect(engine.snapshot().blocks[1].text).toBe('Herewhere');
});

it.each([[3, 4], [13, 14], [0, 999], [2, 1]])('rejects broken graphemes or invalid text offsets %s..%s', (start, end) => {
  const input = request(), before = editor.getJSON();
  expect(engine.executeExternal({ ...input, target: { kind: 'text', blockId: input.target.id, start, end } }).code).toBe('TARGET');
  expect(editor.getJSON()).toEqual(before);
});

it('accepts whole CJK, emoji and combining graphemes', () => {
  const input = request();
  expect(engine.executeExternal({ ...input, target: { kind: 'text', blockId: input.target.id, start: 1, end: 15 } }).ok).toBe(true);
  expect(editor.getHTML()).toContain('<strong>乙👨‍👩‍👧‍👦é</strong>');
});

it('preserves adjacent footnotes and refuses to swallow an intervening inline atom', () => {
  editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ab' }, { type: 'footnote', attrs: { text: 'note' } }, { type: 'text', text: 'cd' }] }] });
  let input = request();
  expect(engine.executeExternal({ ...input, target: { kind: 'text', blockId: input.target.id, start: 0, end: 4 } }).code).toBe('TARGET');
  expect(engine.executeExternal({ ...input, target: { kind: 'text', blockId: input.target.id, start: 2, end: 4 }, operations: [{ type: 'text.replace', text: 'XY' }] }).ok).toBe(true);
  input = request();
  expect(engine.executeExternal({ ...input, target: { kind: 'text', blockId: input.target.id, start: 0, end: 2 }, operations: [{ type: 'text.replace', text: 'Z' }] }).ok).toBe(true);
  expect(editor.state.doc.firstChild?.childCount).toBe(3);
  expect(editor.state.doc.firstChild?.child(1).type.name).toBe('footnote');
  expect(engine.snapshot().blocks[0].text).toBe('ZXY');
});

it('deduplicates successful retries before checking the now-old block version', () => {
  const input = { ...request(), id: 'retry-block' }, first = engine.executeExternal(input);
  expect(first.ok).toBe(true);
  expect(engine.executeExternal(input)).toEqual(first);
});
