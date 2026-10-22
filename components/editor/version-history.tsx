'use client';
import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { toast } from 'sonner';
import { actionErrorMessage } from '@/lib/editor/error-message';
import { useDocumentNavigation } from './use-document-navigation';
import { assertAutosaveActive, type SaveBlock } from '@/lib/editor/document-navigation';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { listVersions, saveVersion, restoreVersion, saveDocument, type DocumentVersion, type SavedDocument } from '@/lib/editor/document-store';

export function VersionHistory({ editor, title, documentId, onOpen, blocked = false }: { editor: Editor; title: string; documentId: string; onOpen: (doc: SavedDocument) => void; blocked?: SaveBlock }) {
  const [open, setOpen] = useState(false), [versions, setVersions] = useState<DocumentVersion[]>([]), [label, setLabel] = useState('');
  const [readError, setReadError] = useState('');
  const versionsUnavailable = useRef(true);
  const { navigation, busy } = useDocumentNavigation(editor);
  const mounted = useRef(true), currentTitle = useRef(title); currentTitle.current = title;
  const currentBlocked = useRef(blocked); currentBlocked.current = blocked;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const ensureWritable = () => { assertAutosaveActive(currentBlocked.current); };
  const ensureInputFinished = () => {
    if (navigation!.isComposing()) throw new Error('Finish composing your text before using saved versions.');
  };
  const current = async () => {
    ensureWritable();
    ensureInputFinished();
    const saved = await saveDocument(currentTitle.current.trim() || 'Untitled document', editor.getJSON(), documentId);
    ensureWritable();
    // A slow save can finish after another field starts a candidate. Do not
    // create a checkpoint or replace the visible draft until input completes.
    if (mounted.current && !editor.isDestroyed) ensureInputFinished();
    return saved;
  };
  const perform = async (action: () => Promise<void>) => { if (!mounted.current || !navigation!.acquire()) return; try { await action(); } catch (e) { if (mounted.current) toast.error(actionErrorMessage(e, 'Version could not be saved.')); } finally { navigation!.release(); } };
  const refreshVersions = async (message = 'Saved versions could not be loaded. Retry loading to try again.') => {
    versionsUnavailable.current = true;
    try {
      const entries = await listVersions(documentId);
      if (!mounted.current) return;
      setVersions(entries); setReadError(''); versionsUnavailable.current = false;
    } catch { if (mounted.current) setReadError(message); }
  };
  return <><button className="secondary-button" disabled={busy} onClick={() => perform(async () => { ensureInputFinished(); setOpen(true); setReadError(''); await refreshVersions(); })}>Saved versions</button>
    <Dialog open={open} onOpenChange={value => { if (navigation!.getSnapshot() === 'idle') setOpen(value); }}><DialogContent className="vdoc-dialog"><DialogTitle>Saved versions</DialogTitle><DialogDescription>Keep up to 40 checkpoints for this document on this device. Restoring also saves a copy of your current work.</DialogDescription>
      {readError && <div role="alert" className="library-error"><span>{readError}</span><button type="button" className="secondary-button" disabled={busy} onClick={() => perform(() => refreshVersions(readError))}>Retry loading</button></div>}
      <form onSubmit={e => { e.preventDefault(); void perform(async () => { if (versionsUnavailable.current) return; const saved = await current(); if (!mounted.current) return; await saveVersion(saved, label); if (!mounted.current) return; setLabel(''); await refreshVersions('Your version was saved, but the version list could not be refreshed. Retry loading to see the latest versions.'); }); }}><label>Version name<input value={label} disabled={busy || Boolean(readError)} onChange={e => setLabel(e.target.value)} maxLength={120} placeholder="Before final edits" /></label><button className="export-button" disabled={busy || Boolean(readError)}>Save current version</button></form>
      <div className="local-documents" aria-busy={busy}>{versions.map(v => <button disabled={busy || Boolean(readError)} key={v.key} onClick={() => perform(async () => { if (versionsUnavailable.current) return; navigation!.freeze(); const saved = await current(); if (!mounted.current) return; const doc = await restoreVersion(v.key, saved); if (!mounted.current) return; ensureWritable(); setOpen(false); onOpen(doc); toast.success('Version restored. Previous work is saved in version history.'); })}><strong>{v.label}</strong><span>{new Date(v.createdAt).toLocaleString()} · Restore</span></button>)}{!versions.length && !busy && !readError && <p>No saved versions yet.</p>}</div>
    </DialogContent></Dialog></>;
}
