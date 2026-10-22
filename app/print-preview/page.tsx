'use client';
import { useEffect, useRef } from 'react';
import { previewSource, previewTextMatches, repeatTableHeaders } from '@/lib/infrastructure/preview/paged-preview';
import { compactPreviewTables } from '@/lib/infrastructure/preview/preview-table-compaction';
import type { Previewer } from 'pagedjs';
import { previewOverflowDetails, previewOverflowMessage, previewMarginOverflow } from '@/lib/infrastructure/preview/preview-layout';
import { waitForPreviewImages } from '@/lib/infrastructure/preview/preview-images';
import { trackPreviewPage } from '@/lib/infrastructure/preview/preview-navigation';
import { finishPreviewParagraphBorders } from '@/lib/infrastructure/preview/preview-paragraph-borders';
import { previewTableHeaderMismatch, previewTableRowMismatch } from '@/lib/infrastructure/preview/preview-table-headers';
import { repairPreviewTableRows, startPreviewRowsOnNewPage } from '@/lib/infrastructure/preview/preview-table-row-repair';
import { previewPageBreakMismatch } from '@/lib/infrastructure/preview/preview-page-breaks';
import { finalizePreviewFlow } from '@/lib/infrastructure/preview/preview-final-flow';
import { installPreviewPrintStyle } from '@/lib/infrastructure/preview/preview-print';
import { isCompositionKey } from '@/lib/editor/keyboard-composition';

export default function PrintPreviewPage() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = host.current!; root.replaceChildren();
    const resources = new AbortController();
    let started = false, disposed = false, ready = false, localPdf = false, totalPages = 0, token = '', preview: Previewer | undefined;
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
        return await current.preview(html, [{ [window.location.href]: css }], root);
      } finally {
        // stop() does not cancel Paged.js's pending CSS/font promises. If they
        // resume after unmount, release anything created after the first cleanup.
        if (disposed) stopLayout(current);
      }
    };
    const releaseResources = () => {
      ready = false;
      stopTracking?.(); stopTracking = undefined;
      removePrintStyle?.(); removePrintStyle = undefined;
      resources.abort();
      stopLayout();
    };
    const send = (data: object) => window.parent.postMessage({ type:'vdoc-preview-status', token, ...data }, window.location.origin);
    const print = () => {
      if (!ready) return;
      try {
        window.print();
        window.parent.postMessage({type:'vdoc-preview-print-result',token},window.location.origin);
      } catch {
        window.parent.postMessage({type:'vdoc-preview-print-result',token,error:'Could not open the print dialog. Your preview is still available. Try Print / Save PDF again.'},window.location.origin);
      }
    };
    const listener = async (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return;
      if (event.data?.type === 'vdoc-preview-connect') {
        if (!started) window.parent.postMessage({type:'vdoc-preview-ready'},window.location.origin);
        else if (event.data.token === token) window.parent.postMessage({type:'vdoc-preview-accepted',token},window.location.origin);
        return;
      }
      if (event.data?.type === 'vdoc-preview-page' && event.data.token === token && ready && Number.isInteger(event.data.page) && event.data.page >= 1 && event.data.page <= totalPages) { root.querySelectorAll('.pagedjs_page')[event.data.page - 1]?.scrollIntoView({block:'start'}); return; }
      if (event.data?.type === 'vdoc-preview-print' && event.data.token === token && ready) { print(); return; }
      if (event.data?.type === 'vdoc-preview-print-mode' && event.data.token === token && ready) { localPdf = event.data.localPdf === true; return; }
      if (event.data?.type !== 'vdoc-preview-render' || started) return;
      started = true; token = event.data.token;
      window.parent.postMessage({type:'vdoc-preview-accepted',token},window.location.origin);
      try {
        const input = event.data.snapshot;
        const source = previewSource(input.title, input.html, input.content);
        document.documentElement.lang = source.language; document.title = input.title;
        const original = document.createElement('div'); original.innerHTML = source.html;
        await waitForPreviewImages(original, resources.signal);
        await document.fonts.ready;
        const { Previewer } = await import('pagedjs');
        if (disposed || !host.current) return;
        let pages = 0;
        let pageCount=0, bottomReserve=0;
        // Final table reflow can differ slightly from the paginator's measuring
        // columns. Repaginate once with real breathing room, keeping the same
        // physical paper size and strict final overflow checks.
        for (let layoutAttempt=0; layoutAttempt<2; layoutAttempt++) {
          let renderHTML=source.html;
          const css=source.css + (bottomReserve ? `
.pagedjs_pagebox > .pagedjs_area > .pagedjs_page_content { height: calc(100% - var(--pagedjs-footnotes-height) - ${bottomReserve}px) !important; }` : '');
          for(let attempt=0;attempt<2;attempt++) {
            preview = new Previewer();
            preview.chunker.hooks.renderNode.register(repeatTableHeaders);
            preview.chunker.hooks.beforePageLayout.register(() => { if (disposed || ++pages > 200) throw new Error('This preview exceeds 200 pages or cannot safely paginate this layout.'); });
            const flow = await renderLayout(preview, renderHTML, css);
            if (disposed) return;
            await waitForPreviewImages(host.current!, resources.signal);
            if (disposed) return;
            // Audit the paginator's complete stream before moving intact cell
            // content into parallel columns (which changes page traversal order).
            if (!previewTextMatches(original, host.current!)) throw new Error('Some text could not be paginated reliably. Return to editing or export Word instead.');
            const retry=repairPreviewTableRows(original,host.current!);
            if(retry.length&&attempt===0) {
              renderHTML=startPreviewRowsOnNewPage(source.html,retry);
              stopLayout();continue;
            }
            pageCount=flow.total;break;
          }
          const compacted=compactPreviewTables(original,host.current!);
          if(compacted) {
            const compactSource=document.createElement('div');compactSource.innerHTML=compacted;
            stopLayout();preview=new Previewer();
            preview.chunker.hooks.renderNode.register(repeatTableHeaders);
            preview.chunker.hooks.beforePageLayout.register(()=>{if(disposed||++pages>200)throw new Error('This preview exceeds 200 pages or cannot safely paginate this layout.');});
            const flow=await renderLayout(preview,compacted,css);
            if(disposed)return;
            await waitForPreviewImages(host.current!,resources.signal);if(disposed)return;
            if(!previewTextMatches(compactSource,host.current!))throw new Error('Some text could not be paginated reliably. Return to editing or export Word instead.');
            pageCount=flow.total;
          }
          finalizePreviewFlow(host.current!);
          finishPreviewParagraphBorders(host.current!);
          const breakMismatch = previewPageBreakMismatch(original, host.current!);
          if (breakMismatch !== null) throw new Error(`A page break was not preserved near page ${breakMismatch}. Return to editing or export Word instead.`);
          const headerMismatch = previewTableHeaderMismatch(original,host.current!);
          if(headerMismatch !== null) throw new Error(`Table headers could not be repeated reliably on page ${headerMismatch}. Return to editing or export Word instead.`);
          const rowMismatch = previewTableRowMismatch(original,host.current!);
          if(rowMismatch !== null) throw new Error(`Table cells became misaligned across pages near page ${rowMismatch}. Split long rows into smaller rows or export Word instead.`);
          const overflow = previewOverflowDetails(host.current!);
          if (overflow !== null) {
            if (layoutAttempt===0 && overflow.edge==='bottom' && overflow.pixels>0 && overflow.pixels<=8) {
              bottomReserve=overflow.pixels+2;
              stopLayout();continue;
            }
            throw new Error(previewOverflowMessage(overflow));
          }
          const marginOverflow = previewMarginOverflow(host.current!);
          if (marginOverflow) throw new Error(`${marginOverflow.part} does not fit on page ${marginOverflow.page}. Increase page margins or shorten the header or footer before printing.`);
          break;
        }
        host.current!.querySelectorAll('.pagedjs_page').forEach((page,index)=>{page.setAttribute('role','region');page.setAttribute('aria-label',`Page ${index+1}`);});
        removePrintStyle = installPreviewPrintStyle(document, input.content);
        totalPages = pageCount; ready = true; send({state:'ready',pages:pageCount,fittedTables:source.fittedTables});
        stopTracking = trackPreviewPage(root, page => window.parent.postMessage({type:'vdoc-preview-current-page',token,page},window.location.origin));
      } catch (error) {
        if (!disposed) {
          // Release failed work before notifying the parent. A delayed parent
          // unmount must not leave a paginator or its styles alive in the frame.
          releaseResources();
          send({state:'error',error:error instanceof Error ? error.message : 'Page preview failed.'});
        }
      }
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isCompositionKey(event)) { event.preventDefault(); window.parent.postMessage({type:'vdoc-preview-close',token},window.location.origin); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        if (!event.repeat && !isCompositionKey(event) && ready) {
          if (localPdf) window.parent.postMessage({type:'vdoc-preview-request-print',token},window.location.origin);
          else print();
        }
      }
    };
    const click = (event: MouseEvent) => { if (event.target instanceof Element && event.target.closest('a')) event.preventDefault(); };
    window.addEventListener('keydown',keyboard); window.addEventListener('click',click);
    window.addEventListener('message', listener);
    window.parent.postMessage({type:'vdoc-preview-ready'}, window.location.origin);
    return () => { disposed = true; releaseResources(); window.removeEventListener('message', listener); window.removeEventListener('keydown',keyboard); window.removeEventListener('click',click); };
  }, []);
  return <><style>{`
    html,body { height:auto!important; overflow:auto!important; margin:0!important; background:#e9edf4!important; }
    #preview-pages { padding:24px; min-width:max-content; }
    .pagedjs_pages { display:flex; flex-direction:column; gap:24px; align-items:center; }
    .pagedjs_page { flex:none; box-shadow:0 1px 10px #26344d20; }
    @media print { html,body { background:white!important; } #preview-pages { padding:0; } .pagedjs_pages { display:block; } .pagedjs_page { box-shadow:none; margin:0; break-after:page; } .pagedjs_page:last-child { break-after:auto; } }
  `}</style><div ref={host} id="preview-pages" aria-label="Paginated document" /></>;
}
