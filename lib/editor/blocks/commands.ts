import { NodeSelection } from '@tiptap/pm/state';
import { defineHandlers, operationFields } from '../commands/types';

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
  'block.toc': (_op, { c }) => c.insertContent({ type: 'tableOfContents' }),
  'block.pageBreak': (_op, { c }) => c.insertContent({ type: 'pageBreak' }),

});
