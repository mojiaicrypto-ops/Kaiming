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
 * 3. **runs the release drills itself** (`scripts/e2e.mjs`, `scripts/live.mjs`) with a
 *    nonce `--drill-out` path, so the drill evidence is produced by this run instead of
 *    read from a repository file a reviewer can edit (WP-10 review round 1, W10R1-01);
 * 4. maps every executed test to the ACs it proves — by test name, or by an explicit
 *    curated `{file, title}` entry, never by "the file mentions the id" (W10R1-04);
 * 5. takes the **weakest link** across all sources per AC: `FAIL` fails it, any
 *    `UNVERIFIED` keeps a suite `PASS` from being reported as a full pass, and every
 *    source is listed (W10R1-03/05);
 * 6. accepts an `UNVERIFIED`/`MISSING` only when it is a **registered accepted gap**
 *    (`scripts/lib/drill-acs.mjs`) whose condition still holds in this environment;
 *    an unregistered or no-longer-valid gap is a FAIL (W10R1-02/08);
 * 7. fails closed on infrastructure problems: a Vitest project with no JSON report, a
 *    mapped test file that executed zero tests, a failing test mapped to no AC, a drill
 *    report that is missing/unparsable, or a drill report whose `binding` does not match
 *    the current code tree;
 * 8. writes `.agentdev/work/WP-10/acceptance.md` (report) and
 *    `acceptance-results.json` (machine readable, consumed by the release gate).
 *
 * Usage:
 *   node scripts/acceptance.mjs [--report <path>] [--json <path>]
 *                               [--projects unit,integration]
 *                               [--no-drills] [--no-write] [--help]
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
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeBinding } from './lib/acceptance-binding.mjs';
import { runDrills } from './lib/acceptance-drills.mjs';
import { aggregateAcceptance } from './lib/acceptance-evidence.mjs';
import { ACCEPTANCE_DOC, EXPECTED_AC_IDS, parseAcceptanceDoc } from './lib/acceptance-registry.mjs';
import { renderAcceptanceReport, renderConsoleTable } from './lib/acceptance-report.mjs';
import {
  RESIDUAL_GAPS,
  conditionHolds,
  providerConfigured,
  reviewModelConfigured,
} from './lib/drill-acs.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
/**
 * Where this run writes its records: the current work package, so a real acceptance run
 * cannot overwrite another package's evidence (WP-12 fix). `--report-dir` (or
 * `AGENTDEV_REPORT_DIR`) moves both files.
 *
 * The *drill* evidence is unaffected: `scripts/lib/acceptance-drills.mjs` spawns the
 * drills with `--drill-out` inside a temporary directory and adopts a report only when it
 * carries this run's nonce, so no repository file is ever read as evidence (W10R1-01).
 */
const DEFAULT_REPORT_DIR = process.env.AGENTDEV_REPORT_DIR
  ? resolve(process.env.AGENTDEV_REPORT_DIR)
  : join(repoRoot, '.agentdev', 'work', 'WP-12');
const DEFAULT_REPORT = join(DEFAULT_REPORT_DIR, 'acceptance.md');
const DEFAULT_JSON = join(DEFAULT_REPORT_DIR, 'acceptance-results.json');

function usage() {
  return [
    'Usage: node scripts/acceptance.mjs [options]',
    '',
    '  --report-dir <path>      where both records go (default .agentdev/work/WP-12)',
    '  --report <path>          markdown output (default <report-dir>/acceptance.md)',
    '  --json <path>            machine-readable sidecar (default <report-dir>/acceptance-results.json)',
    '  --projects <list>        vitest projects to run (default unit,integration)',
    '  --no-drills              do not run scripts/e2e.mjs / scripts/live.mjs in this run',
    '  --no-write               print only, do not write the reports',
    '  --help                   show this help',
    '',
    'The release drills run by default so drill evidence is produced by this run.',
    'There is no option to feed an externally produced drill report: a report is only',
    "adopted when it carries this run's nonce and matches the current code binding.",
  ].join('\n');
}

function parseArgs(argv) {
  const options = {
    report: DEFAULT_REPORT,
    json: DEFAULT_JSON,
    projects: ['unit', 'integration'],
    drills: true,
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
    if (arg === '--report-dir') {
      const dir = resolve(repoRoot, next());
      options.report = join(dir, 'acceptance.md');
      options.json = join(dir, 'acceptance-results.json');
    } else if (arg === '--report') options.report = resolve(repoRoot, next());
    else if (arg === '--json') options.json = resolve(repoRoot, next());
    else if (arg === '--projects')
      options.projects = next()
        .split(',')
        .map((name) => name.trim());
    else if (arg === '--no-drills') options.drills = false;
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
  const startedAt = Date.now();
  const result = spawnSync(
    vitest,
    ['run', '--project', project, '--reporter=json', `--outputFile=${reportPath}`],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 },
  );
  const durationMs = Date.now() - startedAt;
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
    // `spawnSync` reports its own failures (a signal, `ENOBUFS` from `maxBuffer`, a missing
    // executable) here rather than in `status`: without it "no JSON report" has no cause.
    spawnError:
      result.error === undefined
        ? null
        : `${result.error.name}: ${result.error.message}${'code' in result.error ? ` (${String(result.error.code)})` : ''}`,
    durationMs,
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

  const binding = computeBinding(repoRoot);
  const docPath = join(repoRoot, ACCEPTANCE_DOC);
  const { cases, problems: registryProblems } = parseAcceptanceDoc(readFileSync(docPath, 'utf8'));
  const runProblems = [...registryProblems];

  process.stdout.write(`acceptance: parsed ${cases.length} ACs from ${ACCEPTANCE_DOC}\n`);
  process.stdout.write(
    `acceptance: evidence binding ${binding.codeDigest.slice(0, 19)}… (HEAD ${binding.gitHead.slice(0, 7)}, ${String(binding.codeFiles)} code files)\n`,
  );
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
  const runInfraProblems = [];
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
      // Name the project and the *cause*: a vitest run that writes no report was killed
      // (`signal`), killed by the output cap (`spawnError`), or crashed on its own
      // (`exitCode`). Without these three fields "no JSON report" is unattributable
      // (WP-12 R9).
      const cause = `${run.signal === null ? '' : `signal=${String(run.signal)} `}${
        run.spawnError === null ? '' : `spawnError=${run.spawnError} `
      }duration=${String(run.durationMs)}ms`;
      process.stderr.write(
        `acceptance: project "${project}" produced no JSON report (exit ${String(run.exitCode)} ${cause})\n${run.output.slice(-4000)}\n`,
      );
      runInfraProblems.push(
        `Vitest 项目「${project}」没有产出 JSON 报告：exit=${String(run.exitCode)} ${cause}`,
      );
    } else if (run.exitCode !== 0) {
      // A Vitest project that exits non-zero is not a clean pass even when its JSON
      // report happens to list no failing case (collection errors, unhandled rejections,
      // a worker crash). Never treat that as acceptable evidence.
      //
      // This branch has a *report*: the problem is the non-zero exit, never a missing
      // JSON file. Reporting it as "no JSON report" sent readers after the report
      // mechanism while the real failure sat in the report's `failureMessage`
      // (`test.md` §4.5). Both the sidecar problem and the stderr line now name the exit
      // code, the report's own test counts and its first failure, so the next reader
      // goes straight to the failing case.
      const failed = (run.report.testResults ?? [])
        .flatMap((file) =>
          (file.assertionResults ?? [])
            .filter((test) => test.status === 'failed')
            .map((test) => `${file.name ?? '?'} :: ${test.fullName ?? test.title ?? '<unnamed>'}`),
        )
        .slice(0, 5);
      process.stderr.write(
        `acceptance: project "${project}" exited ${String(run.exitCode)} although it produced a JSON report (${String(run.report.numTotalTests)} tests, ${String(run.report.numFailedTests)} failed)\n${failed.length === 0 ? '' : `${failed.join('\n')}\n`}${run.output.slice(-2000)}\n`,
      );
      runInfraProblems.push(
        `Vitest 项目「${project}」exit=${String(run.exitCode)}，但产出了 JSON 报告（${String(run.report.numTotalTests)} 个用例、${String(run.report.numFailedTests)} 个失败）：问题是非零退出，不是缺少报告${
          failed.length === 0 ? '' : `；失败用例：${failed.join('；')}`
        }`,
      );
    }
  }

  const drills = runDrills({ repoRoot, skip: !options.drills });
  if (!drills.executed) {
    process.stdout.write(
      'acceptance: NOTE — release drills were NOT executed in this run (--no-drills); this aggregation is a development check, not a release verdict, and the release gate refuses its sidecar\n',
    );
  }
  runProblems.push(...drills.problems);
  const drillResults = new Map();
  for (const [ac, entries] of drills.results) drillResults.set(ac, [...entries]);

  const { results, diagnostics } = aggregateAcceptance({
    cases,
    reports: runs.map((run) => ({ project: run.project, report: run.report })),
    sources,
    drillResults,
    normalizeFile: toRepoPath,
  });

  // Accepted gaps: an UNVERIFIED/MISSING AC is tolerable only when it is registered
  // *and* the condition behind its registration still holds. Anything else is a FAIL.
  const unaccepted = [];
  for (const result of results) {
    if (result.status !== 'UNVERIFIED' && result.status !== 'MISSING') continue;
    const registration = RESIDUAL_GAPS[result.id];
    if (registration === undefined) {
      result.accepted = false;
      unaccepted.push({
        id: result.id,
        status: result.status,
        why: `未登记的 ${result.status}：${String(result.reason ?? '未给出原因')}；未验证项必须有已登记的豁免与产品决定`,
      });
      continue;
    }
    const condition = conditionHolds(registration.condition);
    if (condition.holds) {
      result.accepted = true;
      result.decision = registration.decision;
      result.residual = registration.residual ?? null;
    } else {
      result.accepted = false;
      unaccepted.push({
        id: result.id,
        status: result.status,
        why: `豁免条件不再成立（${registration.condition}）：${condition.why}`,
      });
    }
  }

  const acceptedCount = results.filter((result) => result.accepted === true).length;
  const finalCounts = {
    PASS: results.filter((result) => result.status === 'PASS').length,
    ACCEPTED: acceptedCount,
    FAIL: results.filter((result) => result.status === 'FAIL').length + unaccepted.length,
    MISSING: results.filter((result) => result.status === 'MISSING' && result.accepted !== true)
      .length,
  };

  const missingResults = EXPECTED_AC_IDS.filter(
    (id) => !results.some((result) => result.id === id),
  );

  // Fail closed on infrastructure problems: they mean the evidence is not trustworthy.
  const infraProblems = [
    ...runProblems,
    ...runInfraProblems,
    ...diagnostics.unexecuted.map(
      (file) => `含 AC 证据的测试文件没有执行任何用例：${file}（文件消失/未被收集）`,
    ),
    ...diagnostics.unmappedFailures.map(
      (test) => `失败用例未映射到任何 AC：${test.file} :: ${test.fullName}`,
    ),
    ...missingResults.map((id) => `没有 ${id} 的结果`),
  ];

  let exitCode = 0;
  if (infraProblems.length > 0) exitCode = 2;
  else if (finalCounts.FAIL > 0) exitCode = 1;

  const git = gitState();
  const meta = {
    generatedAt: new Date().toISOString(),
    repoRoot,
    gitHead: git.head,
    gitDirty: git.dirty,
    nodeVersion: process.version,
    dockerAvailable: dockerAvailable(),
    providerConfigured: providerConfigured(),
    reviewModelConfigured: reviewModelConfigured(),
    binding,
    drillsExecuted: drills.executed,
    exitCode,
  };

  const report = renderAcceptanceReport({
    meta,
    cases,
    results,
    counts: finalCounts,
    runs,
    drillRuns: drills.runs,
    drillSources: drills.sources,
    diagnostics,
    problems: infraProblems,
    unaccepted,
    exitCode,
  });

  const sidecar = {
    tool: 'pnpm test:acceptance',
    generatedAt: meta.generatedAt,
    // Nonce of the caller that asked for this run (`scripts/live.mjs --release`); the
    // release gate rejects a sidecar that does not carry its own nonce, so a planted
    // file with the right digest and a plausible timestamp is not accepted.
    runNonce: process.env.AGENTDEV_ACCEPTANCE_NONCE ?? null,
    gitHead: meta.gitHead,
    gitTree: binding.gitTree,
    codeDigest: binding.codeDigest,
    nodeVersion: meta.nodeVersion,
    providerConfigured: meta.providerConfigured,
    reviewModelConfigured: meta.reviewModelConfigured,
    drillsExecuted: meta.drillsExecuted,
    exitCode,
    counts: finalCounts,
    problems: infraProblems,
    unaccepted,
    results: results.map((result) => ({
      id: result.id,
      status: result.status,
      accepted: result.accepted === true,
      decision: result.decision ?? null,
      residual: result.residual ?? null,
      mapping: result.mapping,
      gap: result.gap,
      reason: result.reason,
      evidence: result.evidence.map((test) => `${toRepoPath(test.file)} :: ${test.fullName}`),
      drills: result.drills.map((drill) => ({
        tool: drill.tool,
        status: drill.status,
        evidence: drill.evidence,
      })),
    })),
  };

  if (options.write) {
    mkdirSync(dirname(options.report), { recursive: true });
    writeFileSync(options.report, report, 'utf8');
    process.stdout.write(`acceptance: wrote ${toRepoPath(options.report)}\n`);
    mkdirSync(dirname(options.json), { recursive: true });
    writeFileSync(options.json, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
    process.stdout.write(`acceptance: wrote ${toRepoPath(options.json)}\n`);
  }

  process.stdout.write('\n');
  process.stdout.write(renderConsoleTable(results, repoRoot));
  process.stdout.write('\n\n');
  process.stdout.write(
    `acceptance: ${String(results.length)}/${String(EXPECTED_AC_IDS.length)} ACs accounted — PASS ${String(finalCounts.PASS)} / ACCEPTED ${String(finalCounts.ACCEPTED)} / FAIL ${String(finalCounts.FAIL)} / MISSING ${String(finalCounts.MISSING)}\n`,
  );
  if (finalCounts.ACCEPTED > 0) {
    process.stdout.write(
      `acceptance: ${String(finalCounts.ACCEPTED)} ACs are UNVERIFIED under a registered, condition-checked accepted gap (see the report).\n`,
    );
  }
  for (const problem of infraProblems) {
    process.stderr.write(`acceptance: ${problem}\n`);
  }
  for (const entry of unaccepted) {
    process.stderr.write(`acceptance: ${entry.id} ${entry.status} — ${entry.why}\n`);
  }
  if (exitCode !== 0) {
    process.stderr.write(
      `acceptance: FAILED (exit ${String(exitCode)}) — ${
        exitCode === 2
          ? 'the evidence itself is not trustworthy (infrastructure problem)'
          : 'there are FAIL results or unaccepted UNVERIFIED/MISSING results'
      }\n`,
    );
  } else {
    process.stdout.write(
      'acceptance: OK — every AC is PASS or a registered, condition-checked accepted gap\n',
    );
  }
  return exitCode;
}

process.exit(main());
