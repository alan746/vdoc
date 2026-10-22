'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import { isCompositionKey } from '@/lib/editor/keyboard-composition';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useLocalPdf } from './use-local-pdf';
export type PrintSnapshot = { title: string; html: string; content: JSONContent };
export function PrintPreview({ snapshot, close }: { snapshot: PrintSnapshot; close: () => void }) {
  const [attempt, setAttempt] = useState(0);
  // Each retry owns its frame, token, timer and listeners. Late messages from
  // a failed attempt must never enable printing in the replacement preview.
  return <PrintPreviewSession key={attempt} snapshot={snapshot} close={close} retry={() => setAttempt(current => current + 1)} />;
}
function PrintPreviewSession({ snapshot, close, retry }: { snapshot: PrintSnapshot; close: () => void; retry: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [token] = useState(() => crypto.randomUUID());
  const [status,setStatus] = useState<{state:'loading'|'ready'|'error';pages?:number;error?:string;fittedTables?:number;currentPage?:number}>({state:'loading'});
  const [printError, setPrintError] = useState('');
  const localPdf = useLocalPdf({ getDocument: () => frame.current?.contentDocument ?? null,
    details: { title: snapshot.title, pages: status.pages || 0,
      pageSize: snapshot.content.attrs?.pageSize === 'letter' ? 'letter' : 'a4',
      orientation: snapshot.content.attrs?.orientation === 'landscape' ? 'landscape' : 'portrait' }, onError: setPrintError });
  const requestPrint = useCallback(() => {
    if (status.state !== 'ready') return;
    setPrintError('');
    if (localPdf.available) { localPdf.print(); return; }
    frame.current?.contentWindow?.postMessage({type:'vdoc-preview-print',token},window.location.origin);
  }, [status.state, token, localPdf]);
  useEffect(() => {
    if (!localPdf.available || status.state !== 'ready') return;
    frame.current?.contentWindow?.postMessage({type:'vdoc-preview-print-mode',token,localPdf:true},window.location.origin);
    const handler = (event: MessageEvent) => {
      if (event.source === frame.current?.contentWindow && event.origin === window.location.origin
        && event.data?.type === 'vdoc-preview-request-print' && event.data.token === token) requestPrint();
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [localPdf.available, status.state, token, requestPrint]);
  useEffect(() => {
    // The modal controls live outside the preview iframe. Handle printing here
    // before the editor's window shortcut can replace the open snapshot.
    const keyboard = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'p') return;
      event.preventDefault();
      if (!event.repeat && !isCompositionKey(event)) requestPrint();
    };
    window.addEventListener('keydown', keyboard, true);
    return () => window.removeEventListener('keydown', keyboard, true);
  }, [requestPrint]);
  const send = () => frame.current?.contentWindow?.postMessage({type:'vdoc-preview-render',token,snapshot},window.location.origin);
  useEffect(() => {
    // Either the frame load or its first ready message can precede the other
    // side's listener. Retry only a small handshake until receipt is confirmed.
    let accepted = false, stopped = false;
    let probeTimer: ReturnType<typeof setInterval> | undefined;
    const stopProbe = () => { if (probeTimer !== undefined) clearInterval(probeTimer); probeTimer = undefined; };
    const probe = () => {
      if (!accepted && !stopped && !document.hidden) frame.current?.contentWindow?.postMessage({type:'vdoc-preview-connect',token},window.location.origin);
    };
    const handler = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== window.location.origin) return;
      if (event.data?.type === 'vdoc-preview-ready' && !accepted && !stopped) send();
      if (event.data?.type === 'vdoc-preview-accepted' && event.data.token === token) { accepted = true; stopProbe(); }
      if (event.data?.type === 'vdoc-preview-close' && event.data.token === token) close();
      if (event.data?.type === 'vdoc-preview-status' && event.data.token === token) { accepted = true; stopProbe(); setStatus({...event.data,currentPage:1}); }
      if (event.data?.type === 'vdoc-preview-print-result' && event.data.token === token) setPrintError(event.data.error || '');
      if (event.data?.type === 'vdoc-preview-current-page' && event.data.token === token) {
        const page = event.data.page;
        setStatus(current => current.state === 'ready' && Number.isInteger(page) && page >= 1 && page <= (current.pages || 0) ? {...current,currentPage:page} : current);
      }
    };
    window.addEventListener('message',handler);
    probeTimer = setInterval(probe,1000);
    probe();
    // Background tabs can suspend frame loading/layout. Only spend the wait
    // budget while visible; preserve the remaining budget rather than reset it.
    let remaining = 60000;
    let visibleSince: number | null = null;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const pause = () => {
      if (timeout !== undefined) clearTimeout(timeout);
      timeout = undefined;
      if (visibleSince !== null) remaining = Math.max(0, remaining - (performance.now() - visibleSince));
      visibleSince = null;
    };
    const resume = () => {
      if (document.hidden || visibleSince !== null) return;
      visibleSince = performance.now();
      timeout = setTimeout(() => {
        pause();
        if (!document.hidden) { stopped = true; stopProbe(); setStatus(current => current.state === 'loading' ? {state:'error',error:'Preview is taking too long. Retry the preview, or return to editing and try a smaller document.'} : current); }
      },remaining);
    };
    const visibility = () => { if (document.hidden) pause(); else { resume(); probe(); } };
    document.addEventListener('visibilitychange',visibility);
    resume();
    return () => { stopped = true; stopProbe(); window.removeEventListener('message',handler); document.removeEventListener('visibilitychange',visibility); pause(); };
  }, [snapshot,token]);
  return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className="print-preview-dialog"><div className="print-preview-heading"><div><DialogTitle>Page preview</DialogTitle><DialogDescription>Read-only preview. Return to editing to make changes.</DialogDescription></div><button className="export-button" disabled={status.state!=='ready' || localPdf.preparing} onClick={requestPrint}>{localPdf.preparing ? 'Preparing PDF…' : 'Print / Save PDF'}</button></div><div className="print-preview-controls">{status.state === 'ready' && <label>Go to page<select aria-label="Go to page" value={status.currentPage || 1} onChange={e=>{const page=Number(e.target.value);setStatus(current=>({...current,currentPage:page}));frame.current?.contentWindow?.postMessage({type:'vdoc-preview-page',token,page},window.location.origin);}}>{Array.from({length:status.pages || 0},(_,i)=><option key={i} value={i+1}>{i+1}</option>)}</select></label>}<p role="status" className="print-preview-status">{status.state==='loading'?'Preparing pages…':status.state==='ready'?`${status.pages} ${status.pages === 1 ? 'page' : 'pages'} · ${snapshot.content.attrs?.pageSize === 'letter'?'Letter':'A4'} · ${snapshot.content.attrs?.orientation || 'portrait'}${status.fittedTables ? ' · Wide tables fitted to page; original widths unchanged.' : ''}`:status.error}</p></div>{status.state === 'ready' && localPdf.available && <p className="print-preview-status">Your PDF opens in a new tab with fixed pages. Print or save it using the PDF viewer’s controls.</p>}{status.state === 'ready' && !localPdf.available && <p className="print-preview-status">To match this preview, use 100% scale and {snapshot.content.attrs?.pageSize === 'letter' ? 'Letter' : 'A4'} {snapshot.content.attrs?.orientation === 'landscape' ? 'landscape' : 'portrait'} in the print dialog. Other scales may change page breaks.</p>}{printError && <p role="alert" className="print-preview-status">{printError}</p>}{printError && localPdf.available && !localPdf.preparing && <button className="print-preview-return" onClick={() => { setPrintError(''); frame.current?.contentWindow?.postMessage({type:'vdoc-preview-print',token},window.location.origin); }}>Use browser printing (100% scale)</button>}{status.state === 'error' && <button className="print-preview-return" onClick={retry}>Retry preview</button>}{status.state !== 'error' && <iframe ref={frame} src="/print-preview" title="Paginated document preview" onLoad={send} />}<button className="print-preview-return" onClick={close}>Return to editing</button></DialogContent></Dialog>;
}
