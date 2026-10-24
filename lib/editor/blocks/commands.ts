import { NodeSelection } from '@tiptap/pm/state';
import { defineHandlers, operationFields, type CommandContext } from '../commands/types';

/** A cursor gets the block where it stands. A selection (such as an agent's block target) is kept and
 *  the new block goes before the top-level block where it starts: "a page break before the conclusion"
 *  must not replace the conclusion's heading. */
function insertBlockAtom(type: string, { state, c }: CommandContext): boolean {
  const { selection } = state;
  if (selection.empty) return c.insertContent({ type });
  const $from = selection.$from;
  return c.insertContentAt($from.depth ? $from.before(1) : $from.pos, { type }, { updateSelection: false });
}

export const blockCommands = defineHandlers({
  'image.insert': (op, { c }) => c.setImage({ src: op.src, alt: op.alt, width: op.width }),
  'image.update': (op, { state, c }) => {
    if (!(state.selection instanceof NodeSelection) || state.selection.node.type.name !== 'image') return false;
    const attrs = operationFields(op), previous = state.selection.node.attrs;
    const height = attrs.width && previous.width > 0 && previous.height > 0 ? attrs.width * previous.height / previous.width : null;
    if (height !== null && (!Number.isFinite(height) || height > 10000)) return false;
    return c.updateAttributes('image', { ...attrs, ...(attrs.width ? { height } : {}) });
  },
  'footnote.update': (op, { state, c }) => state.selection instanceof NodeSelection && state.selection.node.type.name === 'footnote' && c.updateAttributes('footnote', { text: op.text }),
  'footnote.insert': (op, { state, c }) => {
    let number = 1; state.doc.descendants(node => { if (node.type.name === 'footnote') number = Math.max(number, node.attrs.number + 1); });
    return c.insertContent({ type: 'footnote', attrs: { text: op.text, number } });
  },
  'block.toc': (_op, context) => insertBlockAtom('tableOfContents', context),
  'block.pageBreak': (_op, context) => insertBlockAtom('pageBreak', context),

});
