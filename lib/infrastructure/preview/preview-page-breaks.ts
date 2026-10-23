/** Use one forced boundary per marker in the disposable Paged.js source.
 * Its 0.4.3 undisplayed filter marks inline-styled paragraphs as undisplayed;
 * break-after propagation then skips that paragraph and reaches the next
 * marker. Combining it with break-before on following content creates a
 * marker-only page. Override exportHTML's break-after and keep the boundary
 * on the immediate sibling instead. Native printing consumes finished sheets.
 */
export const PREVIEW_PAGE_BREAK_CSS = `
  .page-break { break-after:auto; height:0; margin:0; border:0; }
  .page-break span { display:none; }
  .page-break + * { break-before:page; }
`;

/** Record both sides of explicit breaks in the disposable preview source. */
export function preparePreviewPageBreaks(root: HTMLElement) {
  root.querySelectorAll('.page-break').forEach((marker, index) => {
    let before = marker.previousElementSibling, after = marker.nextElementSibling;
    while (before?.matches('.page-break')) before = before.previousElementSibling;
    while (after?.matches('.page-break')) after = after.nextElementSibling;
    if (!before || !after) return;
    for (const [node, attribute] of [[before, 'data-preview-before-break'], [after, 'data-preview-after-break']] as const) {
      node.setAttribute(attribute, [node.getAttribute(attribute), String(index)].filter(Boolean).join(' '));
    }
  });
}

/** Text equality alone cannot detect an ignored page break. */
export function previewPageBreakMismatch(source: HTMLElement, pages: HTMLElement): number | null {
  const pageNodes = Array.from(pages.querySelectorAll('.pagedjs_page'));
  const pageIndexes = (attribute: string, id: string) => Array.from(pages.querySelectorAll(`[${attribute}~="${id}"]`))
    .filter(node => !node.closest('[data-repeated-header]'))
    .map(node => pageNodes.indexOf(node.closest('.pagedjs_page')!)).filter(index => index >= 0);
  for (const node of source.querySelectorAll('[data-preview-before-break]')) {
    for (const id of node.getAttribute('data-preview-before-break')!.split(' ')) {
      const before = pageIndexes('data-preview-before-break', id), after = pageIndexes('data-preview-after-break', id);
      if (!before.length || !after.length) return 1;
      if (Math.min(...after) <= Math.max(...before)) return Math.min(...after) + 1;
    }
  }
  return null;
}
