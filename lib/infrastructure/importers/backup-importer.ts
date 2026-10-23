import type { FileImporter } from '../../usecases/ports';
import { parseDocument } from '../persistence/document-codec';

/** Native JSON backup; the registry gates supported extensions before decoding. */
export const backupImporter: FileImporter = {
  accepts: () => true,
  async read(file) {
    // JSON syntax/schema validation cannot detect characters already replaced by
    // Blob.text(). Native backups are UTF-8; reject malformed bytes before parsing.
    const bytes = await file.arrayBuffer();
    let raw: string;
    try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('This backup contains invalid UTF-8 text. Choose an intact VDoc backup file.'); }
    return { document: parseDocument(raw), format: 'backup', warnings: [] };
  },
};
