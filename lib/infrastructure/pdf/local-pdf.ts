import type { PaginatedExportSource } from '../../usecases/ports';
export const LOCAL_PDF_ENDPOINT = '/__vdoc/local-pdf';
export type LocalPdfSnapshot = PaginatedExportSource;

export async function requestLocalPdfToken(signal: AbortSignal): Promise<string | null> {
  const response = await fetch(LOCAL_PDF_ENDPOINT, { signal, cache: 'no-store' });
  if (!response.ok) return null;
  const value: unknown = await response.json();
  return value && typeof value === 'object' && 'version' in value && value.version === 1
    && 'token' in value && typeof value.token === 'string' && /^[a-f0-9]{64}$/.test(value.token)
    ? value.token : null;
}

export function captureLocalPdf(document: Document, details: Omit<LocalPdfSnapshot, 'html' | 'css'>): LocalPdfSnapshot {
  const host = document.querySelector('#preview-pages');
  if (!host || host.querySelectorAll('.pagedjs_page').length !== details.pages) throw new Error('Preview changed. Reopen it before printing.');
  if ([...host.querySelectorAll('img')].some(image => !image.complete || !image.naturalWidth || !image.src.startsWith('data:'))) {
    throw new Error('Some preview images are not ready. Reopen the preview and try again.');
  }
  const css = [...document.styleSheets].map(sheet => [...sheet.cssRules].map(rule => rule.cssText).join('\n')).join('\n');
  return { ...details, css, html: host.outerHTML };
}

export async function requestLocalPdf(snapshot: LocalPdfSnapshot, token: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(LOCAL_PDF_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-VDoc-PDF-Token': token },
    body: JSON.stringify(snapshot), signal });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
      ? result.error : 'Could not prepare the PDF. Your document is unchanged.');
  }
  if (response.headers.get('Content-Type')?.split(';')[0] !== 'application/pdf') throw new Error('The PDF service returned an unexpected response.');
  const blob = await response.blob();
  if (blob.size < 5 || blob.size > 32 * 1024 * 1024 || await blob.slice(0, 5).text() !== '%PDF-') throw new Error('The PDF service returned an invalid file.');
  return blob;
}
