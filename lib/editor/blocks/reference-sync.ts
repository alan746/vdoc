import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

export const ReferenceSync = Extension.create({
  name: 'referenceSync',
  addProseMirrorPlugins() { return [new Plugin({ appendTransaction(transactions, oldState, state) {
    if (!transactions.some(t => t.docChanged || t.getMeta('normalizeIds'))) return null;
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
  } })]; },
});
