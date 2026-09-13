#!/usr/bin/env node
/**
 * `pnpm test:acceptance` — release acceptance aggregation (WP-10).
 *
 * Contract (`docs/delivery/implementation.md` §3): "fixture 及 AC 证据汇总 —
 * 必需 AC 全有结果，无未处置失败". This runner:
 *
 * 1. parses `docs/delivery/acceptance.md` into the AC-001…AC-094 registry and fails
 *    closed when the catalog is incomplete, duplicated or out of range;
 * 2. runs the real `unit` and `integration` Vitest projects and keeps their raw JSON;
 * 3. maps every executed test to the ACs it proves (test name, file comment, curated
 *    WP-record-checked mapping) and derives PASS / FAIL / UNVERIFIED per AC;
 * 4. merges optional release-drill reports (`--drill-report`), because a drill FAIL must
 *    override a suite PASS and a drill PASS must close an AC the offline suite cannot;
 * 5. writes `.agentdev/work/WP-10/acceptance.md` with the raw results and exits non-zero
 *    on any FAIL, any missing AC result, or a suite that did not produce a report.
 *
 * UNVERIFIED is allowed only when it names the missing environment (real Provider,
 * browser or drill) and the AC is registered in the report.
 *
 * Usage:
 *   node scripts/acceptance.mjs [--report <path>] [--json <path>]
 *                               [--drill-report <path>]... [--projects unit,integration]
 *                               [--no-write] [--help]
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { aggregateAcceptance } from './lib/acceptance-evidence.mjs';
import {
  ACCEPTANCE_DOC,
  EXPECTED_AC_IDS,
  parseAcceptanceDoc,
  parseDrillReport,
} from './lib/acceptance-registry.mjs';
import { renderAcceptanceReport, renderConsoleTable } from './lib/acceptance-report.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_REPORT = join(repoRoot, '.agentdev', 'work', 'WP-10', 'acceptance.md');
const DRILL_DIR = join(repoRoot, '.agentdev', 'work', 'WP-10', 'drills');

function usage() {
  return [
    'Usage: node scripts/acceptance.mjs [options]',
    '',
    '  --report <path>          markdown output (default .agentdev/work/WP-10/acceptance.md)',
    '  --json <path>            optional machine-readable sidecar',
    '  --drill-report <path>    merge a drill report (repeatable)',
    '  --projects <list>        vitest projects to run (default unit,integration;',
    '                           a subset leaves unrun ACs FAIL/UNVERIFIED, by design)',
    '  --no-write               print only, do not write the report',
    '  --help                   show this help',
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    report: DEFAULT_REPORT,
    json: null,
    drillReports: [],
    projects: ['unit', 'integration'],
    write: true,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === '--report') options.report = resolve(repoRoot, next());
    else if (arg === '--json') options.json = resolve(repoRoot, next());
    else if (arg === '--drill-report') options.drillReports.push(resolve(repoRoot, next()));
    else if (arg === '--projects')
      options.projects = next()
        .split(',')
        .map((name) => name.trim());
    else if (arg === '--no-write') options.write = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  if (options.projects.some((name) => name.length === 0)) {
    throw new Error('--projects must name at least one vitest project');
  }
  return options;
}

/** Recursively collects `*.test.ts` files, skipping build and dependency directories. */
function collectTestFiles(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage') continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) collectTestFiles(full, out);
    else if (entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function toRepoPath(file) {
  const rel = relative(repoRoot, file);
  return sep === '/' ? rel : rel.split(sep).join('/');
}

/** Runs one Vitest project and returns its raw JSON report (or null). */
function runProject(project) {
  // Invoke the same `.bin/vitest` shim `pnpm test:unit` uses: it exports the pnpm
  // NODE_PATH that worker threads rely on for bare requires such as `better-sqlite3`.
  const vitest = join(repoRoot, 'node_modules', '.bin', 'vitest');
  if (!existsSync(vitest)) {
    return {
      project,
      exitCode: 127,
      signal: null,
      output: `vitest shim not found at ${vitest}; run pnpm install`,
      report: null,
      reportPath: null,
    };
  }
  const reportPath = join(tmpdir(), `agentdev-acceptance-${project}-${process.pid}.json`);
  const result = spawnSync(
    vitest,
    ['run', '--project', project, '--reporter=json', `--outputFile=${reportPath}`],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
  );
  let output = [result.stdout ?? '', result.stderr ?? ''].join('\n');
  let report = null;
  if (existsSync(reportPath)) {
    try {
      report = JSON.parse(readFileSync(reportPath, 'utf8'));
    } catch (error) {
      report = null;
      output += `\nfailed to parse ${reportPath}: ${error.message}`;
    }
    rmSync(reportPath, { force: true });
  }
  return {
    project,
    exitCode: result.status ?? 1,
    signal: result.signal ?? null,
    output,
    report,
    reportPath,
  };
}

/** `git rev-parse HEAD` and dirty state; tolerated when git is unavailable. */
function gitState() {
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  return {
    head: head.status === 0 ? head.stdout.trim() : 'unavailable',
    dirty: status.status === 0 ? status.stdout.trim().length > 0 : false,
  };
}

function dockerAvailable() {
  const probe = spawnSync('docker', ['info'], { encoding: 'utf8' });
  return probe.status === 0;
}

function providerConfigured() {
  return [
    'AGENTDEV_PROVIDER_BASE_URL',
    'AGENTDEV_PROVIDER_MODEL',
    'AGENTDEV_PROVIDER_SECRET',
  ].every((name) => typeof process.env[name] === 'string' && process.env[name].length > 0);
}

/** Discovers drill reports from CLI flags, the environment and the WP-10 drill dir. */
function discoverDrillReports(explicit) {
  const paths = [...explicit];
  const fromEnv = process.env.AGENTDEV_DRILL_REPORTS;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    for (const part of fromEnv.split(delimiter).join(',').split(',')) {
      if (part.trim().length > 0) paths.push(resolve(repoRoot, part.trim()));
    }
  }
  if (existsSync(DRILL_DIR)) {
    for (const entry of readdirSync(DRILL_DIR)) {
      if (entry.endsWith('.json')) paths.push(join(DRILL_DIR, entry));
    }
  }
  for (const candidate of ['e2e-results.json', 'live-results.json']) {
    const full = join(repoRoot, '.agentdev', 'work', 'WP-10', candidate);
    if (existsSync(full)) paths.push(full);
  }
  return [...new Set(paths)].sort();
}

function loadDrillReports(paths) {
  const results = new Map();
  const problems = [];
  const sources = [];
  for (const path of paths) {
    if (!existsSync(path)) {
      problems.push(`drill report not found: ${toRepoPath(path)}`);
      continue;
    }
    let payload;
    try {
      payload = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      problems.push(`drill report ${toRepoPath(path)} is not valid JSON: ${error.message}`);
      continue;
    }
    const parsed = parseDrillReport(payload, toRepoPath(path));
    for (const problem of parsed.problems) problems.push(problem);
    for (const [id, entry] of parsed.results) results.set(id, entry);
    sources.push(toRepoPath(path));
  }
  return { results, problems, sources };
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }

  const docPath = join(repoRoot, ACCEPTANCE_DOC);
  const { cases, problems: registryProblems } = parseAcceptanceDoc(readFileSync(docPath, 'utf8'));
  const runProblems = [...registryProblems];

  process.stdout.write(`acceptance: parsed ${cases.length} ACs from ${ACCEPTANCE_DOC}\n`);
  if (registryProblems.length > 0) {
    process.stderr.write(
      `acceptance: registry is not valid:\n  ${registryProblems.join('\n  ')}\n`,
    );
  }

  const sources = collectTestFiles(join(repoRoot, 'packages'), [])
    .concat(collectTestFiles(join(repoRoot, 'apps'), []))
    .sort()
    .map((file) => ({ file: toRepoPath(file), text: readFileSync(file, 'utf8') }));

  const runs = [];
  let infraFailure = false;
  for (const project of options.projects) {
    process.stdout.write(`acceptance: running vitest project "${project}" ...\n`);
    const run = runProject(project);
    runs.push(run);
    process.stdout.write(
      `acceptance: project "${project}" exit=${run.exitCode} ${
        run.report === null
          ? 'no JSON report'
          : `${run.report.numTotalTests} tests, ${run.report.numFailedTests} failed`
      }\n`,
    );
    if (run.report === null) {
      infraFailure = true;
      process.stderr.write(
        `acceptance: project "${project}" produced no JSON report (exit ${run.exitCode})\n${run.output.slice(-2000)}\n`,
      );
    }
  }

  const drill = loadDrillReports(discoverDrillReports(options.drillReports));
  runProblems.push(...drill.problems);

  const { results, counts, diagnostics } = aggregateAcceptance({
    cases,
    reports: runs.map((run) => ({ project: run.project, report: run.report })),
    sources,
    drillResults: drill.results,
    normalizeFile: toRepoPath,
  });

  const missingResults = EXPECTED_AC_IDS.filter(
    (id) => !results.some((result) => result.id === id),
  );

  let exitCode = 0;
  if (infraFailure || registryProblems.length > 0) exitCode = 2;
  else if (
    counts.FAIL > 0 ||
    missingResults.length > 0 ||
    diagnostics.unmappedFailures.length > 0
  ) {
    exitCode = 1;
  }

  const git = gitState();
  const report = renderAcceptanceReport({
    meta: {
      generatedAt: new Date().toISOString(),
      repoRoot,
      gitHead: git.head,
      gitDirty: git.dirty,
      nodeVersion: process.version,
      dockerAvailable: dockerAvailable(),
      providerConfigured: providerConfigured(),
    },
    cases,
    results,
    counts,
    runs,
    diagnostics,
    drillSources: drill.sources,
    registryProblems: [...runProblems, ...missingResults.map((id) => `no result for ${id}`)],
    exitCode,
  });

  if (options.write) {
    mkdirSync(dirname(options.report), { recursive: true });
    writeFileSync(options.report, report, 'utf8');
    process.stdout.write(`acceptance: wrote ${toRepoPath(options.report)}\n`);
  }
  if (options.json !== null) {
    mkdirSync(dirname(options.json), { recursive: true });
    writeFileSync(
      options.json,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          counts,
          results: results.map((result) => ({
            id: result.id,
            status: result.status,
            mapping: result.mapping,
            evidence: result.evidence.map((test) => `${toRepoPath(test.file)} :: ${test.fullName}`),
            reason: result.reason,
          })),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    process.stdout.write(`acceptance: wrote ${toRepoPath(options.json)}\n`);
  }

  process.stdout.write('\n');
  process.stdout.write(renderConsoleTable(results, repoRoot));
  process.stdout.write('\n\n');
  process.stdout.write(
    `acceptance: ${results.length}/${EXPECTED_AC_IDS.length} ACs accounted — PASS ${counts.PASS} / FAIL ${counts.FAIL} / UNVERIFIED ${counts.UNVERIFIED}\n`,
  );
  if (missingResults.length > 0) {
    process.stderr.write(`acceptance: no result for ${missingResults.join(', ')}\n`);
  }
  if (diagnostics.unmappedFailures.length > 0) {
    process.stderr.write(
      `acceptance: ${diagnostics.unmappedFailures.length} failing test(s) are not mapped to any AC\n`,
    );
  }
  if (exitCode !== 0) {
    process.stderr.write(
      `acceptance: FAILED (exit ${exitCode}) — ${
        infraFailure
          ? 'a Vitest project produced no JSON report'
          : registryProblems.length > 0
            ? 'the AC registry is invalid'
            : 'there are FAIL results, missing AC results or unmapped failing tests'
      }\n`,
    );
  } else {
    process.stdout.write('acceptance: OK — every AC has a result and no mapped check failed\n');
  }
  return exitCode;
}

process.exit(main());
