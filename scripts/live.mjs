#!/usr/bin/env node
/**
 * `pnpm test:live` — the real-Provider longitudinal drill and the release drill.
 *
 * Contract (`docs/delivery/implementation.md` §3):
 *
 * - *test:live* is "用户已配置的真实 Provider 纵向演练" and passes only when the HTML,
 *   L1 and L2+settlement paths all succeed against the endpoint the user configured
 *   in `AGENTDEV_PROVIDER_BASE_URL` / `AGENTDEV_PROVIDER_MODEL` /
 *   `AGENTDEV_PROVIDER_SECRET`.
 * - When those variables are absent the command exits non-zero with the explicit
 *   `UNVERIFIED: real Provider not configured (set …)` message and records that result
 *   in `.agentdev/work/WP-10/live.md` / `live-results.json`. It never calls a network
 *   endpoint nobody configured and never fakes a pass.
 *
 * `node scripts/live.mjs --release` runs the release drill instead: every documented
 * engineering command in order, the acceptance aggregation, the deployment notes and
 * the integrated readiness gate (`scripts/lib/live-release.mjs`).
 *
 * Usage:
 *   node scripts/live.mjs [--no-write] [--keep-temp] [--drill-out <path>] [--help]
 *   node scripts/live.mjs --release [--no-write] [--help]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { computeBinding } from './lib/acceptance-binding.mjs';
import {
  E2E_BROWSER_ISOLATION_ACS,
  INDEPENDENT_MODEL_AC,
  LIVE_DRILL_ACS,
} from './lib/drill-acs.mjs';
import { CheckFailure } from './lib/e2e-checks.mjs';
import {
  runHtmlDrill,
  runL1Drill,
  runL2Drill,
  runRuntimeAttemptDrill,
} from './lib/live-drills.mjs';
import { bootLiveStack, shutdownLiveStack } from './lib/live-harness.mjs';
import { renderLiveRecord, liveDrillReport, CheckList } from './lib/live-report.mjs';
import {
  PROVIDER_ENV,
  createOpenAiCompatibleTransport,
  readProviderEnvironment,
} from './lib/live-transport.mjs';
import { REPO_ROOT, loadProduct, revisionOf } from './lib/e2e-runtime.mjs';

const REPORT_DIR = join(REPO_ROOT, '.agentdev', 'work', 'WP-10');

/** Exit code used when the environment cannot supply the real Provider. */
const EXIT_UNVERIFIED = 3;

/**
 * The drill -> AC mapping lives in `scripts/lib/drill-acs.mjs`, shared with the
 * acceptance aggregator so the two lists cannot drift (WP-10 review round 1,
 * W10R1-10). The offline suites and the e2e drill cannot reach these: AC-001 needs a
 * real model answer, AC-007's L1 lane needs a real execution, and AC-010/AC-037/AC-041
 * need the real Review/Test/settlement/knowledge path.
 *
 * AC-002/AC-052 stay UNVERIFIED even here: the drill proves the server-side isolation
 * policy (`default-src 'none'`, `allow-scripts`, credential omission) and a real
 * one-shot download, but "浏览器渲染与脚本隔离" needs a browser this release
 * deliberately does not ship. AC-043 is only claimed when the environment names a
 * distinct Review/Test model; otherwise the drill still proves independent Runs and
 * distinct frozen snapshots and the AC is recorded UNVERIFIED.
 */
const DRILL_ACS = LIVE_DRILL_ACS;

function usage() {
  return [
    'Usage: node scripts/live.mjs [options]',
    '',
    '  --release    run the release drill (every documented engineering command,',
    '               the acceptance aggregation, the readiness gate and release.md)',
    '  --no-write        print the run only; do not write the WP-10 reports',
    '  --keep-temp       keep the temporary project/state directories for forensics',
    '  --drill-out <p>   write the drill JSON to <p> instead of the WP-10 records',
    '                    (used by scripts/acceptance.mjs, which runs this drill itself)',
    '  --help       show this help',
    '',
    `Environment: ${Object.values(PROVIDER_ENV).join(', ')}.`,
    'Without all three the provider drill exits non-zero with an explicit UNVERIFIED',
    'message and never calls any endpoint.',
  ].join('\n');
}

function parseArgs(argv) {
  const options = { release: false, write: true, keepTemp: false, drillOut: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--release') options.release = true;
    else if (arg === '--no-write') options.write = false;
    else if (arg === '--keep-temp') options.keepTemp = true;
    else if (arg === '--drill-out') {
      index += 1;
      if (index >= argv.length) throw new Error('--drill-out requires a path');
      options.drillOut = argv[index];
    } else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

/**
 * Writes `live-results.json` and `live.md` from the executed check list.
 *
 * With `--drill-out` (the aggregator's in-run mode) only the nonce JSON file is
 * written; the WP-10 records stay as the standalone `pnpm test:live` run left them.
 */
function writeLiveReports(checks, meta, write, drillOut = null) {
  const report = liveDrillReport(checks, meta);
  if (drillOut !== null) {
    mkdirSync(dirname(drillOut), { recursive: true });
    writeFileSync(drillOut, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`live: wrote drill report to ${drillOut}\n`);
    return;
  }
  if (!write) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, 'live-results.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(REPORT_DIR, 'live.md'), renderLiveRecord(checks, meta));
  process.stdout.write('live: wrote .agentdev/work/WP-10/live-results.json and live.md\n');
}

/** The residual register the live record always carries. */
const LIVE_RESIDUALS = Object.freeze([
  '真实浏览器未执行（焦点遍历、像素级布局、脚本隔离攻击样例）：产品决定不引入 Playwright 或浏览器下载；浏览器级 AC-002/AC-052/AC-071/AC-073/AC-076 的浏览器侧证据仍为 UNVERIFIED（本演练只验证服务端 CSP/sandbox/一次性下载行为）。',
  'L1 等级来源：`workflow.md` §2.4 的 L1 条件属于 Chief 评估，而当前协议面 `AssessmentPayload` 不携带 L1 判据、`orchestrator.routingFloor` 又会把“声明写路径的 delivery”抬到 L2（DC-62），因此没有真实协议路径能产生 L1 Work；live 演练按 WP-06/AC-068 的既有做法直接落 Work/Authorization/Assessment 行，再由真实 Gate 执行写入与结算。',
  'L1 的 Plan 产物由 Gate 的 `planningRun(...)` 以 planning 角色登记（`packages/core/src/gates.ts`）：L1 CompactPlan 目前仍走同一 Plan 产物通道，没有独立的 CompactPlan API；演练断言的是 L1 链只有 Develop/Review/Settlement 三个阶段 Run。',
  'L2 的 Requirement 投影由演练直接落行（与 e2e 的 L2 演练一致）；需求保存本身由 `pnpm test:e2e` 的 requirement.save-git 覆盖。L2 的 Plan 由真实 Plan Gate 批准（无 productRef），ContextBuilder 的 ProductDefinition 必需项由 WP-05 的提交测试覆盖，不在本演练内。',
  'AC-001 的“读取记录”未由本演练产生：演练直接把真实 Git 内容作为 Chief 选择来源注入 prompt，没有经过 ContextBuilder/read ledger（那由 WP-05 的提交测试覆盖）；本演练覆盖的是真实模型答复区分事实/未知、Work 无 Requirement 且交付分支不变。',
  'CAS journal 使用 @agentdev/workspace 的 createMemoryCasJournal（与 e2e 一致）；崩溃/恢复注入不在本演练范围。',
  'AC-043 仅在环境提供 AGENTDEV_PROVIDER_REVIEW_MODEL（Review/Test 使用另一模型）时按 PASS 记录；否则演练仍验证各专业 Run 独立且各自冻结 config 快照，但“不同 Provider/模型”前提未执行，该 AC 记 UNVERIFIED。',
  '真实 Provider 演练只在三个环境变量齐备时执行；缺失时本文件记录 UNVERIFIED 并以非 0 退出，不伪造成通过。本次配置路径仅以本机回环 OpenAI-compatible 替身做过 `--no-write` 开发冒烟（不写报告、不作为发布证据）。',
]);

/** Provider drill: env gate, real stack, three longitudinal drills. */
async function runProviderDrill(options) {
  const provider = readProviderEnvironment();
  const meta = {
    repoRoot: REPO_ROOT,
    gitHead: revisionOf(REPO_ROOT) || 'unavailable',
    binding: computeBinding(REPO_ROOT),
    nonce: process.env.AGENTDEV_DRILL_NONCE ?? null,
    exitCode: EXIT_UNVERIFIED,
    providerConfigured: provider.configured,
    providerMessage: provider.message,
    providerBaseUrl: provider.baseUrl,
    modelId: provider.modelId,
    reviewModelId: provider.reviewModelId,
    residuals: [...LIVE_RESIDUALS],
  };
  const checks = new CheckList();

  if (!provider.configured) {
    // Fail closed *before* any network use: the refusal is the configured-input check,
    // and every drill that would have run is recorded as UNVERIFIED with that reason.
    process.stderr.write(`${provider.message}\n`);
    checks.unverified('provider.configuration', [], provider.message);
    checks.unverified('drill.html-explanation', DRILL_ACS.html, provider.message);
    checks.unverified('drill.l1-typo', DRILL_ACS.l1, provider.message);
    checks.unverified('drill.l2-delivery', DRILL_ACS.l2, provider.message);
    writeLiveReports(checks, meta, options.write, options.drillOut);
    process.stdout.write(
      `\nlive: UNVERIFIED — 0 real Provider calls were made; set ${Object.values(PROVIDER_ENV).join(', ')} to run the drill\n`,
    );
    return EXIT_UNVERIFIED;
  }

  const product = await loadProduct();
  const transport = createOpenAiCompatibleTransport({ secret: provider.secret });
  let harness;
  try {
    harness = await bootLiveStack({ product, provider, transport, meta });
    await checks.check('provider.connectivity', [], async () => {
      const probe = await harness.probeProvider();
      if (probe.ok !== true) {
        throw new Error(`the configured Provider did not answer: ${String(probe.error)}`);
      }
      return `provider.test completed in ${String(probe.latencyMs)}ms against ${provider.baseUrl} with model ${provider.modelId}; ${transport.summary()}`;
    });
    await checks.check('drill.html-explanation', DRILL_ACS.html, () =>
      runHtmlDrill({ harness, product }),
    );
    await checks.check('drill.l1-typo', DRILL_ACS.l1, () => runL1Drill({ harness, product }));
    await checks.check(
      'drill.l2-delivery',
      provider.reviewModelId === null ? DRILL_ACS.l2 : [...DRILL_ACS.l2, INDEPENDENT_MODEL_AC],
      () => runL2Drill({ harness, product }),
    );
    // The daemon's own executor: supervisor → real Runner child → gateway → real Provider.
    await checks.check('drill.runtime-attempt', ['AC-057'], () =>
      runRuntimeAttemptDrill({ harness, product }),
    );
    checks.unverified(
      'browser.html-rendering',
      E2E_BROWSER_ISOLATION_ACS,
      'AC-002/AC-052 的真实浏览器渲染、脚本隔离与攻击样例需要浏览器环境；本仓库按产品决定不引入 Playwright 或浏览器下载。本演练已执行服务端部分：真实 Provider 产出的 HTML Artifact、预览 CSP/sandbox/credentials 头与一次性下载，浏览器侧仍未验证',
    );
    if (provider.reviewModelId === null) {
      checks.unverified(
        'provider.independent-models',
        [INDEPENDENT_MODEL_AC],
        'AC-043 的“角色配置不同 Provider/模型”需要 AGENTDEV_PROVIDER_REVIEW_MODEL 指定 Review/Test 的独立模型；本演练已验证每个专业 Run 独立且各自冻结 config 快照，但全部角色使用同一个已配置模型，因此多模型前提未执行',
      );
    }
    meta.exitCode = 0;
  } catch (error) {
    if (!(error instanceof CheckFailure)) throw error;
    meta.exitCode = 1;
  } finally {
    await shutdownLiveStack(harness, options.keepTemp);
  }

  writeLiveReports(checks, meta, options.write, options.drillOut);
  process.stdout.write(
    `\nlive: ${checks.passed} passed / ${checks.failed} failed / ${checks.unverifiedCount} unverified; ${transport.summary()}\n`,
  );
  if (meta.exitCode !== 0) {
    process.stderr.write('live: FAILED — the three vertical drills did not all pass\n');
  }
  return meta.exitCode;
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  process.stdout.write(`${usage()}\n`);
  process.exit(0);
}

if (options.release) {
  const { runReleaseDrill } = await import('./lib/live-release.mjs');
  process.exit(await runReleaseDrill({ repoRoot: REPO_ROOT, write: options.write }));
}

process.exit(await runProviderDrill(options));
