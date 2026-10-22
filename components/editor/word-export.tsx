'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { toast } from 'sonner';
import { exportFilename } from '@/lib/editor/export-filename';

type Download = { url: string; name: string; staticChecklist: boolean; changedSinceStart: boolean };

export function useWordExport(editor: Editor | null, title: string) {
  const [busy, setBusy] = useState(false), [download, setDownload] = useState<Download | null>(null);
  const mounted = useRef(true), pending = useRef(false), generation = useRef(0), url = useRef<string | null>(null);
  const prepared = useRef<{ doc: Node; title: string } | null>(null);
  const currentTitle = useRef(title); currentTitle.current = title;
  const release = useCallback(() => { if (url.current) URL.revokeObjectURL(url.current); url.current = null; prepared.current = null; }, []);
  const refreshSnapshotStatus = useCallback(() => {
    const snapshot = prepared.current;
    if (!snapshot || !editor || editor.isDestroyed) return;
    const changedSinceStart = !snapshot.doc.eq(editor.state.doc) || snapshot.title !== currentTitle.current;
    setDownload(current => current && current.changedSinceStart !== changedSinceStart ? { ...current, changedSinceStart } : current);
  }, [editor]);
  useEffect(() => {
    mounted.current = true; pending.current = false; setBusy(false); setDownload(null);
    return () => { mounted.current = false; generation.current++; pending.current = false; release(); };
  }, [editor, release]);
  useEffect(() => {
    editor?.on('update', refreshSnapshotStatus);
    return () => { editor?.off('update', refreshSnapshotStatus); };
  }, [editor, refreshSnapshotStatus]);
  useEffect(refreshSnapshotStatus, [title, refreshSnapshotStatus]);
  const close = useCallback(() => { release(); setDownload(null); }, [release]);
  const request = useCallback(async () => {
    if (!editor || editor.isDestroyed || !mounted.current || pending.current) return;
    pending.current = true; setBusy(true); release(); setDownload(null);
    const job = ++generation.current, snapshot = editor.state.doc, snapshotTitle = currentTitle.current;
    const content = snapshot.toJSON();
    let staticChecklist = false;
    snapshot.descendants(node => { if (node.type.name === 'taskList') staticChecklist = true; });
    const current = () => mounted.current && !editor.isDestroyed && generation.current === job;
    try {
      const { exportWord } = await import('@/lib/editor/word');
      if (!current()) return;
      const blob = await exportWord(content, snapshotTitle);
      if (!current()) return;
      const nextUrl = URL.createObjectURL(blob); url.current = nextUrl;
      prepared.current = { doc: snapshot, title: snapshotTitle };
      setDownload({ url: nextUrl, name: exportFilename(snapshotTitle, 'docx'), staticChecklist,
        changedSinceStart: !snapshot.eq(editor.state.doc) || snapshotTitle !== currentTitle.current });
    } catch (error) {
      if (current()) toast.error(error instanceof Error ? error.message : 'Word export failed.');
    } finally {
      if (mounted.current && generation.current === job) { pending.current = false; setBusy(false); }
    }
  }, [editor, release]);
  return { busy, download, request, close };
}

export function WordExportFeedback({ state }: { state: ReturnType<typeof useWordExport> }) {
  const { busy, download, close, request } = state;
  return <>
    {busy && <div className="export-progress" role="status">Preparing Word document… You can keep editing.</div>}
    {download && <section className="export-progress export-ready" aria-label="Word export">
      <div className="export-ready-details">
        <p role="status"><strong>Word document ready.</strong> Save it to your device below.</p>
        {download.changedSinceStart && <p role="status">This file contains the version from when you started exporting. Your later edits are still in the document.</p>}
        {download.staticChecklist && <p>Checklists are exported as static checkbox symbols. Save a VDoc backup to keep interactive checkboxes and their settings.</p>}
      </div>
      <div className="export-ready-actions">
        {download.changedSinceStart && <button className="secondary-button" onClick={request}>Regenerate with latest edits</button>}
        <a className="export-button" href={download.url} download={download.name}>Download {download.name}</a>
        <button className="quiet-button" aria-label="Dismiss Word download" onClick={close}>Dismiss</button>
      </div>
    </section>}
  </>;
}
