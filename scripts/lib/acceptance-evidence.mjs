/**
 * Turns executed Vitest results into a per-AC verdict.
 *
 * Mapping precedence (strongest source wins, and every mapped test decides the verdict):
 *
 * 1. `test-name` — the AC id (or an `AC-026/027` shorthand) appears in the test name.
 * 2. `file` — the AC id appears somewhere in the test file but not in any test name;
 *    every executed test of that file becomes evidence (coarse but fail-closed).
 * 3. `supplemental` — a curated, auditable mapping for an AC whose proving tests do not
 *    carry its id (`SUPPLEMENTAL_EVIDENCE`). Every curated entry must resolve to an
 *    executed case; a stale entry is a hard FAIL, never a silent pass.
 *
 * Failure wins over evidence from any other source. A drill report (`pnpm test:e2e` /
 * `pnpm test:live`) is merged last so a real drill FAIL overrides a suite PASS and a
 * drill PASS closes an AC the offline suite could not reach.
 */

import {
  KNOWN_RESIDUALS,
  SUPPLEMENTAL_EVIDENCE,
  extractAcIds,
  isValidAcId,
  missingEnvironmentReason,
} from './acceptance-registry.mjs';

/** Vitest status vocabulary normalized to what the verdict needs. */
function normalizeTestStatus(status) {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  return 'skipped';
}

/**
 * Reads the executed test results out of the Vitest JSON reports.
 *
 * `normalizeFile` maps the absolute suite path Vitest reports onto the same
 * repository-relative key the source scan uses, so the curated mappings resolve.
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
      byFile.set(file, tests);
    }
  }
  return { byFile, byAc, all };
}

/**
 * Builds `Map<file, Set<AC>>` for the repository test sources. The scan is what lets an
 * AC find the files that mention it even when no test name does.
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
function resolveSupplemental(ac, byFile) {
  const entries = SUPPLEMENTAL_EVIDENCE[ac] ?? [];
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

/**
 * @typedef {object} AggregatedResult
 * @property {string} id
 * @property {string} status  PASS | FAIL | UNVERIFIED
 * @property {string} mapping test-name | file | supplemental | none | drill
 * @property {object[]} evidence
 * @property {string[]} raw
 * @property {string|null} reason
 * @property {string|null} residual
 * @property {object|null} drill
 */

/**
 * Aggregates one AC from its mapped evidence.
 *
 * @param {object} acceptanceCase
 * @param {{ byFile: Map<string, object[]>, byAc: Map<string, object[]>, all: object[] }} index
 * @param {{ acFiles: Map<string, string[]>, fileAcs: Map<string, Set<string>> }} sources
 * @param {Map<string, object>} drillResults
 * @returns {AggregatedResult}
 */
function aggregateOne(acceptanceCase, index, sources, drillResults) {
  const id = acceptanceCase.id;
  const nameTests = index.byAc.get(id) ?? [];
  let mapping = 'none';
  let evidence = [];
  const raw = [];
  let reason = null;

  if (nameTests.length > 0) {
    mapping = 'test-name';
    evidence = nameTests;
  } else {
    const files = sources.acFiles.get(id) ?? [];
    const fileTests = files.flatMap((file) => index.byFile.get(file) ?? []);
    if (fileTests.length > 0) {
      mapping = 'file';
      evidence = fileTests;
    } else if ((SUPPLEMENTAL_EVIDENCE[id] ?? []).length > 0) {
      const { resolved, missing } = resolveSupplemental(id, index.byFile);
      if (missing.length > 0) {
        return {
          id,
          status: 'FAIL',
          mapping: 'supplemental',
          evidence: resolved,
          raw: missing.map(
            (entry) =>
              `curated evidence is stale: ${entry.file} :: "${entry.title}" did not execute (recorded in ${entry.wpRecord})`,
          ),
          reason: '映射到该 AC 的提交用例不存在或未执行',
          residual: KNOWN_RESIDUALS[id] ?? null,
          drill: null,
        };
      }
      mapping = 'supplemental';
      evidence = resolved;
    }
  }

  const counts = summarize(evidence);
  let status;
  if (counts.failed > 0) {
    status = 'FAIL';
    for (const test of evidence) {
      if (test.status !== 'failed') continue;
      for (const message of test.failures) raw.push(`${test.file} :: ${test.fullName}\n${message}`);
      if (test.failures.length === 0) raw.push(`${test.file} :: ${test.fullName} (failed)`);
    }
  } else if (counts.passed > 0) {
    status = 'PASS';
  } else if (counts.skipped > 0) {
    status = 'UNVERIFIED';
    reason = `映射到该 AC 的 ${counts.skipped} 个用例在本环境被跳过，未产生通过证据`;
  } else {
    status = 'UNVERIFIED';
    reason = missingEnvironmentReason(id, acceptanceCase);
  }

  const drill = drillResults.get(id) ?? null;
  if (drill !== null) {
    if (drill.status === 'FAIL') {
      status = 'FAIL';
      raw.push(`drill ${drill.sourceFile}: ${drill.evidence}`);
      reason = null;
    } else if (drill.status === 'PASS') {
      status = 'PASS';
      reason = null;
    } else if (status === 'UNVERIFIED') {
      reason = `演练未验证：${drill.evidence}（${drill.sourceFile}）`;
    }
  }

  return {
    id,
    status,
    mapping,
    evidence,
    raw,
    reason,
    residual: KNOWN_RESIDUALS[id] ?? null,
    drill,
  };
}

/**
 * Aggregates every registered AC.
 *
 * @param {object} options
 * @param {object[]} options.cases
 * @param {Array<{ project: string, report: unknown }>} options.reports
 * @param {Array<{ file: string, text: string }>} options.sources
 * @param {Map<string, object>} options.drillResults
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
    aggregateOne(acceptanceCase, index, sourceIndex, drillResults),
  );

  const counts = { PASS: 0, FAIL: 0, UNVERIFIED: 0 };
  for (const result of results) counts[result.status] += 1;

  const executedFiles = new Set(index.byFile.keys());
  const unexecuted = sources
    .map((source) => source.file)
    .filter((file) => !executedFiles.has(file) && sourceIndex.fileAcs.get(file)?.size > 0);

  const mappedTests = new Set();
  for (const result of results) {
    for (const test of result.evidence) mappedTests.add(test);
  }
  const unmappedFailures = index.all.filter(
    (test) => test.status === 'failed' && !mappedTests.has(test),
  );

  const supplemental = Object.keys(SUPPLEMENTAL_EVIDENCE).map((id) => {
    const result = results.find((entry) => entry.id === id);
    return {
      id,
      entries: SUPPLEMENTAL_EVIDENCE[id].length,
      resolved: result?.mapping === 'supplemental' && result.status !== 'FAIL',
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
      supplemental,
      unregisteredAcIds: [...sourceIndex.unregistered.entries()].map(([id, files]) => ({
        id,
        files: [...new Set(files)],
      })),
      testCounts: index.all.length,
    },
  };
}
