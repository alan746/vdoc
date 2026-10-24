import { canonicalLanguage } from '../../domain/text/language';
import type { Operation } from '../../domain/entities/operation';
import { defineHandlers, operationFields } from '../commands/types';
import { findTopLevelBlock, insertionPoint, isAtPlacement } from './block-placement';

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

export const documentCommands = defineHandlers({
  'block.insert': (op, { state, c, reject }) => {
    const destination = insertionPoint(state.doc, op);
    if (destination === undefined) return reject('The placement anchor is missing or is not a top-level block. Read the document again and choose an explicit top-level anchor.');
    return c.insertContentAt(destination, insertContent(op.block));
  },
  'block.delete': (op, { state }) => {
    const found = findTopLevelBlock(state.doc, op.id);
    if (!found) return false;
    state.tr.delete(found.pos, found.pos + found.node.nodeSize);
    return true;
  },
  'block.move': (op, { state, reject }) => {
    const source = findTopLevelBlock(state.doc, op.id);
    const destination = insertionPoint(state.doc, op);
    if (!source) return reject('The source is missing or is not a top-level block. Nested content cannot be moved with block.move.');
    if (destination === undefined) return reject('The placement anchor is missing or is not a top-level block. Read the document again and choose an explicit top-level anchor.');
    if (op.id === (op.position?.anchorId ?? op.beforeId)) return reject('A block cannot be positioned relative to itself. Choose a different anchor.');
    if (isAtPlacement(state.doc, op.id, op)) return true;
    const { pos, node } = source;
    const tr = state.tr;
    tr.delete(pos, pos + node.nodeSize);
    tr.insert(destination > pos ? destination - node.nodeSize : destination, node);
    if (!isAtPlacement(tr.doc, op.id, op) || !findTopLevelBlock(tr.doc, op.id)!.node.eq(node)) {
      return reject('The requested adjacent placement could not be verified. The batch was not applied.');
    }
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
});
