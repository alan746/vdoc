import { type DocumentDraft, UNTITLED_DOCUMENT } from '../domain/entities/document';
import { truncateGraphemePrefix } from '../domain/text/unicode';
import type { DocumentImport } from './ports';
import type { FormatRegistry } from './file-formats';

/** Binds the import use case to format strategies; see lib/composition/import-file for the app wiring. */
export function createDocumentImport(registry: FormatRegistry) {
  // Keep conversion notices separate from the document schema and persisted content.
  async function readDocumentImport(file: File): Promise<DocumentImport> {
    // Backups must be restorable at the same sizes supported by local storage.
    // Word/text conversion still has its own bounded import path.
    const capability = registry.importable.find(format => format.import!.extensions.some(extension => file.name.toLowerCase().endsWith(`.${extension}`))
      && format.import!.strategy.accepts(file))?.import;
    if (!capability) throw new Error('This file type cannot be imported.');
    if (capability.maxBytes !== undefined && file.size > capability.maxBytes) throw new Error(`The file exceeds the ${capability.maxBytes / 1_000_000} MB import limit for this format.`);
    const extension = [...capability.extensions].sort((a, b) => b.length - a.length).find(extension => file.name.toLowerCase().endsWith(`.${extension}`))!;
    const title = truncateGraphemePrefix(file.name.slice(0, -extension.length - 1), 120) || UNTITLED_DOCUMENT;
    return capability.strategy.read(file, title);
  }
  async function importDocumentFile(file: File): Promise<DocumentDraft> {
    return (await readDocumentImport(file)).document;
  }
  return { readDocumentImport, importDocumentFile };
}
