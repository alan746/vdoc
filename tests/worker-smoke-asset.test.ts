// @vitest-environment node
import { createServer, type Server, type RequestListener } from 'node:http';
import { afterEach, expect, test } from 'vitest';
import { checkWorkerAsset } from '../scripts/check-worker-asset.mjs';

const servers: Server[] = [];
async function endpoint(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  return new URL(`http://127.0.0.1:${address.port}/_next/static/test.js`);
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

test('retries a stalled GET and verifies the recovered response', async () => {
  let requests = 0;
  const logs: string[] = [];
  const url = await endpoint((_req, res) => {
    if (++requests > 1) res.end('export default 1');
  });
  await checkWorkerAsset(url, { timeoutMs: 1_000, log: (line: string) => logs.push(line) });
  expect(requests).toBe(2);
  expect(logs.some(line => line.startsWith('RETRY /_next/static/test.js'))).toBe(true);
});

test('persistent timeouts fail after a bounded number of requests with the asset path', async () => {
  let requests = 0;
  const url = await endpoint(() => { requests++; });
  await expect(checkWorkerAsset(url, { timeoutMs: 1_000, log: () => {} }))
    .rejects.toThrow('/_next/static/test.js (attempt 2/2');
  expect(requests).toBe(2);
});

test('the deadline also covers a stalled response body', async () => {
  let requests = 0;
  const url = await endpoint((_req, res) => {
    requests++;
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.write('export ');
    if (requests > 1) res.end('default 1');
  });
  await checkWorkerAsset(url, { timeoutMs: 1_000, log: () => {} });
  expect(requests).toBe(2);
});

test.each([404, 500])('HTTP %i fails without retrying', async status => {
  let requests = 0;
  const url = await endpoint((_req, res) => { requests++; res.writeHead(status).end('error'); });
  await expect(checkWorkerAsset(url, { log: () => {} })).rejects.toThrow(`HTTP ${status}`);
  expect(requests).toBe(1);
});

test('empty HTTP 200 fails without retrying', async () => {
  let requests = 0;
  const url = await endpoint((_req, res) => { requests++; res.end(); });
  await expect(checkWorkerAsset(url, { log: () => {} })).rejects.toThrow('must not be empty');
  expect(requests).toBe(1);
});
