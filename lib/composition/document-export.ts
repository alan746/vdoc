import type { DocumentExportSource } from '../usecases/ports';
import { createFileExport, type ExportedFile } from '../usecases/export-file';
import { downloadBlob } from '../infrastructure/browser/download';
import { exportFilename } from '../infrastructure/export/export-filename';
import { fileFormats } from './file-formats';

export const { exportDocument: exportDocumentFile, exportPages: exportPaginatedFile } = createFileExport(fileFormats, exportFilename);

/** Preserve immediate delivery for synchronous formats; async strategies use
 * the same contract without adding another component dispatch branch. */
export function downloadDocument(format: string, source: DocumentExportSource) {
  const capability = fileFormats.get(format).export;
  if (capability?.kind !== 'document' || capability.delivery !== 'download') throw new Error('This format requires its export preparation flow.');
  const file = exportDocumentFile(format, source);
  const deliver = (file: ExportedFile) => downloadBlob(file.name, file.blob);
  return file instanceof Promise ? file.then(deliver) : deliver(file);
}
