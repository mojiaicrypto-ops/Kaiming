/**
 * Real `agentdev` CLI subprocesses for the release drills (WP-12 G11).
 *
 * `scripts/e2e.mjs` drives the product **in process** through the real daemon/BFF, which
 * proves protocol behaviour but never executes the operator commands themselves. The
 * operations ACs (backup/restore/relocate, `secret rotate`, `doctor`, the launchd unit)
 * only have product-path meaning when the installed CLI really runs against a real
 * `AGENTDEV_HOME` and a real filesystem, so this module spawns it as a child process.
 *
 * The child loads the same TypeScript sources as every other drill: a tiny generated
 * bootstrap installs `scripts/lib/e2e-runtime.mjs`'s module-resolution hook and then calls
 * the CLI's own `main()`. Nothing is stubbed — the CLI reads and writes real files, spawns
 * the real daemon host and talks to its loopback admin surface.
 *
 * `runCli` deliberately returns the raw `stdout`/`stderr` and exit code: the checks assert
 * on that raw evidence instead of a reshaped summary.
 */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from './e2e-runtime.mjs';

const RESOLVER = join(REPO_ROOT, 'scripts', 'lib', 'e2e-runtime.mjs');
const CLI_SOURCE = join(REPO_ROOT, 'apps', 'cli', 'src', 'cli.ts');
const DAEMON_SOURCE = join(REPO_ROOT, 'apps', 'daemon', 'src', 'main.ts');

/**
 * Writes the source-mode CLI and daemon bootstraps into `dir`.
 *
 * `installSourceResolver()` registers an *in-process* hook, so a child process cannot
 * inherit it; each generated entry installs it before importing the product source. This
 * is the same loading path `apps/cli/test/*.integration.test.ts` uses for the daemon, and
 * the same one `pnpm typecheck`/`pnpm lint` see.
 *
 * @param {string} dir directory that receives `cli-entry.mjs` and `daemon-entry.mjs`
 * @returns {{ cliEntry: string, daemonEntry: string }}
 */
export function writeCliBootstrap(dir) {
  const cliEntry = join(dir, 'cli-entry.mjs');
  const daemonEntry = join(dir, 'daemon-entry.mjs');
  writeFileSync(
    daemonEntry,
    [
      `import { installSourceResolver } from ${JSON.stringify(RESOLVER)};`,
      'installSourceResolver();',
      `const { runAsProcess } = await import(${JSON.stringify(DAEMON_SOURCE)});`,
      'process.exit(await runAsProcess(process.argv.slice(2), process.env));',
      '',
    ].join('\n'),
    'utf8',
  );
  writeFileSync(
    cliEntry,
    [
      `import { installSourceResolver } from ${JSON.stringify(RESOLVER)};`,
      'installSourceResolver();',
      `const { main } = await import(${JSON.stringify(CLI_SOURCE)});`,
      'await main(process.argv.slice(2));',
      '',
    ].join('\n'),
    'utf8',
  );
  return { cliEntry, daemonEntry };
}

/**
 * Runs one CLI command as a real child process.
 *
 * @param {string} entry the generated CLI bootstrap
 * @param {readonly string[]} args command and options, exactly as an operator types them
 * @param {{ env?: NodeJS.ProcessEnv, input?: string, timeoutMs?: number }} [options]
 * @returns {{ code: number, stdout: string, stderr: string, signal: string | null }}
 */
export function runCli(entry, args, options = {}) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    input: options.input ?? '',
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: result.status ?? (result.error === undefined ? -1 : 127),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal ?? null,
  };
}

/**
 * Parses the JSON result out of a command's stdout.
 *
 * `backup`/`restore` print operator-facing `WARNING [CODE] …` lines before the JSON
 * (`docs/operations/installation.md` §6), so a consumer reads from the first `{`.
 *
 * @param {string} text
 * @returns {Record<string, unknown>}
 */
export function cliJson(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error(`no JSON in CLI output: ${text.slice(0, 400)}`);
  return JSON.parse(text.slice(start));
}
