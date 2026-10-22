import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';

export const PDF_REQUEST_LIMIT = 16 * 1024 * 1024;
const PDF_OUTPUT_LIMIT = 32 * 1024 * 1024;

export async function findPdfBrowser() {
  const configured = process.env.VDOC_PDF_CHROME;
  const candidates = configured ? [configured] : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const path of candidates) {
    if (!isAbsolute(path)) continue;
    try { await access(path, constants.X_OK); return path; } catch { /* Try the next installed browser. */ }
  }
  return null;
}

export function validatePdfSnapshot(input) {
  if (!input || typeof input !== 'object' || typeof input.html !== 'string' || typeof input.css !== 'string'
    || typeof input.title !== 'string' || input.title.length > 500
    || !Number.isInteger(input.pages) || input.pages < 1 || input.pages > 200
    || !['a4', 'letter'].includes(input.pageSize) || !['portrait', 'landscape'].includes(input.orientation)
    || !input.html.includes('id="preview-pages"')
    || Buffer.byteLength(input.html) + Buffer.byteLength(input.css) > PDF_REQUEST_LIMIT) {
    throw new Error('Invalid paginated document.');
  }
  return input;
}

// The browser is a disposable renderer, connected by private pipes. It never
// attaches to a running browser, loads a personal profile, or exposes a CDP port.
/**
 * @param {unknown} input
 * @param {{ executablePath?: string, signal?: AbortSignal, timeoutMs?: number }} [options]
 * @returns {Promise<Buffer>}
 */
export async function renderLocalPdf(input, { executablePath, signal, timeoutMs = 45000 } = {}) {
  const snapshot = validatePdfSnapshot(input);
  signal?.throwIfAborted();
  const executable = executablePath || await findPdfBrowser();
  if (!executable) throw new Error('A local Chrome or Chromium installation is required for PDF export.');
  const profile = await mkdtemp(join(tmpdir(), 'vdoc-pdf-'));
  const deadline = AbortSignal.timeout(timeoutMs);
  const cancellation = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let child, closePromise, onAbort;
  const pending = new Map();
  let id = 0, incoming = Buffer.alloc(0), closed = false;
  const fail = error => { for (const request of pending.values()) request.reject(error); pending.clear(); };
  try {
    cancellation.throwIfAborted();
    child = spawn(executable, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-default-apps',
      '--renderer-process-limit=2', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    closePromise = new Promise(resolve => child.once('close', resolve));
    child.once('error', error => { closed = true; fail(error); });
    child.once('exit', () => { closed = true; fail(new Error('The PDF renderer stopped before export finished.')); });
    onAbort = () => { fail(new Error('PDF export cancelled or timed out.')); child.kill('SIGTERM'); };
    cancellation.addEventListener('abort', onAbort, { once: true });
    child.stdio[3].on('error', fail);
    child.stdio[4].on('data', chunk => {
      incoming = Buffer.concat([incoming, chunk]);
      if (incoming.length > PDF_OUTPUT_LIMIT * 1.5) { onAbort(); return; }
      let end;
      while ((end = incoming.indexOf(0)) !== -1) {
        const raw = incoming.subarray(0, end); incoming = incoming.subarray(end + 1);
        let message;
        try { message = JSON.parse(raw.toString()); } catch { fail(new Error('Invalid renderer response.')); child.kill('SIGTERM'); return; }
        const request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
      }
    });
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      if (closed || cancellation.aborted) { reject(new Error('PDF renderer unavailable.')); return; }
      const requestId = ++id; pending.set(requestId, { resolve, reject });
      child.stdio[3].write(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    const pageCall = (method, params) => call(method, params, sessionId);
    await pageCall('Page.enable');
    await pageCall('Emulation.setScriptExecutionDisabled', { value: true });
    await pageCall('Network.enable');
    await pageCall('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'file://*', 'ftp://*', 'ws://*', 'wss://*'] });
    const { frameTree } = await pageCall('Page.getFrameTree');
    // CSP is before all submitted markup. Only embedded images/fonts and styles
    // are permitted; scripts, frames, forms, external resources and base URLs are denied.
    const csp = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'";
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${snapshot.css.replace(/<\/style/gi, '<\\/style')}</style></head><body>${snapshot.html}</body></html>`;
    await pageCall('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
    const ready = await pageCall('Runtime.evaluate', { awaitPromise: true, returnByValue: true,
      expression: `(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));return {pages:document.querySelectorAll('#preview-pages .pagedjs_page').length,text:document.querySelector('#preview-pages')?.textContent?.length||0};})()` });
    if (ready.exceptionDetails || ready.result?.value?.pages !== snapshot.pages || !ready.result.value.text) {
      throw new Error('The PDF renderer could not load the complete preview.');
    }
    const paper = snapshot.pageSize === 'letter' ? [8.5, 11] : [210 / 25.4, 297 / 25.4];
    const { data } = await pageCall('Page.printToPDF', { printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: false, scale: 1, paperWidth: paper[0], paperHeight: paper[1],
      landscape: snapshot.orientation === 'landscape', marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > PDF_OUTPUT_LIMIT || bytes.subarray(0, 5).toString() !== '%PDF-') throw new Error('Invalid PDF output.');
    return bytes;
  } finally {
    if (onAbort) cancellation.removeEventListener('abort', onAbort);
    fail(new Error('PDF renderer closed.'));
    if (child) {
      if (!closed) child.kill('SIGTERM');
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 2000);
      await closePromise;
      clearTimeout(killTimer);
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}
