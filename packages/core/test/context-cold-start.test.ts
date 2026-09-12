/**
 * Cold start: the new-Conversation seed and the query answer
 * (`docs/architecture/context.md` §1/§5/§6, `docs/product/knowledge.md` §6;
 * `AC-033`, `AC-037`, `AC-039`).
 *
 * The projection is a *real* WP-04 projection built with `buildProjection()` from
 * the fixed sample of `context.md` §6 — orders / payment / session — plus twenty
 * unrelated documents and a development-chat transcript. The tests assert the
 * documented facts, not the implementation:
 *
 * - the seed starts from the Chief's fixed rules, the Project overview and the
 *   current domain summary (`§5`);
 * - the selection follows the documented order and records a reason per entry
 *   (`§1`), so the constraint of the payment Feature enters with its source
 *   (`AC-039`);
 * - the answer finds the current cancellation behaviour, the payment constraint,
 *   the related test path and the known gap (`AC-037`), and 20 unrelated documents
 *   are neither selected nor counted against the budget;
 * - a misleading development-chat transcript is neither selected nor readable and
 *   cannot change the answer (`AC-033`).
 */
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildProjection, type FeatureDocumentInput } from '@agentdev/knowledge';
import {
  COLD_START_SELECTION_ORDER,
  CHIEF_RULES_PATH,
  TRANSCRIPT_DENIAL_REASON,
  assembleColdStart,
  coldStartAnswer,
  createCheckpointStore,
  createTranscriptGuard,
  type ColdStartProjection,
  type ColdStartResult,
  type ContextResult,
} from '../src/context/index.js';

const REVISION = '9f2c1a4b8d3e5f60718293a4b5c6d7e8f9012345';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
const ARTIFACT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';
const CANCEL_ID = 'F-1a2b3c4d';
const PAYMENT_ID = 'F-5e6f7a8b';
const SESSION_ID = 'F-0f1e2d3c';

const CANCEL_BEHAVIOUR = [
  '输入：订单号与用户身份。',
  '前置条件：订单归属当前用户。',
  '正常输出：未付款订单进入已取消状态。',
  '异常输出：已付款订单返回拒绝。',
  '约束：仅未付款订单可在 30 分钟内取消。',
].join('\n');
const PAYMENT_BEHAVIOUR = '支付成功后订单不可直接取消。';
const CONSTRAINT_REASON = '付款状态决定可取消范围，已付款订单只能走退款流程';
const SESSION_BEHAVIOUR = '物理会话轮换后从 Checkpoint 恢复角色、任务与来源。';
const CANCEL_GAP = '服务端未校验取消窗口与订单时区的一致性';

/** The misleading conclusion planted in the development chat. */
const MISLEADING_CONCLUSION = '已付款订单可以随时直接取消，无需退款流程';
const TRANSCRIPT_PATH = '.agentdev/work/WP-06/chat-history.md';
const TRANSCRIPT_DIRECTORY_PATH = '.agentdev/work/WP-06/transcripts/dev-chat.md';

interface FeatureOptions {
  readonly featureId: string;
  readonly name: string;
  readonly module: string;
  readonly purpose: string;
  readonly behaviour: string;
  readonly design?: string;
  readonly designDecisionRefs?: string;
  readonly verification?: string;
  readonly verificationEvidenceRefs?: string;
  readonly verificationCoverage?: string;
  readonly entries?: readonly string[];
  readonly relations?: readonly string[];
  readonly gaps?: string;
  readonly investigationScope?: string;
}

/**
 * Renders one Feature document in the fixed format of `context.md` §2.
 *
 * The helper mirrors the parser's requirements (fourteen mandatory field rows, six
 * mandatory headings, a four-column relation table) so a test failure here means the
 * cold start lost a fact, not that the fixture was malformed.
 */
function featureDocument(options: FeatureOptions): FeatureDocumentInput {
  const relativePath = `features/${options.featureId}/README.md`;
  const entries = options.entries ?? ['未调查'];
  const fields: readonly (readonly [string, string])[] = [
    ['feature_id', options.featureId],
    ['name', options.name],
    ['module', options.module],
    ['owner_document', relativePath],
    ['design', options.design ?? 'confirmed'],
    ['design_decision_refs', options.designDecisionRefs ?? `decision:${DECISION_ID}`],
    ['implementation', 'implemented'],
    ['verification', options.verification ?? 'passed'],
    ['verification_evidence_refs', options.verificationEvidenceRefs ?? `artifact:${ARTIFACT_ID}@1`],
    ['verification_coverage', options.verificationCoverage ?? '未付款可取消；已付款拒绝'],
    ['investigation', 'investigated'],
    ['investigation_scope', options.investigationScope ?? '相关路由、状态转换和测试'],
    ['source_refs', `git:${REVISION}:src/${options.module}/index.ts`],
    ['revision', REVISION],
  ];
  const relations =
    options.relations === undefined || options.relations.length === 0
      ? ['无']
      : [
          '| target_feature_id | kind | reason | source |',
          '|---|---|---|---|',
          ...options.relations,
        ];
  const sections: readonly (readonly [string, string])[] = [
    ['用途', options.purpose],
    ['当前行为', options.behaviour],
    ['关系', relations.join('\n')],
    ['实现入口', entries.map((entry) => `- ${entry}`).join('\n')],
    ['已知差距', options.gaps ?? '无已登记差距。'],
    ['关键决定', `- decision:${DECISION_ID}：本 Feature 的行为由该决定确认。`],
  ];
  const lines = [`# ${options.name}`, '', '| 字段 | 值 |', '|---|---|'];
  for (const [key, value] of fields) lines.push(`| ${key} | ${value} |`);
  lines.push('');
  for (const [heading, body] of sections) lines.push(`## ${heading}`, body, '');
  return { relativePath, markdown: lines.join('\n') };
}

/**
 * The twenty unrelated documents of `context.md` §6.
 *
 * Each one owns a genuinely different subject and vocabulary, so a query about
 * order cancellation cannot match any of them by a shared word: that is what makes
 * "not injected" a real assertion rather than a fixture accident.
 */
const UNRELATED_TOPICS: readonly (readonly [string, string, string])[] = [
  ['日志轮转', 'logging', '按大小与天数轮转工作日志文件，并保留最近三十天。'],
  ['多语言文案', 'i18n', '根据用户语言加载界面文案，缺省回退到简体中文。'],
  ['图表渲染', 'charts', '把统计结果渲染为柱状图与折线图。'],
  ['数据导出', 'export', '把查询结果导出为 CSV 文件。'],
  ['密码散列', 'auth-hash', '使用加盐散列保存用户口令。'],
  ['键盘快捷键', 'hotkeys', '注册全局键盘快捷键并允许用户重绑。'],
  ['主题配色', 'theming', '在浅色与深色主题之间切换界面配色。'],
  ['请求限流', 'rate-limit', '按来源地址限制每分钟请求次数。'],
  ['实时推送', 'push', '通过长连接向浏览器推送事件通知。'],
  ['图片缩略图', 'thumbnails', '为上传图片生成缩略图。'],
  ['邮件模板', 'mail-template', '渲染事务邮件的 HTML 模板。'],
  ['搜索建议', 'suggest', '在输入框内提供搜索建议词。'],
  ['审计留痕', 'audit', '记录管理操作的审计条目。'],
  ['缓存清理', 'cache-gc', '定期清理过期的缓存条目。'],
  ['表单校验', 'validation', '校验用户输入字段的长度与格式。'],
  ['文件预览', 'preview', '在沙箱 iframe 中预览上传的文档。'],
  ['消息分页', 'paging', '按游标分页读取会话消息。'],
  ['头像裁剪', 'avatar', '把上传的头像裁剪为正方形。'],
  ['通知偏好', 'notify-pref', '保存用户的通知渠道偏好。'],
  ['离线草稿', 'draft', '在浏览器本地保存未发送的草稿。'],
];

const UNRELATED: readonly FeatureDocumentInput[] = UNRELATED_TOPICS.map(
  ([name, module, purpose], index) => {
    const featureId = `F-3f${index.toString(16).padStart(2, '0')}9a5c`;
    return featureDocument({
      featureId,
      name,
      module,
      purpose: `${purpose}该模块由 ${module} 目录承载。`,
      behaviour: `${name}的当前实现：${purpose}`,
      entries: [`src/${module}/index.ts`, `tests/${module}/index.test.ts`],
      verificationCoverage: `${name}自检`,
      gaps: '无已登记差距。',
    });
  },
);

const UNRELATED_IDS = UNRELATED_TOPICS.map(
  (_topic, index) => `F-3f${index.toString(16).padStart(2, '0')}9a5c`,
);

function cancelDocument(): FeatureDocumentInput {
  return featureDocument({
    featureId: CANCEL_ID,
    name: '订单取消',
    module: 'orders',
    purpose: '允许用户取消未付款订单，已付款订单走退款流程。',
    behaviour: CANCEL_BEHAVIOUR,
    entries: ['src/orders/cancel.ts', 'tests/orders/cancel.test.ts'],
    relations: [
      `| ${PAYMENT_ID} | constrained_by | ${CONSTRAINT_REASON} | features/${PAYMENT_ID}/README.md |`,
    ],
    gaps: CANCEL_GAP,
    investigationScope: '订单取消路由、状态转换和测试',
  });
}

function paymentDocument(): FeatureDocumentInput {
  return featureDocument({
    featureId: PAYMENT_ID,
    name: '支付规则',
    module: 'payment',
    purpose: '支付状态决定订单可取消范围。',
    behaviour: PAYMENT_BEHAVIOUR,
    design: 'unconfirmed',
    designDecisionRefs: '无',
    verification: 'unverified',
    verificationEvidenceRefs: '无',
    verificationCoverage: '未调查',
    entries: ['src/payment/rule.ts', 'tests/payment/rule.test.ts'],
    investigationScope: '支付状态规则与测试',
  });
}

function sessionDocument(): FeatureDocumentInput {
  return featureDocument({
    featureId: SESSION_ID,
    name: '会话冷启动',
    module: 'session',
    purpose: '新会话从固定规则、项目概览和当前领域摘要开始，并从 Checkpoint 恢复位置。',
    behaviour: SESSION_BEHAVIOUR,
    entries: ['src/session/cold-start.ts', 'tests/session/cold-start.test.ts'],
    investigationScope: '冷启动装配与 Checkpoint 恢复',
  });
}

/** Builds the fixed sample as a real WP-04 projection. */
function fixtureProjection(): ColdStartProjection {
  const result = buildProjection({
    documents: [cancelDocument(), paymentDocument(), sessionDocument(), ...UNRELATED],
    revision: REVISION,
    codeTreeRevision: REVISION,
    knownIds: [DECISION_ID],
  });
  if (!result.published) {
    throw new Error(
      `the fixed sample must publish as a valid projection: ${result.diagnostics
        .map((entry) => `${entry.documentPath}: ${entry.message}`)
        .join('; ')}`,
    );
  }
  return result.projection;
}

/** The unrelated documents registered in the corpus, as Chief would. */
const UNRELATED_CORPUS = UNRELATED.map((document) => ({
  id: `doc:${document.relativePath}`,
  path: document.relativePath,
  kind: 'document' as const,
  reason: 'Chief 登记的无关文档，用于验证不默认注入',
}));

const HEAVY_ID = 'F-9e8d7c6b';

/** A cancellation Feature whose delivered body alone exceeds the minimum budget. */
function heavyDocument(): FeatureDocumentInput {
  return featureDocument({
    featureId: HEAVY_ID,
    name: '订单取消重负载',
    module: 'orders-heavy',
    purpose: '订单取消的完整现状（重负载样例）。',
    behaviour: `${CANCEL_BEHAVIOUR}\n${'重'.repeat(20_000)}`,
    entries: ['src/orders/heavy.ts', 'tests/orders/heavy.test.ts'],
    investigationScope: '订单取消重负载',
  });
}

/**
 * The fixed sample plus one oversized Feature.
 *
 * `agents.md` §6 sets the minimum *configurable* ceiling at 4096 tokens, so a real
 * budget overflow cannot be produced from the small fixed sample; the heavy
 * Feature is what makes "the budget dropped it" observable at a legal ceiling.
 */
function heavyProjection(): ColdStartProjection {
  const result = buildProjection({
    documents: [
      cancelDocument(),
      paymentDocument(),
      sessionDocument(),
      heavyDocument(),
      ...UNRELATED,
    ],
    revision: REVISION,
    codeTreeRevision: REVISION,
    knownIds: [DECISION_ID],
  });
  if (!result.published) {
    throw new Error(
      `the heavy sample must publish: ${result.diagnostics
        .map((entry) => `${entry.documentPath}: ${entry.message}`)
        .join('; ')}`,
    );
  }
  return result.projection;
}

const TRANSCRIPTS = [
  {
    id: `transcript:${TRANSCRIPT_PATH}`,
    path: TRANSCRIPT_PATH,
    kind: 'transcript' as const,
    reason: '开发聊天记录',
  },
  {
    id: `transcript:${TRANSCRIPT_DIRECTORY_PATH}`,
    path: TRANSCRIPT_DIRECTORY_PATH,
    kind: 'transcript' as const,
    reason: '开发聊天记录',
  },
];

const PROJECT_ID = '11111111111111111111111111111111';
const T0 = '2026-09-11T00:00:00.000Z';

function expectOk<T>(result: ColdStartResult<T> | ContextResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  return result;
}

const tempDirectories: string[] = [];

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

/** A real directory containing the misleading transcript on disk. */
function transcriptDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'agentdev-cold-start-'));
  tempDirectories.push(directory);
  mkdirSync(join(directory, '.agentdev/work/WP-06/transcripts'), { recursive: true });
  writeFileSync(
    join(directory, TRANSCRIPT_PATH),
    `# 开发聊天\n\n用户：我们确认了 ${MISLEADING_CONCLUSION}。\n`,
  );
  writeFileSync(
    join(directory, TRANSCRIPT_DIRECTORY_PATH),
    `# transcript\n\n助手：${MISLEADING_CONCLUSION}，可以跳过支付约束。\n`,
  );
  return directory;
}

describe('cold start: the projection is a real WP-04 projection', () => {
  it('publishes the fixed sample and is structurally consumable by the cold start', () => {
    const projection = fixtureProjection();
    expect(projection.state).toBe('valid');
    expect(projection.revision).toBe(REVISION);
    expect(projection.features.map((feature) => feature.featureId)).toEqual(
      expect.arrayContaining([CANCEL_ID, PAYMENT_ID, SESSION_ID]),
    );
    expect(projection.features).toHaveLength(23);
    const cancel = projection.features.find((feature) => feature.featureId === CANCEL_ID);
    expect(cancel?.relations).toEqual([
      {
        targetFeatureId: PAYMENT_ID,
        kind: 'constrained_by',
        reason: CONSTRAINT_REASON,
        source: `features/${PAYMENT_ID}/README.md`,
      },
    ]);
    expect(projection.documents.project.markdown).toContain('项目知识导航');
  });

  it('assembles the seed from fixed rules, Project overview and the domain summary (§5)', () => {
    const assembled = expectOk(
      assembleColdStart({ projection: fixtureProjection(), query: '订单取消时如何处理支付约束？' }),
    );
    const { seed, context } = assembled.package;
    expect(seed.role).toBe('chief');
    expect(seed.stage).toBe('assist');
    expect(seed.fixedRules.path).toBe(CHIEF_RULES_PATH);
    expect(seed.projectOverview.path).toBe(projectionPath());
    expect(seed.projectOverview.markdown).toContain('项目知识导航');
    expect(seed.domain.summary).toContain('订单取消时如何处理支付约束？');
    expect(context.goal).toBe('订单取消时如何处理支付约束？');
    // A fresh conversation carries no resume position.
    expect(seed.domain.resume).toBeUndefined();
    expect(seed.domain.workId).toBeUndefined();
  });
});

/** The rendered `PROJECT.md` path of the default document root. */
function projectionPath(): string {
  return 'docs/agentdev/PROJECT.md';
}

describe('cold start: selection order and reasons (AC-039)', () => {
  it('follows overview → current work → navigation → constraints → bodies, with a reason each', () => {
    const projection = fixtureProjection();
    const assembled = expectOk(
      assembleColdStart({ projection, query: '订单取消时如何处理支付约束？' }),
    );
    const phases = assembled.package.context.selection.map((entry) => entry.phase);
    // Every selected entry carries a non-empty reason.
    for (const entry of assembled.package.context.selection) {
      expect(entry.reason.trim()).not.toBe('');
      expect(entry.tokens).toBeGreaterThan(0);
    }
    // The phase order is a subsequence of the documented order.
    const positions = phases.map((phase) => COLD_START_SELECTION_ORDER.indexOf(phase));
    expect(positions.every((position) => position >= 0)).toBe(true);
    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index] ?? -1).toBeGreaterThanOrEqual(positions[index - 1] ?? -1);
    }
    expect(phases).toContain('role_contract');
    expect(phases).toContain('project_overview');
    expect(phases).toContain('feature_navigation');
    expect(phases).toContain('related_constraints');
    expect(phases).toContain('role_bodies');
    expect(phases[0]).toBe('role_contract');

    // The payment constraint entered the selection with its source (AC-039).
    const constraint = assembled.package.context.selection.find(
      (entry) => entry.phase === 'related_constraints',
    );
    expect(constraint?.key).toBe(`relation:${CANCEL_ID}->${PAYMENT_ID}`);
    expect(constraint?.featureId).toBe(PAYMENT_ID);
    const paymentSource = assembled.package.context.sources.find(
      (source) => source.id === `${CANCEL_ID}#${PAYMENT_ID}`,
    );
    expect(paymentSource?.reason).toBe('直接关联约束');
    expect(paymentSource?.revision).toBe(REVISION);
  });

  it('is deterministic: the same query selects the same entries in the same order', () => {
    const projection = fixtureProjection();
    const first = expectOk(
      assembleColdStart({ projection, query: '订单取消时如何处理支付约束？' }),
    );
    const second = expectOk(
      assembleColdStart({ projection, query: '订单取消时如何处理支付约束？' }),
    );
    expect(second.package.context.selection).toEqual(first.package.context.selection);
  });
});

describe('cold start: the answer recalls the fixed sample (AC-037)', () => {
  it('finds the current cancellation behaviour, the payment constraint, the test path and the gap', () => {
    const projection = fixtureProjection();
    const result = expectOk(coldStartAnswer({ projection, query: '订单取消时如何处理支付约束？' }));
    const { answer } = result;

    // Current behaviour of the cancellation Feature, attributed to its document.
    expect(answer.selectedFeatureIds).toContain(CANCEL_ID);
    const behaviour = answer.currentBehaviour.find((fact) => fact.featureId === CANCEL_ID);
    expect(behaviour?.text).toContain('已付款订单返回拒绝');
    expect(behaviour?.text).toContain('30 分钟内取消');
    expect(behaviour?.documentPath).toBe(`features/${CANCEL_ID}/README.md`);

    // The payment constraint, with the Feature and source it came from (AC-039).
    const constraint = answer.constraints.find((entry) => entry.targetFeatureId === PAYMENT_ID);
    expect(constraint?.constraint).toBe(CONSTRAINT_REASON);
    expect(constraint?.source).toBe(`features/${PAYMENT_ID}/README.md`);
    // The constrained Feature's own behaviour is reported too.
    const payment = answer.currentBehaviour.find((fact) => fact.featureId === PAYMENT_ID);
    expect(payment?.text).toContain('支付成功后订单不可直接取消');
    expect(answer.constraints.length).toBeGreaterThanOrEqual(1);

    // The related test path (and the production entry), split as required.
    expect(answer.entryPaths.testPaths).toContain('tests/orders/cancel.test.ts');
    expect(answer.entryPaths.codePaths).toContain('src/orders/cancel.ts');

    // The known gap.
    expect(answer.knownGaps.map((gap) => gap.description)).toContain(CANCEL_GAP);
    expect(answer.knownGaps.every((gap) => gap.description !== '无已登记差距')).toBe(true);

    // Attribution is complete for every reported Feature.
    expect(answer.attribution.map((entry) => entry.featureId).sort()).toEqual(
      [...answer.selectedFeatureIds].sort(),
    );

    // The answer used only the matched Features' tokens.
    expect(answer.tokenAccounting.initial.used).toBeGreaterThan(0);
    expect(answer.tokenAccounting.initial.used).toBeLessThanOrEqual(
      answer.tokenAccounting.initial.limit,
    );
  });

  it('does not inject the 20 unrelated documents (selected set and token usage)', () => {
    const projection = fixtureProjection();
    const result = expectOk(
      coldStartAnswer({
        projection,
        query: '订单取消时如何处理支付约束？',
        documents: UNRELATED_CORPUS,
        transcripts: TRANSCRIPTS,
      }),
    );
    const { answer } = result;

    // None of the twenty appears in the selected set.
    // The query names cancellation and payment, so those two Features (and the
    // session Feature only if it genuinely matched) are the whole selection.
    expect([...answer.selectedFeatureIds].sort()).toEqual([CANCEL_ID, PAYMENT_ID].sort());

    // Every unrelated document is listed as excluded, with a reason, exactly once.
    // (The session Feature is in the projection but does not answer this query, so
    // it is excluded by the same rule.)
    const excludedUnrelated = answer.excluded.filter((entry) => entry.kind === 'unrelated');
    const excludedIds = excludedUnrelated.map((entry) => entry.ref.id);
    for (const unrelatedId of UNRELATED_IDS) {
      expect(excludedIds).toContain(`feature:${unrelatedId}`);
      expect(excludedIds).not.toContain(`feature:${CANCEL_ID}`);
      expect(excludedIds).not.toContain(`feature:${PAYMENT_ID}`);
    }
    expect(excludedUnrelated).toHaveLength(UNRELATED_IDS.length + 1);
    expect(excludedIds).toContain(`feature:${SESSION_ID}`);
    expect(new Set(excludedIds).size).toBe(excludedIds.length);
    expect(excludedUnrelated.every((entry) => entry.reason.includes('无匹配'))).toBe(true);

    // …and none of their bodies counted against the budget.
    const bodyTokens = answer.packages.context.selection
      .filter((entry) => entry.phase === 'role_bodies')
      .map((entry) => entry.featureId);
    for (const unrelatedId of UNRELATED_IDS) expect(bodyTokens).not.toContain(unrelatedId);

    // Selection stayed far below the startup ceiling: it is a selection, not a dump.
    expect(answer.tokenAccounting.initial.used).toBeLessThan(
      answer.tokenAccounting.initial.limit / 2,
    );
    expect(answer.packages.context.selection).toHaveLength(6);
  });

  it('reports a precise budget gap instead of injecting more (AC-036)', () => {
    const projection = heavyProjection();
    const assembled = expectOk(
      assembleColdStart({
        projection,
        query: '订单取消时如何处理支付约束？',
        limits: { startupTokens: 4_096 },
      }),
    );
    const budgetEntries = assembled.package.context.excluded.filter(
      (entry) => entry.kind === 'budget',
    );
    expect(budgetEntries.length).toBeGreaterThan(0);
    expect(budgetEntries[0]?.reason).toContain('预算不足');
    expect(assembled.package.context.unknowns.some((line) => line.includes('预算不足'))).toBe(true);
    expect(assembled.package.context.tokenAccounting.initial.used).toBeLessThanOrEqual(4_096);
    // The oversized Feature's body was not selected at all.
    expect(assembled.package.context.selection.some((entry) => entry.featureId === HEAVY_ID)).toBe(
      false,
    );
  });

  it('charges the fixed seed against the startup budget and fails closed at zero (W5R1-07)', () => {
    const projection = fixtureProjection();
    const assembled = assembleColdStart({
      projection,
      query: '订单取消时如何处理支付约束？',
      limits: { startupTokens: 0 },
    });
    expect(assembled.ok).toBe(false);
    if (assembled.ok) return;
    expect(assembled.code).toBe('BUDGET_EXCEEDED');
    const messages = assembled.errors.map((error) => error.message).join(' | ');
    expect(messages).toContain(CHIEF_RULES_PATH);
    expect(messages).toContain('缺口');
    // No seed body leaked through the refusal: the fixed-rules body and the
    // Project overview are not part of the failure.
    const serialized = JSON.stringify(assembled);
    expect(serialized).not.toContain('# Agent 固定规则');
    expect(serialized).not.toContain('项目知识导航');
    // The answer entry point closes the same way.
    const answered = coldStartAnswer({
      projection,
      query: '订单取消时如何处理支付约束？',
      limits: { startupTokens: 0 },
    });
    expect(answered.ok).toBe(false);
    if (!answered.ok) expect(answered.code).toBe('BUDGET_EXCEEDED');
  });

  it('refuses cold-start limits outside the documented range (W5R1-06)', () => {
    const projection = fixtureProjection();
    const rejected = [
      { startupTokens: 4_095 },
      { startupTokens: 2_000_001 },
      { startupTokens: 4_096.5 },
      { startupTokens: 1e15 },
      { startupTokens: Number.MAX_SAFE_INTEGER },
      { startupTokens: 24_000, expansionTokens: 4_095 },
    ];
    for (const limits of rejected) {
      const result = assembleColdStart({
        projection,
        query: '订单取消时如何处理支付约束？',
        limits,
      });
      expect(result.ok, JSON.stringify(limits)).toBe(false);
      if (result.ok) continue;
      expect(result.code, JSON.stringify(limits)).toBe('VALIDATION_ERROR');
    }
    // The documented boundaries are not a validation error (the seed may still be
    // too large for the smallest legal ceiling, which is a reported budget gap).
    for (const startupTokens of [4_096, 2_000_000]) {
      const result = assembleColdStart({
        projection,
        query: '订单取消时如何处理支付约束？',
        limits: { startupTokens },
      });
      if (!result.ok) expect(result.code, String(startupTokens)).not.toBe('VALIDATION_ERROR');
    }
  });

  it('closes a throwing cold-start clock instead of escaping (W5R1-10)', () => {
    const result = assembleColdStart({
      projection: fixtureProjection(),
      query: '订单取消时如何处理支付约束？',
      now: () => {
        throw new Error('clock boom: secret-token');
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('marks a stale projection as an unknown rather than presenting it as current', () => {
    const projection = fixtureProjection();
    const stale: ColdStartProjection = {
      ...projection,
      state: 'stale',
      staleReason: '非法 Feature 知识，拒绝发布',
    };
    const assembled = expectOk(
      assembleColdStart({ projection: stale, query: '订单取消时如何处理支付约束？' }),
    );
    expect(assembled.package.context.unknowns.some((line) => line.includes('投影已过期'))).toBe(
      true,
    );
  });
});

describe('cold start: the transcript is unreadable and cannot change the answer (AC-033)', () => {
  it('excludes a development-chat transcript with a reason instead of selecting it', () => {
    const projection = fixtureProjection();
    const assembled = expectOk(
      assembleColdStart({
        projection,
        query: '订单取消时如何处理支付约束？',
        corpus: UNRELATED_CORPUS,
        transcripts: TRANSCRIPTS,
      }),
    );
    const transcripts = assembled.package.context.excluded.filter(
      (entry) => entry.kind === 'transcript',
    );
    expect(transcripts.map((entry) => entry.ref.id).sort()).toEqual(
      TRANSCRIPTS.map((entry) => `transcript:${entry.path}`).sort(),
    );
    for (const entry of transcripts) {
      expect(entry.reason).toBe(TRANSCRIPT_DENIAL_REASON);
    }
    // Not selected, and its content is nowhere in the package.
    expect(
      assembled.package.context.selection.some((entry) => entry.key.includes('chat-history')),
    ).toBe(false);
    expect(JSON.stringify(assembled.package)).not.toContain(MISLEADING_CONCLUSION);
  });

  it('refuses to read the transcript from a real directory, contents included', () => {
    const directory = transcriptDirectory();
    const projection = fixtureProjection();
    const result = expectOk(
      coldStartAnswer({
        projection,
        query: '订单取消时如何处理支付约束？',
        documents: UNRELATED_CORPUS,
        transcripts: TRANSCRIPTS,
        directory,
      }),
    );

    for (const path of [TRANSCRIPT_PATH, TRANSCRIPT_DIRECTORY_PATH]) {
      expect(result.guard.readable(path)).toBe(false);
      const refusal = result.guard.refusal(path);
      expect(refusal?.code).toBe('CONTEXT_FORBIDDEN');
      expect(refusal?.message.toLowerCase()).toContain('transcript');
      const read = result.guard.read(path);
      expect(read.ok).toBe(false);
      if (read.ok) throw new Error(`expected ${path} to be unreadable`);
      // A refusal never carries content.
      expect(read).not.toHaveProperty('content');
      expect(read.errors[0]?.code).toBe('CONTEXT_FORBIDDEN');
    }

    // A registered document is readable, but an unregistered path is not — even
    // though it would pass the ACL on its own.
    expect(result.guard.readable(CHIEF_RULES_PATH)).toBe(true);
    expect(result.guard.readable('docs/notes/random-note.md')).toBe(false);
    expect(result.guard.refusal('docs/notes/random-note.md')?.code).toBe('CONTEXT_FORBIDDEN');
    expect(result.guard.read('docs/notes/random-note.md').ok).toBe(false);

    // The answer is derived from the projection: the misleading conclusion never
    // appears in any reported fact.
    const serialized = JSON.stringify(result.answer);
    expect(serialized).not.toContain(MISLEADING_CONCLUSION);
    const behaviour = result.answer.currentBehaviour.find((fact) => fact.featureId === CANCEL_ID);
    expect(behaviour?.text).toContain('已付款订单返回拒绝');
    expect(behaviour?.text).not.toContain('可以随时直接取消');
  });

  it('has the same answer with and without the transcript in the corpus', () => {
    const projection = fixtureProjection();
    const without = expectOk(
      coldStartAnswer({ projection, query: '订单取消时如何处理支付约束？' }),
    );
    const withTranscript = expectOk(
      coldStartAnswer({
        projection,
        query: '订单取消时如何处理支付约束？',
        transcripts: TRANSCRIPTS,
      }),
    );
    expect(withTranscript.answer.currentBehaviour).toEqual(without.answer.currentBehaviour);
    expect(withTranscript.answer.constraints).toEqual(without.answer.constraints);
    expect(withTranscript.answer.entryPaths).toEqual(without.answer.entryPaths);
    expect(withTranscript.answer.knownGaps).toEqual(without.answer.knownGaps);
    // Only the exclusion list grows.
    const extraExcluded = withTranscript.answer.excluded.filter(
      (entry) => entry.kind === 'transcript',
    );
    expect(extraExcluded).toHaveLength(2);
    expect(without.answer.excluded.filter((entry) => entry.kind === 'transcript')).toHaveLength(0);
  });

  it('rejects a corpus registered through a transcript path pattern at the guard', () => {
    // Even when a transcript is smuggled in as a *document*, the guard refuses it:
    // the deny-list is on the path, not on the caller's label.
    const guard = createTranscriptGuard({
      role: 'chief',
      stage: 'assist',
      project: {
        projectId: PROJECT_ID,
        codeRoot: '',
        documentRoot: '',
        deliveryBranch: 'agentdev/main',
      },
      corpus: [
        {
          id: 'doc:transcript',
          path: TRANSCRIPT_PATH,
          kind: 'document',
          reason: 'smuggled',
        },
      ],
    });
    expect(guard.readable(TRANSCRIPT_PATH)).toBe(false);
    expect(guard.read(TRANSCRIPT_PATH).ok).toBe(false);
    expect(guard.refusal(TRANSCRIPT_PATH)?.code).toBe('CONTEXT_FORBIDDEN');
  });

  it('refuses the dev-chat and developer-transcript path markers (W5R1-05)', () => {
    for (const path of ['docs/dev-chat.md', 'docs/developer-transcript.md']) {
      const guard = createTranscriptGuard({
        role: 'chief',
        stage: 'assist',
        project: {
          projectId: PROJECT_ID,
          codeRoot: '',
          documentRoot: 'docs',
          deliveryBranch: 'agentdev/main',
        },
        corpus: [{ id: `doc:${path}`, path, kind: 'document', reason: 'smuggled as a document' }],
      });
      expect(guard.readable(path), path).toBe(false);
      expect(guard.refusal(path)?.code, path).toBe('CONTEXT_FORBIDDEN');
      expect(guard.read(path).ok, path).toBe(false);
    }
  });

  it('refuses a corpus symlink that escapes the project root (W5R1-02)', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentdev-symlink-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'agentdev-symlink-outside-'));
    tempDirectories.push(root, outside);
    mkdirSync(join(root, 'docs'), { recursive: true });
    const secret = join(outside, 'secret.md');
    writeFileSync(secret, 'HOST-SECRET-OUTSIDE-PROJECT\n', 'utf8');
    symlinkSync(secret, join(root, 'docs/notes.md'));

    const guardFor = (corpus: { readonly id: string; readonly path: string }[]) =>
      createTranscriptGuard({
        role: 'chief',
        stage: 'assist',
        project: {
          projectId: PROJECT_ID,
          codeRoot: '',
          documentRoot: 'docs',
          deliveryBranch: 'agentdev/main',
        },
        directory: root,
        corpus: corpus.map((entry) => ({
          id: entry.id,
          path: entry.path,
          kind: 'document' as const,
          reason: 'corpus entry',
        })),
      });

    // The symlink is inside the project but resolves outside it: `execution.md` §3
    // forbids the escape, so it is refused and its bytes never come back.
    const escaping = guardFor([{ id: 'doc:docs/notes.md', path: 'docs/notes.md' }]);
    expect(escaping.readable('docs/notes.md')).toBe(false);
    expect(escaping.refusal('docs/notes.md')?.code).toBe('CONTEXT_FORBIDDEN');
    const read = escaping.read('docs/notes.md');
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error('expected the symlink to be unreadable');
    expect(read).not.toHaveProperty('content');
    expect(JSON.stringify(read)).not.toContain('HOST-SECRET');

    // Control: a regular file inside the root is still readable.
    writeFileSync(join(root, 'docs/README.md'), 'inside the project\n', 'utf8');
    const inside = guardFor([{ id: 'doc:docs/README.md', path: 'docs/README.md' }]);
    const insideRead = inside.read('docs/README.md');
    expect(insideRead.ok).toBe(true);
    if (insideRead.ok) expect(insideRead.content).toBe('inside the project\n');
  });

  it('rejects an empty query and a non-projection input', () => {
    const projection = fixtureProjection();
    const empty = assembleColdStart({ projection, query: '   ' });
    expect(empty.ok).toBe(false);
    if (empty.ok) throw new Error('expected a refusal');
    expect(empty.code).toBe('VALIDATION_ERROR');

    const broken = assembleColdStart({
      projection: { ...projection, features: undefined } as unknown as ColdStartProjection,
      query: '订单取消',
    });
    expect(broken.ok).toBe(false);
  });
});

describe('cold start: resuming from a Checkpoint (context.md §5)', () => {
  it('carries the Work/Task/stage and next action into the seed without the old transcript', () => {
    const projection = fixtureProjection();
    // A real checkpoint from the store, so the seed consumes the same shape a
    // resumed session would receive.
    const store = createCheckpointStore({ now: () => T0 });
    const runId = '0191f000-0000-7000-8000-0000000000aa';
    const sessionRef = 'session-new';
    expectOk(
      store.registerRun({
        runId,
        role: 'backend',
        projectId: PROJECT_ID,
        workId: 'WP-06',
        sessionRef,
      }),
    );
    const saved = expectOk(
      store.save({
        runId,
        checkpoint: {
          runId,
          projectId: PROJECT_ID,
          role: 'backend',
          sessionRef,
          workId: 'WP-06',
          taskId: '0191f000-0000-7000-8000-0000000000c1',
          stage: 'develop-L2',
          manifest: { id: DECISION_ID, version: 3, hash: 'a'.repeat(64) },
          pendingDecisions: [
            {
              id: 'd-1',
              kind: 'permission',
              state: 'pending',
              summary: '等待用户授权测试命令',
              requestedAt: T0,
            },
          ],
          artifactRefs: [],
          nextAction: '运行 orders 取消测试并提交 stage_result',
          recentMessages: [],
          approval: { state: 'approved', decidedAt: T0, role: 'backend' },
          sourceRefs: [
            {
              kind: 'git',
              id: 'src/orders/cancel.ts',
              version: REVISION,
              path: 'src/orders/cancel.ts',
            },
          ],
        },
      }),
    );

    const result = expectOk(
      coldStartAnswer({
        projection,
        query: '订单取消时如何处理支付约束？',
        checkpoint: saved.checkpoint,
        transcripts: TRANSCRIPTS,
      }),
    );
    expect(result.answer.packages.seed.role).toBe('backend');
    expect(result.answer.packages.seed.stage).toBe('develop-L2');
    expect(result.answer.packages.seed.domain.workId).toBe('WP-06');
    expect(result.answer.packages.seed.domain.resume).toEqual({
      stage: 'develop-L2',
      nextAction: '运行 orders 取消测试并提交 stage_result',
      manifest: `${DECISION_ID}@3`,
      approval: 'approved',
    });
    // The resume position is a selection entry of the current-Work phase.
    const currentWork = result.answer.packages.context.selection.find(
      (entry) => entry.phase === 'current_work',
    );
    expect(currentWork?.key).toBe(`checkpoint:${runId}`);
    // The transcript is still excluded after a rotation.
    expect(result.answer.excluded.filter((entry) => entry.kind === 'transcript')).toHaveLength(
      TRANSCRIPTS.length,
    );
    expect(JSON.stringify(result.answer)).not.toContain(MISLEADING_CONCLUSION);
  });

  it("still enforces the caller's readScope when the Project roots are narrower", () => {
    const guard = createTranscriptGuard({
      role: 'chief',
      stage: 'assist',
      project: {
        projectId: PROJECT_ID,
        codeRoot: 'src',
        documentRoot: 'docs/agentdev',
        deliveryBranch: 'agentdev/main',
      },
      corpus: [
        {
          id: `feature:${CANCEL_ID}`,
          path: `features/${CANCEL_ID}/README.md`,
          kind: 'feature',
          reason: 'feature navigation is readable by every role',
        },
        {
          id: 'doc:outside',
          path: 'foo/bar.ts',
          kind: 'code',
          reason: 'registered, but outside this readScope',
        },
      ],
    });
    // A readable, registered path is admitted…
    expect(guard.readable(`features/${CANCEL_ID}/README.md`)).toBe(true);
    // …but the corpus allow-list is not a bypass: the ACL still decides.
    expect(guard.readable('foo/bar.ts')).toBe(false);
    expect(guard.refusal('foo/bar.ts')?.code).toBe('CONTEXT_FORBIDDEN');
    expect(guard.read('foo/bar.ts').ok).toBe(false);
    // …and a path escaping the repository root is refused outright.
    expect(guard.readable('../secrets.md')).toBe(false);
    expect(guard.read('../secrets.md').ok).toBe(false);
    // A plain assembly with the same projection is unaffected.
    const assembled = assembleColdStart({
      projection: fixtureProjection(),
      query: '订单取消时如何处理支付约束？',
    });
    expect(assembled.ok).toBe(true);
  });
});
