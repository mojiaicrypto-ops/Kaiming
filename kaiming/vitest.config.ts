/**
 * The unit suite lives in `test/` only. The browser acceptance suite (Playwright) lives in
 * `browser/` and must never be collected here - Playwright specs throw outside their own runner.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['browser/**', 'node_modules/**', 'spikes/**'],
  },
});
