'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { toast } from 'sonner';
import { exportDocumentFile } from '@/lib/composition/document-export';
import { fileFormats } from '@/lib/composition/file-formats';
import type { ExportNotice } from '@/lib/usecases/ports';
import { useLatest } from './use-latest';

type Download = { url: string; name: string; formatId: string; label: string; notices: readonly ExportNotice[]; changedSinceStart: boolean };

export function usePreparedExport(editor: Editor | null, title: string) {
  const [busy, setBusy] = useState(false), [download, setDownload] = useState<Download | null>(null);
  const [busyFormat, setBusyFormat] = useState<string | null>(null);
  // A different editor is a different document: drop the previous export's state.
  const [owner, setOwner] = useState(editor);
  if (owner !== editor) { setOwner(editor); setBusy(false); setBusyFormat(null); setDownload(null); }
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true), pending = useRef(false), generation = useRef(0), url = useRef<string | null>(null);
  const prepared = useRef<{ doc: Node; title: string } | null>(null);
  const currentTitle = useLatest(title);
  const release = useCallback(() => { controller.current?.abort(); controller.current = null; if (url.current) URL.revokeObjectURL(url.current); url.current = null; prepared.current = null; }, []);
  const refreshSnapshotStatus = useCallback(() => {
    const snapshot = prepared.current;
    if (!snapshot || !editor || editor.isDestroyed) return;
    const changedSinceStart = !snapshot.doc.eq(editor.state.doc) || snapshot.title !== currentTitle.current;
    setDownload(current => current && current.changedSinceStart !== changedSinceStart ? { ...current, changedSinceStart } : current);
  }, [editor, currentTitle]);
  useEffect(() => {
    mounted.current = true; pending.current = false;
    // A counter, not a DOM ref: bumping it invalidates work still in flight.
    const counter = generation;
    return () => { mounted.current = false; counter.current++; pending.current = false; release(); };
  }, [editor, release]);
  useEffect(() => {
    editor?.on('update', refreshSnapshotStatus);
    return () => { editor?.off('update', refreshSnapshotStatus); };
  }, [editor, refreshSnapshotStatus]);
  useEffect(refreshSnapshotStatus, [title, refreshSnapshotStatus]);
  const close = useCallback(() => { release(); setDownload(null); }, [release]);
  const request = useCallback(async (formatId: string) => {
    if (!editor || editor.isDestroyed || !mounted.current || pending.current) return;
    pending.current = true; setBusy(true); setBusyFormat(formatId); release(); setDownload(null);
    const abort = new AbortController(); controller.current = abort;
    const job = ++generation.current, snapshot = editor.state.doc, snapshotTitle = currentTitle.current;
    const current = () => mounted.current && !editor.isDestroyed && generation.current === job;
    try {
      const format = fileFormats.get(formatId);
      const { blob, name, notices = [] } = await exportDocumentFile(formatId,
        { title: snapshotTitle, doc: snapshot, json: snapshot.toJSON(), html: editor.getHTML() }, { signal: abort.signal });
      if (!current()) return;
      const nextUrl = URL.createObjectURL(blob); url.current = nextUrl;
      prepared.current = { doc: snapshot, title: snapshotTitle };
      setDownload({ url: nextUrl, name, formatId, label: format.label, notices,
        changedSinceStart: !snapshot.eq(editor.state.doc) || snapshotTitle !== currentTitle.current });
    } catch (error) {
      if (current()) toast.error(error instanceof Error ? error.message : 'File export failed.');
    } finally {
      if (mounted.current && generation.current === job) { pending.current = false; setBusy(false); }
    }
  }, [editor, release, currentTitle]);
  return { busy, busyFormat, download, request, close };
}

export function PreparedExportFeedback({ state }: { state: ReturnType<typeof usePreparedExport> }) {
  const { busy, download, close, request } = state;
  return <>
    {busy && <div className="export-progress" role="status">Preparing {state.busyFormat ? fileFormats.get(state.busyFormat).label : 'document'} document… You can keep editing.</div>}
    {download && <section className="export-progress export-ready" aria-label={`${download.label} export`}>
      <div className="export-ready-details">
        <p role="status"><strong>{download.label} document ready.</strong> Save it to your device below.</p>
        {download.changedSinceStart && <p role="status">This file contains the version from when you started exporting. Your later edits are still in the document.</p>}
        {download.notices.map(notice => <p key={notice.code}>{notice.message}</p>)}
      </div>
      <div className="export-ready-actions">
        {download.changedSinceStart && <button className="secondary-button" onClick={() => request(download.formatId)}>Regenerate with latest edits</button>}
        <a className="export-button" href={download.url} download={download.name}>Download {download.name}</a>
        <button className="quiet-button" aria-label={`Dismiss ${download.label} download`} onClick={close}>Dismiss</button>
      </div>
    </section>}
  </>;
}
