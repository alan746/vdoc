'use client';
import { useEffect, useRef } from 'react';
import { createPrintPreviewRenderer } from '@/lib/composition/print-preview';
import { isCompositionKey } from '@/lib/editor/keyboard-composition';

export default function PrintPreviewPage() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = host.current!; root.replaceChildren();
    const renderer = createPrintPreviewRenderer(root, document);
    let started = false, disposed = false, ready = false, localPdf = false, totalPages = 0, token = '';
    const releaseResources = () => { ready = false; renderer.release(); };
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
      if (event.data?.type === 'vdoc-preview-page' && event.data.token === token && ready && Number.isInteger(event.data.page) && event.data.page >= 1 && event.data.page <= totalPages) { renderer.scrollToPage(event.data.page); return; }
      if (event.data?.type === 'vdoc-preview-print' && event.data.token === token && ready) { print(); return; }
      if (event.data?.type === 'vdoc-preview-print-mode' && event.data.token === token && ready) { localPdf = event.data.localPdf === true; return; }
      if (event.data?.type !== 'vdoc-preview-render' || started) return;
      started = true; token = event.data.token;
      window.parent.postMessage({type:'vdoc-preview-accepted',token},window.location.origin);
      try {
        const result = await renderer.render(event.data.snapshot);
        if (!result) return;
        totalPages = result.pages; ready = true; send({state:'ready',pages:result.pages,fittedTables:result.fittedTables});
        renderer.trackPages(page => window.parent.postMessage({type:'vdoc-preview-current-page',token,page},window.location.origin));
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
    return () => { disposed = true; ready = false; renderer.dispose(); window.removeEventListener('message', listener); window.removeEventListener('keydown',keyboard); window.removeEventListener('click',click); };
  }, []);
  return <><style>{`
    html,body { height:auto!important; overflow:auto!important; margin:0!important; background:#e9edf4!important; }
    #preview-pages { padding:24px; min-width:max-content; }
    .pagedjs_pages { display:flex; flex-direction:column; gap:24px; align-items:center; }
    .pagedjs_page { flex:none; box-shadow:0 1px 10px #26344d20; }
    @media print { html,body { background:white!important; } #preview-pages { padding:0; } .pagedjs_pages { display:block; } .pagedjs_page { box-shadow:none; margin:0; break-after:page; } .pagedjs_page:last-child { break-after:auto; } }
  `}</style><div ref={host} id="preview-pages" aria-label="Paginated document" /></>;
}
