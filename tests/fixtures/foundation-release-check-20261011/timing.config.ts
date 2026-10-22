import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../../vitest.config';

export default mergeConfig(base, defineConfig({
  test: {setupFiles: ['./tests/setup.ts', './tests/fixtures/foundation-release-check-20261011/timing.setup.ts']},
}));
