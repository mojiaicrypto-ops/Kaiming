/**
 * Writes the browser drill's machine-readable report (WP-12 T7a).
 *
 * Each spec attaches one `evidence` text at the end of its body
 * (`testInfo.attach('evidence', …)`); this reporter collects the title, the AC ids the
 * title declares, the real Playwright status, the attached evidence, the first error
 * and any `fixme`/`skip` gap note, and writes them as one JSON file.
 *
 * `scripts/lib/browser-suite.mjs` reads exactly that file and turns it into the AC
 * verdicts `pnpm test:e2e` prints and `pnpm test:acceptance` merges. Keeping the
 * evidence in the spec (instead of a summary written next to the run) is what stops a
 * passing-looking report from claiming more than the browser actually observed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Map Playwright's per-result status onto the drill vocabulary. */
function drillStatus(status) {
  if (status === 'passed') return 'PASS';
  if (status === 'skipped') return 'UNVERIFIED';
  return 'FAIL';
}

/** The single-passing-status rule: retries are disabled, so any non-pass is reported. */
function worstStatus(statuses) {
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('UNVERIFIED')) return 'UNVERIFIED';
  return 'PASS';
}

/** The `evidence` attachment body a spec attached, as text. */
function evidenceOf(result) {
  for (const attachment of result.attachments ?? []) {
    if (attachment.name !== 'evidence') continue;
    const body = attachment.body;
    if (body === undefined || body === null) continue;
    return Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  }
  return '';
}

/** The first error message Playwright recorded for one result. */
function errorOf(result) {
  for (const error of result.errors ?? []) {
    if (typeof error?.message === 'string' && error.message.trim() !== '') {
      return error.message.trim();
    }
  }
  if (typeof result.error?.message === 'string') return result.error.message.trim();
  return '';
}

/** The `fixme`/`skip` annotation description that records a known gap. */
function gapOf(test) {
  for (const annotation of test.annotations ?? []) {
    if (annotation.type !== 'fixme' && annotation.type !== 'skip') continue;
    if (typeof annotation.description === 'string' && annotation.description.trim() !== '') {
      return annotation.description.trim();
    }
  }
  return '';
}

/**
 * The `AC-NNN` ids a spec declares.
 *
 * Read from the **test's own title**, not the full `describe › test` path: a group
 * `describe` may name an AC while one of its specs is a recorded gap that must not be
 * attributed to that AC.
 */
function acceptanceIdsOf(title) {
  const found = new Set();
  for (const match of String(title).matchAll(/\bAC-\d{3}\b/gu)) found.add(match[0]);
  return [...found].sort();
}

export default class AgentDevBrowserReporter {
  constructor(options = {}) {
    this.rootDir = options.rootDir ?? process.cwd();
    this.outputFile =
      typeof options.outputFile === 'string' && options.outputFile !== ''
        ? options.outputFile
        : (process.env.AGENTDEV_BROWSER_REPORT ??
          join(this.rootDir, 'node_modules', '.cache', 'agentdev-browser', 'report.json'));
    /** @type {Map<string, { title: string, statuses: string[], result: unknown, test: unknown }>} */
    this.byTitle = new Map();
  }

  onTestEnd(test, result) {
    const parts = typeof test.titlePath === 'function' ? test.titlePath() : [test.title];
    const title = parts.filter((part) => typeof part === 'string' && part !== '').join(' › ');
    const current = this.byTitle.get(title) ?? {
      title,
      acs: acceptanceIdsOf(test.title),
      statuses: [],
      result,
      test,
    };
    current.statuses.push(drillStatus(result.status));
    // Keep the last (worst) result: retries are off, but a timed-out teardown may
    // report twice and the report must never look better than the run.
    current.result = result;
    current.test = test;
    this.byTitle.set(title, current);
  }

  onEnd() {
    const specs = [...this.byTitle.values()].map((entry) => ({
      title: entry.title,
      acs: entry.acs,
      file: typeof entry.test.location?.file === 'string' ? entry.test.location.file : '',
      status: worstStatus(entry.statuses),
      evidence: evidenceOf(entry.result),
      error: errorOf(entry.result),
      gap: gapOf(entry.test),
    }));
    mkdirSync(dirname(this.outputFile), { recursive: true });
    writeFileSync(
      this.outputFile,
      `${JSON.stringify(
        {
          tool: 'tests/browser (playwright)',
          generatedAt: new Date().toISOString(),
          specs,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
}
