'use client';
import type { Editor } from '@tiptap/core';
import { usePreparedExport, PreparedExportFeedback } from './prepared-export';

/** Compatibility entry for callers requesting Word specifically. The shared
 * preparation UI and registry also handle newly registered async exporters. */
export function useWordExport(editor: Editor | null, title: string) {
  const state = usePreparedExport(editor, title);
  return { ...state, request: () => state.request('docx'),
    download: state.download ? { ...state.download, staticChecklist: state.download.notices.some(notice => notice.code === 'static-checklist') } : null };
}
export const WordExportFeedback = PreparedExportFeedback;
