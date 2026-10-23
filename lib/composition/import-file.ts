import { createDocumentImport } from '../usecases/import-file';
import { fileFormats } from './file-formats';

export const { readDocumentImport, importDocumentFile } = createDocumentImport(fileFormats);
