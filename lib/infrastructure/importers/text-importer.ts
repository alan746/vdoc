import { CURRENT_DOCUMENT_VERSION } from '../../domain/rules/document-migrations';
import type { FileImporter } from '../../usecases/ports';
import { decodeTextFile } from '../export/text-import';

export const textImporter: FileImporter = {
  accepts: file => /\.txt$/i.test(file.name),
  async read(file, title) {
    const paragraphs = decodeTextFile(await file.arrayBuffer()).split(/\r\n|\r|\n/).map(text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }));
    return { document: { version: CURRENT_DOCUMENT_VERSION, title, savedAt: new Date().toISOString(), content: { type: 'doc', content: paragraphs } }, format: 'text', warnings: [] };
  },
};
