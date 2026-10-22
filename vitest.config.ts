import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': new URL('.', import.meta.url).pathname } },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    // Evidence may contain copies of old tests; only the live suite is executable.
    exclude: ['tests/fixtures/**'],
    setupFiles: ['tests/setup.ts'],
    // Independent runner/worker timers have stalled together for >6s on the
    // shared host with almost no CPU use. Keep a bounded infrastructure deadline
    // without changing product timeouts or explicit performance assertions.
    testTimeout: 15000,
    // Keep the local acceptance suite bounded on the shared development machine.
    maxWorkers: 1,
    fileParallelism: false,
  },
});
