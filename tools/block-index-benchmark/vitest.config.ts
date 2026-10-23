import { defineConfig } from 'vitest/config';
import base from '../../vitest.config';

export default defineConfig({
  ...base,
  test: { ...base.test, include: ['tools/block-index-benchmark/profile.test.ts'], testTimeout: 60000 },
});
