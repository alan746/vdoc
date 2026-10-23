import { TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { parseCellBorders, renderCellBorders, uniformBorderValue } from './table-borders';

const background = {
  default: null,
  parseHTML: (el: HTMLElement) => el.style.backgroundColor || null,
  renderHTML: (attrs: Record<string, unknown>) => attrs.backgroundColor ? { style: `background-color: ${attrs.backgroundColor}` } : {},
};
const cellStyle = {
  backgroundColor: background,
  minHeight: { default: null, parseHTML: (el: HTMLElement) => el.style.height ? parseFloat(el.style.height) : null, renderHTML: (a: Record<string, unknown>) => a.minHeight != null ? { style: `height: ${a.minHeight}px` } : {} },
  borderColor: { default: null, parseHTML: (el: HTMLElement) => uniformBorderValue(el,'color') || null, renderHTML: (a: Record<string, unknown>) => a.borderColor ? { style: `border-color: ${a.borderColor}` } : {} },
  borderStyle: { default: 'solid', parseHTML: (el: HTMLElement) => ['dashed','dotted'].includes(uniformBorderValue(el,'style')) ? uniformBorderValue(el,'style') : 'solid', renderHTML: (a: Record<string, unknown>) => ({ style: `border-style: ${a.borderStyle || 'solid'}` }) },
  borderWidth: { default: null, parseHTML: (el: HTMLElement) => ['none','hidden'].includes(uniformBorderValue(el,'style')) ? 0 : uniformBorderValue(el,'width') ? parseFloat(uniformBorderValue(el,'width')) : null, renderHTML: (a: Record<string, unknown>) => a.borderWidth !== null ? { style: `border-width: ${a.borderWidth}px` } : {} },
  padding: { default: null, parseHTML: (el: HTMLElement) => el.style.padding ? parseFloat(el.style.padding) : null, renderHTML: (a: Record<string, unknown>) => a.padding !== null ? { style: `padding: ${a.padding}px` } : {} },
  borders: { default: null, parseHTML: parseCellBorders, renderHTML: renderCellBorders },
  verticalAlign: { default: 'top', parseHTML: (el: HTMLElement) => el.style.verticalAlign || 'top', renderHTML: (a: Record<string, unknown>) => ({ style: `vertical-align: ${a.verticalAlign}` }) },
};
export const VdocRow = TableRow.extend({ addAttributes() { return { ...this.parent?.(), minHeight: cellStyle.minHeight,
  allowSplit: {
    default: false,
    parseHTML: (el: HTMLElement) => {
      const explicit = el.getAttribute('data-allow-split');
      if (explicit !== null) return explicit === 'true';
      return (el.style.breakInside || el.style.pageBreakInside) === 'auto';
    },
    renderHTML: (attrs: Record<string, unknown>) => ({ 'data-allow-split': String(attrs.allowSplit === true), style: `break-inside:${attrs.allowSplit === true ? 'auto' : 'avoid'};page-break-inside:${attrs.allowSplit === true ? 'auto' : 'avoid'}` }),
  },
}; } });
export const VdocCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellStyle }; } });
export const VdocHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellStyle }; } });
