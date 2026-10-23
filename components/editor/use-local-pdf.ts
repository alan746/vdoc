'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { captureLocalPdf, requestLocalPdfToken, type LocalPdfSnapshot } from '@/lib/composition/local-pdf';
import { exportPaginatedFile } from '@/lib/composition/document-export';

export function useLocalPdf({ getDocument, details, onError }: {
  getDocument: () => Document | null;
  details: Omit<LocalPdfSnapshot, 'html' | 'css'>;
  onError: (message: string) => void;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const job = useRef<AbortController | null>(null);
  const disposed = useRef(false);
  useEffect(() => {
    disposed.current = false;
    const probe = new AbortController();
    const timeout = setTimeout(() => probe.abort(), 3000);
    if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
      void requestLocalPdfToken(probe.signal).then(value => {
        if (!disposed.current && !probe.signal.aborted && value) setToken(value);
      }).catch(() => {}).finally(() => clearTimeout(timeout));
    } else clearTimeout(timeout);
    return () => { disposed.current = true; probe.abort(); clearTimeout(timeout); job.current?.abort(); };
  }, []);
  const print = useCallback(() => {
    if (!token || job.current) return;
    // Open during the click/keyboard gesture, before asynchronous rendering.
    // Only this newly created tab is ever navigated or closed by this hook.
    const tab = window.open('about:blank', '_blank');
    if (!tab) { onError('Allow a new tab for VDoc to open the printable PDF, then try again.'); return; }
    tab.opener = null;
    tab.document.title = 'Preparing VDoc PDF';
    tab.document.body.textContent = 'Preparing your PDF…';
    const controller = new AbortController(); job.current = controller; setPreparing(true); onError('');
    const timer = setTimeout(() => controller.abort(), 55000);
    void (async () => {
      if (disposed.current || tab.closed) return;
      const document = getDocument();
      if (!document) throw new Error('Preview is unavailable. Reopen it before printing.');
      const snapshot = captureLocalPdf(document, details);
      const { blob } = await exportPaginatedFile('pdf', snapshot, { signal: controller.signal });
      if (controller.signal.aborted || disposed.current || tab.closed) return;
      const url = URL.createObjectURL(blob);
      tab.location.replace(url);
      // The PDF tab has time to load; this bounds retained object-URL memory.
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    })().catch(error => {
      if (!tab.closed) tab.close();
      if (!disposed.current) onError(controller.signal.aborted ? 'PDF preparation timed out. Your document is unchanged. Try again.' : error.message);
    }).finally(() => {
      clearTimeout(timer); job.current = null;
      if (controller.signal.aborted && !tab.closed) tab.close();
      if (!disposed.current) setPreparing(false);
    });
  }, [token, details, getDocument, onError]);
  return { available: Boolean(token), preparing, print };
}
