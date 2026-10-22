import type { CommandProps } from '@tiptap/core';
import { selectedRect } from '@tiptap/pm/tables';
import type { Node } from '@tiptap/pm/model';
export function subdivideCell(state: CommandProps['state'], rows: number, cols: number) {
  const rect = selectedRect(state), map = rect.map;
  const chosen = map.map[rect.top * map.width + rect.left], cell = rect.table.nodeAt(chosen)!;
  if (cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1 || rect.bottom - rect.top !== 1 || rect.right - rect.left !== 1 || rows * cols === 1) return false;
  if (map.width + cols - 1 > 30 || map.height + rows - 1 > 1000) return false;
  const grid: { column: number; node: Node }[][] = Array.from({ length: map.height + rows - 1 }, () => []);
  const rowAttrs: Record<string, unknown>[] = [];
  for (let r = 0; r < map.height; r++) rowAttrs[r > rect.top ? r + rows - 1 : r] = rect.table.child(r).attrs;
  for (const offset of new Set(map.map)) {
    const box = map.findCell(offset), node = rect.table.nodeAt(offset)!;
    const row = box.top > rect.top ? box.top + rows - 1 : box.top, column = box.left > rect.left ? box.left + cols - 1 : box.left;
    if (offset === chosen) {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) grid[row + r].push({ column: column + c, node: node.type.create({ ...node.attrs, blockId: r || c ? null : node.attrs.blockId, rowspan: 1, colspan: 1, colwidth: node.attrs.colwidth ? [Math.max(40, Math.round(node.attrs.colwidth[0] / cols))] : null }, r || c ? state.schema.nodes.paragraph.create() : node.content) });
    } else {
      const crossRow = box.top <= rect.top && box.bottom > rect.top, crossColumn = box.left <= rect.left && box.right > rect.left;
      let widths = node.attrs.colwidth?.slice() || null;
      if (widths && crossColumn) { const index = rect.left - box.left, width = Math.max(40, Math.round(widths[index] / cols)); widths.splice(index, 1, ...Array(cols).fill(width)); }
      grid[row].push({ column, node: node.type.create({ ...node.attrs, rowspan: node.attrs.rowspan + (crossRow ? rows - 1 : 0), colspan: node.attrs.colspan + (crossColumn ? cols - 1 : 0), colwidth: widths }, node.content) });
    }
  }
  const content = grid.map((cells, i) => state.schema.nodes.tableRow.create(rowAttrs[i] || {}, cells.sort((a,b)=>a.column-b.column).map(c=>c.node)));
  state.tr.replaceWith(rect.tableStart - 1, rect.tableStart - 1 + rect.table.nodeSize, rect.table.type.create(rect.table.attrs, content));
  return true;
}
