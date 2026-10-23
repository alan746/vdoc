import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkWorkerAsset } from './check-worker-asset.mjs';

// Run the built app in workerd, where module-scope I/O restrictions differ from
// Node/jsdom. A browser can recover from an SSR error while HTTP still says 500.
const root = fileURLToPath(new URL('../', import.meta.url));
const worker = spawn(process.execPath, [
  '--import', fileURLToPath(new URL('./sites-env.mjs', import.meta.url)),
  fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url)),
  'dev', '--config', 'dist/server/wrangler.json', '--local',
  '--ip', '127.0.0.1', '--port', '0', '--inspector-port', '0',
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
const closed = new Promise(resolve => worker.once('close', resolve));
let output = '';

try {
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker startup timed out')), 45_000);
    const finish = (error, url) => {
      clearTimeout(timer);
      if (error) reject(error); else resolve(url);
    };
    worker.once('error', error => finish(error));
    worker.once('close', code => finish(new Error(`Worker exited before readiness (${code})`)));
    const receive = chunk => {
      output = (output + chunk.toString()).slice(-12_000);
      const ready = output.match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
      if (ready) finish(null, ready[1]);
    };
    worker.stdout.on('data', receive);
    worker.stderr.on('data', receive);
  });
  const assets = new Set();
  for (const path of ['/', '/print-preview', '/account', '/cloud']) {
    const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200, `${path} must return HTTP 200`);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    const html = await response.text();
    assert.doesNotMatch(html, /id="__next_error__"/, `${path} must not render an error shell`);
    assert.ok(html.includes(path === '/' ? 'Opening workspace' : path === '/account' ? 'Your account' : path === '/cloud' ? 'Opening cloud workspace' : 'preview-pages'), `${path} must render its initial UI`);
    for (const match of html.matchAll(/(?:src|href)="([^\"]+)"/g)) {
      if (match[1].startsWith('/_next/static/')) assets.add(match[1]);
    }
    console.log(`PASS ${path}: HTTP 200 and expected server-rendered UI`);
  }
  const account = await fetch(new URL('/api/account', origin), { signal: AbortSignal.timeout(10_000) });
  assert.equal(account.status, 200);
  assert.deepEqual(await account.json(), { configured: false, user: null });
  assert.match(account.headers.get('cache-control'), /no-store/);
  const signIn = await fetch(new URL('/api/auth/sign-in/social', origin), { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'google' }), signal: AbortSignal.timeout(10_000) });
  await signIn.text();
  assert.equal(signIn.status, 503, 'Unconfigured authentication must fail closed');
  console.log('PASS authentication fails closed without production credentials');
  assert.ok(assets.size > 0, 'The rendered pages must reference client assets');
  for (const path of assets) {
    await checkWorkerAsset(new URL(path, origin));
  }
  console.log(`PASS ${assets.size} referenced client assets`);
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGTERM');
  const forceStop = setTimeout(() => worker.kill('SIGKILL'), 5_000);
  try { await closed; } finally { clearTimeout(forceStop); }
}
