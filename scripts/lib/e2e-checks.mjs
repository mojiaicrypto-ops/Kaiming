/**
 * The check list `pnpm test:e2e` prints and the machine-readable report it writes.
 *
 * Two outputs come from one executed run:
 *
 * - the **console list** — one line per check with `PASS`/`FAIL`, the acceptance ids
 *   it proves and the raw evidence, so a human or a log scraper can see exactly what
 *   the real stack did;
 * - `.agentdev/work/WP-10/e2e-results.json` — the drill report shape
 *   `scripts/lib/acceptance-registry.mjs` parses (`{results:[{ac,status,evidence}]}`),
 *   which `pnpm test:acceptance` merges. The merge is **weakest link wins**: a drill
 *   FAIL fails the AC, a drill UNVERIFIED keeps a suite PASS from being reported as a
 *   full PASS, and only a drill PASS closes an AC the offline suites cannot reach. The
 *   report also carries the `binding` of the code tree it ran against.
 * - `.agentdev/work/WP-10/e2e.md` — the same run rendered as a WP record.
 *
 * A check is only `PASS` when its body returned evidence; a thrown error is `FAIL`
 * with the raw message and stack tail, and the runner stops there. `UNVERIFIED`
 * exists for the checks this environment genuinely cannot execute (a real browser),
 * and it always carries a reason — never a silent skip.
 */

/** Thrown after a failed check has been printed; the runner stops at the first one. */
export class CheckFailure extends Error {
  constructor(record) {
    super(`check failed: ${record.name}`);
    this.name = 'CheckFailure';
    this.record = record;
  }
}

/**
 * Ordering used when one acceptance id is touched by several checks.
 *
 * The **weakest link wins**: an AC whose browser half this release cannot execute is
 * `UNVERIFIED` even when another check proved its server half with `PASS`, because the
 * AC's full Given/When/Then is not verified (WP-10 review round 1, W10R1-03). A `FAIL`
 * still outranks everything.
 */
const STATUS_RANK = { PASS: 1, UNVERIFIED: 2, FAIL: 3 };

function shorten(text, limit) {
  const value = String(text ?? '')
    .replace(/\s+/gu, ' ')
    .trim();
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

export class CheckList {
  constructor(options = {}) {
    this.records = [];
    this.log = options.log ?? ((line) => process.stdout.write(`${line}\n`));
    this.now = options.now ?? (() => Date.now());
    this.failure = null;
  }

  get passed() {
    return this.records.filter((record) => record.status === 'PASS').length;
  }

  get failed() {
    return this.records.filter((record) => record.status === 'FAIL').length;
  }

  get unverifiedCount() {
    return this.records.filter((record) => record.status === 'UNVERIFIED').length;
  }

  /**
   * Runs one check and records its verdict.
   *
   * The body returns the evidence string (what was observed, with real values). A
   * thrown error fails the check, prints the raw diagnostic and throws
   * {@link CheckFailure} so the runner cannot continue past a broken contract.
   */
  async check(name, acs, body) {
    const startedAt = this.now();
    try {
      const evidence = await body();
      // Fail closed (W10R1-11): a check that returns no evidence text has not shown
      // what it observed, so it may never be recorded as a PASS.
      if (evidence === undefined || evidence === null || String(evidence).trim().length === 0) {
        throw new Error(
          'check returned no evidence text; a check without observed evidence fails closed',
        );
      }
      const record = {
        name,
        acs: [...acs],
        status: 'PASS',
        evidence: String(evidence),
        durationMs: this.now() - startedAt,
      };
      this.records.push(record);
      this.print(record);
      return record;
    } catch (error) {
      const raw =
        error instanceof Error
          ? `${error.message}\n${String(error.stack ?? '')
              .split('\n')
              .slice(0, 12)
              .join('\n')}`
          : String(error);
      const record = {
        name,
        acs: [...acs],
        status: 'FAIL',
        evidence: shorten(raw, 2000),
        raw,
        durationMs: this.now() - startedAt,
      };
      this.records.push(record);
      this.print(record);
      this.failure = record;
      throw new CheckFailure(record);
    }
  }

  /** Records something this environment cannot execute, with the input it lacks. */
  unverified(name, acs, reason) {
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      throw new Error(`unverified check ${name} must name the missing input`);
    }
    const record = {
      name,
      acs: [...acs],
      status: 'UNVERIFIED',
      evidence: reason,
      durationMs: 0,
    };
    this.records.push(record);
    this.print(record);
    return record;
  }

  print(record) {
    const ids = record.acs.join(',') || '-';
    this.log(
      `${record.status.padEnd(10)} ${record.name.padEnd(46)} [${ids}] ${shorten(record.evidence, 200)}`,
    );
  }

  /** One line per acceptance id: the checks that touched it and their strongest status. */
  aggregate() {
    const byAc = new Map();
    for (const record of this.records) {
      for (const ac of record.acs) {
        const current = byAc.get(ac);
        const better =
          current === undefined || STATUS_RANK[record.status] > STATUS_RANK[current.status];
        if (better) {
          byAc.set(ac, {
            ac,
            status: record.status,
            evidence: `${record.name}: ${record.evidence}`,
            checks: [record.name],
          });
        } else {
          current.checks.push(record.name);
          if (record.status === 'FAIL') current.evidence += `; ${record.name}: ${record.evidence}`;
        }
      }
    }
    return [...byAc.values()].sort((left, right) => (left.ac < right.ac ? -1 : 1));
  }
}

/** Builds the drill report `pnpm test:acceptance` merges (`e2e-results.json`). */
export function drillReport(checks, meta = {}) {
  return {
    tool: meta.tool ?? 'pnpm test:e2e',
    generatedAt: new Date().toISOString(),
    ...meta,
    // Every report is bound to the code tree it ran against; the acceptance
    // aggregator recomputes the binding and refuses a report that does not match.
    binding: meta.binding ?? null,
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

/** Renders `.agentdev/work/WP-10/e2e.md` from the executed run. */
export function renderE2eRecord(checks, meta) {
  const lines = [];
  lines.push('# WP-10 T2 无头端到端演练记录（自动生成）');
  lines.push('');
  lines.push('本文件由 `node scripts/e2e.mjs`（`pnpm test:e2e`）在真实运行后写出，请勿手工编辑。');
  lines.push('');
  lines.push('## 0. 运行元数据');
  lines.push('');
  lines.push(`- 生成时间：${new Date().toISOString()}`);
  lines.push('- 命令：`pnpm test:e2e`（实际执行 `node scripts/e2e.mjs`）');
  lines.push(`- Node：\`${process.version}\``);
  lines.push(`- 仓库：\`${meta.repoRoot}\``);
  lines.push(`- Git HEAD：\`${meta.gitHead}\``);
  lines.push(
    '- 装载方式：Node 原生类型擦除 + 模块解析钩子直接执行 `packages/*/src`；无构建、无浏览器、无新依赖。',
  );
  lines.push(
    `- 真实栈：临时 Git 项目 \`${meta.projectRoot}\`、SQLite \`${meta.dataDir}/project.sqlite\`、真实 Core 服务、真实 \`createDaemon\`（HTTP+WS）与真实 \`createWebApp\` BFF，端口均为回环 0。`,
  );
  lines.push(
    `- BFF：\`${meta.webUrl}\`；daemon：\`${meta.daemonUrl}\`；允许的 Origin：\`${meta.webOrigin}\``,
  );
  lines.push(
    `- Provider：离线演练，未调用任何模型；配置中的 Provider 指向桩地址 \`${meta.providerBaseUrl}\`，模型能力探测（\`config.test\`）为纯能力校验。`,
  );
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
  lines.push('| AC | 状态 | 证据 |');
  lines.push('|---|---|---|');
  for (const entry of checks.aggregate()) {
    lines.push(
      `| ${entry.ac} | **${entry.status}** | ${entry.evidence.replace(/\|/gu, '\\|').replace(/\n+/gu, ' ')} |`,
    );
  }
  lines.push('');
  lines.push('## 3. UNVERIFIED 与残余');
  lines.push('');
  const unverified = checks.records.filter((record) => record.status === 'UNVERIFIED');
  if (unverified.length === 0) {
    lines.push('无：本次未执行检查全部给出了原因与缺失输入。');
  } else {
    for (const record of unverified) {
      lines.push(`- \`${record.name}\`（${record.acs.join(', ')}）：${record.evidence}`);
    }
  }
  lines.push('');
  if (meta.residuals !== undefined && meta.residuals.length > 0) {
    for (const residual of meta.residuals) lines.push(`- ${residual}`);
  }
  lines.push('');
  lines.push('## 4. 失败原始输出');
  lines.push('');
  if (checks.failure === null) {
    lines.push('无失败。');
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
