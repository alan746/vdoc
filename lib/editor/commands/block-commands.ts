import { canonicalLanguage } from '../../domain/text/language';
import { NodeSelection } from '@tiptap/pm/state';
import { operationFields, type HandlerMap } from './types';

/** Block, image, footnote, link and document-level operations. */
export const blockCommands = {
  'block.move': (op, { state }) => {
    let source: { pos: number; node: import('@tiptap/pm/model').Node } | undefined;
    let destination = op.beforeId === null ? state.doc.content.size : -1;
    state.doc.forEach((node, pos) => {
      if (node.attrs.blockId === op.id) source = { pos, node };
      if (node.attrs.blockId === op.beforeId) destination = pos;
    });
    if (!source || destination < 0 || op.id === op.beforeId) return false;
    const { pos, node } = source;
    const tr = state.tr;
    tr.delete(pos, pos + node.nodeSize);
    tr.insert(destination > pos ? destination - node.nodeSize : destination, node);
    return true;
  },
  'document.language': (op, { state }) => {
    state.tr.setDocAttribute('language', canonicalLanguage(op.language)); return true;
  },
  'document.layout': (op, { state }) => {
 const attrs = operationFields(op); for (const [key, value] of Object.entries(attrs)) state.tr.setDocAttribute(key, value); return true; 
  },
  'image.insert': (op, { c }) => c.setImage({ src: op.src, alt: op.alt, width: op.width }),
  'image.update': (op, { state, c }) => {
    if (!(state.selection instanceof NodeSelection) || state.selection.node.type.name !== 'image') return false;
    const attrs = operationFields(op), previous = state.selection.node.attrs;
    const height = attrs.width && previous.width > 0 && previous.height > 0 ? attrs.width * previous.height / previous.width : null;
    if (height !== null && (!Number.isFinite(height) || height > 10000)) return false;
    return c.updateAttributes('image', { ...attrs, ...(attrs.width ? { height } : {}) });
  },
  'block.code': (_op, { c }) => c.toggleCodeBlock(),
  'footnote.update': (op, { state, c }) => state.selection instanceof NodeSelection && state.selection.node.type.name === 'footnote' && c.updateAttributes('footnote', { text: op.text }),
  'footnote.insert': (op, { state, c }) => {
    let number = 1; state.doc.descendants(node => { if (node.type.name === 'footnote') number = Math.max(number, node.attrs.number + 1); });
    return c.insertContent({ type: 'footnote', attrs: { text: op.text, number } });
  },
  'block.toc': (_op, { c }) => c.insertContent({ type: 'tableOfContents' }),
  'block.pageBreak': (_op, { c }) => c.insertContent({ type: 'pageBreak' }),
  'block.quote': (_op, { c }) => c.toggleBlockquote(),
  'block.rule': (_op, { c }) => c.setHorizontalRule(),
  'link.set': (op, { c }) => c.setLink({ href: op.href }),
  'link.unset': (_op, { c }) => c.unsetLink(),
} satisfies HandlerMap<'block.move' | 'document.language' | 'document.layout' | 'image.insert' | 'image.update' | 'block.code' | 'footnote.update' | 'footnote.insert' | 'block.toc' | 'block.pageBreak' | 'block.quote' | 'block.rule' | 'link.set' | 'link.unset'>;
