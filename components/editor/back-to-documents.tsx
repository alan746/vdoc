'use client';
import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { actionErrorMessage } from '@/lib/shared/error-message';
import { useDocumentNavigation } from './use-document-navigation';
import { assertAutosaveActive, type SaveBlock } from '@/lib/usecases/document-navigation';
import { documents } from '@/lib/composition/repositories';
import { documentTitle } from '@/lib/domain/entities/document';
import { useMounted } from './use-mounted';

export function BackToDocuments({ editor, title, documentId, blocked, onHome }: {
  editor: Editor; title: string; documentId: string; blocked: SaveBlock; onHome: () => void;
}) {
  const current = useRef({ title, blocked, onHome });
  current.current = { title, blocked, onHome };
  const mounted = useMounted();
  const { navigation, busy } = useDocumentNavigation(editor);
  const [saving, setSaving] = useState(false);

  const leave = async () => {
    if (!mounted.current || !navigation!.acquire()) return;
    setSaving(true);
    try {
      while (mounted.current && !editor.isDestroyed) {
        assertAutosaveActive(current.current.blocked);
        if (navigation!.isComposing()) throw new Error('Finish composing your text before returning to documents.');
        const savedTitle = documentTitle(current.current.title);
        const savedContent = editor.state.doc;
        await documents.save(savedTitle, savedContent.toJSON(), documentId);
        if (!mounted.current || editor.isDestroyed) return;
        // Recheck after storage finishes: typing and renaming remain available
        // during a slow save. Never navigate with a superseded snapshot.
        assertAutosaveActive(current.current.blocked);
        if (navigation!.isComposing()) throw new Error('Finish composing your text before returning to documents.');
        if (savedContent !== editor.state.doc || savedTitle !== (documentTitle(current.current.title))) continue;
        current.current.onHome();
        return;
      }
    } catch (error) {
      if (mounted.current) toast.error(actionErrorMessage(error, 'Save failed. Keep this document open and download a backup.'));
    } finally {
      navigation!.release();
      if (mounted.current) setSaving(false);
    }
  };

  return <><button className="brand-icon" aria-label="Back to documents" title={saving ? 'Saving before leaving…' : 'Back to documents'} disabled={busy} onClick={leave}><FileText size={23} strokeWidth={1.8} /></button><span role="status" className="sr-only">{saving ? 'Saving before returning to documents…' : ''}</span></>;
}
