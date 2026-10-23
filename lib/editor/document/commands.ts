import type { Node } from '@tiptap/pm/model';
import { canonicalLanguage } from '../../domain/text/language';
import type { Operation } from '../../domain/entities/operation';
import { defineHandlers, operationFields } from '../commands/types';

/** A top-level block by ID in the document being edited. Deliberately not the
 *  engine's BlockIndex: inside a batch, earlier operations have already changed
 *  `state.doc`, so positions indexed before the batch would be stale. */
function findTopLevelBlock(doc: Node, id: string | null): { pos: number; node: Node } | undefined {
  if (id === null) return undefined;
  for (let index = 0, pos = 0; index < doc.childCount; pos += doc.child(index).nodeSize, index++)
    if (doc.child(index).attrs.blockId === id) return { pos, node: doc.child(index) };
}

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
  'block.insert': (op, { state, c }) => {
    const destination = op.beforeId === null ? state.doc.content.size : findTopLevelBlock(state.doc, op.beforeId)?.pos;
    return destination !== undefined && c.insertContentAt(destination, insertContent(op.block));
  },
  'block.delete': (op, { state }) => {
    const found = findTopLevelBlock(state.doc, op.id);
    if (!found) return false;
    state.tr.delete(found.pos, found.pos + found.node.nodeSize);
    return true;
  },
  'block.move': (op, { state }) => {
    const source = findTopLevelBlock(state.doc, op.id);
    const destination = op.beforeId === null ? state.doc.content.size : findTopLevelBlock(state.doc, op.beforeId)?.pos;
    if (!source || destination === undefined || op.id === op.beforeId) return false;
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
});
