import { afterEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { createExtensions } from '../lib/editor/extensions';
import { DocumentEngine } from '../lib/usecases/engine';
import { referenceSyncKey } from '../lib/editor/blocks/reference-sync';

// vdoc#64: ReferenceSync skips its document walk for typing that provably
// cannot change the table of contents or the footnote numbers.

let editor: Editor, engine: DocumentEngine;
const open = async (content: string) => {
  editor = new Editor({ extensions: createExtensions(), content });
  await new Promise(resolve => setTimeout(resolve, 0));
  engine = new DocumentEngine(editor);
};
afterEach(() => { engine.destroy(); editor.destroy(); vi.restoreAllMocks(); });

const posOf = (text: string) => { let found = -1; editor.state.doc.descendants((node, pos) => { if (found < 0 && node.isText && node.text?.includes(text)) found = pos; }); return found; };
const find = (type: string) => { const found: Node[] = []; editor.state.doc.descendants(node => { if (node.type.name === type) found.push(node); }); return found; };
const tocTexts = () => find('tableOfContents')[0].attrs.items.map((item: { text: string }) => item.text);
const footnoteNumbers = () => find('footnote').map(node => [node.attrs.text, node.attrs.number]);
/** Runs the plugin's appendTransaction for `tr` and reports whether it walked the new document. */
const walks = (tr: Transaction) => {
  const plugin = referenceSyncKey.get(editor.state)!, next = editor.state.apply(tr);
  const walk = vi.spyOn(next.doc, 'descendants');
  plugin.spec.appendTransaction!.call(plugin, [tr], editor.state, next);
  return walk.mock.calls.length > 0;
};
const insertToc = () => {
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  expect(engine.execute({ operations: [{ type: 'block.toc' }] }).ok).toBe(true);
};

it('does not walk the document for typing in a paragraph, with or without a table of contents', async () => {
  await open('<h1>Heading</h1><p>Paragraph</p>');
  expect(walks(editor.state.tr.insertText('X', posOf('Paragraph') + 1))).toBe(false);
  expect(walks(editor.state.tr.insertText('X', posOf('Heading') + 1))).toBe(false);
  insertToc();
  expect(referenceSyncKey.getState(editor.state)).toEqual({ hasTableOfContents: true });
  expect(walks(editor.state.tr.insertText('X', posOf('Paragraph') + 1))).toBe(false);
});

it('updates the table of contents when a heading is typed in, through the user-typing step', async () => {
  await open('<h1>Heading</h1><p>Paragraph</p>');
  insertToc();
  expect(walks(editor.state.tr.insertText('X', posOf('Heading') + 1))).toBe(true);
  editor.commands.insertContentAt(posOf('Heading'), 'New ');
  expect(tocTexts()).toEqual(['New Heading']);
  editor.commands.insertContentAt(posOf('Paragraph'), 'Body ');
  expect(tocTexts()).toEqual(['New Heading']);
});

it('picks up a table of contents added later, and forgets one that is deleted', async () => {
  await open('<h1>Heading</h1><p>Paragraph</p>');
  editor.commands.insertContentAt(posOf('Heading'), 'A ');
  expect(referenceSyncKey.getState(editor.state)).toEqual({ hasTableOfContents: false });
  insertToc();
  editor.commands.insertContentAt(posOf('Heading'), 'B ');
  expect(tocTexts()).toEqual(['B A Heading']);
  let tocPos = -1; editor.state.doc.forEach((node, offset) => { if (node.type.name === 'tableOfContents') tocPos = offset; });
  editor.view.dispatch(editor.state.tr.delete(tocPos, tocPos + editor.state.doc.nodeAt(tocPos)!.nodeSize));
  expect(referenceSyncKey.getState(editor.state)).toEqual({ hasTableOfContents: false });
});

it('renumbers footnotes inserted or deleted by an inline replace', async () => {
  await open('<p>one two three</p>');
  const note = (text: string, number = 0) => editor.schema.nodes.footnote.create({ text, number });
  editor.view.dispatch(editor.state.tr.insert(posOf('three') + 5, note('later')));
  expect(footnoteNumbers()).toEqual([['later', 1]]);
  const insert = editor.state.tr.insert(posOf('one') + 3, note('earlier'));
  expect(walks(insert)).toBe(true);
  editor.view.dispatch(insert);
  expect(footnoteNumbers()).toEqual([['earlier', 1], ['later', 2]]);
  let first = -1; editor.state.doc.descendants((node, pos) => { if (first < 0 && node.type.name === 'footnote') first = pos; });
  const remove = editor.state.tr.delete(first, first + 1);
  expect(walks(remove)).toBe(true);
  editor.view.dispatch(remove);
  expect(footnoteNumbers()).toEqual([['later', 1]]);
});

it('still takes the full path for structural edits and normalizeIds', async () => {
  await open('<h1>Heading</h1><p>Paragraph</p>');
  expect(walks(editor.state.tr.split(posOf('Paragraph') + 3))).toBe(true);
  expect(walks(editor.state.tr.setMeta('normalizeIds', true))).toBe(true);
});
