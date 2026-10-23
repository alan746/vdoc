import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { changedBlockIds } from '../lib/editor/document/changed-blocks';
import { naiveChangedBlockIds } from './support/naive-changed-blocks';

// vdoc#40: one block index per document change, shared by every reader, and a
// changedBlockIds that skips subtrees ProseMirror shares between documents.

let editor: Editor, engine: DocumentEngine;
const open = async (content: string) => {
  editor = new Editor({ extensions: createExtensions(), content });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor);
};
afterEach(() => { engine.destroy(); editor.destroy(); });
const ids = () => engine.snapshot().blocks.map(block => block.id);
const at = (s = engine.snapshot()) => ({ expectedSessionId: s.sessionId, expectedRevision: s.revision });

describe('block index', () => {
  beforeEach(() => open('<h1>Title</h1><p>one</p><p>two</p><h2>Sub</h2><p>three</p>'));

  it('keeps every indexed position pointing at its own block through edits', () => {
    const check = () => editor.state.doc.descendants((node, pos) => {
      if (!node.attrs.blockId) return;
      expect(engine.locateBlock(node.attrs.blockId)).toEqual({ from: pos, to: pos + node.nodeSize });
    });
    check();
    editor.commands.insertContentAt(1, 'XYZ'); check();
    const [, one, two] = ids();
    expect(engine.execute({ operations: [{ type: 'block.move', id: two, beforeId: one }] }).ok).toBe(true); check();
    expect(engine.execute({ operations: [{ type: 'block.insert', beforeId: null, block: { kind: 'table', rows: 2, cols: 2, header: true } }] }).ok).toBe(true); check();
  });

  it('keeps a moved block’s version and bumps an edited one', () => {
    const [, one, two] = ids();
    const versions = () => Object.fromEntries(engine.snapshot().blocks.map(block => [block.id, block.version]));
    const before = versions();
    engine.execute({ operations: [{ type: 'block.move', id: two, beforeId: one }] });
    expect(versions()[two]).toBe(before[two]);
    const s = engine.snapshot();
    engine.execute({ ...at(s), target: { kind: 'block', id: one }, operations: [{ type: 'text.replace', text: 'edited' }] });
    expect(versions()[one]).toBeGreaterThan(before[one]);
  });

  it('serves the outline from the index, in document order', () => {
    expect(engine.outline().map(entry => entry.text)).toEqual(['Title', 'Sub']);
    const [title] = ids();
    engine.execute({ ...at(), target: { kind: 'block', id: title }, operations: [{ type: 'paragraph.style', level: 0 }] });
    expect(engine.outline().map(entry => entry.text)).toEqual(['Sub']);
  });

  it('reads blocks in document order, deduplicated, whatever the request order', () => {
    const [title, one, two] = ids();
    expect(engine.readBlocks([two, title, two, 'missing', one]).blocks.map(block => block.id)).toEqual([title, one, two]);
  });

  it('re-indexes instead of returning stale positions when the state is replaced without a transaction', () => {
    const replaced = editor.schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'b_new' }, content: [{ type: 'text', text: 'new' }] }] });
    editor.view.updateState(EditorState.create({ doc: replaced, plugins: editor.state.plugins }));
    expect(engine.hasBlock(ids()[0])).toBe(true);
    expect(engine.locateBlock('b_new')).toEqual({ from: 0, to: replaced.child(0).nodeSize });
    expect(engine.readBlocks(['b_new']).blocks[0].text).toBe('new');
  });
});

describe('changedBlockIds with structural sharing', () => {
  beforeEach(() => open('<p>alpha</p><p>beta</p><ul><li><p>item</p></li></ul><table><tr><td>a</td><td>b</td></tr></table><p>omega</p>'));
  // Every scenario must report exactly what the original full-document algorithm reports.
  const same = (action: () => unknown) => {
    const before = editor.state.doc; action(); const after = editor.state.doc;
    expect(after.eq(before)).toBe(false);
    expect(changedBlockIds(before, after)).toEqual(naiveChangedBlockIds(before, after));
  };
  const block = (text: string) => engine.snapshot().blocks.find(entry => entry.text === text)!.id;

  it.each<[string, () => unknown]>([
    ['typing inside a paragraph', () => editor.commands.insertContentAt(3, 'X')],
    ['splitting a paragraph', () => { editor.commands.setTextSelection(3); editor.commands.splitBlock(); }],
    ['deleting a block', () => engine.execute({ operations: [{ type: 'block.delete', id: block('beta') }] })],
    ['moving a block', () => engine.execute({ operations: [{ type: 'block.move', id: block('omega'), beforeId: block('alpha') }] })],
    ['wrapping a top-level paragraph into a blockquote', () => engine.execute({ ...at(), target: { kind: 'block', id: block('alpha') }, operations: [{ type: 'block.quote' }] })],
    ['turning a paragraph into a list item', () => engine.execute({ ...at(), target: { kind: 'block', id: block('beta') }, operations: [{ type: 'list.toggle', kind: 'bullet' }] })],
    ['changing a heading level', () => engine.execute({ ...at(), target: { kind: 'block', id: block('alpha') }, operations: [{ type: 'paragraph.style', level: 2 }] })],
    ['editing a table cell', () => { const t = engine.snapshot().tables[0]; return engine.execute({ ...at(), target: { kind: 'cell', tableId: t.id, cellId: t.cells[0].id }, operations: [{ type: 'text.insert', text: 'Z' }] }); }],
    ['adding a table row', () => { const t = engine.snapshot().tables[0]; return engine.execute({ ...at(), target: { kind: 'cells', tableId: t.id, row: 0, col: 0 }, operations: [{ type: 'table.edit', action: 'rowAfter' }] }); }],
    ['inserting a new table block', () => engine.execute({ operations: [{ type: 'block.insert', beforeId: block('beta'), block: { kind: 'table', rows: 2, cols: 2, header: true, headerText: ['x', 'y'] } }] })],
    ['replacing the whole document', () => editor.commands.setContent('<h1>new</h1><p>doc</p>')],
  ])('matches the original algorithm when %s', (_name, action) => same(action));
});

describe('scaling', () => {
  // Relative timings with generous margins: shared CI hosts are noisy, but the
  // gap between O(k) and O(document) on 4000 paragraphs is two orders of magnitude.
  const time = (run: () => void, repeat: number) => {
    let best = Infinity;
    for (let attempt = 0; attempt < 3; attempt++) { const start = performance.now(); for (let i = 0; i < repeat; i++) run(); best = Math.min(best, performance.now() - start); }
    return best;
  };
  const paragraphs = (count: number) => Array.from({ length: count }, (_, i) => `<p>paragraph ${i}</p>`).join('');

  it('read_blocks and the outline do not scale with unrelated document size', async () => {
    await open(paragraphs(40));
    const smallId = ids()[5];
    const smallRead = time(() => { engine.readBlocks([smallId]); engine.outline(); }, 300);
    engine.destroy(); editor.destroy();
    await open(paragraphs(4000));
    const bigId = ids()[5];
    const bigRead = time(() => { engine.readBlocks([bigId]); engine.outline(); }, 300);
    expect(bigRead).toBeLessThan(smallRead * 10 + 5);
  });

  it('changedBlockIds for a one-character edit is far cheaper than the full-document algorithm', async () => {
    await open(paragraphs(4000));
    const before = editor.state.doc;
    editor.commands.insertContentAt(before.content.size - 3, 'X');
    const after = editor.state.doc;
    expect(changedBlockIds(before, after)).toEqual(naiveChangedBlockIds(before, after));
    const optimised = time(() => changedBlockIds(before, after), 20);
    const naive = time(() => naiveChangedBlockIds(before, after), 20);
    expect(optimised).toBeLessThan(naive / 5);
  });
});
