import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import type { Step } from '@tiptap/pm/transform';
import { DecorationSet } from '@tiptap/pm/view';
import { createExtensions } from '../lib/editor/extensions';
import { UserTextReplace } from '../lib/editor/document/preserving-replace';
import { paragraphBorderGroupsKey } from '../lib/editor/paragraph/paragraph-border-groups';

// Joined paragraph borders keep their decorations through ordinary typing,
// including real user typing (UserTextReplace), and rebuild them otherwise.

const edge = { color: '#663399', width: 1, style: 'solid', padding: 4 };
const bordered = (text: string) => `<p data-paragraph-border-join="true" data-paragraph-borders='${JSON.stringify({ top: edge, bottom: edge, left: edge, right: edge })}'>${text}</p>`;

let editor: Editor;
beforeEach(async () => {
  const element = document.createElement('div'); document.body.appendChild(element);
  editor = new Editor({ element, extensions: createExtensions(), content: bordered('alpha') + bordered('bravo') + bordered('charlie') + '<p>plain</p>' });
  await new Promise(resolve => setTimeout(resolve, 0));
});
afterEach(() => { editor.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); });

const posOf = (text: string) => { let found = -1; editor.state.doc.descendants((node, pos) => { if (found < 0 && node.isText && node.text?.includes(text)) found = pos; }); return found; };
/** Start position of the top-level block containing `text`. */
const blockOf = (text: string) => editor.state.doc.resolve(posOf(text)).before(1);
/** Each rendered paragraph as "text:prev,next" with the group flags it carries. */
const groups = () => [...editor.view.dom.querySelectorAll('p')].map(p =>
  `${p.textContent}:${['prev', 'next'].filter(side => p.getAttribute(`data-vdoc-border-${side}`) === 'true').join(',')}`);
/** Calls of DecorationSet.create that built border-group decorations. Counted at
 *  call time: ProseMirror consumes (nulls out) the array it is given. */
const groupRebuilds = () => {
  let count = 0;
  const create = DecorationSet.create.bind(DecorationSet);
  vi.spyOn(DecorationSet, 'create').mockImplementation((doc, decorations) => {
    const attrs = (decoration: unknown) => (decoration as { type: { attrs: Record<string, string> } }).type.attrs;
    if (decorations.some(decoration => Object.keys(attrs(decoration) ?? {}).some(name => name.startsWith('data-vdoc-border-')))) count++;
    return create(doc, decorations);
  });
  return () => count;
};

describe('paragraph border groups', () => {
  it('marks the joined neighbours of each bordered paragraph', () => {
    expect(groups()).toEqual(['alpha:next', 'bravo:prev,next', 'charlie:prev', 'plain:']);
  });

  it('maps the decorations through real user typing instead of rebuilding them', () => {
    const steps: Step[] = [];
    editor.on('transaction', ({ transaction }) => steps.push(...transaction.steps));
    const rebuilds = groupRebuilds();
    editor.chain().setTextSelection(posOf('bravo') + 2).insertContent('X').run();
    editor.chain().setTextSelection(posOf('plain') + 1).insertContent('Y').run();
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every(step => step instanceof UserTextReplace)).toBe(true);
    expect(rebuilds()).toBe(0);
    expect(groups()).toEqual(['alpha:next', 'brXavo:prev,next', 'charlie:prev', 'pYlain:']);
  });

  it('regroups when a paragraph stops joining its neighbours', () => {
    const rebuilds = groupRebuilds();
    const at = blockOf('bravo');
    editor.view.dispatch(editor.state.tr.setNodeMarkup(at, undefined, { ...editor.state.doc.nodeAt(at)!.attrs, paragraphBorderJoin: false }));
    expect(groups()).toEqual(['alpha:', 'bravo:', 'charlie:', 'plain:']);
    const plain = blockOf('plain'), charlie = editor.state.doc.nodeAt(blockOf('charlie'))!;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(plain, undefined, { ...editor.state.doc.nodeAt(plain)!.attrs, paragraphBorders: charlie.attrs.paragraphBorders, paragraphBorderJoin: true }));
    expect(groups()).toEqual(['alpha:', 'bravo:', 'charlie:next', 'plain:prev']);
    expect(rebuilds()).toBeGreaterThan(0);
  });

  it('regroups when bordered paragraphs are split or joined', () => {
    editor.chain().setTextSelection(posOf('charlie') + 3).splitBlock().run();
    expect(groups()).toEqual(['alpha:next', 'bravo:prev,next', 'cha:prev,next', 'rlie:prev', 'plain:']);
    editor.chain().setTextSelection(blockOf('rlie') + 1).joinBackward().run();
    expect(groups()).toEqual(['alpha:next', 'bravo:prev,next', 'charlie:prev', 'plain:']);
    editor.chain().setTextSelection(blockOf('bravo') + 1).joinBackward().run();
    expect(groups()).toEqual(['alphabravo:next', 'charlie:prev', 'plain:']);
    editor.chain().setTextSelection(blockOf('plain') + 1).joinBackward().run();
    expect(groups()).toEqual(['alphabravo:next', 'charlieplain:prev']);
  });

  it('keeps the same decoration set for a selection-only transaction', () => {
    const before = paragraphBorderGroupsKey.getState(editor.state);
    editor.commands.setTextSelection(posOf('charlie') + 1);
    expect(paragraphBorderGroupsKey.getState(editor.state)).toBe(before);
  });
});
