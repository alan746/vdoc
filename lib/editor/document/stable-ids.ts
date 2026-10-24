import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Mapping, AttrStep, DocAttrStep } from '@tiptap/pm/transform';
import { everyStep, isTypingStep } from '../transaction-steps';

export const StableIds = Extension.create<{ types: string[] }>({
  name: 'stableIds',
  addOptions() { return { types: [] }; },
  addGlobalAttributes() {
    return [{ types: this.options.types, attributes: { blockId: {
      default: null,
      parseHTML: el => el.getAttribute('data-block-id'),
      renderHTML: attrs => attrs.blockId ? { 'data-block-id': attrs.blockId } : {},
    } } }];
  },
  onCreate() {
    this.editor.view.dispatch(this.editor.state.tr.setMeta('normalizeIds', true));
  },
  addProseMirrorPlugins() {
    const nodeTypes = this.options.types;
    return [new Plugin({
      appendTransaction(transactions, oldState, state) {
        if (!transactions.some(t => t.docChanged || t.getMeta('normalizeIds'))) return null;
        // Text and mark edits cannot introduce or duplicate block IDs. Avoid a full
        // document traversal on every keystroke in a long document.
        // Attribute steps are harmless here too: they cannot add or duplicate an ID.
        if (!transactions.some(t => t.getMeta('normalizeIds')) &&
          everyStep(transactions, (step, doc) => isTypingStep(step, doc) || step instanceof AttrStep || step instanceof DocAttrStep)) return null;
        const mapping = new Mapping();
        transactions.forEach(transaction => mapping.appendMapping(transaction.mapping));
        // nodeAt(mapped) searches siblings from the start. Repeating it for
        // every old block makes Enter/join/paste quadratic in wide documents.
        // Index the final positions once, including identified nested nodes.
        const currentIds = new Map<number, string>();
        state.doc.descendants((node, pos) => {
          if (node.attrs.blockId) currentIds.set(pos, node.attrs.blockId);
        });
        const originals = new Map<string, number>();
        oldState.doc.descendants((node, pos) => {
          if (!node.attrs.blockId || originals.has(node.attrs.blockId)) return;
          const mapped = mapping.map(pos, 1);
          if (currentIds.get(mapped) === node.attrs.blockId) originals.set(node.attrs.blockId, mapped);
        });
        const seen = new Set<string>();
        const tr = state.tr;
        state.doc.descendants((node, pos) => {
          if (!nodeTypes.includes(node.type.name)) return;
          const id = node.attrs.blockId;
          if (!id || seen.has(id) || (originals.has(id) && originals.get(id) !== pos)) {
            const newId = `b_${crypto.randomUUID()}`;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: newId });
            seen.add(newId);
          } else seen.add(id);
        });
        return tr.docChanged ? tr.setMeta('addToHistory', false) : null;
      },
    })];
  },
});
