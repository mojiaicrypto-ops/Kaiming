/**
 * Playwright `globalTeardown` for the real-browser drill (WP-12 T7a).
 *
 * Closes the daemon, the BFF, the Provider stub, the attack probe and the temporary
 * SQLite store that `globalSetup` opened, and removes the temporary directories.
 */
import { cleanupTempDirs } from '../../scripts/lib/e2e-runtime.mjs';

import { closeBrowserStack } from './stack-runtime.mjs';

export default async function globalTeardown() {
  await closeBrowserStack();
  cleanupTempDirs();
}
