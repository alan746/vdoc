import type { Attrs, Node } from '@tiptap/pm/model';
import { TableMap, type Rect } from '@tiptap/pm/tables';

export const borderSides = ['top', 'right', 'bottom', 'left'] as const;
export type BorderSide = typeof borderSides[number];
export type Border = { color: string; width: number; style: 'solid' | 'dashed' | 'dotted' };
export type BorderScope = 'all' | 'outer' | 'inner' | BorderSide;
export type CellBorders = Partial<Record<BorderSide, Border>>;

export function cellBorder(attrs: Attrs, side: BorderSide): Border {
  return { color: attrs.borderColor || '#DCE3ED', width: attrs.borderWidth ?? 1, style: attrs.borderStyle || 'solid', ...attrs.borders?.[side] };
}

export function uniformBorderValue(el: HTMLElement, part: 'color' | 'width' | 'style'): string {
  const values = borderSides.map(side=>el.style.getPropertyValue(`border-${side}-${part}`));
  return values.every(value=>value===values[0]) ? values[0] : '';
}

export function parseCellBorders(el: HTMLElement): CellBorders | null {
  const result: CellBorders = {};
  for (const side of borderSides) {
    const color = el.style.getPropertyValue(`border-${side}-color`);
    const width = el.style.getPropertyValue(`border-${side}-width`);
    const style = el.style.getPropertyValue(`border-${side}-style`);
    // Keep ordinary uniform legacy borders in the original attributes.
    if (color === uniformBorderValue(el,'color') && width === uniformBorderValue(el,'width') && style === uniformBorderValue(el,'style')) continue;
    if (color || width || style) result[side] = {
      color: color || el.style.borderColor || '#DCE3ED',
      width: style === 'none' || style === 'hidden' ? 0 : parseFloat(width || el.style.borderWidth || '1'),
      style: style === 'dashed' || style === 'dotted' ? style : 'solid',
    };
  }
  return Object.keys(result).length ? result : null;
}

export function renderCellBorders(attrs: Attrs) {
  if (!attrs.borders) return {};
  return { style: borderSides.map(side => {
    const border = cellBorder(attrs, side);
    return `border-${side}:${border.width}px ${border.style} ${border.color}`;
  }).join(';') };
}

/** Update both representations of a shared edge. Never change half of a merged edge. */
export function tableBorderChanges(table: Node, rect: Rect, scope: BorderScope, patch: Partial<Border>): Map<number, CellBorders> | null {
  const map = TableMap.get(table), edges = new Set<string>();
  const logicalSide = (side: BorderSide): BorderSide => table.attrs.columnDirection === 'rtl' ? side === 'left' ? 'right' : side === 'right' ? 'left' : side : side;
  function segments(bounds: Rect, physicalSide: BorderSide) {
    const side = logicalSide(physicalSide);
    const horizontal = side === 'top' || side === 'bottom';
    const line = side === 'top' ? bounds.top : side === 'bottom' ? bounds.bottom : side === 'left' ? bounds.left : bounds.right;
    return Array.from({ length: horizontal ? bounds.right - bounds.left : bounds.bottom - bounds.top }, (_, i) =>
      `${horizontal ? 'h' : 'v'}:${line}:${i + (horizontal ? bounds.left : bounds.top)}`);
  }
  for (const offset of map.cellsInRect(rect)) {
    const bounds = map.findCell(offset);
    for (const side of borderSides) {
      const logical = logicalSide(side);
      const perimeter = logical === 'top' ? bounds.top === rect.top : logical === 'bottom' ? bounds.bottom === rect.bottom : logical === 'left' ? bounds.left === rect.left : bounds.right === rect.right;
      if (scope === 'all' || scope === 'inner' && !perimeter || scope === 'outer' && perimeter || scope === side && perimeter) {
        for (const segment of segments(bounds, side)) edges.add(segment);
      }
    }
  }
  const result = new Map<number, CellBorders>();
  for (const offset of new Set(map.map)) {
    const bounds = map.findCell(offset), cell = table.nodeAt(offset)!;
    for (const side of borderSides) {
      const pieces = segments(bounds, side), count = pieces.filter(piece => edges.has(piece)).length;
      if (!count) continue;
      if (count !== pieces.length) return null;
      const borders = result.get(offset) || { ...cell.attrs.borders };
      borders[side] = { ...cellBorder(cell.attrs, side), ...patch };
      result.set(offset, borders);
    }
  }
  return result;
}
