import { canonicalLanguage } from '../../domain/text/language';
import { operationFields, type HandlerMap } from '../commands/types';

export const documentCommands = {
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
  'block.code': (_op, { c }) => c.toggleCodeBlock(),
  'block.quote': (_op, { c }) => c.toggleBlockquote(),
  'block.rule': (_op, { c }) => c.setHorizontalRule(),
} satisfies HandlerMap<'block.move' | 'document.language' | 'document.layout' | 'block.code' | 'block.quote' | 'block.rule'>;
