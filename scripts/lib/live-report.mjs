/**
 * The `pnpm test:live` reports (WP-10 T3).
 *
 * Two outputs come from one executed run, exactly like `pnpm test:e2e`:
 *
 * - `.agentdev/work/WP-10/live-results.json` — the drill-report shape
 *   `scripts/lib/acceptance-registry.mjs` parses (`{results:[{ac,status,evidence}]}`),
 *   which `pnpm test:acceptance` merges. The merge is *weakest link wins*: an
 *   UNVERIFIED row keeps a suite PASS from being reported as a full PASS (the
 *   real-Provider half of the AC did not run), and a FAIL row fails the AC outright.
 *   The report also carries the `binding` (git HEAD/tree and code digest) of the tree
 *   it ran against; the aggregator refuses a report whose binding does not match.
 * - `.agentdev/work/WP-10/live.md` — the same run rendered as the WP-10 T3 record,
 *   with the raw provider metadata, per-check evidence and the exact UNVERIFIED
 *   reason.
 *
 * The report never contains the Provider credential: only whether one was set, and
 * the base URL with any userinfo removed.
 */
import { CheckList } from './e2e-checks.mjs';

/** Strips `user:password@` from a URL so a report can never leak a credential. */
export function redactUrl(value) {
  const text = String(value ?? '');
  try {
    const url = new URL(text);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return text;
  }
}

/** A one-line shortening helper shared with the console table. */
function shorten(text, limit) {
  const value = String(text ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/** Builds the machine-readable drill report `pnpm test:acceptance` merges. */
export function liveDrillReport(checks, meta = {}) {
  return {
    tool: 'pnpm test:live',
    generatedAt: new Date().toISOString(),
    repoRoot: meta.repoRoot,
    gitHead: meta.gitHead,
    binding: meta.binding ?? null,
    nonce: meta.nonce ?? null,
    exitCode: meta.exitCode,
    provider: {
      configured: meta.providerConfigured === true,
      baseUrl: meta.providerConfigured === true ? redactUrl(meta.providerBaseUrl) : null,
      modelId: meta.providerConfigured === true ? meta.modelId : null,
      reviewModelId: meta.providerConfigured === true ? meta.reviewModelId : null,
      secretConfigured: meta.providerConfigured === true,
      unavailableReason: meta.providerConfigured === true ? null : meta.providerMessage,
    },
    results: checks.aggregate().map((entry) => ({
      ac: entry.ac,
      status: entry.status,
      evidence: shorten(entry.evidence, 900),
      checks: entry.checks,
    })),
    checks: checks.records.map((record) => ({
      name: record.name,
      acs: record.acs,
      status: record.status,
      evidence: record.evidence,
      durationMs: record.durationMs,
    })),
  };
}

/** Renders `.agentdev/work/WP-10/live.md` from the executed run. */
export function renderLiveRecord(checks, meta) {
  const lines = [];
  lines.push('# WP-10 T3 真实 Provider 纵向演练记录（自动生成）');
  lines.push('');
  lines.push(
    '本文件由 `node scripts/live.mjs`（`pnpm test:live`）在真实运行后写出，请勿手工编辑。',
  );
  lines.push('');
  lines.push('## 0. 运行元数据');
  lines.push('');
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push('- 命令：`pnpm test:live`（实际执行 `node scripts/live.mjs`）');
  lines.push(`- Node：\`${process.version}\``);
  lines.push(`- 仓库：\`${meta.repoRoot}\``);
  lines.push(`- Git HEAD：\`${meta.gitHead}\``);
  lines.push(
    '- 装载方式：Node 原生类型擦除 + 模块解析钩子直接执行 `packages/*/src`；真实 Provider HTTP（Node 内建 `node:http`/`node:https`），无新依赖、无浏览器。',
  );
  lines.push(
    meta.providerConfigured === true
      ? `- 真实栈：临时 Git 项目 \`${String(meta.projectRoot)}\`、SQLite \`${String(meta.dataDir)}/project.sqlite\`、真实 Core 服务、真实 \`createDaemon\` 与真实 \`createWebApp\` BFF（回环端口 0）。`
      : '- 真实栈：未启动（未配置 Provider，演练在任何网络调用前退出）。',
  );
  lines.push(
    meta.providerConfigured === true
      ? `- Provider：\`${redactUrl(meta.providerBaseUrl)}\`，模型 \`${String(meta.modelId)}\`；Review/Test 模型 \`${String(meta.reviewModelId)}\`；Secret 已配置（值不落盘）。`
      : '- Provider：未配置。',
  );
  if (meta.providerConfigured !== true) {
    lines.push(`- 未验证原因：${String(meta.providerMessage)}`);
  }
  lines.push(
    `- 检查：PASS ${checks.passed} / FAIL ${checks.failed} / UNVERIFIED ${checks.unverifiedCount}（共 ${checks.records.length}）`,
  );
  lines.push(`- 退出码：${meta.exitCode}`);
  lines.push('');
  lines.push('## 1. 逐项检查（原始证据）');
  lines.push('');
  lines.push('| 检查 | 状态 | 关联 AC | 证据 |');
  lines.push('|---|---|---|---|');
  for (const record of checks.records) {
    lines.push(
      `| \`${record.name}\` | **${record.status}** | ${record.acs.join(', ') || '—'} | ${String(record.evidence).replace(/\|/gu, '\\|').replace(/\n+/gu, ' ')} |`,
    );
  }
  lines.push('');
  lines.push('## 2. AC 聚合（供 `pnpm test:acceptance` 合并）');
  lines.push('');
  if (checks.aggregate().length === 0) {
    lines.push('本次没有产生任何 AC 结果（未配置 Provider 时不伪造结果）。');
  } else {
    lines.push('| AC | 状态 | 证据 |');
    lines.push('|---|---|---|');
    for (const entry of checks.aggregate()) {
      lines.push(
        `| ${entry.ac} | **${entry.status}** | ${entry.evidence.replace(/\|/gu, '\\|').replace(/\n+/gu, ' ')} |`,
      );
    }
  }
  lines.push('');
  lines.push('## 3. UNVERIFIED 与残余');
  lines.push('');
  const unverified = checks.records.filter((record) => record.status === 'UNVERIFIED');
  if (unverified.length === 0) {
    lines.push('无：本次每个未执行检查都给出了原因与缺失输入。');
  } else {
    for (const record of unverified) {
      lines.push(`- \`${record.name}\`（${record.acs.join(', ') || '—'}）：${record.evidence}`);
    }
  }
  lines.push('');
  if (Array.isArray(meta.residuals)) {
    for (const residual of meta.residuals) lines.push(`- ${residual}`);
  }
  lines.push('');
  lines.push('## 4. 失败原始输出');
  lines.push('');
  if (checks.failure === null) {
    lines.push(
      checks.failed === 0 && checks.records.length > 0 && meta.exitCode === 0
        ? '无失败。'
        : '无检查失败；退出码非 0 由配置缺失或演练未执行导致，原因见 §3。',
    );
  } else {
    lines.push(`检查 \`${checks.failure.name}\` 失败，原始输出：`);
    lines.push('');
    lines.push('```text');
    lines.push(String(checks.failure.raw ?? checks.failure.evidence));
    lines.push('```');
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

/** Re-exported so `live.mjs` has one import for the report layer. */
export { CheckList };
