import type { Node } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';
import { pinnedRowCount } from './table-headers';

/** Move one logical row/column. Never split or silently expand a merged group. */
export function reorderedTable(table: Node, axis: 'row' | 'column', from: number, to: number): Node | null {
  const map = TableMap.get(table), size = axis === 'row' ? map.height : map.width;
  if (![from, to].every(n => Number.isInteger(n) && n >= 0 && n < size) || from === to) return null;
  const pins = pinnedRowCount(table);
  if (axis === 'row' && table.attrs.pinnedRows != null && (from < pins) !== (to < pins)) return null;
  const order = Array.from({ length: size }, (_, i) => i);
  order.splice(to, 0, ...order.splice(from, 1));
  const destination = Array<number>(size);
  order.forEach((original, next) => { destination[original] = next; });
  for (const offset of new Set(map.map)) {
    const bounds = map.findCell(offset);
    const start = axis === 'row' ? bounds.top : bounds.left, end = axis === 'row' ? bounds.bottom : bounds.right;
    // Every cell must retain both its span and its internal logical order.
    for (let i = start + 1; i < end; i++) if (destination[i] !== destination[start] + i - start) return null;
  }
  const rows = Array.from({ length: map.height }, (_, i) => table.child(i));
  if (axis === 'row') return table.type.create(table.attrs, order.map(i => rows[i]), table.marks);
  let rowOffset = 0;
  const nextRows = rows.map(row => {
    const cells: { node: Node; left: number }[] = [];
    row.forEach((cell, offset) => cells.push({ node: cell, left: destination[map.colCount(rowOffset + offset + 1)] }));
    rowOffset += row.nodeSize;
    cells.sort((a, b) => a.left - b.left);
    return row.type.create(row.attrs, cells.map(cell => cell.node), row.marks);
  });
  return table.type.create(table.attrs, nextRows, table.marks);
}
