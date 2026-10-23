import { CURRENT_DOCUMENT_VERSION } from '../../domain/rules/document-migrations';
import type { FileImporter } from '../../usecases/ports';
import { parseDocument } from '../persistence/document-codec';

export const wordImporter: FileImporter = {
  accepts: file => /\.docx$/i.test(file.name),
  async read(file, title) {
    // Loaded on demand: the DOCX converter is large and only needed here.
    const { importWord } = await import('../word/word');
    const result = await importWord(await file.arrayBuffer());
    return { document: parseDocument(JSON.stringify({ version: CURRENT_DOCUMENT_VERSION, title, content: result.content, savedAt: new Date().toISOString() }), 20_000_000), format: 'word', warnings: [...new Set(result.warnings.map(message => message.trim()).filter(Boolean))] };
  },
};
