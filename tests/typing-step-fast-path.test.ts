import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { DecorationSet } from '@tiptap/pm/view';
import { createExtensions } from '../lib/editor/extensions';
import { everyStep, isTypingStep } from '../lib/editor/transaction-steps';
import { tableHeadersKey } from '../lib/editor/table/table-headers';

// vdoc#63: one shared "ordinary typing" predicate, and a table pinned-rows
// plugin that does no table work for it.

let editor: Editor;
beforeEach(async () => {
  const element = document.createElement('div'); document.body.appendChild(element);
  editor = new Editor({ element, extensions: createExtensions(), content: '<p>before</p><table><tr><th>head</th><th>h2</th></tr><tr><td>body</td><td>b2</td></tr></table><p>after</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
});
afterEach(() => { editor.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); });

const posOf = (text: string) => { let found = -1; editor.state.doc.descendants((node, pos) => { if (found < 0 && node.isText && node.text === text) found = pos; }); return found; };
const table = () => { let found: Node | undefined; editor.state.doc.descendants(node => { if (node.type.name === 'table') found ??= node; }); return found!; };
const pinnedRows = () => [...editor.view.dom.querySelectorAll('tr.vdoc-pinned-row')].map(row => row.textContent);
/** Calls of DecorationSet.create that built pinned-row decorations. Counted at
 *  call time: ProseMirror consumes (nulls out) the array it is given. */
const pinnedRebuilds = () => {
  let count = 0;
  const create = DecorationSet.create.bind(DecorationSet);
  vi.spyOn(DecorationSet, 'create').mockImplementation((doc, decorations) => {
    if (decorations.some(decoration => (decoration as unknown as { type: { attrs: { class?: string } } }).type.attrs.class === 'vdoc-pinned-row')) count++;
    return create(doc, decorations);
  });
  return () => count;
};

describe('isTypingStep / everyStep', () => {
  it('accepts inline typing and mark changes, and rejects structural steps', () => {
    const at = posOf('before');
    expect(everyStep([editor.state.tr.insertText('X', at + 1)], isTypingStep)).toBe(true);
    expect(everyStep([editor.state.tr.addMark(at, at + 3, editor.schema.marks.bold.create())], isTypingStep)).toBe(true);
    expect(everyStep([editor.state.tr.split(at + 2)], isTypingStep)).toBe(false);
    expect(everyStep([editor.state.tr.setNodeMarkup(0, undefined, { ...editor.state.doc.child(0).attrs, blockId: 'other' })], isTypingStep)).toBe(false);
  });
  it('rejects deleting whole blocks, although both ends share the table or list parent', () => {
    let tablePos = -1; editor.state.doc.forEach((node, offset) => { if (node.type.name === 'table') tablePos = offset; });
    const firstRow = table().child(0);
    expect(everyStep([editor.state.tr.delete(tablePos + 1, tablePos + 1 + firstRow.nodeSize)], isTypingStep)).toBe(false);
  });
  it('checks every step of every transaction against the document before that step', () => {
    const at = posOf('before');
    const typing = editor.state.tr.insertText('X', at + 1).insertText('Y', at + 2);
    const mixed = editor.state.tr.insertText('X', at + 1).split(at + 3);
    expect(everyStep([typing, typing], isTypingStep)).toBe(true);
    expect(everyStep([typing, mixed], isTypingStep)).toBe(false);
    expect(everyStep([], isTypingStep)).toBe(true);
  });
});

describe('table pinned rows', () => {
  it('does not walk the document when typing inside a cell or outside any table', () => {
    const plugin = tableHeadersKey.get(editor.state)!;
    for (const text of ['head', 'before']) {
      const tr = editor.state.tr.insertText('X', posOf(text) + 1);
      const next = editor.state.apply(tr);
      const walkBefore = vi.spyOn(editor.state.doc, 'descendants'), walkAfter = vi.spyOn(next.doc, 'descendants');
      expect(plugin.spec.appendTransaction!.call(plugin, [tr], editor.state, next)).toBeNull();
      expect(walkBefore).not.toHaveBeenCalled(); expect(walkAfter).not.toHaveBeenCalled();
    }
  });

  it('keeps the pinned rows through typing without rebuilding their decorations', () => {
    expect(pinnedRows()).toEqual(['headh2']);
    const rebuilds = pinnedRebuilds();
    editor.commands.insertContentAt(posOf('head') + 1, 'X');
    editor.commands.insertContentAt(posOf('before') + 1, 'Y');
    expect(rebuilds()).toBe(0);
    expect(pinnedRows()).toEqual(['hXeadh2']);
    expect(table().attrs.pinnedRows ?? 1).toBe(1);
  });

  it('keeps the same decoration set for a selection-only transaction', () => {
    const before = tableHeadersKey.getState(editor.state);
    editor.commands.setTextSelection(posOf('after') + 1);
    expect(tableHeadersKey.getState(editor.state)).toBe(before);
  });

  it('still extends the pin count when a row is inserted inside the pinned header', () => {
    const rebuilds = pinnedRebuilds();
    editor.chain().setTextSelection(posOf('head') + 1).addRowBefore().run();
    expect(table().attrs.pinnedRows).toBe(2);
    expect(pinnedRows()).toHaveLength(2);
    expect(rebuilds()).toBeGreaterThan(0);
  });

  it('rebuilds the decorations when the pin count changes explicitly', () => {
    const { tr } = editor.state;
    let tablePos = -1; editor.state.doc.forEach((node, offset) => { if (node.type.name === 'table') tablePos = offset; });
    editor.view.dispatch(tr.setNodeMarkup(tablePos, undefined, { ...table().attrs, pinnedRows: 0 }).setMeta('vdocPinnedRows', [table().attrs.blockId]));
    expect(pinnedRows()).toEqual([]);
  });
});

describe('list numbering', () => {
  it('renumbers a continued list when an item of the list before it is deleted', async () => {
    editor.destroy();
    editor = new Editor({ extensions: createExtensions(), content: '<ol><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ol><p>mid</p><ol data-continue-numbering="true"><li><p>d</p></li></ol>' });
    await new Promise(resolve => setTimeout(resolve, 0));
    const starts = () => { const found: number[] = []; editor.state.doc.forEach(node => { if (node.type.name === 'orderedList') found.push(node.attrs.start); }); return found; };
    expect(starts()).toEqual([1, 4]);
    const list = editor.state.doc.child(0), from = 1 + list.child(0).nodeSize;
    editor.view.dispatch(editor.state.tr.delete(from, from + list.child(1).nodeSize));
    expect(starts()).toEqual([1, 3]);
  });
});
