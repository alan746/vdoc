import { reorderedTable } from './table-move';
import { tableBorderChanges } from './table-borders';
import { completePinnedBoundary, pinnedRowCount } from './table-headers';
import { subdivideCell } from './table-split';
import { CellSelection, TableMap, selectedRect } from '@tiptap/pm/tables';
import type { Node } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { operationFields, type HandlerMap } from '../commands/types';

type Rect = ReturnType<typeof selectedRect>;
type Attrs = Record<string, unknown>;
const patchNode = (tr: Transaction, pos: number, node: Node, patch: Attrs) => tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch });
const patchTable = (tr: Transaction, { table, tableStart }: Pick<Rect, 'table' | 'tableStart'>, patch: Attrs) => patchNode(tr, tableStart - 1, table, patch);
/** Patches rows in [from, to). */
function patchRows(tr: Transaction, { table, tableStart }: Pick<Rect, 'table' | 'tableStart'>, from: number, to: number, patch: Attrs) {
  table.forEach((row, offset, index) => { if (index >= from && index < to) patchNode(tr, tableStart + offset, row, patch); });
}
function applyBorderChanges(tr: Transaction, rect: Rect, changes: Map<number, unknown>) {
  for (const [offset, borders] of changes) patchNode(tr, rect.tableStart + offset, rect.table.nodeAt(offset)!, { borders });
}
function patchSelectedCells(tr: Transaction, rect: Rect, patch: Attrs) {
  for (const offset of rect.map.cellsInRect(rect)) patchNode(tr, rect.tableStart + offset, tr.doc.nodeAt(rect.tableStart + offset)!, patch);
}

/** Table structure, layout and styling operations. */
export const tableCommands = {
  'table.border': (op, { state }) => {
    const rect = selectedRect(state);
    const changes = tableBorderChanges(rect.table, rect, op.scope, {color:op.color,width:op.width,style:op.style});
    if (!changes || !changes.size) return false;
    applyBorderChanges(state.tr, rect, changes);
    return true;
  },
  'table.pinRows': (op, { state }) => {
    const rect = selectedRect(state), { table } = rect;
    if (op.count > table.childCount || completePinnedBoundary(table, op.count) !== op.count) return false;
    state.tr.setMeta('vdocPinnedRows', [...(state.tr.getMeta('vdocPinnedRows') || []), table.attrs.blockId]);
    patchTable(state.tr, rect, { pinnedRows: op.count });
    return true;
  },
  'table.direction': (op, { state }) => { patchTable(state.tr, selectedRect(state), { columnDirection: op.direction }); return true; },
  'table.rowBreak': (op, { state }) => {
    const rect = selectedRect(state);
    if (op.from >= op.to || op.to > rect.table.childCount) return false;
    patchRows(state.tr, rect, op.from, op.to, { allowSplit: op.allowSplit });
    return true;
  },
  'table.layout': (op, { state }) => { patchTable(state.tr, selectedRect(state), { alignment: op.alignment }); return true; },
  'table.rowHeight': (op, { state }) => {
    const { table, tableStart, map } = selectedRect(state);
    if (op.row >= map.height) return false;
    patchRows(state.tr, { table, tableStart }, op.row, op.row + 1, { minHeight: op.height });
    // A rowspan's content/minimum belongs to several rows; retain it. Only
    // remove legacy cell-height constraints confined to the resized row.
    for (const offset of new Set(map.map.slice(op.row * map.width, (op.row + 1) * map.width))) {
      const cell = table.nodeAt(offset)!;
      if (cell.attrs.rowspan === 1 && cell.attrs.minHeight !== null)
        patchNode(state.tr, tableStart + offset, cell, { minHeight: null });
    }
    return true;
  },
  'table.columnWidth': (op, { state }) => {
    const { table, tableStart, map } = selectedRect(state);
    if (op.column >= map.width) return false;
    for (const offset of new Set(map.map.filter((_, index) => index % map.width === op.column))) {
      const cell = table.nodeAt(offset)!;
      const widths = cell.attrs.colwidth ? [...cell.attrs.colwidth] : Array(cell.attrs.colspan).fill(0);
      widths[op.column - map.colCount(offset)] = op.width;
      state.tr.setNodeMarkup(tableStart + offset, undefined, { ...cell.attrs, colwidth: widths });
    }
    return true;
  },
  'table.distributeRows': (op, { state }) => {
    const { table, tableStart, map } = selectedRect(state);
    if (op.from >= op.to || op.to > map.height) return false;
    // A spanning cell crossing the boundary cannot be resized without touching
    // an unselected row. Reject the whole transaction instead of changing it.
    const cells = [...new Set(map.map.slice(op.from * map.width, op.to * map.width))];
    for (const offset of cells) {
      const bounds = map.findCell(offset);
      if (bounds.top < op.from || bounds.bottom > op.to) return false;
    }
    patchRows(state.tr, { table, tableStart }, op.from, op.to, { minHeight: op.height });
    for (const offset of cells) patchNode(state.tr, tableStart + offset, table.nodeAt(offset)!, { minHeight: null });
    return true;
  },
  'table.style': (op, { state }) => {
    const attrs = operationFields(op);
    if (!Object.keys(attrs).length) return false;
    const rect = selectedRect(state);
    const borderPatch = { ...(op.borderColor !== undefined ? {color:op.borderColor} : {}), ...(op.borderWidth !== undefined ? {width:op.borderWidth} : {}), ...(op.borderStyle !== undefined ? {style:op.borderStyle} : {}) };
    if (Object.keys(borderPatch).length) {
      const changes = tableBorderChanges(rect.table,rect,'all',borderPatch);
      if (!changes) return false;
      applyBorderChanges(state.tr, rect, changes);
    }
    if (op.minHeight !== undefined) patchRows(state.tr, rect, rect.top, rect.bottom, { minHeight: null });
    patchSelectedCells(state.tr, rect, attrs);
    return true;
  },
  'table.split': (op, { state }) => subdivideCell(state, op.rows, op.cols),
  'table.widths': (op, { state }) => {
    const $from = state.selection.$from;
    let depth = $from.depth;
    while (depth > 0 && $from.node(depth).type.name !== 'table') depth--;
    if (!depth) return false;
    const table = $from.node(depth), map = TableMap.get(table), start = $from.start(depth);
    if (op.widths.length !== map.width) return false;
    const tr = state.tr;
    for (const offset of new Set(map.map)) {
      const cell = table.nodeAt(offset)!;
      const column = map.colCount(offset);
      tr.setNodeMarkup(start + offset, undefined, { ...cell.attrs, colwidth: op.widths.slice(column, column + cell.attrs.colspan) });
    }
    return true;
  },
  'table.move': (op, { state }) => {
    const rect = selectedRect(state);
    const moved = reorderedTable(rect.table, op.axis, op.from, op.to);
    if (!moved) return false;
    state.tr.replaceWith(rect.tableStart - 1, rect.tableStart - 1 + rect.table.nodeSize, moved);
    const map = TableMap.get(moved);
    const row = op.axis === 'row' ? op.to : Math.min(rect.top, map.height - 1);
    const col = op.axis === 'column' ? op.to : Math.min(rect.left, map.width - 1);
    state.tr.setSelection(CellSelection.create(state.tr.doc, rect.tableStart + map.map[row * map.width + col]));
    return true;
  },
  'table.sort': (op, { state }) => {
    const rect = selectedRect(state);
    if (op.column >= rect.map.width) return false;
    const rows = Array.from({ length: rect.table.childCount }, (_, i) => rect.table.child(i));
    const pinned = rows.splice(0, pinnedRowCount(rect.table));
    if (rows.some(row => Array.from({ length: row.childCount }, (_, i) => row.child(i)).some(cell => cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1))) return false;
    const language = state.doc.attrs.language;
    rows.sort((a, b) => a.child(op.column).textContent.localeCompare(b.child(op.column).textContent, language && language !== 'und' ? language : undefined, { numeric: true }) * (op.descending ? -1 : 1));
    state.tr.replaceWith(rect.tableStart - 1, rect.tableStart - 1 + rect.table.nodeSize, rect.table.type.create(rect.table.attrs, [...pinned, ...rows]));
    return true;
  },
  'table.insert': (op, { c }) => c.insertTable({ rows: op.rows, cols: op.cols, withHeaderRow: op.header }),
  'table.edit': (op, { state, c }) => {
    if (op.action === 'merge') {
      const rect = selectedRect(state), pinned = pinnedRowCount(rect.table);
      if (rect.table.attrs.pinnedRows != null && rect.top < pinned && rect.bottom > pinned) return false;
    }
    if (op.action === 'deleteRow' || op.action === 'deleteColumn') {
      let depth = state.selection.$from.depth;
      while (depth > 0 && state.selection.$from.node(depth).type.name !== 'table') depth--;
      if (depth) {
        const rect = selectedRect(state);
        if ((op.action === 'deleteRow' && rect.top === 0 && rect.bottom === rect.map.height) || (op.action === 'deleteColumn' && rect.left === 0 && rect.right === rect.map.width)) return c.deleteTable();
      }
    }
    const actions = {
      rowBefore: c.addRowBefore, rowAfter: c.addRowAfter, columnBefore: c.addColumnBefore, columnAfter: c.addColumnAfter,
      deleteRow: c.deleteRow, deleteColumn: c.deleteColumn, deleteTable: c.deleteTable, merge: c.mergeCells,
      split: c.splitCell, headerRow: c.toggleHeaderRow,
    };
    return actions[op.action]();
  },
  'table.background': (op, { state }) => {
    patchSelectedCells(state.tr, selectedRect(state), { backgroundColor: op.color });
    return true;
  },
} satisfies HandlerMap<'table.border' | 'table.pinRows' | 'table.direction' | 'table.rowBreak' | 'table.layout' | 'table.rowHeight' | 'table.columnWidth' | 'table.distributeRows' | 'table.style' | 'table.split' | 'table.widths' | 'table.move' | 'table.sort' | 'table.insert' | 'table.edit' | 'table.background'>;
