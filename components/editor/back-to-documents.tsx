'use client';
import type { Editor } from '@tiptap/core';
import { FileText } from 'lucide-react';
import type { SaveBlock } from '@/lib/usecases/document-navigation';
import { useSaveBeforeLeave } from './use-save-before-leave';

export function BackToDocuments({ editor, title, documentId, blocked, onHome }: {
  editor: Editor; title: string; documentId: string; blocked: SaveBlock; onHome: () => void;
}) {
  const { leave, busy, saving } = useSaveBeforeLeave({ editor, title, documentId, blocked });
  return <><button className="brand-icon" aria-label="Back to documents" title={saving ? 'Saving before leaving…' : 'Back to documents'} disabled={busy} onClick={() => void leave(onHome)}><FileText size={23} strokeWidth={1.8} /></button><span role="status" className="sr-only">{saving ? 'Saving before returning to documents…' : ''}</span></>;
}
