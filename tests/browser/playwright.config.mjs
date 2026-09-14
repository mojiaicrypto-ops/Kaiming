/**
 * Playwright configuration for the real-browser release drill (WP-12 T7a).
 *
 * The suite drives the **real** workbench: `globalSetup` boots the repository's own
 * sources (`scripts/lib/e2e-stack.mjs`) — real temp Git project, real SQLite, real
 * `createDaemon`, real BFF — on loopback ephemeral ports, signs in with the real
 * installation token from `tests/browser/*.spec.mjs`, and no product request is
 * stubbed. `workers: 1` keeps the panel/language state machine and the single daemon
 * deterministic; `retries: 0` means a flaky assertion is reported, never hidden.
 *
 * Run it directly with `pnpm test:browser` or as part of `pnpm test:e2e`
 * (`scripts/lib/browser-suite.mjs` starts it and merges its per-AC report).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
/** Artifacts stay under `node_modules/`, so a failed run never dirties the repo. */
const outputDir = join(here, '..', '..', 'node_modules', '.cache', 'agentdev-browser', 'output');

export default defineConfig({
  testDir: here,
  testMatch: '**/*.spec.mjs',
  outputDir,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  // One spec can boot nothing extra (the stack is global); 60s is the per-test budget.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: join(here, 'global-setup.mjs'),
  globalTeardown: join(here, 'global-teardown.mjs'),
  reporter: [['line'], [join(here, 'reporter.mjs')]],
  use: {
    headless: true,
    acceptDownloads: true,
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
