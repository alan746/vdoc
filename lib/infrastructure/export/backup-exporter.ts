import type { FileExporter } from '../../usecases/ports';
import { CURRENT_DOCUMENT_VERSION } from '../../domain/rules/document-migrations';

export const backupExporter: FileExporter = {
  write(source) {
    const data = JSON.stringify({ version: CURRENT_DOCUMENT_VERSION, title: source.title, content: source.json, savedAt: new Date().toISOString() }, null, 2);
    return { blob: new Blob([data], { type: 'application/json' }) };
  },
};
