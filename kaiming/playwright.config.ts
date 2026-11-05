import { defineConfig, devices } from '@playwright/test';

/**
 * Real-browser acceptance harness (P4-i). The workbench server is started in-process by
 * `browser/harness.ts`, so the port is dynamic and the spec navigates to `harness.baseUrl`
 * explicitly; `baseURL` stays bound to `KAIMING_BASE_URL` for runs against an already-running
 * workbench. No retries: a flaky acceptance test hides a real failure.
 */
export default defineConfig({
  testDir: './browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: process.env.KAIMING_BASE_URL,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
