import type { Editor } from '@tiptap/core';
import { toast } from 'sonner';
import { downloadFile } from '@/lib/infrastructure/browser/download';
import { exportHTML } from '@/lib/infrastructure/export/html-export';
import { exportPlainText } from '@/lib/infrastructure/export/plain-text';
import { exportFilename } from '@/lib/infrastructure/export/export-filename';

export function exportLocalDocument(editor: Editor, title: string, format: 'json' | 'html' | 'txt') {
  try {
    const name = exportFilename(title, format === 'json' ? 'vdoc.json' : format);
    if (format === 'txt') downloadFile(name, exportPlainText(editor.state.doc), 'text/plain;charset=utf-8');
    else if (format === 'json') downloadFile(name, JSON.stringify({ version: 1, title, content: editor.getJSON(), savedAt: new Date().toISOString() }, null, 2), 'application/json');
    else downloadFile(name, exportHTML(title, editor.getHTML(), editor.getJSON()), 'text/html;charset=utf-8');
    // Browsers expose the request, not whether the user completed saving the file.
    toast.success('Download requested');
    return true;
  } catch {
    toast.error('Could not prepare the download. Your document is still open. Please try again.');
    return false;
  }
}
