import type { JSONContent } from '@tiptap/core';

/** Native printing consumes already paginated sheets, not the source document.
 * Install after Paged.js finishes so its polisher cannot turn this @page rule
 * into another set of document margins or override physical sheet dimensions.
 */
export function installPreviewPrintStyle(document: Document, content: JSONContent): () => void {
  const attrs=content.attrs || {};
  const [short,long]=attrs.pageSize==='letter' ? [215.9,279.4] : [210,297];
  const [width,height]=attrs.orientation==='landscape' ? [long,short] : [short,long];
  const style=document.createElement('style');
  style.dataset.previewPrint='true';
  // WebKit computes its print scale from the root layout width. Leaving that
  // auto-sized while its fixed-width paper overflows can enlarge the entire
  // sheet (the reported A4 PDF used 595pt / 743px instead of ~595pt / 794px).
  // Give the root the same physical width as its sheets, including in an iframe.
  style.textContent=`@media print {
    @page { size: ${width}mm ${height}mm; margin: 0 !important; padding: 0 !important; }
    @page vdoc-sheet { size: ${width}mm ${height}mm; margin: 0 !important; padding: 0 !important; }
    html, body { width: ${width}mm !important; min-width: ${width}mm !important; max-width: none !important; height: auto !important; min-height: 0 !important; max-height: none !important; padding: 0 !important; margin: 0 !important; }
    #preview-pages { padding: 0; width: ${width}mm !important; min-width: ${width}mm !important; }
    #preview-pages .pagedjs_pages { display: block !important; width: ${width}mm !important; height: auto !important; min-height: 0 !important; max-height: none !important; }
    #preview-pages .pagedjs_page, #preview-pages .pagedjs_sheet {
      width: ${width}mm !important; height: ${height}mm !important;
      min-width: 0 !important; max-width: none !important; min-height: 0 !important; max-height: none !important;
      margin: 0 !important; padding: 0 !important;
    }
    #preview-pages .pagedjs_page {
      page: vdoc-sheet; display: block; box-shadow: none;
      page-break-inside: avoid; break-inside: avoid-page;
      page-break-after: always; break-after: page;
    }
    #preview-pages .pagedjs_page:last-child { page-break-after: auto; break-after: auto; }
    /* Source breaks have already been honored by the paginator. */
    #preview-pages .pagedjs_page * { page-break-before: auto !important; break-before: auto !important; page-break-after: auto !important; break-after: auto !important; }
  }`;
  document.head.appendChild(style);
  return () => style.remove();
}
