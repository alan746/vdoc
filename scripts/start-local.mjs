import { createServer, request as requestHttp } from 'node:http';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLocalPdfHandler } from './local-pdf-handler.mjs';

export function localStartOptions(args) {
  const options = { port: 8787, ip: '127.0.0.1', persistTo: '.wrangler/state' };
  for (let i = 0; i < args.length; i++) {
    const [name, inline] = args[i].split('=', 2);
    if (!['--port', '--ip', '--persist-to'].includes(name)) throw new Error(`Unsupported local start option: ${name}`);
    const value = inline ?? args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
    if (name === '--port') options.port = Number(value);
    else if (name === '--ip') options.ip = value;
    else options.persistTo = value;
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('Invalid local port.');
  if (!['127.0.0.1', '::1'].includes(options.ip)) throw new Error('Local VDoc must bind to a loopback address.');
  return options;
}

export async function startLocalApp(options, { signal } = {}) {
  signal?.throwIfAborted();
  await import('./sites-env.mjs');
  await access(new URL('../dist/server/wrangler.json', import.meta.url)).catch(() => { throw new Error('Build VDoc first with npm run build.'); });
  const pdf = createLocalPdfHandler();
  let workerPort, child, closing, readyTimer, resolveReady, rejectReady;
  let workerClosed = Promise.resolve(), resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  const server = createServer((req, res) => {
    let url;
    try {
      url = new URL(`http://${req.headers.host}`);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || Number(url.port || 80) !== server.address().port) throw new Error();
    } catch { res.writeHead(403); res.end('Open VDoc from its local address.'); return; }
    const proxy = () => {
      if (!workerPort) { res.writeHead(503, { 'Retry-After': '1' }); res.end('VDoc is starting.'); return; }
      const upstream = requestHttp({ hostname: '127.0.0.1', port: workerPort, method: req.method, path: req.url,
        headers: { ...req.headers, connection: 'close' } }, incoming => {
        res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
        incoming.on('error', () => res.destroy());
      });
      upstream.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('VDoc is temporarily unavailable.'); } else res.destroy(); });
      req.on('aborted', () => upstream.destroy());
      res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
      req.pipe(upstream);
    };
    void pdf(req, res, proxy).catch(() => { if (!res.headersSent) { res.writeHead(503); res.end('Local PDF export is unavailable.'); } else res.destroy(); });
  });
  const close = () => {
    closing ??= (async () => {
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(readyTimer);
      rejectReady?.(new Error('Local VDoc stopped before startup completed.'));
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const killTimer = setTimeout(() => child?.kill('SIGKILL'), 5000);
      await workerClosed; clearTimeout(killTimer); resolveClosed();
    })();
    return closing;
  };
  const onAbort = () => { void close(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port, options.ip, resolve); });
    signal?.throwIfAborted();
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // Port 0 belongs to this child; use only its actual readiness report. Never
    // attach to or reuse an already-running worker on a guessed port.
    child = spawn(process.execPath, ['--import', fileURLToPath(new URL('./sites-env.mjs', import.meta.url)),
      fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)), 'dev',
      '--config', 'dist/server/wrangler.json', '--local', '--persist-to', options.persistTo,
      '--ip', '127.0.0.1', '--port', '0', '--inspector-port', '0'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
    workerClosed = new Promise(resolve => child.once('close', resolve));
    child.once('error', error => rejectReady(error));
    child.once('exit', (code, signal) => {
      rejectReady(new Error(`Local Worker exited (${code ?? signal}).`));
      if (!closing) { process.exitCode = 1; void close(); }
    });
    let buffer = '';
    const output = chunk => {
      const text = chunk.toString(); process.stdout.write(text);
      buffer = (buffer + text).slice(-8192);
      const match = /Ready on http:\/\/127\.0\.0\.1:(\d+)/.exec(buffer);
      if (match && !workerPort) { workerPort = Number(match[1]); clearTimeout(readyTimer); resolveReady(); }
    };
    child.stdout.on('data', output); child.stderr.on('data', output);
    readyTimer = setTimeout(() => rejectReady(new Error('Local Worker startup timed out.')), 45000);
    await ready;
    const host = options.ip === '::1' ? '[::1]' : options.ip;
    return { url: `http://${host}:${server.address().port}`, close, closed };
  } catch (error) { await close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let app;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    app = await startLocalApp(localStartOptions(process.argv.slice(2)), { signal: controller.signal });
    console.log(`VDoc local production: ${app.url}`);
    await app.closed;
  } catch (error) { if (!controller.signal.aborted) { console.error(error.message); process.exitCode = 1; } }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
