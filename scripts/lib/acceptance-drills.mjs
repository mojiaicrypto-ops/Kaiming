/**
 * Runs the release drills *inside* the acceptance aggregation (WP-10 review round 1,
 * W10R1-01).
 *
 * Before this module existed, `pnpm test:acceptance` read
 * `.agentdev/work/WP-10/{e2e,live}-results.json` from the repository and trusted it.
 * The review forged one of those files and turned the only UNVERIFIED AC into a PASS
 * with `exit 0`. Now the aggregation produces its own evidence: it spawns
 * `scripts/e2e.mjs` and `scripts/live.mjs` with
 *
 * - `--drill-out <path>` inside a temporary directory this run created, and
 * - `AGENTDEV_DRILL_NONCE=<uuid>` that this run generated.
 *
 * A report is only adopted when it was written to that path *and* carries this run's
 * nonce *and* its `binding` matches the current code tree. Repository files are never
 * read as evidence, and there is no flag that makes an externally produced report
 * trusted: drill evidence must be produced by the run that consumes it.
 *
 * `pnpm test:live` legitimately exits 3 when the environment has no
 * `AGENTDEV_PROVIDER_*`; that run still writes a report whose rows are `UNVERIFIED`,
 * which is exactly what the aggregator must see.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { computeBinding, verifyBinding } from './acceptance-binding.mjs';
import { parseDrillReport } from './acceptance-registry.mjs';

/** Exit code `scripts/live.mjs` uses when the real Provider is not configured. */
export const LIVE_UNVERIFIED_EXIT = 3;

/** The drills the acceptance aggregation runs, in order. */
export const DRILL_COMMANDS = Object.freeze([
  {
    tool: 'pnpm test:e2e',
    script: 'scripts/e2e.mjs',
    args: [],
    allowedExitCodes: [0],
    timeoutMs: 1_800_000,
  },
  {
    tool: 'pnpm test:live',
    script: 'scripts/live.mjs',
    args: [],
    allowedExitCodes: [0, LIVE_UNVERIFIED_EXIT],
    timeoutMs: 1_800_000,
  },
]);

function toRepoPath(repoRoot, file) {
  const rel = relative(repoRoot, file);
  return sep === '/' ? rel : rel.split(sep).join('/');
}

/**
 * Runs every drill and returns the parsed, binding-checked reports.
 *
 * @param {{ repoRoot: string, log?: (line: string) => void, env?: NodeJS.ProcessEnv, skip?: boolean }} options
 * @returns {{
 *   executed: boolean,
 *   results: Map<string, object[]>,
 *   sources: string[],
 *   problems: string[],
 *   runs: Array<{ tool: string, exitCode: number, durationMs: number, output: string }>,
 * }}
 */
export function runDrills(options) {
  const { repoRoot } = options;
  const log = options.log ?? ((line) => process.stdout.write(`${line}\n`));
  const env = options.env ?? process.env;
  const problems = [];
  const sources = [];
  const runs = [];
  const results = new Map();

  if (options.skip === true) {
    log('acceptance: --no-drills — release drills were not executed in this run');
    return { executed: false, results, sources, problems, runs };
  }

  const dir = mkdtempSync(join(tmpdir(), 'agentdev-acceptance-drills-'));
  // The nonce proves the report was produced by this run: nothing outside this process
  // knows it before the drills start.
  const nonce = randomUUID();
  const binding = computeBinding(repoRoot);
  try {
    for (const drill of DRILL_COMMANDS) {
      const out = join(dir, `${drill.script.split('/').pop()}.json`);
      const startedAt = Date.now();
      const result = spawnSync(
        process.execPath,
        [join(repoRoot, drill.script), ...drill.args, '--drill-out', out],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: { ...env, AGENTDEV_DRILL_NONCE: nonce },
          maxBuffer: 256 * 1024 * 1024,
          timeout: drill.timeoutMs,
        },
      );
      const output = [result.stdout ?? '', result.stderr ?? ''].join('\n');
      const exitCode = result.status ?? (result.error === undefined ? 1 : 127);
      runs.push({ tool: drill.tool, exitCode, durationMs: Date.now() - startedAt, output });
      log(
        `acceptance: ${drill.tool} exit=${String(exitCode)} (${String(Date.now() - startedAt)}ms)`,
      );
      if (exitCode !== 0) {
        log(
          `acceptance: ${drill.tool} output tail:\n${output
            .split('\n')
            .filter((line) => line.trim().length > 0)
            .slice(-12)
            .join('\n')}`,
        );
      }
      if (!drill.allowedExitCodes.includes(exitCode)) {
        problems.push(
          `${drill.tool} exited ${String(exitCode)}; expected ${drill.allowedExitCodes.join(' or ')}`,
        );
      }
      if (!existsSync(out)) {
        problems.push(`${drill.tool} produced no drill report at ${toRepoPath(repoRoot, out)}`);
        continue;
      }
      let payload;
      try {
        payload = JSON.parse(readFileSync(out, 'utf8'));
      } catch (error) {
        problems.push(`${drill.tool} wrote an unparsable drill report: ${error.message}`);
        continue;
      }
      const record = /** @type {Record<string, unknown>} */ (payload);
      if (record.nonce !== nonce) {
        problems.push(
          `${drill.tool}: 演练报告的 nonce 与本次运行不一致（报告不是本次运行产生的，拒绝作为验收证据）`,
        );
        continue;
      }
      const verified = verifyBinding(payload, binding, drill.tool);
      problems.push(...verified.problems);
      if (!verified.ok) continue;
      const parsed = parseDrillReport(payload, `${drill.tool}（本次运行）`);
      problems.push(...parsed.problems);
      for (const [ac, entry] of parsed.results) {
        if (!results.has(ac)) results.set(ac, []);
        results.get(ac).push({ ...entry, tool: drill.tool });
      }
      sources.push(
        `${drill.tool}（本次运行，nonce ${nonce.slice(0, 8)}…，绑定 ${binding.codeDigest.slice(0, 19)}…）`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  return { executed: true, results, sources, problems, runs };
}
