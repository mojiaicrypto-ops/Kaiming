/**
 * Evidence binding (WP-10 review round 1, W10R1-01 / W10R1-06).
 *
 * A drill report is only evidence for *this* source tree. Every report carries a
 * `binding` computed from the repository content, and the acceptance aggregator
 * recomputes it and refuses a report whose binding does not match. That removes the
 * fail-open path the review reproduced: rewriting a committed
 * `.agentdev/work/WP-10/live-results.json` to say `AC-001 PASS` no longer changes the
 * aggregate, because the forged file cannot carry the code digest of the tree it is
 * being read against without changing that tree.
 *
 * The digest is content based (`git ls-files` + SHA-256 of the working-tree bytes of
 * every tracked code path), not `HEAD` based, so committing the generated records
 * alone does not invalidate a report while any edit under `packages/`, `apps/` or
 * `scripts/` does.
 *
 * A drill report is only ever consumed from the run that produced it
 * (`scripts/acceptance.mjs` spawns `scripts/e2e.mjs` and `scripts/live.mjs` itself), so
 * the binding is a cross-check on top of the run nonce and the nonce temp path — never
 * a licence to trust a report found on disk.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Tracked paths whose content makes up the code digest. */
export const CODE_PATHS = Object.freeze([
  'packages',
  'apps',
  'scripts',
  'package.json',
  'pnpm-lock.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
  'vitest.config.ts',
  'eslint.config.js',
]);

function git(repoRoot, args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
}

/**
 * Computes the content binding of one repository state.
 *
 * @param {string} repoRoot
 * @returns {{ gitHead: string, gitTree: string, codeDigest: string, dirty: boolean, generatedAt: string, nodeVersion: string }}
 */
export function computeBinding(repoRoot) {
  const head = git(repoRoot, ['rev-parse', 'HEAD']);
  const tree = git(repoRoot, ['rev-parse', 'HEAD^{tree}']);
  const status = git(repoRoot, ['status', '--porcelain']);
  const listed = git(repoRoot, ['ls-files', '-z', '--', ...CODE_PATHS]);
  const digest = createHash('sha256');
  const files = (listed ?? '')
    .split('\u0000')
    .filter((entry) => entry.length > 0)
    .sort();
  for (const file of files) {
    let content;
    try {
      content = readFileSync(join(repoRoot, file));
    } catch {
      digest.update(`${file}\u0000missing\u0000`);
      continue;
    }
    digest.update(`${file}\u0000${createHash('sha256').update(content).digest('hex')}\u0000`);
  }
  return {
    gitHead: head === null ? 'unavailable' : head.trim(),
    gitTree: tree === null ? 'unavailable' : tree.trim(),
    codeDigest: `sha256:${digest.digest('hex')}`,
    codeFiles: files.length,
    dirty: status === null ? false : status.trim().length > 0,
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
  };
}

/**
 * Verifies one drill report against the current binding.
 *
 * @param {unknown} report parsed drill report
 * @param {object} current binding of the current tree
 * @param {string} label report label used in messages
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function verifyBinding(report, current, label) {
  const problems = [];
  const binding = /** @type {Record<string, unknown>|undefined} */ (
    report !== null && typeof report === 'object'
      ? /** @type {Record<string, unknown>} */ (report).binding
      : undefined
  );
  if (binding === null || binding === undefined || typeof binding !== 'object') {
    problems.push(
      `${label}: 演练报告没有 binding 字段，无法证明它针对当前代码树产生（拒绝作为验收证据）`,
    );
    return { ok: false, problems };
  }
  const record = /** @type {Record<string, unknown>} */ (binding);
  if (record.codeDigest !== current.codeDigest) {
    problems.push(
      `${label}: 演练报告的 codeDigest ${String(record.codeDigest)} 与当前代码树 ${current.codeDigest} 不一致（报告不是针对当前代码树产生的，拒绝作为验收证据）`,
    );
  }
  if (record.gitHead !== current.gitHead) {
    problems.push(
      `${label}: 演练报告的 gitHead ${String(record.gitHead)} 与当前 HEAD ${current.gitHead} 不一致（拒绝作为验收证据）`,
    );
  }
  if (record.gitTree !== current.gitTree) {
    problems.push(
      `${label}: 演练报告的 gitTree ${String(record.gitTree)} 与当前 ${current.gitTree} 不一致（拒绝作为验收证据）`,
    );
  }
  return { ok: problems.length === 0, problems };
}
