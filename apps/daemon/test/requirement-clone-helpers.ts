/**
 * Shared harness for the requirement-pool clone/import drills (WP-12).
 *
 * This module is a test fixture, not a test (the file is not `*.test.ts`, so Vitest
 * never collects it). It boots a **real installation**: `AuthService`, a temporary
 * installation home and a `ProjectDirectory` whose assembly calls the production
 * `openProject`, which starts the real daemon, the real SQLite project database and the
 * real Core services. Nothing here is mocked.
 *
 * It is shared by:
 *
 * - `requirement-import.integration.test.ts` — the import reader's real `git clone` →
 *   `requirement.import` path over a **fixture** pool (the record files are written with
 *   `node:fs` there, so that test does not prove the producer side);
 * - `requirement-portability-drill.integration.test.ts` — the no-seed drill in which the
 *   pool itself is produced by the documented protocol commands and committed to the
 *   delivery branch by the real `RequirementSaveService` (AC-087/088/089).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AuthService, readInstallationCredential } from '@agentdev/core';

import { openProject } from '../src/bootstrap.js';
import { ProjectDirectory, type AssembledProject } from '../src/project-directory.js';

/** The exact `Origin` the installation allowlists for its BFF. */
export const WEB_ORIGIN = 'http://127.0.0.1:4317';

/** The branch whose committed pool is the durable requirement source. */
export const DELIVERY_BRANCH = 'agentdev/main';

/** Runs one real `git` command and returns stdout (throws on a non-zero exit). */
export function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'AgentDev Test',
      GIT_AUTHOR_EMAIL: 'test@localhost',
      GIT_COMMITTER_NAME: 'AgentDev Test',
      GIT_COMMITTER_EMAIL: 'test@localhost',
    },
  }).toString();
}

/** One real installation: a private home plus its project directory. */
export interface Installation {
  readonly home: string;
  readonly directory: ProjectDirectory;
  close(): void;
}

/**
 * Starts one installation in its own temporary home.
 *
 * The home is what makes two installations independent: `openProject` derives each
 * project's SQLite `dataDir` from `home/projects/<projectId>`, so a second installation
 * opening a clone really starts from an empty database.
 */
export function startInstallation(): Installation {
  const home = mkdtempSync(join(tmpdir(), 'agentdev-clone-home-'));
  const auth = AuthService.loadOrCreate({
    stateDir: home,
    config: { deployment: 'loopback', allowedOrigins: [WEB_ORIGIN] },
  });
  const token = readInstallationCredential(home);
  const ref: { current?: ProjectDirectory } = {};
  const directory = new ProjectDirectory({
    home,
    host: '127.0.0.1',
    version: '0.0.0-test',
    bearer: () => token,
    epoch: () => 1,
    webOrigin: WEB_ORIGIN,
    assemble: async (input): Promise<AssembledProject> => {
      const project = await openProject({
        root: input.root,
        home,
        auth,
        installationToken: token,
        version: '0.0.0-test',
        withWeb: false,
        daemonPort: 0,
        host: '127.0.0.1',
        trust: input.trust,
        ...(ref.current === undefined ? {} : { projectDirectory: ref.current }),
      });
      return {
        projectId: project.projectId,
        root: project.root,
        gitRoot: project.gitRoot,
        dataDir: project.dataDir,
        instance: {
          projectId: project.projectId,
          root: project.root,
          daemon: { host: '127.0.0.1' as const, port: project.ports.daemon },
          web: null,
        },
        store: project.store,
        protocol: project.protocol,
        deliveryBranch: 'agentdev/main',
        documentRoot: 'docs/agentdev',
      };
    },
    teardown: () => Promise.resolve(),
    runningRuns: () => 0,
    executionReady: () => true,
  });
  ref.current = directory;
  return { home, directory, close: () => rmSync(home, { recursive: true, force: true }) };
}
