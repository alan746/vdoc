import type { FileExporter, PaginatedExportSource } from '../../usecases/ports';
import { requestLocalPdf, requestLocalPdfToken } from '../pdf/local-pdf';

/** PDF consumes completed sheets; availability/fallback and popup ownership stay in the UI. */
export const pdfExporter: FileExporter<PaginatedExportSource> = {
  async write(source, options) {
    const signal = options?.signal ?? new AbortController().signal;
    // Refresh credentials for each job: a preview can outlive a server restart.
    const token = await requestLocalPdfToken(signal);
    signal.throwIfAborted();
    if (!token) throw new Error('The local PDF service is unavailable. Restart VDoc locally, then try again.');
    return { blob: await requestLocalPdf(source, token, signal) };
  },
};
