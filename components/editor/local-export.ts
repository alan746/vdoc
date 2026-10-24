import type { Editor } from '@tiptap/core';
import { toast } from 'sonner';
import { downloadDocument } from '@/lib/composition/document-export';
import { createExportSnapshot } from '@/lib/editor/export-snapshot';

export function exportLocalDocument(editor: Editor, title: string, format: string) {
  const success = () => { toast.success('Download requested'); return true; };
  const failure = () => { toast.error('Could not prepare the download. Your document is still open. Please try again.'); return false; };
  try {
    const result = downloadDocument(format, createExportSnapshot(editor.state.doc, title));
    // Browsers expose the request, not whether the user completed saving the file.
    return result instanceof Promise ? result.then(success, failure) : success();
  } catch {
    return failure();
  }
}
