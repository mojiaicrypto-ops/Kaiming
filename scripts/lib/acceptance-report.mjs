/**
 * Renders the WP-10 release acceptance report (`pnpm test:acceptance`).
 *
 * The output is machine generated on purpose: a per-AC table with the executed check
 * and its raw result, the raw suite summaries, the UNVERIFIED reasons and the FAIL raw
 * output. Nothing in the report is hand written, so Review/Test can audit it against
 * the same run that produced it.
 */
import { relative } from 'node:path';

/** Escapes a value for a Markdown table cell. */
function cell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, ' ')
    .trim();
}

/** Shortens a long list into `a, b, c …(+N)`. */
function brief(items, limit) {
  if (items.length <= limit) return items.join(', ');
  return `${items.slice(0, limit).join(', ')} …(+${items.length - limit})`;
}

/** Builds `file :: test name` labels relative to the repository root. */
function makeLabel(repoRoot) {
  return (test) => {
    const file = String(test.file ?? '');
    const shown = file.startsWith(repoRoot) ? relative(repoRoot, file) : file;
    return `${shown} :: ${test.fullName}`;
  };
}

/** Last `limit` lines of a captured command output. */
function tail(text, limit) {
  const lines = String(text ?? '')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  return lines.slice(Math.max(0, lines.length - limit)).join('\n');
}

function countsOf(run) {
  const report = run.report;
  if (report === null || typeof report !== 'object') return '无 JSON 报告';
  return `${report.numTotalTests} tests / ${report.numPassedTests} passed / ${report.numFailedTests} failed`;
}

/**
 * @param {object} input
 * @returns {string} Markdown report
 */
export function renderAcceptanceReport(input) {
  const {
    meta,
    cases,
    results,
    counts,
    runs,
    diagnostics,
    drillSources,
    registryProblems,
    exitCode,
  } = input;

  const byId = new Map(cases.map((entry) => [entry.id, entry]));
  const evidenceLabel = makeLabel(meta.repoRoot);
  const relativeOnly = (file) =>
    file.startsWith(meta.repoRoot) ? relative(meta.repoRoot, file) : file;
  const unverified = results.filter((result) => result.status === 'UNVERIFIED');
  const failed = results.filter((result) => result.status === 'FAIL');
  const externalDrills = results.filter((result) => result.drill !== null);

  const lines = [];
  lines.push('# WP-10 发布验收证据汇总（自动生成）');
  lines.push('');
  lines.push('本文件由 `node scripts/acceptance.mjs` 生成，请勿手工编辑。');
  lines.push('');
  lines.push('## 0. 运行元数据');
  lines.push('');
  lines.push(`- 生成时间：${meta.generatedAt}`);
  lines.push(`- 命令：\`pnpm test:acceptance\`（实际执行 \`node scripts/acceptance.mjs\`）`);
  lines.push(`- 仓库：\`${meta.repoRoot}\``);
  lines.push(
    `- Git HEAD：\`${meta.gitHead}\`${meta.gitDirty ? '（工作区有未提交改动）' : '（工作区干净）'}`,
  );
  lines.push(
    `- Node：\`${meta.nodeVersion}\`；Docker：${meta.dockerAvailable ? '可用' : '不可用'}`,
  );
  lines.push(
    `- 真实 Provider 环境变量：${meta.providerConfigured ? '已配置' : '未配置（AGENTDEV_PROVIDER_* 缺失，`pnpm test:live` 将显式失败）'}`,
  );
  lines.push(`- 退出码：${exitCode}`);
  lines.push('');
  lines.push(
    `- AC 统计：**共 ${results.length}**（期望 ${cases.length}） → **PASS ${counts.PASS} / FAIL ${counts.FAIL} / UNVERIFIED ${counts.UNVERIFIED}**`,
  );
  lines.push(
    `- 已执行提交用例：${diagnostics.testCounts} 个，覆盖 ${diagnostics.executedFiles}/${diagnostics.scannedFiles} 个测试文件`,
  );
  if (registryProblems.length > 0) {
    lines.push('');
    lines.push('> **注册表问题（fail-closed）**');
    for (const problem of registryProblems) lines.push(`> - ${problem}`);
  }
  lines.push('');

  lines.push('## 1. 自动检查原始结果');
  lines.push('');
  lines.push('| 命令 | 退出码 | 结果摘要 | 原始输出尾部 |');
  lines.push('|---|---|---|---|');
  for (const run of runs) {
    lines.push(
      `| \`vitest run --project ${cell(run.project)}\` | ${run.exitCode} | ${cell(countsOf(run))} | ${cell(tail(run.output, 6))} |`,
    );
  }
  for (const source of drillSources) {
    lines.push(`| 演练报告 \`${cell(source)}\` | - | 已并入聚合 | - |`);
  }
  if (drillSources.length === 0) {
    lines.push(
      '| `pnpm test:e2e` / `pnpm test:live` | - | 本次未运行（无 `--drill-report`，未发现演练结果文件） | - |',
    );
  }
  lines.push('');

  lines.push('## 2. 每 AC 结果');
  lines.push('');
  lines.push('| AC | 标题 | 状态 | 映射 | 已执行证据（文件 :: 用例） | 备注 / 未验证原因 |');
  lines.push('|---|---|---|---|---|---|');
  for (const result of results) {
    const acceptanceCase = byId.get(result.id);
    const evidence = result.evidence.map(evidenceLabel);
    const note = [];
    if (result.status === 'UNVERIFIED' && result.reason !== null) note.push(result.reason);
    if (result.status === 'PASS' && result.residual !== null) note.push(`残余：${result.residual}`);
    if (result.status === 'FAIL') note.push('映射用例失败，原始输出见 §4');
    if (result.drill !== null)
      note.push(`演练：${result.drill.status}（${result.drill.sourceFile}）`);
    lines.push(
      `| ${result.id} | ${cell(acceptanceCase?.title ?? '')} | **${result.status}** | ${result.mapping} | ${cell(brief(evidence, 3)) || '—'} | ${cell(note.join('；')) || '—'} |`,
    );
  }
  lines.push('');

  lines.push('## 3. UNVERIFIED 明细');
  lines.push('');
  if (unverified.length === 0) {
    lines.push('无。');
    lines.push('');
  } else {
    for (const result of unverified) {
      const acceptanceCase = byId.get(result.id);
      lines.push(`### ${result.id} ${acceptanceCase?.title ?? ''}`);
      lines.push('');
      lines.push(`- 关联：${acceptanceCase?.requirement ?? ''}`);
      lines.push(`- Given：${acceptanceCase?.given ?? ''}`);
      lines.push(`- When：${acceptanceCase?.when ?? ''}`);
      lines.push(`- Then：${acceptanceCase?.then ?? ''}`);
      lines.push(`- 原因：${result.reason ?? '未说明'}`);
      lines.push(`- 证据提示：${acceptanceCase?.evidence ?? ''}`);
      if (result.residual !== null) lines.push(`- 已知残余：${result.residual}`);
      lines.push('');
    }
  }

  lines.push('## 4. FAIL 明细');
  lines.push('');
  if (failed.length === 0) {
    lines.push('无。');
    lines.push('');
  } else {
    for (const result of failed) {
      const acceptanceCase = byId.get(result.id);
      lines.push(`### ${result.id} ${acceptanceCase?.title ?? ''}`);
      lines.push('');
      lines.push(`- Then：${acceptanceCase?.then ?? ''}`);
      lines.push(`- 映射：${result.mapping}`);
      lines.push('');
      lines.push('```text');
      lines.push(tail(result.raw.join('\n\n'), 40));
      lines.push('```');
      lines.push('');
    }
  }

  lines.push('## 5. 已执行证据之外仍未覆盖的部分');
  lines.push('');
  const withResiduals = results.filter((result) => result.residual !== null);
  if (withResiduals.length === 0) {
    lines.push('无。');
  } else {
    lines.push('| AC | 状态 | 未执行部分 |');
    lines.push('|---|---|---|');
    for (const result of withResiduals) {
      lines.push(`| ${result.id} | ${result.status} | ${cell(result.residual)} |`);
    }
  }
  lines.push('');

  lines.push('## 6. 映射审计');
  lines.push('');
  lines.push('### 6.1 映射来源统计');
  lines.push('');
  const mappingCounts = new Map();
  for (const result of results) {
    mappingCounts.set(result.mapping, (mappingCounts.get(result.mapping) ?? 0) + 1);
  }
  lines.push('| 映射来源 | AC 数 | 含义 |');
  lines.push('|---|---|---|');
  lines.push(
    `| test-name | ${mappingCounts.get('test-name') ?? 0} | 用例名直接含 AC 编号（最强证据） |`,
  );
  lines.push(
    `| file | ${mappingCounts.get('file') ?? 0} | 测试文件提到该 AC 但用例名未写；该文件全部用例为证据 |`,
  );
  lines.push(
    `| supplemental | ${mappingCounts.get('supplemental') ?? 0} | 经 WP 记录核对的人工映射，逐条解析到已执行用例 |`,
  );
  lines.push(`| none | ${mappingCounts.get('none') ?? 0} | 无提交测试证据，依赖演练或环境 |`);
  lines.push('');
  lines.push('### 6.2 人工映射解析结果（必须全部 resolved）');
  lines.push('');
  lines.push('| AC | 条目数 | 已解析 |');
  lines.push('|---|---|---|');
  for (const entry of diagnostics.supplemental) {
    lines.push(`| ${entry.id} | ${entry.entries} | ${entry.resolved ? '是' : '否（FAIL）'} |`);
  }
  lines.push('');
  lines.push('### 6.3 未执行但含 AC 证据的测试文件');
  lines.push('');
  if (diagnostics.unexecuted.length === 0) {
    lines.push('无：全部含 AC 证据的测试文件都出现在 Vitest 报告中。');
  } else {
    for (const file of diagnostics.unexecuted) lines.push(`- \`${relativeOnly(file)}\``);
  }
  lines.push('');
  lines.push('### 6.4 失败但未映射到任何 AC 的用例（fail-closed）');
  lines.push('');
  if (diagnostics.unmappedFailures.length === 0) {
    lines.push('无：每个失败用例都至少映射到一个 AC。');
  } else {
    for (const test of diagnostics.unmappedFailures) {
      lines.push(`- \`${evidenceLabel(test)}\``);
    }
  }
  lines.push('');
  lines.push('### 6.5 测试中的未注册 AC 编号（负例夹具，不进入聚合）');
  lines.push('');
  if (diagnostics.unregisteredAcIds.length === 0) {
    lines.push('无。');
  } else {
    for (const entry of diagnostics.unregisteredAcIds) {
      lines.push(`- \`${entry.id}\`（${entry.files.join(', ')}）`);
    }
  }
  lines.push('');
  if (externalDrills.length > 0) {
    lines.push('### 6.6 演练结果接入');
    lines.push('');
    lines.push('| AC | 演练状态 | 来源 | 说明 |');
    lines.push('|---|---|---|---|');
    for (const result of externalDrills) {
      lines.push(
        `| ${result.id} | ${result.drill.status} | \`${result.drill.sourceFile}\` | ${cell(result.drill.evidence)} |`,
      );
    }
    lines.push('');
    lines.push(
      '演练报告格式：`{ "results": [ { "ac": "AC-002", "status": "PASS|FAIL|UNVERIFIED", "evidence": "…" } ] }`；',
    );
    lines.push(
      '通过 `--drill-report <path>` 或 `AGENTDEV_DRILL_REPORTS` 传入，也会自动读取 `.agentdev/work/WP-10/drills/*.json`。',
    );
    lines.push('');
  }

  lines.push('## 7. 机器可读结果');
  lines.push('');
  lines.push('```json');
  lines.push(
    JSON.stringify(
      {
        generatedAt: meta.generatedAt,
        gitHead: meta.gitHead,
        exitCode,
        counts,
        results: results.map((result) => ({
          id: result.id,
          status: result.status,
          mapping: result.mapping,
          evidence: result.evidence.map(evidenceLabel),
          reason: result.reason,
        })),
      },
      null,
      2,
    ),
  );
  lines.push('```');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

/** Console table printed by the CLI (full per-AC table). */
export function renderConsoleTable(results, repoRoot) {
  const evidenceLabel = makeLabel(repoRoot);
  const lines = [];
  const width = Math.max(...results.map((result) => result.id.length));
  for (const result of results) {
    const evidence = result.evidence.map(evidenceLabel);
    let note = '';
    if (result.status === 'UNVERIFIED') note = (result.reason ?? '').slice(0, 90);
    else if (result.status === 'PASS' && result.residual !== null) note = 'residual';
    lines.push(
      [
        result.id.padEnd(width),
        result.status.padEnd(10),
        result.mapping.padEnd(12),
        brief(evidence, 2) || '—',
        note,
      ].join('  '),
    );
  }
  return lines.join('\n');
}
