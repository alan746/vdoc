import type { JSONContent } from '@tiptap/core';
import type { Previewer } from 'pagedjs';
import { previewSource, previewTextMatches, repeatTableHeaders } from './paged-preview';
import { compactPreviewTables } from './preview-table-compaction';
import { previewOverflowDetails, previewOverflowMessage, previewMarginOverflow } from './preview-layout';
import { waitForPreviewImages } from './preview-images';
import { trackPreviewPage } from './preview-navigation';
import { finishPreviewParagraphBorders } from './preview-paragraph-borders';
import { previewTableHeaderMismatch, previewTableRowMismatch } from './preview-table-headers';
import { repairPreviewTableRows, startPreviewRowsOnNewPage } from './preview-table-row-repair';
import { previewPageBreakMismatch } from './preview-page-breaks';
import { finalizePreviewFlow } from './preview-final-flow';
import { installPreviewPrintStyle } from './preview-print';

export type PrintPreviewSnapshot = { title: string; html: string; content: JSONContent };
export type PrintPreviewResult = { pages: number; fittedTables: ReturnType<typeof previewSource>['fittedTables'] };

/** Paginates a document snapshot into `root` with Paged.js and verifies the
 * result (text stream, page breaks, table headers/rows, overflow) before it
 * can be printed. One renderer serves one preview frame. */
export function createPrintPreviewRenderer(root: HTMLElement, doc: Document) {
  const resources = new AbortController();
  let disposed = false, preview: Previewer | undefined;
  let stopTracking: (() => void) | undefined;
  let removePrintStyle: (() => void) | undefined;
  const stopLayout = (current = preview) => {
    if (preview === current) preview = undefined;
    current?.chunker.stop();
    if (current?.polisher.styleEl) current.polisher.destroy();
    root.replaceChildren();
  };
  const renderLayout = async (current: Previewer, html: string, css: string) => {
    try {
      return await current.preview(html, [{ [doc.defaultView!.location.href]: css }], root);
    } finally {
      // stop() does not cancel Paged.js's pending CSS/font promises. If they
      // resume after unmount, release anything created after the first cleanup.
      if (disposed) stopLayout(current);
    }
  };
  /** Stops pagination, page tracking and print styles, and empties `root`. */
  const release = () => {
    stopTracking?.(); stopTracking = undefined;
    removePrintStyle?.(); removePrintStyle = undefined;
    resources.abort();
    stopLayout();
  };

  /** Resolves with the page count, or null if the renderer was disposed meanwhile. Throws a user-facing Error when the layout cannot be printed reliably. */
  const render = async (input: PrintPreviewSnapshot): Promise<PrintPreviewResult | null> => {
    const source = previewSource(input.title, input.html, input.content);
    doc.documentElement.lang = source.language; doc.title = input.title;
    const original = doc.createElement('div'); original.innerHTML = source.html;
    await waitForPreviewImages(original, resources.signal);
    await doc.fonts.ready;
    const { Previewer } = await import('pagedjs');
    if (disposed) return null;
    let pages = 0;
    let pageCount=0, bottomReserve=0;
    // One paginator pass: render, wait for images, then audit that the
    // complete text stream of `expected` survived. Null once disposed.
    const paginate = async (html: string, css: string, expected: HTMLElement) => {
      preview = new Previewer();
      preview.chunker.hooks.renderNode.register(repeatTableHeaders);
      preview.chunker.hooks.beforePageLayout.register(() => { if (disposed || ++pages > 200) throw new Error('This preview exceeds 200 pages or cannot safely paginate this layout.'); });
      const flow = await renderLayout(preview, html, css);
      if (disposed) return null;
      await waitForPreviewImages(root, resources.signal);
      if (disposed) return null;
      if (!previewTextMatches(expected, root)) throw new Error('Some text could not be paginated reliably. Return to editing or export Word instead.');
      return flow;
    };
    // Final table reflow can differ slightly from the paginator's measuring
    // columns. Repaginate once with real breathing room, keeping the same
    // physical paper size and strict final overflow checks.
    for (let layoutAttempt=0; layoutAttempt<2; layoutAttempt++) {
      let renderHTML=source.html;
      const css=source.css + (bottomReserve ? `
.pagedjs_pagebox > .pagedjs_area > .pagedjs_page_content { height: calc(100% - var(--pagedjs-footnotes-height) - ${bottomReserve}px) !important; }` : '');
      for(let attempt=0;attempt<2;attempt++) {
        // Audit the paginator's complete stream before moving intact cell
        // content into parallel columns (which changes page traversal order).
        const flow = await paginate(renderHTML, css, original);
        if (!flow) return null;
        const retry=repairPreviewTableRows(original,root);
        if(retry.length&&attempt===0) {
          renderHTML=startPreviewRowsOnNewPage(source.html,retry);
          stopLayout();continue;
        }
        pageCount=flow.total;break;
      }
      const compacted=compactPreviewTables(original,root);
      if(compacted) {
        const compactSource=doc.createElement('div');compactSource.innerHTML=compacted;
        stopLayout();
        const flow=await paginate(compacted,css,compactSource);
        if(!flow)return null;
        pageCount=flow.total;
      }
      finalizePreviewFlow(root);
      finishPreviewParagraphBorders(root);
      const breakMismatch = previewPageBreakMismatch(original, root);
      if (breakMismatch !== null) throw new Error(`A page break was not preserved near page ${breakMismatch}. Return to editing or export Word instead.`);
      const headerMismatch = previewTableHeaderMismatch(original,root);
      if(headerMismatch !== null) throw new Error(`Table headers could not be repeated reliably on page ${headerMismatch}. Return to editing or export Word instead.`);
      const rowMismatch = previewTableRowMismatch(original,root);
      if(rowMismatch !== null) throw new Error(`Table cells became misaligned across pages near page ${rowMismatch}. Split long rows into smaller rows or export Word instead.`);
      const overflow = previewOverflowDetails(root);
      if (overflow !== null) {
        if (layoutAttempt===0 && overflow.edge==='bottom' && overflow.pixels>0 && overflow.pixels<=8) {
          bottomReserve=overflow.pixels+2;
          stopLayout();continue;
        }
        throw new Error(previewOverflowMessage(overflow));
      }
      const marginOverflow = previewMarginOverflow(root);
      if (marginOverflow) throw new Error(`${marginOverflow.part} does not fit on page ${marginOverflow.page}. Increase page margins or shorten the header or footer before printing.`);
      break;
    }
    root.querySelectorAll('.pagedjs_page').forEach((page,index)=>{page.setAttribute('role','region');page.setAttribute('aria-label',`Page ${index+1}`);});
    removePrintStyle = installPreviewPrintStyle(doc, input.content);
    return { pages: pageCount, fittedTables: source.fittedTables };
  };

  return {
    render,
    /** Reports the page currently in view; call after the parent has been told the preview is ready. */
    trackPages(onPage: (page: number) => void) { stopTracking = trackPreviewPage(root, onPage); },
    scrollToPage(page: number) { root.querySelectorAll('.pagedjs_page')[page - 1]?.scrollIntoView({ block: 'start' }); },
    release,
    /** Final cleanup when the frame unmounts; in-flight renders resolve to null. */
    dispose() { disposed = true; release(); },
  };
}
