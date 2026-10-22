import { randomBytes } from 'node:crypto';
import { findPdfBrowser, PDF_REQUEST_LIMIT, renderLocalPdf, validatePdfSnapshot } from './local-pdf.mjs';

export const LOCAL_PDF_PATH = '/__vdoc/local-pdf';
const addresses = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const hosts = new Set(['localhost', '127.0.0.1', '[::1]']);

export function createLocalPdfHandler({ render = renderLocalPdf, findBrowser = findPdfBrowser } = {}) {
  const token = randomBytes(32).toString('hex');
  let busy = false;
  return async (request, response, next) => {
    if (request.url?.split('?')[0] !== LOCAL_PDF_PATH) { next(); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const json = (status, value) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value));
    };
    let origin;
    try {
      const url = new URL(`${request.socket.encrypted ? 'https' : 'http'}://${request.headers.host}`);
      if (!hosts.has(url.hostname) || !addresses.has(request.socket.remoteAddress)
        || Number(url.port || (url.protocol === 'https:' ? 443 : 80)) !== request.socket.localPort) throw new Error('Not a local origin');
      origin = url.origin;
    } catch { json(403, { error: 'Local PDF export is only available on this device.' }); return; }
    if (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin' && request.headers['sec-fetch-site'] !== 'none') {
      json(403, { error: 'Open PDF export from VDoc.' }); return;
    }
    if (request.method === 'GET') {
      const available = Boolean(await findBrowser());
      json(available ? 200 : 503, available ? { version: 1, token } : { error: 'Local PDF renderer unavailable.' }); return;
    }
    if (request.method !== 'POST') { response.setHeader('Allow', 'GET, POST'); json(405, { error: 'Method not allowed.' }); return; }
    if (request.headers.origin !== origin || request.headers['x-vdoc-pdf-token'] !== token) {
      json(403, { error: 'PDF export session expired. Reopen the preview.' }); return;
    }
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') { json(415, { error: 'Expected a document snapshot.' }); return; }
    if (busy) { json(409, { error: 'Another PDF is being prepared. Try again when it finishes.' }); return; }
    if (Number(request.headers['content-length']) > PDF_REQUEST_LIMIT) { json(413, { error: 'This document is too large for local PDF export.' }); return; }
    const abort = new AbortController();
    const disconnect = () => { if (!response.writableEnded) abort.abort(); };
    response.once('close', disconnect);
    const readTimer = setTimeout(() => { abort.abort(); json(408, { error: 'The document upload timed out.' }); request.destroy(); }, 20000);
    let acquired = false;
    try {
      let size = 0; const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > PDF_REQUEST_LIMIT) { json(413, { error: 'This document is too large for local PDF export.' }); return; }
        chunks.push(chunk);
      }
      clearTimeout(readTimer);
      if (abort.signal.aborted) return;
      let snapshot;
      try { snapshot = validatePdfSnapshot(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { json(400, { error: 'The paginated document could not be read. Reopen the preview.' }); return; }
      if (busy) { json(409, { error: 'Another PDF is being prepared. Try again when it finishes.' }); return; }
      busy = true; acquired = true;
      const bytes = await render(snapshot, { signal: abort.signal });
      if (abort.signal.aborted || response.destroyed) return;
      const filename = (snapshot.title.replace(/[\x00-\x1f\x7f/\\]/g, '').trim().slice(0, 100) || 'Document') + '.pdf';
      response.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': bytes.length,
        'Content-Disposition': `inline; filename="Document.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}` });
      response.end(bytes);
    } catch {
      json(503, { error: 'Could not prepare the PDF. Your document is unchanged. Try again, or use browser printing.' });
    } finally {
      clearTimeout(readTimer); response.removeListener('close', disconnect);
      if (acquired) busy = false;
    }
  };
}
