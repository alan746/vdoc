import { afterEach, describe, expect, it, vi } from 'vitest';
import { Fragment, Schema, type Node } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// vdoc#85: patches/prosemirror-view+1.42.6.patch makes DecorationSet.map and
// forChild linear in the number of node decorations at one level, instead of
// O(decorations × children). These cases pin the unchanged results and fail
// if the patch is not applied.

const schema = new Schema({ nodes: {
  doc: { content: 'block+' }, text: { group: 'inline' },
  paragraph: { group: 'block', content: 'inline*' },
  quote: { group: 'block', content: 'block+' },
} });
const p = (text: string) => schema.node('paragraph', null, text ? [schema.text(text)] : []);
const quote = (...children: Node[]) => schema.node('quote', null, children);
const docOf = (...children: Node[]) => schema.node('doc', null, children);
/** Start positions of the top-level children. */
const starts = (doc: Node) => { const found: number[] = []; doc.forEach((_, offset) => found.push(offset)); return found; };
const nodeDecos = (doc: Node) => starts(doc).map(at => Decoration.node(at, at + doc.nodeAt(at)!.nodeSize, { 'data-n': String(at) }));
const label = (deco: Decoration) => { const { attrs } = (deco as unknown as { type: { attrs: Record<string, string> } }).type; return attrs['data-n'] ?? attrs.class; };
/** Every decoration in the set as [from, to, label], in document order. */
const ranges = (set: DecorationSet) => set.find().sort((a, b) => a.from - b.from || a.to - b.to).map(deco => [deco.from, deco.to, label(deco)]);
afterEach(() => { vi.restoreAllMocks(); });

describe('DecorationSet.map with node decorations', () => {
  it('maps node decorations through typing, block deletion and a block replacement', () => {
    const doc = docOf(p('one'), p('two'), p('three'), p('four'));
    const removed: unknown[] = [];
    const set = DecorationSet.create(doc, nodeDecos(doc));

    const typed = new Transform(doc).insert(6, schema.text('XY'));
    expect(ranges(set.map(typed.mapping, typed.doc))).toEqual([[0, 5, '0'], [5, 12, '5'], [12, 19, '10'], [19, 25, '17']]);

    const deleted = new Transform(doc).delete(5, 10);
    expect(ranges(set.map(deleted.mapping, deleted.doc, { onRemove: spec => removed.push(spec) }))).toEqual([[0, 5, '0'], [5, 12, '10'], [12, 18, '17']]);
    expect(removed).toHaveLength(1);

    // Replacing the second paragraph's boundaries with a quote: its decoration
    // no longer spans exactly one node and must be dropped.
    const wrapped = new Transform(doc).wrap(doc.resolve(6).blockRange()!, [{ type: schema.nodes.quote }]);
    expect(ranges(set.map(wrapped.mapping, wrapped.doc))).toEqual([[0, 5, '0'], [12, 19, '10'], [19, 25, '17']]);
  });

  it('keeps decorations inside nested blocks and inline decorations', () => {
    const doc = docOf(p('one'), quote(p('in'), p('side')), p('end'));
    const decos = [...nodeDecos(doc), Decoration.node(6, 10, { 'data-n': 'inner' }), Decoration.inline(2, 8, { class: 'hit' })];
    const set = DecorationSet.create(doc, decos);
    const typed = new Transform(doc).insert(2, schema.text('X'));
    expect(ranges(set.map(typed.mapping, typed.doc))).toEqual([[0, 6, '0'], [3, 9, 'hit'], [6, 18, '5'], [7, 11, 'inner'], [18, 23, '17']]);
  });

  it('checks node decorations against the children without a findIndex per decoration', () => {
    const doc = docOf(...Array.from({ length: 200 }, (_, i) => p(`paragraph ${i}`)));
    const set = DecorationSet.create(doc, nodeDecos(doc));
    const typed = new Transform(doc).insert(doc.content.size - 3, schema.text('X'));
    // findIndex is internal to prosemirror-model, so it is missing from the public types.
    const findIndex = vi.spyOn(Fragment.prototype as unknown as { findIndex: (pos: number) => unknown }, 'findIndex');
    const mapped = set.map(typed.mapping, typed.doc);
    expect(mapped.find()).toHaveLength(200);
    expect(findIndex.mock.calls.length).toBeLessThan(10);
  });
});

describe('DecorationSet.forChild with node decorations', () => {
  it('slices inline decorations into each child and leaves node decorations out', () => {
    const doc = docOf(p('one'), quote(p('in')), p('end'));
    const set = DecorationSet.create(doc, [...nodeDecos(doc), Decoration.node(6, 10, { 'data-n': 'inner' }), Decoration.inline(2, 7, { class: 'hit' })]);
    expect(ranges(set.forChild(0, doc.child(0)) as DecorationSet)).toEqual([[1, 3, 'hit']]);
    const inQuote = set.forChild(5, doc.child(1));
    const found: (string | undefined)[] = [];
    inQuote.forEachSet(member => found.push(...ranges(member).map(range => `${range[0]}-${range[1]}:${range[2]}`)));
    expect(found.sort()).toEqual(['0-1:hit', '0-4:inner']);
    expect(set.forChild(11, doc.child(2))).toBe(DecorationSet.empty);
  });

  it('does not walk node decorations when looking for a child', () => {
    const doc = docOf(...Array.from({ length: 50 }, (_, i) => p(`paragraph ${i}`)));
    const decos = nodeDecos(doc);
    const set = DecorationSet.create(doc, decos);
    set.forChild(0, doc.child(0));
    let reads = 0;
    for (const deco of decos) {
      let from = deco.from;
      Object.defineProperty(deco, 'from', { get: () => { reads++; return from; }, set: value => { from = value; } });
    }
    doc.forEach((child, offset) => set.forChild(offset, child));
    expect(reads).toBe(0);
  });
});
