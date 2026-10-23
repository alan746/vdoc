import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';
import { pinnedRowCount } from './table/table-headers';
import type { BlockIndex } from './document/block-index';

export type TableSnapshot = {
  id: string; rows: number; columns: number; columnDirection: 'ltr' | 'rtl'; pinnedRows: number;
  rowBreaks: { id: string; row: number; allowSplit: boolean }[];
  cells: { id: string; rowId: string; row: number; column: number; rowspan: number; colspan: number; text: string }[];
};

const isReadable = (node: Node) => node.isTextblock || node.type.name === 'table' || node.isAtom;

function tableSnapshot(node: Node): TableSnapshot {
  const map = TableMap.get(node);
  const cells = [...new Set(map.map)].map(offset => {
    const cell = node.nodeAt(offset)!, bounds = map.findCell(offset);
    return { id: cell.attrs.blockId as string, rowId: node.child(bounds.top).attrs.blockId as string, row: bounds.top, column: bounds.left, rowspan: bounds.bottom - bounds.top, colspan: bounds.right - bounds.left, text: cell.textContent };
  });
  return { id: node.attrs.blockId, rows: map.height, columns: map.width, columnDirection: node.attrs.columnDirection === 'rtl' ? 'rtl' : 'ltr', pinnedRows: pinnedRowCount(node), rowBreaks: Array.from({ length: node.childCount }, (_, row) => ({ id: node.child(row).attrs.blockId as string, row, allowSplit: node.child(row).attrs.allowSplit === true })), cells };
}

/** Read model handed to external callers: blocks, table grids, selection and the full document JSON. */
export function documentSnapshot(editor: Editor, sessionId: string, revision: number, index: BlockIndex) {
  const blocks: { id: string; version: number; type: string; text: string; from: number; to: number }[] = [];
  const tables: TableSnapshot[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.blockId && isReadable(node)) blocks.push({ id: node.attrs.blockId, version: index.version(node.attrs.blockId)!, type: node.type.name, text: node.textContent, from: node.isAtom ? pos : pos + 1, to: node.isAtom ? pos + node.nodeSize : pos + node.nodeSize - 1 });
    if (node.type.name === 'table') tables.push(tableSnapshot(node));
  });
  return { schemaVersion: 1, sessionId, tables, revision, selection: { from: editor.state.selection.from, to: editor.state.selection.to }, blocks, document: editor.getJSON() };
}
export type DocumentSnapshot = ReturnType<typeof documentSnapshot>;

export type OutlineEntry = { id: string; level: number; text: string };
/** Headings in document order, for resolving references like "under the budget heading". O(headings). */
export function documentOutline(index: BlockIndex): OutlineEntry[] {
  return index.headings().map(({ node }) => ({ id: node.attrs.blockId, level: node.attrs.level, text: node.textContent }));
}

export type BlockRead = { blocks: { id: string; version: number; type: string; text: string }[]; tables: TableSnapshot[] };
/** Full content for specific block IDs, in document order, without walking the
 *  document: O(k log k) for k requested IDs. Unknown IDs are omitted, not errors. */
export function readBlocks(index: BlockIndex, ids: readonly string[]): BlockRead {
  const found = [...new Set(ids)].flatMap(id => { const entry = index.get(id); return entry && isReadable(entry.node) ? [entry] : []; }).sort((a, b) => a.pos - b.pos);
  return {
    blocks: found.map(({ node, version }) => ({ id: node.attrs.blockId, version, type: node.type.name, text: node.textContent })),
    tables: found.filter(({ node }) => node.type.name === 'table').map(({ node }) => tableSnapshot(node)),
  };
}
