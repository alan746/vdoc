import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Step } from '@tiptap/pm/transform';
import { everyStep, isTypingStep, replaceOf } from '../transaction-steps';

type ReferenceState = { hasTableOfContents: boolean };
export const referenceSyncKey = new PluginKey<ReferenceState>('vdocReferenceSync');

/** A table of contents is a block, so this stops descending at textblocks. */
function containsTableOfContents(doc: Node): boolean {
  let found = false;
  doc.descendants(node => {
    if (node.type.name === 'tableOfContents') found = true;
    return !found && !node.isTextblock && !node.isAtom;
  });
  return found;
}

/** A typing step that inserts or removes a footnote changes footnote order. O(size of the edit). */
function touchesFootnote(step: Step, docBefore: Node): boolean {
  const replace = replaceOf(step);
  if (!replace) return false;
  let found = false;
  const visit = (node: Node) => { if (node.type.name === 'footnote') found = true; return !found; };
  replace.slice.content.descendants(visit);
  if (replace.from < replace.to) docBefore.nodesBetween(replace.from, replace.to, visit);
  return found;
}

/** TOC items are built from heading text and level only. If they ever read
 *  more of the document, this check must widen with them. Marks change neither. */
function editsHeading(step: Step, docBefore: Node): boolean {
  const replace = replaceOf(step);
  return replace !== null && docBefore.resolve(replace.from).parent.type.name === 'heading';
}

export const ReferenceSync = Extension.create({
  name: 'referenceSync',
  addProseMirrorPlugins() { return [new Plugin<ReferenceState>({
    key: referenceSyncKey,
    // Typing cannot add or remove a block, so it keeps the previous answer.
    state: {
      init: (_, state) => ({ hasTableOfContents: containsTableOfContents(state.doc) }),
      apply: (tr, previous) => !tr.docChanged || everyStep([tr], isTypingStep) ? previous : { hasTableOfContents: containsTableOfContents(tr.doc) },
    },
    appendTransaction(transactions, oldState, state) {
      if (!transactions.some(t => t.docChanged || t.getMeta('normalizeIds'))) return null;
      // The full walk below decides what the references should be; this only
      // proves for ordinary typing that it would find nothing to change.
      const { hasTableOfContents } = referenceSyncKey.getState(state)!;
      if (!transactions.some(t => t.getMeta('normalizeIds')) && everyStep(transactions, (step, doc) =>
        isTypingStep(step, doc) && !touchesFootnote(step, doc) && !(hasTableOfContents && editsHeading(step, doc)))) return null;
      const headings: { text: string; level: number }[] = [], notes: { pos: number; number: number; attrs: Record<string, unknown> }[] = [], contents: { pos: number; attrs: Record<string, unknown> }[] = [];
      state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') headings.push({ text: node.textContent || 'Untitled heading', level: node.attrs.level });
        if (node.type.name === 'footnote') notes.push({ pos, number: notes.length + 1, attrs: node.attrs });
        if (node.type.name === 'tableOfContents') contents.push({ pos, attrs: node.attrs });
      });
      const tr = state.tr;
      for (const note of notes) if (note.number !== note.attrs.number) tr.setNodeMarkup(note.pos, undefined, { ...note.attrs, number: note.number });
      for (const toc of contents) if (JSON.stringify(toc.attrs.items) !== JSON.stringify(headings)) tr.setNodeMarkup(toc.pos, undefined, { ...toc.attrs, items: headings });
      return tr.docChanged ? tr.setMeta('addToHistory', false) : null;
    },
  })]; },
});
