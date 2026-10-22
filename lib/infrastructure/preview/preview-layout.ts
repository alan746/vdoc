import type { JSONContent } from '@tiptap/core';
import { printContainerWidth } from './print-containers';

export function previewPageWidth(content: JSONContent) {
  const a = content.attrs || {};
  const dimensions = a.pageSize === 'letter' ? [215.9, 279.4] : [210, 297];
  return (dimensions[a.orientation === 'landscape' ? 1 : 0] - 2 * (Number(a.pageMargin) || 20)) * 96 / 25.4;
}

/** Fit only the disposable print copy. Preserve column ratios and all document widths. */
export function fitPreviewTables(root: HTMLElement, availableWidth: number): number {
  let fitted = 0;
  const fit = (table: HTMLTableElement, available: number) => {
    const cols = Array.from(table.querySelectorAll<HTMLTableColElement>(':scope > colgroup > col'));
    const widths = cols.map(col => parseFloat(col.style.width || col.style.minWidth) || 40);
    const total = widths.reduce((sum, width) => sum + width, 0);
    const declared = /px$/.test(table.style.width) ? parseFloat(table.style.width) : 0;
    // Leave a pixel for collapsed outer borders and browser subpixel rounding.
    const target = Math.max(1, available - 1);
    const percentage = /^\d+(?:\.\d+)?%$/.test(table.style.width) ? parseFloat(table.style.width) / 100 : 1;
    const desired = Math.max(total, declared || target * percentage);
    const effective = Math.min(desired, target);
    let resolvedWidths = widths;
    if (!declared || desired > target) {
      // A percentage width can resolve against the whole multi-column flow
      // instead of one page. Freeze auto-sized tables before fragmentation.
      const automatic = cols.map(col => !/px$/.test(col.style.width) || !(parseFloat(col.style.width) > 0));
      const autoCount = automatic.filter(Boolean).length;
      resolvedWidths = widths.map((width,index) => autoCount && total <= effective
        ? width + (automatic[index] ? (effective - total) / autoCount : 0)
        : width / total * effective);
      table.style.width = `${effective}px`; table.style.minWidth = '0'; table.style.maxWidth = `${target}px`;
      cols.forEach((col, index) => { col.style.width = `${resolvedWidths[index]}px`; col.style.minWidth = '0'; });
      if (!declared) table.dataset.previewWidthResolved = 'true';
      if (desired > target) { table.dataset.previewFitted = 'true'; fitted++; }
    }
    const resolvedTotal = resolvedWidths.reduce((sum,width) => sum + width,0);
    // Resolve logical columns, including cells beneath rowspans, for nested tables.
    const occupied: number[] = [];
    Array.from(table.rows).forEach(row => {
      let column = 0;
      for (const cell of Array.from(row.cells)) {
        while (occupied[column] > 0) column++;
        const ratio = resolvedTotal ? resolvedWidths.slice(column, column + cell.colSpan).reduce((s, w) => s + w, 0) / resolvedTotal : 1;
        // Zero is explicit, and shorthand's first value can be vertical padding.
        // CSSOM expands shorthand into the horizontal sides used by this fit.
        const left = parseFloat(cell.style.paddingLeft), right = parseFloat(cell.style.paddingRight);
        const padding = (Number.isFinite(left) ? left : 10) + (Number.isFinite(right) ? right : 10);
        const cellWidth = Math.max(1, effective * ratio - padding - 2);
        cell.querySelectorAll<HTMLTableElement>('table').forEach(nested => { if (nested.parentElement?.closest('table') === table) fit(nested, printContainerWidth(nested, cell, cellWidth)); });
        for (let i = column; i < column + cell.colSpan; i++) occupied[i] = cell.rowSpan;
        column += cell.colSpan;
      }
      for (let i = 0; i < occupied.length; i++) occupied[i] = Math.max(0, (occupied[i] || 0) - 1);
    });
  };
  root.querySelectorAll<HTMLTableElement>('table').forEach(table => { if (!table.parentElement?.closest('table')) fit(table, printContainerWidth(table, root, availableWidth)); });
  return fitted;
}

export type PreviewOverflow = {
  page: number;
  kind: 'page area' | 'table' | 'image' | 'divider' | 'checkbox' | 'paragraph border' | 'text';
  edge: 'left' | 'right' | 'top' | 'bottom' | 'size';
  pixels: number;
};

/** Text in the DOM can still be clipped on paper. Inspect actual painted ranges too.
 * Keep object/edge measurements so a browser-specific failure is actionable. */
export function previewOverflowDetails(root: HTMLElement): PreviewOverflow | null {
  const areas = Array.from(root.querySelectorAll<HTMLElement>('.pagedjs_area'));
  for (let index = 0; index < areas.length; index++) {
    const area = areas[index], bounds = area.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return { page:index + 1, kind:'page area', edge:'size', pixels:0 };
    const outside = (r: DOMRect, kind: PreviewOverflow['kind']): PreviewOverflow | null => {
      if (r.width <= 0 || r.height <= 0) return null;
      const edges = [['left', bounds.left - r.left], ['right', r.right - bounds.right], ['top', bounds.top - r.top], ['bottom', r.bottom - bounds.bottom]] as const;
      const largest = [...edges].sort((a,b) => b[1] - a[1])[0];
      return largest[1] > 2 ? { page:index + 1, kind, edge:largest[0], pixels:Math.ceil(largest[1]) } : null;
    };
    for (const element of area.querySelectorAll('table,img,hr,input,[data-preview-border-line]')) {
      const kind = element.hasAttribute('data-preview-border-line') ? 'paragraph border' : ({ TABLE:'table', IMG:'image', HR:'divider', INPUT:'checkbox' } as const)[element.tagName as 'TABLE'|'IMG'|'HR'|'INPUT'];
      const result = outside(element.getBoundingClientRect(), kind);
      if (result) return result;
    }
    const walker = root.ownerDocument.createTreeWalker(area, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim()) continue;
      const range = root.ownerDocument.createRange(); range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        const result = outside(rect, 'text');
        if (result) return result;
      }
    }
  }
  return null;
}

export function previewOverflowPage(root: HTMLElement): number | null {
  return previewOverflowDetails(root)?.page ?? null;
}

export function previewOverflowMessage(overflow: PreviewOverflow): string {
  if (overflow.edge === 'size') return `Page ${overflow.page} could not be measured. Close the preview and try again.`;
  return `Content extends beyond page ${overflow.page}: ${overflow.kind} crosses the ${overflow.edge} edge by ${overflow.pixels} px. Try landscape, smaller margins, or smaller table rows and images before printing.`;
}

/** Margin text is generated by CSS, outside .pagedjs_area. Element geometry and
 * scroll extents include that generated content even though DOM ranges do not. */
export function previewMarginOverflow(root: HTMLElement): { page: number; part: 'Header' | 'Footer' | 'Page number' } | null {
  const pages = Array.from(root.querySelectorAll<HTMLElement>('.pagedjs_page'));
  const slots = [
    ['.pagedjs_margin-top-center', 'Header'],
    ['.pagedjs_margin-bottom-left', 'Footer'],
    ['.pagedjs_margin-bottom-right', 'Page number'],
  ] as const;
  for (const [index, page] of pages.entries()) {
    for (const [selector, part] of slots) {
      const box = page.querySelector<HTMLElement>(`${selector}.hasContent`);
      const content = box?.querySelector<HTMLElement>('.pagedjs_margin-content');
      if (!box) continue;
      if (!content) return { page: index + 1, part };
      const bounds = box.getBoundingClientRect(), text = content.getBoundingClientRect();
      const group = box.closest<HTMLElement>('.pagedjs_margin-top, .pagedjs_margin-bottom')?.getBoundingClientRect();
      const outside = (area: DOMRect) => text.left < area.left - 2 || text.right > area.right + 2 || text.top < area.top - 2 || text.bottom > area.bottom + 2;
      if (!bounds.width || !bounds.height || !text.width || !text.height ||
        outside(bounds) || (group && outside(group)) ||
        content.scrollWidth > content.clientWidth + 2 || content.scrollHeight > content.clientHeight + 2) return { page: index + 1, part };
    }
  }
  return null;
}
