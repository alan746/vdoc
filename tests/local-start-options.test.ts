import { expect, it } from 'vitest';
import { localStartOptions } from '../scripts/start-local.mjs';
it('keeps local defaults and accepts explicit or OS-assigned test ports', () => {
  expect(localStartOptions([])).toEqual({ port: 8787, ip: '127.0.0.1', persistTo: '.wrangler/state' });
  expect(localStartOptions(['--port=0', '--ip', '::1', '--persist-to', 'tmp/test-state'])).toEqual({ port: 0, ip: '::1', persistTo: 'tmp/test-state' });
});
it.each([['--port', '-1'], ['--port', '65536'], ['--port', '12.5'], ['--port'], ['--ip', '0.0.0.0'], ['--remote'], ['--persist-to', '--port']])('rejects invalid or nonlocal runtime options: %j', (...args) => {
  expect(() => localStartOptions(args)).toThrow();
});
