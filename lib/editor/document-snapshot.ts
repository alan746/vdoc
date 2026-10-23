import type { Editor } from '@tiptap/core';
import { TableMap } from '@tiptap/pm/tables';
import { pinnedRowCount } from './table/table-headers';
import type { BlockVersions } from './document/block-version';

/** Read model handed to external callers: blocks, table grids, selection and the full document JSON. */
export function documentSnapshot(editor: Editor, sessionId: string, revision: number, versions: BlockVersions) {
  const blocks: { id: string; version: number; type: string; text: string; from: number; to: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs.blockId && (node.isTextblock || node.type.name === 'table' || node.isAtom)) blocks.push({ id: node.attrs.blockId, version: versions.get(node.attrs.blockId)!, type: node.type.name, text: node.textContent, from: node.isAtom ? pos : pos + 1, to: node.isAtom ? pos + node.nodeSize : pos + node.nodeSize - 1 });
  });
  const tables: { id: string; rows: number; columns: number; columnDirection: 'ltr' | 'rtl'; pinnedRows: number; rowBreaks: { id: string; row: number; allowSplit: boolean }[]; cells: { id: string; rowId: string; row: number; column: number; rowspan: number; colspan: number; text: string }[] }[] = [];
  editor.state.doc.descendants(node => {
    if (node.type.name !== 'table') return;
    const map = TableMap.get(node);
    const cells = [...new Set(map.map)].map(offset => {
      const cell = node.nodeAt(offset)!, bounds = map.findCell(offset);
      return { id: cell.attrs.blockId as string, rowId: node.child(bounds.top).attrs.blockId as string, row: bounds.top, column: bounds.left, rowspan: bounds.bottom - bounds.top, colspan: bounds.right - bounds.left, text: cell.textContent };
    });
    tables.push({ id: node.attrs.blockId, rows: map.height, columns: map.width, columnDirection: node.attrs.columnDirection === 'rtl' ? 'rtl' : 'ltr', pinnedRows: pinnedRowCount(node), rowBreaks: Array.from({ length: node.childCount }, (_, row) => ({ id: node.child(row).attrs.blockId as string, row, allowSplit: node.child(row).attrs.allowSplit === true })), cells });
  });
  return { schemaVersion: 1, sessionId, tables, revision, selection: { from: editor.state.selection.from, to: editor.state.selection.to }, blocks, document: editor.getJSON() };
}

/** Headings in document order, for resolving references like "under the budget heading". */
export function documentOutline(editor: Editor): { id: string; level: number; text: string }[] {
  const outline: { id: string; level: number; text: string }[] = [];
  editor.state.doc.descendants(node => {
    if (node.type.name === 'heading' && node.attrs.blockId) outline.push({ id: node.attrs.blockId, level: node.attrs.level, text: node.textContent });
  });
  return outline;
}

/** Full content for specific block IDs, so callers can read a few blocks by ID
 *  instead of the whole document. Unknown IDs are omitted, not errors. */
export function readBlocks(editor: Editor, versions: BlockVersions, ids: readonly string[]) {
  const wanted = new Set(ids);
  const blocks: { id: string; version: number; type: string; text: string }[] = [];
  const tables: ReturnType<typeof documentSnapshot>['tables'] = [];
  editor.state.doc.descendants(node => {
    if (node.attrs.blockId && wanted.has(node.attrs.blockId) && (node.isTextblock || node.type.name === 'table' || node.isAtom))
      blocks.push({ id: node.attrs.blockId, version: versions.get(node.attrs.blockId)!, type: node.type.name, text: node.textContent });
    if (node.type.name === 'table' && wanted.has(node.attrs.blockId)) {
      const map = TableMap.get(node);
      const cells = [...new Set(map.map)].map(offset => {
        const cell = node.nodeAt(offset)!, bounds = map.findCell(offset);
        return { id: cell.attrs.blockId as string, rowId: node.child(bounds.top).attrs.blockId as string, row: bounds.top, column: bounds.left, rowspan: bounds.bottom - bounds.top, colspan: bounds.right - bounds.left, text: cell.textContent };
      });
      tables.push({ id: node.attrs.blockId, rows: map.height, columns: map.width, columnDirection: node.attrs.columnDirection === 'rtl' ? 'rtl' : 'ltr', pinnedRows: pinnedRowCount(node), rowBreaks: Array.from({ length: node.childCount }, (_, row) => ({ id: node.child(row).attrs.blockId as string, row, allowSplit: node.child(row).attrs.allowSplit === true })), cells });
    }
  });
  return { blocks, tables };
}
