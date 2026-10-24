import { afterEach, beforeEach, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
let editor: Editor, engine: DocumentEngine;
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: '<p>Existing content</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor);
});
afterEach(() => { engine.destroy(); editor.destroy(); });
const request = () => ({ callId: 'article-1', expectedSessionId: engine.sessionId, expectedRevision: engine.revision,
  destination: { kind: 'document_end' }, title: 'Ancient Greece', blocks: [
    { kind: 'paragraph', text: 'Introduction' }, { kind: 'heading', level: 2, text: 'Origins' },
    { kind: 'paragraph', text: 'Origins body' }, { kind: 'heading', level: 3, text: 'Crete' }, { kind: 'paragraph', text: 'Crete body' },
  ] });
it('inserts real headings, preserves content, reports IDs, deduplicates and undoes atomically', () => {
  const before = editor.getJSON(), input = request();
  const result = engine.insertStructuredArticle(input);
  expect(result).toMatchObject({ ok: true, headingCounts: { 1: 1, 2: 1, 3: 1 }, paragraphCount: 3 });
  expect(editor.state.doc.firstChild?.textContent).toBe('Existing content');
  const headings: number[] = [], ids: string[] = [];
  editor.state.doc.forEach(node => { ids.push(node.attrs.blockId); if (node.type.name === 'heading') headings.push(node.attrs.level); });
  expect(headings).toEqual([1, 2, 3]);
  expect(result.insertedBlockIds).toEqual(ids.slice(1));
  expect(engine.insertStructuredArticle(input)).toEqual(result);
  expect(engine.insertStructuredArticle({ ...input, title: 'Changed' }).code).toBe('DUPLICATE');
  expect(engine.history('undo', 'api').ok).toBe(true);
  expect(editor.getJSON()).toEqual(before);
});
it.each([
  { blocks: [{ kind: 'paragraph', text: 'x', attrs: {} }] },
  { blocks: Array(81).fill({ kind: 'paragraph', text: 'x' }) },
  { blocks: Array(5).fill({ kind: 'paragraph', text: 'x'.repeat(3000) }) },
])('rejects invalid or incomplete articles without mutation', patch => {
  const before = editor.getJSON(), revision = engine.revision;
  expect(engine.insertStructuredArticle({ ...request(), ...patch }).code).toBe('INVALID');
  expect(editor.getJSON()).toEqual(before); expect(engine.revision).toBe(revision);
});
it('rejects stale, cancelled and missing destination requests without writing', () => {
  const input = request(); editor.commands.insertContent('User edit');
  const before = editor.getJSON();
  expect(engine.insertStructuredArticle(input).code).toBe('STALE');
  expect(engine.insertStructuredArticle(request(), { signal: AbortSignal.abort() }).code).toBe('CANCELLED');
  expect(engine.insertStructuredArticle({ ...request(), destination: { kind: 'after_block', blockId: 'gone' } }).code).toBe('TARGET');
  expect(editor.getJSON()).toEqual(before);
});
it('uses a stable boundary regardless of cursor and supports selective agent undo', () => {
  const input = { ...request(), destination: { kind: 'before_block', blockId: engine.snapshot().blocks[0].id } };
  expect(engine.insertStructuredArticle(input, { origin: { actor: 'boson', turnId: 'article-turn' } }).ok).toBe(true);
  expect(editor.state.doc.firstChild?.type.name).toBe('heading');
  expect(editor.state.doc.lastChild?.textContent).toBe('Existing content');
  expect(engine.undoTurn('article-turn', { actor: 'boson', turnId: 'undo-turn' }).ok).toBe(true);
  expect(editor.state.doc.textContent).toBe('Existing content');
});

it('accepts an article starting with H2, reports the real outline, and undoes the whole article', () => {
  const before = editor.getJSON();
  const input = request(); input.blocks.shift();
  expect(engine.insertStructuredArticle(input)).toMatchObject({ ok: true, headingCounts: { 1: 1, 2: 1, 3: 1 }, paragraphCount: 2 });
  expect(engine.outline().map(heading => [heading.level, heading.text])).toEqual([[1, 'Ancient Greece'], [2, 'Origins'], [3, 'Crete']]);
  expect(engine.history('undo', 'api').ok).toBe(true);
  expect(editor.getJSON()).toEqual(before);
});
it.each([
  { blocks: [{ kind: 'heading', level: 2, text: 'Part two' }, { kind: 'heading', level: 3, text: '2.1' }, { kind: 'paragraph', text: 'Body' }] },
  { blocks: [{ kind: 'heading', level: 2, text: 'One' }, { kind: 'heading', level: 2, text: 'Two' }] },
  { blocks: [{ kind: 'heading', level: 3, text: 'Skipped' }, { kind: 'paragraph', text: 'Body' }] },
  { blocks: [{ kind: 'paragraph', text: 'Intro' }, { kind: 'heading', level: 2, text: 'Ends on a heading' }] },
])('accepts any heading structure the model chooses', patch => {
  expect(engine.insertStructuredArticle({ ...request(), ...patch })).toMatchObject({ ok: true });
});
