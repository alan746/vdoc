import { type DocumentDraft, UNTITLED_DOCUMENT } from '../domain/entities/document';
import { truncateGraphemePrefix } from '../domain/text/unicode';
import type { FileImporter, DocumentImport } from './ports';

/** Binds the import use case to format strategies; see lib/composition/import-file for the app wiring. */
export function createDocumentImport(importers: readonly FileImporter[]) {
  // Keep conversion notices separate from the document schema and persisted content.
  async function readDocumentImport(file: File): Promise<DocumentImport> {
    // Backups must be restorable at the same sizes supported by local storage.
    // Word/text conversion still has its own bounded import path.
    if (!/\.json$/i.test(file.name) && file.size > 20_000_000) throw new Error('The file exceeds the 20 MB import limit for Word and text files.');
    const title = truncateGraphemePrefix(file.name.replace(/\.(docx|txt)$/i, ''), 120) || UNTITLED_DOCUMENT;
    const importer = importers.find(candidate => candidate.accepts(file));
    if (!importer) throw new Error('This file type cannot be imported.');
    return importer.read(file, title);
  }
  async function importDocumentFile(file: File): Promise<DocumentDraft> {
    return (await readDocumentImport(file)).document;
  }
  return { readDocumentImport, importDocumentFile };
}
