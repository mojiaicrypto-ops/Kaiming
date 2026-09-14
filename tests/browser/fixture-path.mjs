/**
 * Where the browser suite's fixture file lives (WP-12 T7a).
 *
 * `globalSetup` boots the stack in Playwright's main process and `globalTeardown`
 * closes it, but the specs run in worker processes. The fixture file is the handover:
 * a deterministic path under `node_modules/`, so a worker can find it without relying
 * on environment propagation (the `AGENTDEV_BROWSER_FIXTURE` variable is honoured first
 * when it is set).
 */
import { join } from 'node:path';

import { REPO_ROOT } from '../../scripts/lib/e2e-runtime.mjs';

/** Environment variable the driver may use to point at another fixture file. */
export const FIXTURE_ENV = 'AGENTDEV_BROWSER_FIXTURE';

/** The default fixture path (inside the ignored cache directory). */
export const FIXTURE_PATH = join(
  REPO_ROOT,
  'node_modules',
  '.cache',
  'agentdev-browser',
  'fixture.json',
);
