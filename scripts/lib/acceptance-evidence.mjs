/**
 * Turns executed Vitest results and drill reports into a per-AC verdict.
 *
 * ## Mapping (how evidence is found)
 *
 * 1. `test-name` — the AC id (or an `AC-026/027` shorthand) appears in the executed
 *    test's own name/`describe` chain. Strongest and fine grained: the id is bound to
 *    one executed case.
 * 2. `curated` — an explicit `CURATED_EVIDENCE` entry (`{file, title, rationale,
 *    wpRecord}`) for an AC whose proving cases do not spell its id. Every entry must
 *    resolve to an executed case; a stale entry is a hard FAIL.
 *
 * There is no file-level mapping: WP-10 review round 1 (W10R1-04) showed that "every
 * executed case of a file that mentions the id" let an unrelated case in the same file
 * stand in for a deleted key case.
 *
 * ## Verdict (weakest link wins)
 *
 * The verdict of an acceptance case is the **most severe** status across every source
 * that reported on it, where `FAIL > UNVERIFIED > PASS` (`MISSING` when nothing
 * reported at all):
 *
 * - an executed FAIL always fails the AC;
 * - a drill `UNVERIFIED` (the browser half, the real-Provider half, the distinct
 *   Review/Test model) keeps a suite `PASS` from being reported as a full `PASS` — the
 *   AC's full Given/When/Then did not run (W10R1-03);
 * - a registered accepted gap (`RESIDUAL_GAPS`) also downgrades a suite `PASS` to
 *   `UNVERIFIED` unless the drill named by its `closedBy` reported `PASS` for that AC;
 *   when that drill did report `PASS`, a competing `UNVERIFIED` from a drill that by
 *   design cannot supply the missing input (the offline e2e drill and the real model) no
 *   longer downgrades the AC;
 * - every drill that reported on the AC is kept (W10R1-05), so the strongest evidence
 *   is never hidden by a weaker source that happened to be merged last.
 *
 * The aggregation never decides whether an `UNVERIFIED` is tolerable: that is
 * `scripts/acceptance.mjs`, which re-checks the accepted-gap condition every run.
 */

import {
  CURATED_EVIDENCE,
  extractAcIds,
  isValidAcId,
  missingEnvironmentReason,
} from './acceptance-registry.mjs';
import { RESIDUAL_GAPS } from './drill-acs.mjs';

/** Severity order used when several sources report on one AC. */
const STATUS_RANK = { PASS: 1, UNVERIFIED: 2, FAIL: 3, MISSING: 4 };

/** Vitest status vocabulary normalized to what the verdict needs. */
function normalizeTestStatus(status) {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  return 'skipped';
}

/** Returns the more severe of two statuses (`null` means "no report"). */
function mostSevere(left, right) {
  if (left === null) return right;
  if (right === null) return left;
  return STATUS_RANK[right] > STATUS_RANK[left] ? right : left;
}

/**
 * Reads the executed test results out of the Vitest JSON reports.
 *
 * A collected file that ran zero cases is deliberately absent from `byFile`: it is not
 * evidence, and the caller's `diagnostics.unexecuted` check then fails closed on it.
 *
 * @param {Array<{ project: string, report: unknown }>} reports
 * @param {(file: string) => string} [normalizeFile]
 * @returns {{ byFile: Map<string, object[]>, byAc: Map<string, object[]>, all: object[] }}
 */
export function indexTestCases(reports, normalizeFile = (file) => file) {
  const byFile = new Map();
  const byAc = new Map();
  const all = [];
  for (const { project, report } of reports) {
    const results = report?.testResults;
    if (!Array.isArray(results)) continue;
    for (const suite of results) {
      if (suite === null || typeof suite !== 'object') continue;
      const file = normalizeFile(String(suite.name ?? ''));
      const tests = [];
      for (const assertion of suite.assertionResults ?? []) {
        const record = {
          file,
          project,
          fullName: String(assertion.fullName ?? assertion.title ?? ''),
          title: String(assertion.title ?? ''),
          status: normalizeTestStatus(assertion.status),
          failures: Array.isArray(assertion.failureMessages)
            ? assertion.failureMessages.map((message) => String(message))
            : [],
        };
        tests.push(record);
        all.push(record);
        for (const ac of extractAcIds(record.fullName)) {
          if (!byAc.has(ac)) byAc.set(ac, []);
          byAc.get(ac).push(record);
        }
      }
      // A file that was collected but ran zero cases is NOT evidence: leaving it out of
      // `byFile` is what makes it show up in `diagnostics.unexecuted` and fail the run
      // closed (WP-10 review round 2, zero-case collection hole).
      if (tests.length > 0) byFile.set(file, tests);
    }
  }
  return { byFile, byAc, all };
}

/**
 * Builds the diagnostics the report needs: which test sources mention an AC id, and
 * which of them never executed.
 *
 * @param {Array<{ file: string, text: string }>} sources
 * @returns {{ fileAcs: Map<string, Set<string>>, acFiles: Map<string, string[]>, unregistered: Map<string, string[]> }}
 */
export function indexTestSources(sources) {
  const fileAcs = new Map();
  const acFiles = new Map();
  const unregistered = new Map();
  for (const { file, text } of sources) {
    const ids = extractAcIds(text);
    fileAcs.set(file, ids);
    for (const id of ids) {
      if (!acFiles.has(id)) acFiles.set(id, []);
      acFiles.get(id).push(file);
    }
    for (const match of text.matchAll(/AC-(\d{3})(?!\d)/g)) {
      const id = `AC-${match[1]}`;
      if (isValidAcId(id)) continue;
      if (!unregistered.has(id)) unregistered.set(id, []);
      unregistered.get(id).push(file);
    }
  }
  return { fileAcs, acFiles, unregistered };
}

/** Summarizes a set of evidence tests without hiding skips. */
function summarize(tests) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const test of tests) {
    if (test.status === 'passed') passed += 1;
    else if (test.status === 'failed') failed += 1;
    else skipped += 1;
  }
  return { passed, failed, skipped };
}

/** Resolves the curated entries of one AC against the executed report. */
function resolveCurated(ac, byFile) {
  const entries = CURATED_EVIDENCE[ac] ?? [];
  const resolved = [];
  const missing = [];
  for (const entry of entries) {
    const pool = byFile.get(entry.file) ?? [];
    const hit = pool.find(
      (test) => test.title.includes(entry.title) || test.fullName.includes(entry.title),
    );
    if (hit === undefined) missing.push(entry);
    else resolved.push(hit);
  }
  return { resolved, missing };
}

/** Reads the suite verdict of one AC out of its mapped evidence. */
function suiteVerdict(acceptanceCase, index) {
  const id = acceptanceCase.id;
  const nameTests = index.byAc.get(id) ?? [];
  const curatedEntries = CURATED_EVIDENCE[id] ?? [];
  // Curated entries are validated even when the AC is also mapped by test name: a dead
  // mapping is an error, not a harmless leftover (WP-10 review round 2, W10R2-06).
  const curated =
    curatedEntries.length === 0 ? { resolved: [], missing: [] } : resolveCurated(id, index.byFile);
  const stale = curated.missing;

  let mapping = 'none';
  if (nameTests.length > 0) mapping = 'test-name';
  else if (curatedEntries.length > 0) mapping = 'curated';

  const seen = new Set();
  const evidence = [];
  for (const test of [...nameTests, ...curated.resolved]) {
    const key = `${test.file}\u0000${test.fullName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    evidence.push(test);
  }

  const counts = summarize(evidence);
  let status = 'MISSING';
  if (stale.length > 0) status = 'FAIL';
  else if (counts.failed > 0) status = 'FAIL';
  else if (counts.passed > 0) status = 'PASS';
  else if (counts.skipped > 0) status = 'UNVERIFIED';

  const raw = [];
  if (stale.length > 0) {
    for (const entry of stale) {
      raw.push(
        `curated evidence is stale: ${entry.file} :: "${entry.title}" did not execute (recorded in ${entry.wpRecord})`,
      );
    }
  }
  for (const test of evidence) {
    if (test.status !== 'failed') continue;
    if (test.failures.length === 0) raw.push(`${test.file} :: ${test.fullName} (failed)`);
    for (const message of test.failures) raw.push(`${test.file} :: ${test.fullName}\n${message}`);
  }
  return { status, mapping, evidence, stale, raw };
}

/**
 * @typedef {object} AggregatedResult
 * @property {string} id
 * @property {'PASS'|'FAIL'|'UNVERIFIED'|'MISSING'} status weakest-link verdict
 * @property {'test-name'|'curated'|'none'} mapping
 * @property {object[]} evidence executed cases behind the suite verdict
 * @property {Array<{tool: string, status: string, evidence: string, checks: string[]}>} drills
 * @property {string|null} gap        registered accepted gap of this AC, when any
 * @property {boolean} gapClosed      a drill PASS actually closed the registered gap
 * @property {string|null} reason
 * @property {string[]} raw
 */

/**
 * Aggregates one AC from its mapped evidence and every drill report.
 *
 * @param {object} acceptanceCase
 * @param {{ byFile: Map<string, object[]>, byAc: Map<string, object[]> }} index
 * @param {Array<{tool: string, status: string, evidence: string, checks: string[]}>} drills
 * @returns {AggregatedResult}
 */
function aggregateOne(acceptanceCase, index, drills) {
  const id = acceptanceCase.id;
  const suite = suiteVerdict(acceptanceCase, index);

  let status = suite.status === 'MISSING' ? null : suite.status;
  for (const drill of drills) status = mostSevere(status, drill.status);
  if (status === null) status = 'MISSING';

  const registration = RESIDUAL_GAPS[id];
  const gap = registration?.gap ?? null;
  // A gap is only closed by the drill that can actually supply the missing input.
  const gapClosed =
    registration?.closedBy !== undefined &&
    drills.some((drill) => drill.tool === registration.closedBy && drill.status === 'PASS');
  // A registered gap downgrades a "complete" suite PASS: its unexecuted half means the
  // AC's full Given/When/Then was not verified.
  if (gap !== null && !gapClosed && status !== 'FAIL') status = 'UNVERIFIED';
  // ...and once that drill really executed the missing half, the AC is verified: another
  // drill's "I cannot use a real model / a browser" row is not evidence against it.
  if (gapClosed && status === 'UNVERIFIED' && suite.status !== 'FAIL') status = 'PASS';

  let reason = null;
  if (status === 'UNVERIFIED') {
    reason =
      gap ??
      (suite.status === 'UNVERIFIED' && suite.evidence.length > 0
        ? `映射到该 AC 的 ${summarize(suite.evidence).skipped} 个用例在本环境被跳过，未产生通过证据`
        : missingEnvironmentReason(id, acceptanceCase));
  } else if (status === 'MISSING') {
    reason = missingEnvironmentReason(id, acceptanceCase);
  } else if (status === 'FAIL' && suite.stale.length > 0) {
    reason = '映射到该 AC 的提交用例不存在或未执行';
  }

  return {
    id,
    status,
    mapping: suite.mapping,
    evidence: suite.evidence,
    drills,
    gap,
    gapClosed,
    reason,
    raw: suite.raw,
  };
}

/**
 * Aggregates every registered AC.
 *
 * @param {object} options
 * @param {object[]} options.cases
 * @param {Array<{ project: string, report: unknown }>} options.reports
 * @param {Array<{ file: string, text: string }>} options.sources
 * @param {Map<string, Array<object>>} options.drillResults AC -> every drill row about it
 * @param {(file: string) => string} [options.normalizeFile]
 * @returns {{ results: AggregatedResult[], counts: object, diagnostics: object }}
 */
export function aggregateAcceptance({
  cases,
  reports,
  sources,
  drillResults,
  normalizeFile = (file) => file,
}) {
  const index = indexTestCases(reports, normalizeFile);
  const sourceIndex = indexTestSources(sources);

  const results = cases.map((acceptanceCase) =>
    aggregateOne(acceptanceCase, index, drillResults.get(acceptanceCase.id) ?? []),
  );

  const counts = { PASS: 0, FAIL: 0, UNVERIFIED: 0, MISSING: 0 };
  for (const result of results) counts[result.status] += 1;

  const executedFiles = new Set(index.byFile.keys());
  const unexecuted = sources
    .map((source) => source.file)
    .filter((file) => !executedFiles.has(file) && (sourceIndex.fileAcs.get(file)?.size ?? 0) > 0);

  const mappedTests = new Set();
  for (const result of results) {
    for (const test of result.evidence) mappedTests.add(test);
  }
  const unmappedFailures = index.all.filter(
    (test) => test.status === 'failed' && !mappedTests.has(test),
  );

  const curated = Object.keys(CURATED_EVIDENCE).map((id) => {
    const result = results.find((entry) => entry.id === id);
    const stale =
      result?.raw.filter((line) => line.startsWith('curated evidence is stale')).length ?? 0;
    return {
      id,
      entries: CURATED_EVIDENCE[id].length,
      mapping: result?.mapping ?? 'none',
      // Independent of which mapping won: the curated list itself must be fully alive.
      resolved: stale === 0 && result?.status !== 'FAIL',
      stale,
    };
  });

  return {
    results,
    counts,
    diagnostics: {
      executedFiles: executedFiles.size,
      scannedFiles: sources.length,
      unexecuted,
      unmappedFailures,
      curated,
      unregisteredAcIds: [...sourceIndex.unregistered.entries()].map(([id, files]) => ({
        id,
        files: [...new Set(files)],
      })),
      testCounts: index.all.length,
    },
  };
}
