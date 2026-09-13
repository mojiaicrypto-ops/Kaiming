/**
 * The release drill and its readiness gate (WP-10 T3, release.md).
 *
 * `node scripts/live.mjs --release` runs the ten engineering commands
 * `docs/delivery/implementation.md` §3 documents, in the documented order, and writes
 * `.agentdev/work/WP-10/release.md` with each command's real exit code, duration and
 * output tail. Nothing is summarised from memory: every row is a spawn result.
 *
 * The drill also carries the **release-readiness check** integrated into the same run
 * (there is no separate command). It reads the acceptance result **of this run** — the
 * `acceptance-results.json` sidecar written by the `pnpm test:acceptance` command above,
 * only when its binding matches the current code tree, it was produced inside this run
 * and it comes from a run that really executed the release drills (WP-10 review round 1,
 * W10R1-06/07). Readiness then fails when:
 *
 * - any documented command exited non-zero;
 * - the acceptance result is missing, stale, unbound or drill-less;
 * - any AC is `FAIL` or `MISSING`;
 * - any AC is `UNVERIFIED` without a registered, condition-checked accepted gap.
 *
 * Accepted gaps (the browser half this release deliberately does not ship, the real
 * Provider when the environment has none) do not block readiness, but they are printed
 * as an explicit `READY (ACCEPTED RISK n)` verdict with the list, never folded into a
 * plain `READY` (W10R1-08).
 *
 * The deployment notes are generated with the exact commands this release actually
 * implements. Commands the product does not ship yet are marked `UNVERIFIED` with the
 * concrete gap instead of being invented.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { computeBinding } from './acceptance-binding.mjs';
import { providerConfigured } from './drill-acs.mjs';

/** Where the drill writes its record, relative to the repository root. */
export const RELEASE_REPORT = join('.agentdev', 'work', 'WP-10', 'release.md');

/**
 * The documented engineering commands, in the documented order.
 *
 * `timeoutMs` is a runaway guard, not a pass condition; a timeout is a non-zero exit
 * and is reported with the command's partial output.
 */
export const RELEASE_COMMANDS = Object.freeze([
  {
    id: 'install',
    command: 'pnpm install --frozen-lockfile',
    bin: 'pnpm',
    args: ['install', '--frozen-lockfile'],
    scope: '固定依赖',
    timeoutMs: 900_000,
  },
  {
    id: 'typecheck',
    command: 'pnpm typecheck',
    bin: 'pnpm',
    args: ['typecheck'],
    scope: '全 Workspace tsc --noEmit',
    timeoutMs: 600_000,
  },
  {
    id: 'lint',
    command: 'pnpm lint',
    bin: 'pnpm',
    args: ['lint'],
    scope: 'ESLint + Prettier --check',
    timeoutMs: 600_000,
  },
  {
    id: 'test:unit',
    command: 'pnpm test:unit',
    bin: 'pnpm',
    args: ['test:unit'],
    scope: 'Vitest unit',
    timeoutMs: 900_000,
  },
  {
    id: 'test:integration',
    command: 'pnpm test:integration',
    bin: 'pnpm',
    args: ['test:integration'],
    scope: 'Vitest integration（SQLite/Git/Pi/WS/容器）',
    timeoutMs: 1_800_000,
  },
  {
    id: 'test:e2e',
    command: 'pnpm test:e2e',
    bin: 'pnpm',
    args: ['test:e2e'],
    scope: '真实 Core + BFF 无头端到端（Provider 桩）',
    timeoutMs: 1_800_000,
  },
  {
    id: 'test:acceptance',
    command: 'pnpm test:acceptance',
    bin: 'pnpm',
    args: ['test:acceptance'],
    scope: 'AC 证据汇总',
    timeoutMs: 1_800_000,
  },
  {
    id: 'test:live',
    command: 'pnpm test:live',
    bin: 'pnpm',
    args: ['test:live'],
    scope: '真实 Provider 纵向演练',
    timeoutMs: 1_800_000,
  },
  {
    id: 'docs:check',
    command: 'pnpm docs:check',
    bin: 'pnpm',
    args: ['docs:check'],
    scope: 'Markdown 链接与文档索引',
    timeoutMs: 300_000,
  },
  {
    id: 'build',
    command: 'pnpm build',
    bin: 'pnpm',
    args: ['build'],
    scope: 'daemon/runner/web/cli 发布产物',
    timeoutMs: 900_000,
  },
]);

/** The last `count` non-empty lines of a command's output. */
export function tailLines(output, count) {
  const lines = String(output ?? '')
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+$/u, ''))
    .filter((line) => line.length > 0);
  return lines.slice(Math.max(0, lines.length - count)).join('\n');
}

/** Runs one documented command and captures its real exit code and output. */
function runCommand(entry, repoRoot) {
  const startedAt = Date.now();
  const result = spawnSync(entry.bin, entry.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 256 * 1024 * 1024,
    timeout: entry.timeoutMs,
  });
  const output = [result.stdout ?? '', result.stderr ?? ''].join('\n');
  const timedOut = result.error !== undefined && result.error.code === 'ETIMEDOUT';
  return {
    ...entry,
    exitCode: result.status ?? (result.error === undefined ? 1 : 127),
    durationMs: Date.now() - startedAt,
    error: result.error?.message ?? null,
    timedOut,
    output,
    tail: tailLines(output, 20),
  };
}

/**
 * Reads the acceptance result of *this* run from its machine-readable sidecar.
 *
 * The sidecar is only trusted when it was produced inside this release run
 * (`generatedAt >= startedAt`), carries a binding that matches the current code tree,
 * and comes from a run that executed the release drills. A stale or forged report is
 * reported as unavailable instead of being summarised (WP-10 review round 1,
 * W10R1-06/07).
 *
 * @param {string} repoRoot
 * @param {string} startedAt ISO timestamp the release drill started at
 * @returns {{ available: boolean, why: string|null, total: number|null, pass: number|null,
 *             accepted: number|null, fail: number|null, missing: number|null,
 *             drillsExecuted: boolean, acceptedGaps: Array<{id: string, decision: string|null, gap: string|null}> }}
 */
export function readAcceptanceResult(repoRoot, startedAt) {
  const unavailable = (why) => ({
    available: false,
    why,
    total: null,
    pass: null,
    accepted: null,
    fail: null,
    missing: null,
    drillsExecuted: false,
    acceptedGaps: [],
  });
  const sidecar = join(repoRoot, '.agentdev', 'work', 'WP-10', 'acceptance-results.json');
  if (!existsSync(sidecar)) return unavailable('本次运行没有产出 acceptance-results.json');
  let payload;
  try {
    payload = JSON.parse(readFileSync(sidecar, 'utf8'));
  } catch (error) {
    return unavailable(`acceptance-results.json 无法解析：${error.message}`);
  }
  if (typeof payload.generatedAt !== 'string' || payload.generatedAt < startedAt) {
    return unavailable(
      `acceptance-results.json 生成于 ${String(payload.generatedAt)}，早于本次发布演练开始时间 ${startedAt}（拒绝使用旧结果）`,
    );
  }
  const binding = computeBinding(repoRoot);
  if (payload.codeDigest !== binding.codeDigest) {
    return unavailable(
      `acceptance-results.json 的 codeDigest ${String(payload.codeDigest)} 与当前代码树 ${binding.codeDigest} 不一致`,
    );
  }
  if (payload.drillsExecuted !== true) {
    return unavailable('acceptance-results.json 来自未执行发布演练的聚合运行（--no-drills）');
  }
  const results = Array.isArray(payload.results) ? payload.results : [];
  return {
    available: true,
    why: null,
    total: results.length,
    pass: payload.counts?.PASS ?? null,
    accepted: payload.counts?.ACCEPTED ?? null,
    fail: payload.counts?.FAIL ?? null,
    missing: payload.counts?.MISSING ?? null,
    drillsExecuted: true,
    acceptedGaps: results
      .filter((entry) => entry.accepted === true)
      .map((entry) => ({ id: entry.id, decision: entry.decision ?? null, gap: entry.gap ?? null })),
  };
}

/** Runs `pnpm doctor` and returns its real outcome for the deployment notes. */
function runDoctor(repoRoot) {
  const entry = {
    id: 'doctor',
    command: 'pnpm doctor',
    bin: 'pnpm',
    args: ['doctor'],
    scope: '依赖/镜像/目录/端口探测',
    timeoutMs: 300_000,
  };
  return runCommand(entry, repoRoot);
}

/** Renders the deployment/run notes with the exact commands this release ships. */
function renderRunNotes(doctor) {
  const lines = [];
  lines.push('## 5. 部署与运行说明（本版本实际命令）');
  lines.push('');
  lines.push('| 步骤 | 确切命令 | 结果 |');
  lines.push('|---|---|---|');
  lines.push(
    `| 环境体检 | \`pnpm doctor\`（即 \`node apps/cli/dist/cli.js doctor\`，需先 \`pnpm build\`） | exit ${String(doctor.exitCode)}；${doctor.exitCode === 0 ? 'executionReady=true' : '非 0：依赖/Docker/端口未就绪，原始输出见 §4'} |`,
  );
  lines.push('| 安装依赖 | `pnpm install --frozen-lockfile` | 见 §1 的 `install` 行 |');
  lines.push('| 构建发布产物 | `pnpm build` | 见 §1 的 `build` 行 |');
  lines.push(
    '| 启动 daemon | UNVERIFIED — 本版本 CLI 只实现 `doctor`/`version`（`apps/cli/src/cli.ts`），没有 `agentdev start`；真实 daemon 由 `createDaemon(...)` 组装并以 `server.listen(...)` 监听（演练脚本即如此启动） | 未验证 |',
  );
  lines.push(
    '| 打开 Web 工作台 | UNVERIFIED — 没有 `agentdev open`；BFF 由 `createWebApp(...)` 组装并监听回环端口（`pnpm test:e2e`/`test:live` 中真实启动，端口为 0=临时回环端口） | 未验证 |',
  );
  lines.push(
    '| 备份 | UNVERIFIED（CLI 级）— 没有 `agentdev backup`；现有真实入口是 daemon RPC `backup.run`（`apps/daemon/src/protocol.ts`）与 `packages/core` 的 backup/restore 服务（AC-064 由集成测试覆盖） | 未验证 |',
  );
  lines.push(
    '| 恢复 | UNVERIFIED（CLI 级）— 没有 `agentdev restore`；现有真实入口是 daemon RPC `restore.run` 与 `packages/core` 的恢复服务；恢复后 Provider Secret 必须单独重新配置（备份不含 Secret） | 未验证 |',
  );
  lines.push(
    '| 关闭/停止 | UNVERIFIED — 没有 `agentdev stop`；优雅停止（停止准入→保存 Checkpoint→回收容器→关闭数据库）由 `packages/core` 的恢复/结算路径实现，未暴露为 CLI | 未验证 |',
  );
  lines.push('');
  lines.push(
    '说明：以上 UNVERIFIED 不是演练失败，而是本版本尚未交付的 CLI 面；`reliability.md` §7 的 `agentdev start/stop/status/open/backup/restore/relocate` 是待交付接口。',
  );
  lines.push('');
  return lines;
}

/**
 * Runs the whole release drill.
 *
 * @param {{ repoRoot: string, write?: boolean }} options
 * @returns {Promise<number>} the readiness exit code
 */
export async function runReleaseDrill(options) {
  const repoRoot = options.repoRoot;
  const write = options.write !== false;
  const startedAt = new Date().toISOString();
  process.stdout.write('release: running the documented engineering commands in order\n');
  const runs = [];
  for (const entry of RELEASE_COMMANDS) {
    process.stdout.write(`release: ${entry.command} ...\n`);
    const run = runCommand(entry, repoRoot);
    runs.push(run);
    process.stdout.write(
      `release: ${entry.command} exit=${String(run.exitCode)} (${String(run.durationMs)}ms)\n`,
    );
  }

  const counts = readAcceptanceResult(repoRoot, startedAt);
  const doctor = runDoctor(repoRoot);
  process.stdout.write(`release: pnpm doctor exit=${String(doctor.exitCode)}\n`);

  const failedCommands = runs.filter((run) => run.exitCode !== 0);
  const readinessProblems = [];
  for (const run of failedCommands) {
    if (run.id === 'test:live' && !providerConfigured()) {
      // Exit 3 is `test:live`'s documented "no real Provider configured" refusal. It is
      // the registered AC-001/007/010/037/041 gap (plan.md §2 D2), not a code failure —
      // but it does mean the Provider longitudinal path is unverified, so the release is
      // not fully verified either. Reported as blocking *and* as the registered gap.
      readinessProblems.push(
        `真实 Provider 纵向验证未执行：\`pnpm test:live\` exit ${String(run.exitCode)}（AGENTDEV_PROVIDER_* 未配置；已登记豁免 AC-001/007/010/037/041，决定见 WP-10 plan.md §2 D2）`,
      );
      continue;
    }
    readinessProblems.push(`命令失败：${run.command}（exit ${String(run.exitCode)}）`);
  }
  if (!counts.available) {
    readinessProblems.push(`无法采用本次运行的验收结果：${String(counts.why)}`);
  } else {
    if ((counts.fail ?? 0) > 0)
      readinessProblems.push(`验收存在 FAIL：${String(counts.fail)} 个 AC`);
    if ((counts.missing ?? 0) > 0)
      readinessProblems.push(`验收存在 MISSING：${String(counts.missing)} 个 AC 没有任何结果`);
  }
  const ready = readinessProblems.length === 0;
  const verdict = !ready
    ? 'NOT READY'
    : (counts.accepted ?? 0) > 0
      ? `READY (ACCEPTED RISK ${String(counts.accepted)})`
      : 'READY';

  const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  const lines = [];
  lines.push('# WP-10 发布演练与就绪检查（自动生成）');
  lines.push('');
  lines.push(
    '本文件由 `node scripts/live.mjs --release` 在真实运行后写出，请勿手工编辑。命令、退出码与输出尾巴全部来自实际执行。',
  );
  lines.push('');
  lines.push('## 0. 运行元数据');
  lines.push('');
  lines.push(`- 生成时间：${startedAt}`);
  lines.push(`- 完成时间：${new Date().toISOString()}`);
  lines.push(`- 仓库：\`${repoRoot}\``);
  lines.push(`- Git HEAD：\`${gitHead.status === 0 ? gitHead.stdout.trim() : 'unavailable'}\``);
  lines.push(`- Node：\`${process.version}\``);
  lines.push(`- 命令序列：${RELEASE_COMMANDS.map((entry) => `\`${entry.command}\``).join(' → ')}`);
  lines.push('');
  lines.push('## 1. 逐命令结果');
  lines.push('');
  lines.push('| # | 命令 | 范围 | 退出码 | 耗时(ms) | 输出尾巴 |');
  lines.push('|---|---|---|---|---|---|');
  runs.forEach((run, index) => {
    const tail = run.tail.replace(/\|/gu, '\\|').replace(/\n+/gu, ' ⏎ ');
    lines.push(
      `| ${String(index + 1)} | \`${run.command}\` | ${run.scope} | **${String(run.exitCode)}**${run.timedOut ? '（超时）' : ''} | ${String(run.durationMs)} | ${tail.length === 0 ? '（无输出）' : tail} |`,
    );
  });
  lines.push('');
  lines.push('## 2. 验收聚合');
  lines.push('');
  if (!counts.available) {
    lines.push(`无法采用本次运行的验收结果：${String(counts.why)}（按未就绪处理）。`);
  } else {
    lines.push(
      `- AC 统计：**共 ${String(counts.total)}**（期望 94） → **PASS ${String(counts.pass)} / ACCEPTED ${String(counts.accepted)} / FAIL ${String(counts.fail)} / MISSING ${String(counts.missing)}**`,
    );
    lines.push(
      '- 来源：本次运行的 `.agentdev/work/WP-10/acceptance-results.json`（已校验 `codeDigest`、生成时间与「本次运行内执行了发布演练」）。',
    );
    lines.push('- 详细逐 AC 结果见 `.agentdev/work/WP-10/acceptance.md`。');
    if (counts.acceptedGaps.length > 0) {
      lines.push('');
      lines.push('| 已登记豁免 AC | 未执行部分 | 决定记录 |');
      lines.push('|---|---|---|');
      for (const gap of counts.acceptedGaps) {
        lines.push(
          `| ${gap.id} | ${String(gap.gap ?? '').replace(/\|/gu, '\\|')} | ${String(gap.decision ?? '').replace(/\|/gu, '\\|')} |`,
        );
      }
    }
  }
  lines.push('');
  lines.push('## 3. 发布就绪检查（本演练内置，无独立命令）');
  lines.push('');
  lines.push(`- 结论：**${verdict}**`);
  if (ready) {
    lines.push(
      '- 所有文档化工程命令退出 0；本次运行的验收聚合没有 FAIL、没有 MISSING、没有未登记的 UNVERIFIED。',
    );
    if ((counts.accepted ?? 0) > 0) {
      lines.push(
        `- **已登记豁免 ${String(counts.accepted)} 个 AC**（完整 Given/When/Then 未全部执行，缺口与决定记录见 §2 表）：这些缺口不阻断就绪，但发布记录必须随版本保留；本结论不声称它们已被验证。`,
      );
    }
  } else {
    for (const problem of readinessProblems) lines.push(`- ${problem}`);
  }
  lines.push('');
  lines.push('## 4. 失败命令原始输出');
  lines.push('');
  if (failedCommands.length === 0) {
    lines.push('无失败命令。');
  } else {
    for (const run of failedCommands) {
      lines.push(`### \`${run.command}\`（exit ${String(run.exitCode)}）`);
      lines.push('');
      lines.push('```text');
      lines.push(tailLines(run.output, 40));
      lines.push('```');
      lines.push('');
    }
  }
  lines.push('');
  lines.push(...renderRunNotes(doctor));
  lines.push('## 6. doctor 原始输出（尾巴）');
  lines.push('');
  lines.push('```text');
  lines.push(doctor.tail.length === 0 ? '(no output)' : doctor.tail);
  lines.push('```');
  lines.push('');

  const reportPath = join(repoRoot, RELEASE_REPORT);
  if (write) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
    process.stdout.write(`release: wrote ${RELEASE_REPORT}\n`);
  } else {
    process.stdout.write(`${lines.join('\n')}\n`);
  }

  process.stdout.write('\n');
  process.stdout.write(
    `release: ${verdict} — commands ${String(runs.length - failedCommands.length)}/${String(runs.length)} ok` +
      (counts.available
        ? `; AC PASS ${String(counts.pass)} / ACCEPTED ${String(counts.accepted)} / FAIL ${String(counts.fail)} / MISSING ${String(counts.missing)}`
        : '; acceptance result unavailable') +
      '\n',
  );
  if (!ready) {
    process.stderr.write(`release: NOT READY — ${readinessProblems.join('; ')}\n`);
  }
  return ready ? 0 : 1;
}
