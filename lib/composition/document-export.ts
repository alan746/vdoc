import { CURRENT_DOCUMENT_VERSION } from '../domain/rules/document-migrations';
import type { JSONContent } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { downloadFile } from '../infrastructure/browser/download';
import { exportFilename } from '../infrastructure/export/export-filename';
import { exportHTML } from '../infrastructure/export/html-export';
import { exportPlainText } from '../infrastructure/export/plain-text';

// UI-facing export entry points. Formats and file delivery are bound here so
// components never import exporters or browser download code directly.

export type LocalExportFormat = 'json' | 'html' | 'txt';
export type ExportSource = { title: string; doc: Node; html: string; json: JSONContent };

/** Builds the file for `format` and asks the browser to download it. Throws if the file cannot be prepared. */
export function downloadDocument(format: LocalExportFormat, source: ExportSource) {
  const name = exportFilename(source.title, format === 'json' ? 'vdoc.json' : format);
  if (format === 'txt') downloadFile(name, exportPlainText(source.doc), 'text/plain;charset=utf-8');
  else if (format === 'json') downloadFile(name, JSON.stringify({ version: CURRENT_DOCUMENT_VERSION, title: source.title, content: source.json, savedAt: new Date().toISOString() }, null, 2), 'application/json');
  else downloadFile(name, exportHTML(source.title, source.html, source.json), 'text/html;charset=utf-8');
}

/** Loads the (large) DOCX converter on demand. */
export async function loadWordExporter(): Promise<(content: JSONContent, title: string) => Promise<Blob>> {
  return (await import('../infrastructure/word/word')).exportWord;
}

export const exportFileName = exportFilename;
