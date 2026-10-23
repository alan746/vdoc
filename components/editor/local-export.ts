import type { Editor } from '@tiptap/core';
import { toast } from 'sonner';
import { downloadDocument } from '@/lib/composition/document-export';

export function exportLocalDocument(editor: Editor, title: string, format: 'json' | 'html' | 'txt') {
  try {
    downloadDocument(format, { title, doc: editor.state.doc, html: editor.getHTML(), json: editor.getJSON() });
    // Browsers expose the request, not whether the user completed saving the file.
    toast.success('Download requested');
    return true;
  } catch {
    toast.error('Could not prepare the download. Your document is still open. Please try again.');
    return false;
  }
}
