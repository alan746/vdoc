import { canonicalLanguage } from '../../domain/text/language';
import type { Operation } from '../../domain/entities/operation';
import { operationFields, type HandlerMap } from '../commands/types';

type InsertBlock = Extract<Operation, { type: 'block.insert' }>['block'];
const textContent = (text: string) => text ? [{ type: 'text', text }] : [];
function insertContent(block: InsertBlock): object {
  if (block.kind === 'heading') return { type: 'heading', attrs: { level: block.level }, content: textContent(block.text) };
  if (block.kind === 'paragraph') return { type: 'paragraph', content: textContent(block.text) };
  const headerCells = block.headerText ?? Array.from({ length: block.cols }, () => '');
  const dataRowCount = block.rows - (block.header ? 1 : 0);
  const cell = (type: string, text: string) => ({ type, content: [{ type: 'paragraph', content: textContent(text) }] });
  const rows = [
    ...(block.header ? [{ type: 'tableRow', content: headerCells.map(text => cell('tableHeader', text)) }] : []),
    ...Array.from({ length: dataRowCount }, (_, row) => ({ type: 'tableRow', content: (block.rowsText?.[row] ?? Array.from({ length: block.cols }, () => '')).map(text => cell('tableCell', text)) })),
  ];
  return { type: 'table', content: rows };
}

export const documentCommands = {
  'block.insert': (op, { state, c }) => {
    let destination = op.beforeId === null ? state.doc.content.size : -1;
    state.doc.forEach((node, pos) => { if (node.attrs.blockId === op.beforeId) destination = pos; });
    return destination >= 0 && c.insertContentAt(destination, insertContent(op.block));
  },
  'block.delete': (op, { state }) => {
    let found: { pos: number; size: number } | undefined;
    state.doc.forEach((node, pos) => { if (node.attrs.blockId === op.id) found = { pos, size: node.nodeSize }; });
    if (!found) return false;
    state.tr.delete(found.pos, found.pos + found.size);
    return true;
  },
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
} satisfies HandlerMap<'block.move' | 'document.language' | 'document.layout' | 'block.code' | 'block.quote' | 'block.rule' | 'block.insert' | 'block.delete'>;
