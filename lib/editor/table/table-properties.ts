import type { Node } from '@tiptap/pm/model';
import { TableMap } from '@tiptap/pm/tables';
import type { Operation } from '../../domain/entities/operation';

export type CellProperties = { width: number; padding: number; borderWidth: number; borderStyle?: 'solid' | 'dashed' | 'dotted'; borderColor: string; minHeight: number; verticalAlign: 'top' | 'middle' | 'bottom' };

/** Resolve widths across all rows, including a merged first row. */
export function tableColumnWidths(table: Node, measured: number[] = []): number[] {
  const map = TableMap.get(table);
  return Array.from({ length: map.width }, (_, column) => {
    for (let row = 0; row < map.height; row++) {
      const offset = map.map[row * map.width + column], cell = table.nodeAt(offset)!;
      const value = cell.attrs.colwidth?.[column - map.colCount(offset)];
      if (Number.isFinite(value) && value > 0) return value;
    }
    return Math.max(40, Math.round(measured[column] || 160));
  });
}

export function distributeColumnWidths(widths: number[], left = 0, right = widths.length): number[] {
  const result = widths.slice(), count = right - left;
  if (count <= 0) return result;
  const total = Math.round(widths.slice(left, right).reduce((a,b)=>a+b,0));
  const base = Math.floor(total / count), remainder = total % count;
  for (let i = left; i < right; i++) result[i] = base + (i - left < remainder ? 1 : 0);
  return result;
}

/** Apply only fields the user edited, preserving other cells' mixed styles. */
export function tablePropertyOperations(before: CellProperties, after: CellProperties, widths: number[], left: number, right: number): Operation[] {
  const operations: Operation[] = [];
  const style: Extract<Operation, {type:'table.style'}> = {type:'table.style'};
  for (const key of ['padding','borderWidth','borderStyle','borderColor','minHeight','verticalAlign'] as const) {
    if (before[key] !== after[key]) Object.assign(style, {[key]:after[key]});
  }
  if (Object.keys(style).length > 1) operations.push(style);
  // Do not resubmit untouched imported widths to the stricter editing limits.
  if (before.width !== after.width) widths.forEach((_, column) => {
    if (column >= left && column < right) operations.push({type:'table.columnWidth',column,width:after.width});
  });
  return operations;
}
