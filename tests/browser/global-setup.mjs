/**
 * Playwright `globalSetup` for the real-browser drill (WP-12 T7a).
 *
 * Boots the repository's real stack (real temp Git project, real SQLite, real
 * `createDaemon` + BFF on ephemeral loopback ports, offline Provider stub), seeds the
 * preview artifact and gives the specs a small fixture file with the ephemeral URLs,
 * the installation token and the seeded ids.
 */
import { openBrowserStack } from './stack-runtime.mjs';

export default async function globalSetup() {
  const stack = await openBrowserStack();
  process.stdout.write(
    `browser: real stack at ${stack.fixture.webUrl} (AGENTDEV_HOME=${stack.fixture.stateDir}) with the offline Provider stub; seeded HTML artifact ${stack.fixture.htmlArtifactId}\n`,
  );
}
