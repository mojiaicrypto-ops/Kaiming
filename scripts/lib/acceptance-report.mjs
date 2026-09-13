/**
 * Renders the WP-10 release acceptance report (`pnpm test:acceptance`).
 *
 * The output is machine generated on purpose: a per-AC table with the executed check
 * and its raw result, the raw suite and drill summaries, the accepted-gap register and
 * the FAIL raw output. Nothing in the report is hand written, so Review/Test can audit
 * it against the same run that produced it.
 */
import { relative } from 'node:path';

import { RESIDUAL_GAPS } from './drill-acs.mjs';

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

/** The status label shown per AC, keeping the accepted-gap distinction visible. */
function statusLabel(result) {
  if (result.accepted === true) return `${result.status}（已登记豁免）`;
  return result.status;
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
    drillRuns,
    drillSources,
    diagnostics,
    problems,
    unaccepted,
    exitCode,
  } = input;

  const byId = new Map(cases.map((entry) => [entry.id, entry]));
  const evidenceLabel = makeLabel(meta.repoRoot);
  const relativeOnly = (file) =>
    file.startsWith(meta.repoRoot) ? relative(meta.repoRoot, file) : file;
  const accepted = results.filter((result) => result.accepted === true);
  const failed = results.filter((result) => result.status === 'FAIL');
  const withDrills = results.filter((result) => result.drills.length > 0);

  const lines = [];
  lines.push('# WP-10 发布验收证据汇总（自动生成）');
  lines.push('');
  lines.push('本文件由 `node scripts/acceptance.mjs` 生成，请勿手工编辑。');
  lines.push('');
  lines.push('## 0. 运行元数据');
  lines.push('');
  lines.push(`- 生成时间：${meta.generatedAt}`);
  lines.push('- 命令：`pnpm test:acceptance`（实际执行 `node scripts/acceptance.mjs`）');
  lines.push(`- 仓库：\`${meta.repoRoot}\``);
  lines.push(
    `- Git HEAD：\`${meta.gitHead}\`${meta.gitDirty ? '（工作区有未提交改动）' : '（工作区干净）'}`,
  );
  lines.push(
    `- 证据绑定：\`codeDigest ${meta.binding.codeDigest}\`（gitTree \`${meta.binding.gitTree}\`，${String(meta.binding.codeFiles)} 个代码文件的内容哈希）；演练报告必须携带同一绑定才会被采用`,
  );
  lines.push(
    `- Node：\`${meta.nodeVersion}\`；Docker：${meta.dockerAvailable ? '可用' : '不可用'}`,
  );
  lines.push(
    `- 真实 Provider 环境变量：${meta.providerConfigured ? '已配置' : '未配置（AGENTDEV_PROVIDER_* 缺失）'}；Review/Test 独立模型：${meta.reviewModelConfigured ? '已配置' : '未配置'}`,
  );
  lines.push(
    `- 发布演练：${meta.drillsExecuted ? '本次运行内执行了 `scripts/e2e.mjs` 与 `scripts/live.mjs`（非读取仓库文件）' : '本次未执行（`--no-drills`）'}`,
  );
  lines.push(`- 退出码：${exitCode}`);
  lines.push('');
  lines.push(
    `- AC 统计：**共 ${results.length}**（期望 ${cases.length}） → **PASS ${counts.PASS} / ACCEPTED ${counts.ACCEPTED} / FAIL ${counts.FAIL} / MISSING ${counts.MISSING}**`,
  );
  lines.push(
    '- ACCEPTED = 该 AC 的完整 Given/When/Then 未全部执行，但缺口已在 `scripts/lib/drill-acs.mjs` 登记，且豁免条件在本次运行中依然成立（逐条见 §3）。PASS 只表示该 AC 的全部已映射证据通过且没有未验证的登记缺口。',
  );
  lines.push(
    `- 已执行提交用例：${diagnostics.testCounts} 个，覆盖 ${diagnostics.executedFiles}/${diagnostics.scannedFiles} 个测试文件`,
  );
  if (problems.length > 0) {
    lines.push('');
    lines.push('> **fail-closed 问题（本次运行判定为不可信证据）**');
    for (const problem of problems) lines.push(`> - ${problem}`);
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
  for (const run of drillRuns) {
    lines.push(
      `| \`${cell(run.tool)}\`（本次运行内执行） | ${run.exitCode} | 真实演练（见 §6.6） | ${cell(tail(run.output, 8))} |`,
    );
  }
  for (const source of drillSources) {
    lines.push(`| 演练报告 \`${cell(source)}\` | - | 已并入聚合（绑定已校验） | - |`);
  }
  if (drillRuns.length === 0 && drillSources.length === 0) {
    lines.push('| `pnpm test:e2e` / `pnpm test:live` | - | 本次未执行（`--no-drills`） | - |');
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
    if (result.accepted === true) note.push(`已登记豁免：${result.gap ?? ''}`);
    else if (result.status === 'UNVERIFIED' && result.reason !== null) note.push(result.reason);
    else if (result.status === 'MISSING') note.push(result.reason ?? '无证据');
    if (result.status === 'FAIL') note.push('映射用例失败或缺口未登记，原始输出见 §5');
    for (const drill of result.drills) note.push(`演练 ${drill.tool}：${drill.status}`);
    lines.push(
      `| ${result.id} | ${cell(acceptanceCase?.title ?? '')} | **${cell(statusLabel(result))}** | ${result.mapping} | ${cell(brief(evidence, 3)) || '—'} | ${cell(note.filter((part) => part.length > 0).join('；')) || '—'} |`,
    );
  }
  lines.push('');

  lines.push('## 3. 已登记豁免（ACCEPTED）明细');
  lines.push('');
  if (accepted.length === 0) {
    lines.push('无：本次没有任何 AC 依赖已登记豁免。');
    lines.push('');
  } else {
    lines.push('| AC | 标题 | 未验证状态 | 登记缺口 | 豁免条件 | 决定记录 |');
    lines.push('|---|---|---|---|---|---|');
    for (const result of accepted) {
      const acceptanceCase = byId.get(result.id);
      const registration = RESIDUAL_GAPS[result.id];
      lines.push(
        `| ${result.id} | ${cell(acceptanceCase?.title ?? '')} | ${result.status} | ${cell(result.gap ?? '')} | \`${cell(registration?.condition ?? '')}\` | ${cell(result.decision ?? registration?.decision ?? '')} |`,
      );
    }
    lines.push('');
    lines.push('逐条 Given/When/Then 与原因：');
    lines.push('');
    for (const result of accepted) {
      const acceptanceCase = byId.get(result.id);
      lines.push(`### ${result.id} ${acceptanceCase?.title ?? ''}`);
      lines.push('');
      lines.push(`- 关联：${acceptanceCase?.requirement ?? ''}`);
      lines.push(`- Given：${acceptanceCase?.given ?? ''}`);
      lines.push(`- When：${acceptanceCase?.when ?? ''}`);
      lines.push(`- Then：${acceptanceCase?.then ?? ''}`);
      lines.push(`- 证据提示：${acceptanceCase?.evidence ?? ''}`);
      lines.push(`- 已执行证据：${brief(result.evidence.map(evidenceLabel), 6) || '无'}`);
      lines.push(`- 未执行部分（登记缺口）：${result.gap ?? '未登记'}`);
      lines.push(`- 豁免条件与决定：${result.decision ?? '未登记'}`);
      for (const drill of result.drills) {
        lines.push(`- 演练 ${drill.tool}：**${drill.status}** — ${cell(drill.evidence)}`);
      }
      lines.push('');
    }
  }

  lines.push('## 4. 未登记的未验证项（fail-closed）');
  lines.push('');
  if (unaccepted.length === 0) {
    lines.push('无：每个 UNVERIFIED/MISSING 都在登记表中且条件成立。');
  } else {
    lines.push('| AC | 状态 | 原因 |');
    lines.push('|---|---|---|');
    for (const entry of unaccepted) {
      lines.push(`| ${entry.id} | ${entry.status} | ${cell(entry.why)} |`);
    }
  }
  lines.push('');

  lines.push('## 5. FAIL 明细');
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

  lines.push('## 6. 映射与证据审计');
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
    `| test-name | ${mappingCounts.get('test-name') ?? 0} | 用例名（含 describe 链）直接含 AC 编号，逐用例绑定 |`,
  );
  lines.push(
    `| curated | ${mappingCounts.get('curated') ?? 0} | 人工登记到具体用例（文件 :: 用例名），逐条解析，缺一条即 FAIL |`,
  );
  lines.push(`| none | ${mappingCounts.get('none') ?? 0} | 无提交测试证据，依赖演练或已登记豁免 |`);
  lines.push('');
  lines.push('### 6.2 人工映射解析结果（必须全部 resolved，且无 stale）');
  lines.push('');
  lines.push('| AC | 条目数 | 已解析 | 过期条目 |');
  lines.push('|---|---|---|---|');
  for (const entry of diagnostics.curated) {
    lines.push(
      `| ${entry.id} | ${entry.entries} | ${entry.resolved ? '是' : '否（FAIL）'} | ${entry.stale} |`,
    );
  }
  lines.push('');
  lines.push('### 6.3 未执行但含 AC 证据的测试文件（fail-closed）');
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
  lines.push('### 6.6 每个 AC 的全部演练来源（不做覆盖式合并）');
  lines.push('');
  if (withDrills.length === 0) {
    lines.push('无：本次没有演练报告。');
  } else {
    lines.push('| AC | 演练来源 | 状态 | 证据 |');
    lines.push('|---|---|---|---|');
    for (const result of withDrills) {
      for (const drill of result.drills) {
        lines.push(
          `| ${result.id} | \`${cell(drill.tool)}\` | ${drill.status} | ${cell(drill.evidence)} |`,
        );
      }
    }
    lines.push('');
    lines.push(
      '合并规则：**最弱一环胜出**（FAIL > UNVERIFIED > PASS）。演练 UNVERIFIED 会把同一 AC 的套件 PASS 降级，因为该 AC 的完整 Given/When/Then 并未全部执行。',
    );
  }
  lines.push('');

  lines.push('## 7. 机器可读结果');
  lines.push('');
  lines.push('```json');
  lines.push(
    JSON.stringify(
      {
        generatedAt: meta.generatedAt,
        gitHead: meta.gitHead,
        codeDigest: meta.binding.codeDigest,
        drillsExecuted: meta.drillsExecuted,
        exitCode,
        counts,
        problems,
        results: results.map((result) => ({
          id: result.id,
          status: result.status,
          accepted: result.accepted === true,
          mapping: result.mapping,
          evidence: result.evidence.map(evidenceLabel),
          drills: result.drills.map((drill) => ({ tool: drill.tool, status: drill.status })),
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
    if (result.accepted === true) note = 'accepted gap';
    else if (result.status === 'UNVERIFIED') note = (result.reason ?? '').slice(0, 90);
    else if (result.status === 'MISSING') note = (result.reason ?? 'no evidence').slice(0, 90);
    const drillNote = result.drills.map((drill) => `${drill.status}`).join('/');
    lines.push(
      [
        result.id.padEnd(width),
        (result.accepted === true ? `${result.status}*` : result.status).padEnd(12),
        result.mapping.padEnd(10),
        brief(evidence, 2) || '—',
        note.length > 0 ? note : drillNote,
      ].join('  '),
    );
  }
  return lines.join('\n');
}
