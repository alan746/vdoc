'use client';
import { useState } from 'react';
import type { Editor } from '@tiptap/core';
import { toast } from 'sonner';
import { actionErrorMessage } from '@/lib/shared/error-message';
import { useDocumentNavigation } from './use-document-navigation';
import { assertAutosaveActive, type SaveBlock } from '@/lib/usecases/document-navigation';
import { documents } from '@/lib/composition/repositories';
import { documentTitle } from '@/lib/domain/entities/document';
import { useMounted } from './use-mounted';
import { useLatest } from './use-latest';

export function useSaveBeforeLeave({ editor, title, documentId, blocked }: {
  editor: Editor; title: string; documentId: string; blocked: SaveBlock;
}) {
  const current = useLatest({ title, blocked });
  const mounted = useMounted();
  const { navigation, busy } = useDocumentNavigation(editor);
  const [saving, setSaving] = useState(false);

  const leave = async (action: () => void | Promise<void>) => {
    if (!mounted.current || !navigation!.acquire()) return;
    setSaving(true);
    try {
      while (mounted.current && !editor.isDestroyed) {
        assertAutosaveActive(current.current.blocked);
        if (navigation!.isComposing()) throw new Error('Finish composing your text before leaving this document.');
        const savedTitle = documentTitle(current.current.title);
        const savedContent = editor.state.doc;
        await documents.save(savedTitle, savedContent.toJSON(), documentId);
        if (!mounted.current || editor.isDestroyed) return;
        // Recheck after storage finishes: typing and renaming remain available
        // during a slow save. Never navigate with a superseded snapshot.
        assertAutosaveActive(current.current.blocked);
        if (navigation!.isComposing()) throw new Error('Finish composing your text before leaving this document.');
        if (savedContent !== editor.state.doc || savedTitle !== (documentTitle(current.current.title))) continue;
        // Account changes can await a network request; keep this saved snapshot
        // stable until the action completes or fails.
        navigation!.freeze();
        navigation!.confirmSavedDeparture(savedTitle);
        await action();
        return;
      }
    } catch (error) {
      if (mounted.current) toast.error(actionErrorMessage(error, 'Save failed. Keep this document open and download a backup.'));
    } finally {
      navigation!.release();
      if (mounted.current) setSaving(false);
    }
  };

  return { leave, busy, saving };
}
