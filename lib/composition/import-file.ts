import { createDocumentImport } from '../usecases/import-file';
import { wordImporter } from '../infrastructure/importers/word-importer';
import { textImporter } from '../infrastructure/importers/text-importer';
import { backupImporter } from '../infrastructure/importers/backup-importer';

export const { readDocumentImport, importDocumentFile } = createDocumentImport([wordImporter, textImporter, backupImporter]);
