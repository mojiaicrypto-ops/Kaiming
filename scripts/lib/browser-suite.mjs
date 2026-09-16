/**
 * Real-browser drill driver (WP-12 T7a, `docs/delivery/implementation.md` §3).
 *
 * WP-10 shipped `pnpm test:e2e` without a browser and registered the client-side
 * clauses of AC-002/AC-052/AC-071/AC-073/AC-076 as an accepted gap ("产品决定不引入
 * Playwright"). The user reversed that decision: Playwright is now a **dev-only** root
 * dependency and the browser clauses are executed by a real Chromium run.
 *
 * This module owns the drill side of that:
 *
 * - {@link browserAvailability} answers honestly whether Playwright **and** its
 *   Chromium binary are actually on disk. `scripts/lib/drill-acs.mjs` uses it, so
 *   `browser-absent` can no longer excuse an unexecuted browser AC once the browser is
 *   installed;
 * - {@link runBrowserSuite} runs `tests/browser/**` with Playwright's own runner and
 *   turns its machine-readable report into one verdict per AC. A failing or skipped
 *   spec degrades the AC (`FAIL` / `UNVERIFIED`), and a missing spec is a `FAIL`, never
 *   a silent pass. No browser HTTP is stubbed: the specs drive the real daemon, the
 *   real BFF and the real DOM.
 *
 * The report the specs produce (`tests/browser/reporter.mjs`) carries the evidence
 * string each spec attached, so the AC verdicts the aggregator merges are the run's
 * own observations rather than a summary written by hand.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { REPO_ROOT } from './e2e-runtime.mjs';

/** The Playwright project the browser drill runs. */
export const BROWSER_CONFIG = 'tests/browser/playwright.config.mjs';

/** Cache directory the suite may write into; under `node_modules`, so never in Git. */
export const BROWSER_CACHE_DIR = join(REPO_ROOT, 'node_modules', '.cache', 'agentdev-browser');

/**
 * Check name `pnpm test:e2e` prints for each browser AC.
 *
 * One Playwright spec can prove several ACs (the isolation spec proves AC-002 and
 * AC-052), and the aggregator still takes the weakest link per AC.
 */
export const BROWSER_AC_CHECK_NAMES = Object.freeze({
  'AC-002': 'browser.html-preview-and-download',
  'AC-052': 'browser.html-attack-samples',
  'AC-071': 'browser.live-layout',
  'AC-073': 'browser.keyboard-aria-i18n',
  'AC-074': 'browser.inbox-todo-resolution',
  'AC-076': 'browser.attachment-client-hints',
  'AC-011': 'browser.l3-confirmation',
});

/** The statuses the browser report may carry. */
const BROWSER_STATUSES = Object.freeze(['PASS', 'FAIL', 'UNVERIFIED']);

/** Status rank used when several specs touch one AC (weakest link wins). */
const STATUS_RANK = Object.freeze({ PASS: 1, UNVERIFIED: 2, FAIL: 3 });

/** The `@playwright/test` version, or `unknown` when the package cannot be read. */
function installedVersion(requireFromRoot) {
  for (const specifier of ['@playwright/test/package.json', 'playwright/package.json']) {
    try {
      const manifest = JSON.parse(readFileSync(requireFromRoot.resolve(specifier), 'utf8'));
      if (typeof manifest.version === 'string') return manifest.version;
    } catch {
      continue;
    }
  }
  return 'unknown';
}

let cachedAvailability;

/**
 * Detects whether a real browser can run here.
 *
 * Both halves matter: the npm package being importable is not enough, because the
 * browser binary is a separate download (`pnpm exec playwright install chromium`).
 *
 * @returns {{ available: boolean, version: string, executablePath: string, reason: string }}
 */
export function browserAvailability() {
  if (cachedAvailability !== undefined) return cachedAvailability;
  const requireFromRoot = createRequire(join(REPO_ROOT, 'package.json'));
  const version = installedVersion(requireFromRoot);
  let executablePath;
  try {
    const playwright = requireFromRoot('@playwright/test');
    executablePath = String(playwright.chromium.executablePath());
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    cachedAvailability = {
      available: false,
      version,
      executablePath: '',
      reason: `@playwright/test 未安装（${details}）`,
    };
    return cachedAvailability;
  }
  if (executablePath === '' || !existsSync(executablePath)) {
    cachedAvailability = {
      available: false,
      version,
      executablePath,
      reason: `Playwright ${version} 已安装，但 Chromium 未下载（${executablePath || '无路径'} 不存在）；需运行 pnpm exec playwright install chromium`,
    };
    return cachedAvailability;
  }
  cachedAvailability = {
    available: true,
    version,
    executablePath,
    reason: `Playwright ${version} 与 Chromium（${executablePath}）可用`,
  };
  return cachedAvailability;
}

/** True when a real Chromium can be launched for the drills. */
export function browserAvailable() {
  return browserAvailability().available;
}

/** Why `browser-absent` does or does not hold, as one sentence. */
export function browserUnavailableReason() {
  return browserAvailability().reason;
}

/** Extracts the `AC-NNN` ids a spec title declares. */
export function acceptanceIdsOf(title) {
  const found = new Set();
  for (const match of String(title).matchAll(/\bAC-\d{3}\b/gu)) found.add(match[0]);
  return [...found].sort();
}

/** Normalizes one report spec, rejecting a shape this driver cannot read. */
function normalizeSpec(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const spec = /** @type {Record<string, unknown>} */ (raw);
  const title = typeof spec.title === 'string' ? spec.title : '';
  const status = typeof spec.status === 'string' ? spec.status.toUpperCase() : '';
  if (title === '' || !BROWSER_STATUSES.includes(status)) return null;
  const acs = Array.isArray(spec.acs) ? spec.acs.map(String) : acceptanceIdsOf(title);
  return {
    file: typeof spec.file === 'string' ? spec.file : '',
    title,
    acs: [...new Set(acs)].sort(),
    status,
    evidence: typeof spec.evidence === 'string' ? spec.evidence.trim() : '',
    error: typeof spec.error === 'string' ? spec.error.trim() : '',
    gap: typeof spec.gap === 'string' ? spec.gap.trim() : '',
  };
}

/**
 * Aggregates the suite's specs into one verdict per required AC.
 *
 * @param {ReturnType<typeof normalizeSpec>[]} specs
 * @param {readonly string[]} acs
 */
function aggregateByAc(specs, acs) {
  const results = new Map();
  for (const ac of acs) {
    const own = specs.filter((spec) => spec !== null && spec.acs.includes(ac));
    if (own.length === 0) {
      results.set(ac, {
        status: 'FAIL',
        evidence: `浏览器套件没有针对 ${ac} 的用例：该 AC 未被执行`,
        error: '',
        specs: [],
      });
      continue;
    }
    const ranked = [...own].sort(
      (left, right) => STATUS_RANK[right.status] - STATUS_RANK[left.status],
    );
    const worst = ranked[0];
    const evidence =
      worst.status === 'PASS'
        ? own.map((spec) => spec.evidence || spec.title).join(' | ')
        : worst.status === 'UNVERIFIED'
          ? `已登记缺口：${worst.gap || worst.title}（用例「${worst.title}」未执行）`
          : `失败用例「${worst.title}」：${worst.error || '用例未通过'}`;
    results.set(ac, {
      status: worst.status,
      evidence,
      error: worst.error,
      specs: own.map((spec) => spec.title),
    });
  }
  return results;
}

/** One `FAIL` verdict per AC, with the same reason (infrastructure failure route). */
function failedForAll(acs, reason) {
  return new Map(acs.map((ac) => [ac, { status: 'FAIL', evidence: reason, error: '', specs: [] }]));
}

/**
 * Runs the real-browser suite once and returns one verdict per AC.
 *
 * @param {{ acs: readonly string[], env?: NodeJS.ProcessEnv, timeoutMs?: number }} options
 * @returns {{
 *   available: boolean,
 *   exitCode: number,
 *   output: string,
 *   results: Map<string, { status: string, evidence: string, error: string, specs: string[] }>,
 *   specs: Array<Record<string, unknown>>,
 *   durationMs: number,
 * }}
 */
export function runBrowserSuite(options) {
  const availability = browserAvailability();
  const acs = options.acs;
  const startedAt = Date.now();
  if (!availability.available) {
    return {
      available: false,
      exitCode: 1,
      output: availability.reason,
      results: failedForAll(acs, `浏览器不可用：${availability.reason}`),
      gaps: [],
      specs: [],
      durationMs: 0,
    };
  }

  const cli = join(REPO_ROOT, 'node_modules', '.bin', 'playwright');
  if (!existsSync(cli)) {
    return {
      available: true,
      exitCode: 127,
      output: `Playwright CLI 缺失：${cli}`,
      results: failedForAll(acs, `Playwright CLI 缺失：${cli}`),
      gaps: [],
      specs: [],
      durationMs: Date.now() - startedAt,
    };
  }

  mkdirSync(BROWSER_CACHE_DIR, { recursive: true });
  const reportPath = join(BROWSER_CACHE_DIR, `report-${String(process.pid)}.json`);
  rmSync(reportPath, { force: true });
  const childEnv = { ...(options.env ?? process.env), AGENTDEV_BROWSER_REPORT: reportPath };
  // The contract command's output is a report, not a terminal: drop `NO_COLOR` when the
  // caller forces colour, or every Playwright child prints a Node warning into the log.
  if (childEnv.FORCE_COLOR !== undefined) delete childEnv.NO_COLOR;
  const result = spawnSync(cli, ['test', '--config', BROWSER_CONFIG], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: options.timeoutMs ?? 600_000,
    env: childEnv,
  });
  let output = [result.stdout ?? '', result.stderr ?? ''].join('\n');
  const exitCode = result.status ?? (result.error === undefined ? 1 : 127);

  let payload = null;
  if (existsSync(reportPath)) {
    try {
      payload = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch (error) {
      payload = null;
      output += `\n浏览器报告无法解析：${String(error)}`;
    }
  }
  if (payload === null || !Array.isArray(payload.specs)) {
    return {
      available: true,
      exitCode: exitCode === 0 ? 1 : exitCode,
      output,
      results: failedForAll(acs, `浏览器套件没有产出可解析的报告（exit ${String(exitCode)}）`),
      gaps: [],
      specs: [],
      durationMs: Date.now() - startedAt,
    };
  }

  const specs = payload.specs.map(normalizeSpec).filter((spec) => spec !== null);
  return {
    available: true,
    exitCode,
    output,
    results: aggregateByAc(specs, acs),
    specs,
    // Skipped specs that recorded a known gap; reported even when no AC claims them.
    gaps: specs
      .filter((spec) => spec.status === 'UNVERIFIED' && spec.gap !== '')
      .map((spec) => ({ title: spec.title, gap: spec.gap })),
    durationMs: Date.now() - startedAt,
  };
}
