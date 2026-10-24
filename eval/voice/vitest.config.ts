import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Separate from the unit suite: real-model runs are slow and billed.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../..', import.meta.url)) } },
  test: {
    root: fileURLToPath(new URL('../..', import.meta.url)),
    environment: 'jsdom',
    include: ['eval/voice/**/*.eval.ts'],
    setupFiles: ['tests/setup.ts'],
    maxWorkers: 1,
    fileParallelism: false,
  },
});
