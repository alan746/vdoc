import type { NodeRule } from '../../domain/rules/document-validation';
import { validColor } from '../validation-values';

export const rowPaginationRule: NodeRule = (node, attrs) => {
    if (node.type === 'tableRow' && attrs.allowSplit !== undefined && typeof attrs.allowSplit !== 'boolean') throw new Error('The backup contains an invalid row page-break setting.');
};

export const pinnedRowsRule: NodeRule = (node, attrs) => {
    if (node.type === 'table' && attrs.pinnedRows != null && (!Number.isInteger(attrs.pinnedRows) || attrs.pinnedRows < 0 || attrs.pinnedRows > (node.content?.length || 0))) throw new Error('The backup contains an invalid pinned row count.');
};

export const tableStyleRule: NodeRule = (node, attrs) => {
    if (node.type === 'table' && attrs.columnDirection != null && !['ltr','rtl'].includes(attrs.columnDirection)) throw new Error('The backup contains an invalid column direction.');
    if (attrs.alignment != null && !['left','center','right'].includes(attrs.alignment)) throw new Error('The backup contains an invalid table alignment.');
    if (attrs.borderStyle != null && !['solid','dashed','dotted'].includes(attrs.borderStyle)) throw new Error('The backup contains an invalid border style.');
};

/* eslint-disable @typescript-eslint/no-explicit-any */

export const cellBordersRule: NodeRule = (node, attrs) => {
    if (attrs.borders != null) {
      if (typeof attrs.borders !== 'object' || Array.isArray(attrs.borders)) throw new Error('The backup contains invalid cell borders.');
      for (const [side, border] of Object.entries(attrs.borders) as [string, any][]) {
        if (!['top','right','bottom','left'].includes(side) || !border || typeof border !== 'object' || Array.isArray(border) || Object.keys(border).some(key=>!['width','color','style'].includes(key)) || !validColor(border.color) || typeof border.color !== 'string' || !Number.isFinite(border.width) || border.width < 0 || border.width > 10000 || !['solid','dashed','dotted'].includes(border.style)) throw new Error('The backup contains invalid cell borders.');
      }
    }
};

export const cellSpansRule: NodeRule = (node, attrs) => {
    if (node.type === 'tableCell' || node.type === 'tableHeader') {
      for (const key of ['colspan', 'rowspan']) if (attrs[key] != null && (!Number.isInteger(attrs[key]) || attrs[key] < 1)) throw new Error('The backup contains an invalid cell span.');
      if (attrs.colwidth != null && attrs.colwidth.length !== (attrs.colspan ?? 1)) throw new Error('The backup contains mismatched column widths.');
    }
    if (attrs.colwidth != null && (!Array.isArray(attrs.colwidth) || attrs.colwidth.some((n: unknown) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 10000))) throw new Error('The backup contains invalid column widths.');
};
