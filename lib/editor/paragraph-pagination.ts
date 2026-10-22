import { selectedParagraphs } from './paragraph-selection';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';
import type { Operation } from './operations';

export const paginationKeys = ['keepWithNext', 'keepLinesTogether', 'preventSingleLines'] as const;
export type PaginationKey = typeof paginationKeys[number];
export type PaginationValues = Record<PaginationKey, boolean | 'mixed'>;
export function paragraphPagination(node: Pick<ProseMirrorNode, 'type' | 'attrs'>) {
  return { keepWithNext: node.attrs.keepWithNext ?? node.type.name === 'heading', keepLinesTogether: node.attrs.keepLinesTogether === true, preventSingleLines: node.attrs.preventSingleLines !== false };
}
export function selectedPagination(editor: Editor): PaginationValues {
  const values: PaginationValues = {keepWithNext:false,keepLinesTogether:false,preventSingleLines:true};
  let found = false;
  for (const { node } of selectedParagraphs(editor.state.doc, editor.state.selection)) {
    const current = paragraphPagination(node);
    for (const key of paginationKeys) values[key] = !found ? current[key] : values[key] === current[key] ? current[key] : 'mixed';
    found = true;
  }
  return values;
}
export function paginationOperation(before: PaginationValues, after: PaginationValues): Extract<Operation, {type:'paragraph.style'}> | null {
  const operation: Extract<Operation, {type:'paragraph.style'}> = {type:'paragraph.style'};
  for (const key of paginationKeys) if (after[key] !== 'mixed' && before[key] !== after[key]) operation[key] = after[key];
  return Object.keys(operation).length > 1 ? operation : null;
}

export function paginationAttributes() {
  return Object.fromEntries(paginationKeys.map(key => {
    const data = `data-${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}`;
    return [key, {
      default: key === 'keepWithNext' ? null : key === 'preventSingleLines',
      parseHTML: (el: HTMLElement) => {
        const explicit = el.getAttribute(data);
        if (explicit !== null) return explicit === 'true';
        if (key === 'preventSingleLines') return !(el.style.orphans === '1' && el.style.widows === '1');
        const rule = key === 'keepWithNext' ? el.style.breakAfter || el.style.pageBreakAfter : el.style.breakInside || el.style.pageBreakInside;
        if (rule === 'avoid' || rule === 'avoid-page') return true;
        if (rule === 'auto') return false;
        return key === 'keepWithNext' ? null : false;
      },
      renderHTML: (attrs: Record<string, unknown>) => {
        const value = attrs[key];
        if (value == null) return {};
        const css = key === 'preventSingleLines' ? `orphans:${value ? 2 : 1};widows:${value ? 2 : 1}` : key === 'keepWithNext' ? `break-after:${value ? 'avoid' : 'auto'};page-break-after:${value ? 'avoid' : 'auto'}` : `break-inside:${value ? 'avoid' : 'auto'};page-break-inside:${value ? 'avoid' : 'auto'}`;
        return { [data]:String(value), style:css };
      },
    }];
  }));
}
