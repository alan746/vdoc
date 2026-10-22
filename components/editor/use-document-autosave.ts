'use client';
import { useCallback, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { startAutosave, type InputComposition } from '@/lib/editor/autosave';

export function useDocumentAutosave(editor: Editor | null, documentId: string, title: string,
  blocked: { current: boolean }, report: (status: string, warning?: string) => void, composition?: InputComposition) {
  const current = useRef({ title, report }); current.current = { title, report };
  const controller = useRef<ReturnType<typeof startAutosave> | null>(null);
  useEffect(() => {
    if (!editor) return;
    const save = startAutosave(editor, documentId, { getTitle: () => current.current.title, blocked, composition,
      report: (status, warning) => current.current.report(status, warning) });
    controller.current = save;
    return () => { save.dispose(); controller.current = null; };
  }, [editor, documentId, blocked, composition?.active, composition?.subscribe]);
  useEffect(() => { controller.current?.schedule(); }, [title]);
  // Reuse the serialized save queue and its pause/navigation guards.
  return useCallback(() => { void controller.current?.flush(); }, []);
}
