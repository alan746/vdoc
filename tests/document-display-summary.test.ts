import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { createExtensions } from '../lib/editor/extensions';
import { BlockIndex } from '../lib/editor/document/block-index';
import { documentDisplaySummary } from '../lib/editor/document/display-summary';

let editor: Editor;
const text = (value: string) => ({ type: 'text', text: value });
const note = (value: string) => ({ type: 'footnote', attrs: { text: value, number: 1 } });
beforeEach(async () => {
  editor = new Editor({ extensions: createExtensions(), content: { type: 'doc', content: [
    { type: 'paragraph', content: [text('Before')] },
    { type: 'heading', attrs: { level: 2 }, content: [text('Title'), note('Heading note')] },
    { type: 'blockquote', content: [
      { type: 'heading', attrs: { level: 3 }, content: [text('Nested')] },
      { type: 'paragraph', content: [text('Quote'), note('Quote note')] },
    ] },
    { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [
      { type: 'heading', attrs: { level: 3 }, content: [text('Cell title')] },
      { type: 'paragraph', content: [text('Cell'), note('Cell note')] },
    ] }] }] },
  ] } });
  await new Promise(resolve => setTimeout(resolve, 0));
});
afterEach(() => { editor.destroy(); vi.restoreAllMocks(); });

/** Independent oracle: the existing command index and original full note walk. */
function expected(doc: Node) {
  const index = new BlockIndex(); index.update(doc);
  const headings = index.headings().map(({ node, pos }) => ({ id: node.attrs.blockId, level: node.attrs.level, text: node.textContent, from: pos }));
  const notes: { number: number; text: string }[] = [];
  doc.descendants(node => { if (node.type.name === 'footnote') notes.push({ number: node.attrs.number, text: node.attrs.text }); });
  return { headings, notes };
}
function check() { expect(documentDisplaySummary(editor.state.doc)).toEqual(expected(editor.state.doc)); }

it('matches live positions, labels and footnotes in headings, quotes and table cells', () => {
  check();
  expect(documentDisplaySummary(editor.state.doc).notes.map(note => note.text)).toEqual(['Heading note', 'Quote note', 'Cell note']);
});

it('relocates cached headings after preceding edits and moves, including undo and redo', () => {
  const before = editor.getJSON(); check();
  editor.commands.insertContentAt(1, 'A longer prefix'); check();
  const afterTyping = editor.getJSON();
  const node = editor.state.doc.child(2);
  const at = editor.state.doc.child(0).nodeSize + editor.state.doc.child(1).nodeSize;
  const tr = closeHistory(editor.state.tr).delete(at, at + node.nodeSize);
  editor.view.dispatch(tr.insert(tr.doc.content.size, node)); check();
  expect(documentDisplaySummary(editor.state.doc).headings.map(heading => heading.text)).toEqual(['Title', 'Cell title', 'Nested']);
  editor.commands.undo(); check(); expect(editor.getJSON()).toEqual(afterTyping);
  editor.commands.undo(); check(); expect(editor.getJSON()).toEqual(before);
  editor.commands.redo(); check(); editor.commands.redo(); check();
});

it('updates heading text and level and removes headings converted into paragraphs', () => {
  check();
  const pos = editor.state.doc.firstChild!.nodeSize;
  editor.view.dispatch(editor.state.tr.insertText('Updated ', pos + 1)); check();
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...editor.state.doc.child(1).attrs, level: 1 })); check();
  expect(documentDisplaySummary(editor.state.doc).headings[0]).toMatchObject({ level: 1, text: 'Updated Title' });
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, editor.schema.nodes.paragraph, editor.state.doc.child(1).attrs)); check();
  expect(documentDisplaySummary(editor.state.doc).headings.map(heading => heading.text)).toEqual(['Nested', 'Cell title']);
});

it('refreshes note edits, removal and renumbering without mutating older cached summaries', () => {
  const original = documentDisplaySummary(editor.state.doc), saved = structuredClone(original);
  let pos = 0;
  editor.state.doc.descendants((node, offset) => { if (node.type.name === 'footnote' && node.attrs.text === 'Heading note') pos = offset; });
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...editor.state.doc.nodeAt(pos)!.attrs, text: 'Edited note' })); check();
  expect(documentDisplaySummary(editor.state.doc).notes[0].text).toBe('Edited note');
  editor.view.dispatch(editor.state.tr.delete(pos, pos + 1)); check();
  expect(documentDisplaySummary(editor.state.doc).notes).toEqual([{ number: 1, text: 'Quote note' }, { number: 2, text: 'Cell note' }]);
  expect(original).toEqual(saved);
});

it('does not revisit unchanged subtrees after editing unrelated body text', () => {
  const before = editor.state.doc;
  expect(documentDisplaySummary(before)).toBe(documentDisplaySummary(before));
  const unchanged = Array.from({ length: before.childCount - 1 }, (_, index) => vi.spyOn(before.child(index + 1), 'forEach'));
  const next = editor.state.tr.insertText('字', 1).doc;
  const changed = vi.spyOn(next.child(0), 'forEach');
  const summary = documentDisplaySummary(next);
  expect(changed).toHaveBeenCalledOnce();
  expect(unchanged.reduce((count, spy) => count + spy.mock.calls.length, 0)).toBe(0);
  expect(summary.notes).toEqual(documentDisplaySummary(before).notes);
  expect(summary.headings[0].from).toBe(documentDisplaySummary(before).headings[0].from + 1);
  expect(summary).toEqual(expected(next));
});

it('keeps unidentified top-level containers out of the addressable outline', () => {
  const doc = editor.schema.nodeFromJSON({ type: 'doc', content: [{ type: 'blockquote', content: [
    { type: 'heading', attrs: { blockId: 'nested', level: 2 }, content: [text('No root ID'), note('Still a note')] },
  ] }] });
  expect(documentDisplaySummary(doc)).toEqual(expected(doc));
  expect(documentDisplaySummary(doc).headings).toEqual([]);
  expect(documentDisplaySummary(doc).notes).toHaveLength(1);
});
