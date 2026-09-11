import { describe, expect, it } from 'vitest';
import { emptyScope, type ProductDefinition } from '@agentdev/contracts';
import {
  FEATURE_SECTION_HEADINGS,
  buildProjection,
  createInMemoryProjectionCache,
  listGaps,
  observedVsConfirmed,
  queryFeatureView,
  type DesignView,
  type DeliveredView,
  type FeatureDocumentInput,
  type FeatureView,
  type FeatureViewResult,
  type KnowledgeProjection,
  type ProjectionBuildResult,
  type WorkOverlay,
  type WorkView,
} from '../src/index.js';

const REVISION = '9f2c1a4b8d3e5f60718293a4b5c6d7e8f9012345';
const OTHER_REVISION = '0123456789abcdef0123456789abcdef01234567';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
const OTHER_DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e62';
const CANCEL_ID = 'F-1a2b3c4d';
const PAYMENT_ID = 'F-5e6f7a8b';
const KNOWN_IDS = [DECISION_ID, OTHER_DECISION_ID];

const CANCEL_PURPOSE = '允许用户取消未付款订单。已付款订单走退款流程。';
const CANCEL_BEHAVIOUR = [
  '输入：订单号与用户身份。',
  '前置条件：订单归属当前用户。',
  '正常输出：未付款订单进入已取消状态。',
  '异常输出：已付款订单返回拒绝。',
  '约束：仅未付款订单可在 30 分钟内取消。',
].join('\n');
const CANCEL_GAP = '并发取消未覆盖。';
const CONSTRAINT_REASON = '付款状态决定可取消范围';
const PAYMENT_BEHAVIOUR = '支付成功后订单不可直接取消。';

interface DocumentOptions {
  readonly featureId?: string;
  readonly name?: string;
  readonly module?: string;
  readonly fields?: Readonly<Record<string, string>>;
  readonly sections?: Readonly<Record<string, string>>;
}

function featureDocument(options: DocumentOptions = {}): FeatureDocumentInput {
  const featureId = options.featureId ?? CANCEL_ID;
  const name = options.name ?? '订单取消';
  const relativePath = `features/${featureId}/README.md`;
  const fields: Record<string, string> = {
    feature_id: featureId,
    name,
    module: options.module ?? 'orders',
    owner_document: relativePath,
    design: 'confirmed',
    design_decision_refs: `decision:${DECISION_ID}`,
    implementation: 'absent',
    verification: 'unverified',
    verification_evidence_refs: '无',
    verification_coverage: '未调查',
    investigation: 'investigated',
    investigation_scope: '订单取消路由、状态转换和测试',
    source_refs: `git:${REVISION}:src/orders/cancel.ts`,
    revision: REVISION,
    ...options.fields,
  };
  const sections: Record<string, string> = {
    用途: CANCEL_PURPOSE,
    当前行为: CANCEL_BEHAVIOUR,
    关系: [
      '| target_feature_id | kind | reason | source |',
      '|---|---|---|---|',
      `| ${PAYMENT_ID} | constrained_by | ${CONSTRAINT_REASON} | features/${PAYMENT_ID}/README.md |`,
    ].join('\n'),
    实现入口: ['- src/orders/cancel.ts', '- tests/orders/cancel.test.ts'].join('\n'),
    已知差距: `- ${CANCEL_GAP}`,
    关键决定: `- decision:${DECISION_ID}：已付款取消使用退款流程。`,
    ...options.sections,
  };
  const lines = [`# ${name}`, '', '| 字段 | 值 |', '|---|---|'];
  for (const [key, value] of Object.entries(fields)) lines.push(`| ${key} | ${value} |`);
  lines.push('');
  for (const heading of FEATURE_SECTION_HEADINGS) {
    const body = sections[heading];
    if (body === undefined) continue;
    lines.push(`## ${heading}`, body, '');
  }
  return { relativePath, markdown: lines.join('\n') };
}

function paymentDocument(): FeatureDocumentInput {
  return featureDocument({
    featureId: PAYMENT_ID,
    name: '支付规则',
    module: 'payment',
    fields: {
      design: 'unconfirmed',
      design_decision_refs: '无',
      implementation: 'implemented',
      source_refs: `git:${REVISION}:src/payment/rule.ts`,
    },
    sections: {
      用途: '支付状态决定订单可取消范围。',
      当前行为: PAYMENT_BEHAVIOUR,
      关系: '无',
      实现入口: '- src/payment/rule.ts',
      已知差距: '无已登记差距。',
      关键决定: '无',
    },
  });
}

function invalidDocument(): FeatureDocumentInput {
  return featureDocument({ featureId: 'F-99999999', fields: { design: 'certain' } });
}

function build(
  documents: readonly FeatureDocumentInput[],
  cache?: ReturnType<typeof createInMemoryProjectionCache>,
): ProjectionBuildResult {
  return buildProjection({
    documents,
    revision: REVISION,
    codeTreeRevision: REVISION,
    knownIds: KNOWN_IDS,
    ...(cache === undefined ? {} : { cache }),
  });
}

function published(result: ProjectionBuildResult): KnowledgeProjection {
  expect(result.published, 'expected the projection to publish').toBe(true);
  if (!result.published) throw new Error('expected the projection to publish');
  return result.projection;
}

function viewOf<K extends FeatureView['view']>(
  result: FeatureViewResult,
  view: K,
): Extract<FeatureView, { view: K }> {
  expect(result.ok, 'expected the view query to succeed').toBe(true);
  if (!result.ok) throw new Error('expected the view query to succeed');
  expect(result.view.view).toBe(view);
  return result.view as Extract<FeatureView, { view: K }>;
}

function definition(goal: string, featureRefs: readonly string[]): ProductDefinition {
  return {
    goal,
    scope: emptyScope(),
    behaviors: [
      { id: 'B-1', trigger: '用户请求取消', expected: '订单取消', failure: '返回拒绝原因' },
    ],
    acceptance: [{ id: 'A-1', given: '未付款订单', when: '取消', then: '已取消' }],
    constraints: ['不得影响已付款订单'],
    decisionRefs: [DECISION_ID],
    featureRefs: [...featureRefs],
  };
}

interface OverlayOptions {
  readonly featureRefs?: readonly string[];
  readonly confirmed?: boolean;
  readonly baseRevision?: string;
}

function workOverlay(workId: string, goal: string, options: OverlayOptions = {}): WorkOverlay {
  return {
    workId,
    baseRevision: options.baseRevision ?? REVISION,
    definition: definition(goal, options.featureRefs ?? [CANCEL_ID]),
    confirmed: options.confirmed ?? true,
  };
}

function designOf(projection: KnowledgeProjection): DesignView {
  return viewOf(queryFeatureView(projection, { featureId: CANCEL_ID, view: 'design' }), 'design');
}

function deliveredOf(projection: KnowledgeProjection): DeliveredView {
  return viewOf(
    queryFeatureView(projection, { featureId: CANCEL_ID, view: 'delivered' }),
    'delivered',
  );
}

function workOf(projection: KnowledgeProjection, overlay: WorkOverlay): WorkView {
  return viewOf(
    queryFeatureView(projection, { featureId: CANCEL_ID, view: 'work', workOverlay: overlay }),
    'work',
  );
}

describe('knowledge views', () => {
  it('separates confirmed intent from delivered reality (AC-038, AC-037)', () => {
    const projection = published(build([featureDocument(), paymentDocument()]));
    const design = designOf(projection);
    const delivered = deliveredOf(projection);

    expect(design.view).toBe('design');
    expect(design.design).toBe('confirmed');
    expect(design.designDecisionRefs).toEqual([`decision:${DECISION_ID}`]);
    expect(design.purpose.text).toBe(CANCEL_PURPOSE);
    expect(design.implementation).toBe('absent');

    expect(delivered.view).toBe('delivered');
    expect(delivered.design).toBe('confirmed');
    expect(delivered.implementation).toBe('absent');
    expect(delivered.verification).toBe('unverified');
    expect(delivered.currentBehaviour.text).toContain('正常输出：未付款订单进入已取消状态。');
    expect(delivered.currentBehaviour.text).toContain('约束：仅未付款订单可在 30 分钟内取消。');
    expect(delivered.constraints).toEqual([CONSTRAINT_REASON]);
    expect(delivered.implementationEntries.map((entry) => entry.path)).toContain(
      'src/orders/cancel.ts',
    );
    expect(delivered.gaps.map((gap) => gap.description)).toEqual([CANCEL_GAP]);

    // The design answer never carries delivered facts...
    expect(JSON.stringify(design)).not.toContain('约束：仅未付款订单可在 30 分钟内取消。');
    expect(JSON.stringify(design)).not.toContain(CANCEL_GAP);
    expect(JSON.stringify(design)).not.toContain('src/orders/cancel.ts');
    // ...and the delivered answer never carries the design decision refs.
    expect('designDecisionRefs' in delivered).toBe(false);
    expect('decisions' in delivered).toBe(false);
    expect(JSON.stringify(delivered)).not.toContain(DECISION_ID);
    expect(JSON.stringify(delivered)).not.toContain(CANCEL_PURPOSE);

    // A design-only change leaves the delivered answer unchanged.
    const changedDesign = published(
      build([
        featureDocument({ fields: { design_decision_refs: `decision:${OTHER_DECISION_ID}` } }),
        paymentDocument(),
      ]),
    );
    expect(deliveredOf(changedDesign)).toEqual(delivered);
    expect(designOf(changedDesign).designDecisionRefs).toEqual([`decision:${OTHER_DECISION_ID}`]);
  });

  it('answers AC-037 from the feature body without injecting unrelated documents', () => {
    const projection = published(build([featureDocument(), paymentDocument()]));
    const delivered = deliveredOf(projection);

    expect(delivered.name).toBe('订单取消');
    expect(delivered.module).toBe('orders');
    expect(delivered.currentBehaviour.text).toContain('输入：订单号与用户身份。');
    expect(delivered.currentBehaviour.text).toContain('约束：仅未付款订单可在 30 分钟内取消。');
    expect(delivered.constraints).toContain(CONSTRAINT_REASON);

    const json = JSON.stringify(delivered);
    expect(json).not.toContain(PAYMENT_ID);
    expect(json).not.toContain(PAYMENT_BEHAVIOUR);
    expect(json).not.toContain('支付规则');
  });

  it('keeps a Work overlay out of the delivered answer and out of another Work (AC-038)', () => {
    const projection = published(build([featureDocument()]));
    const deliveredBefore = deliveredOf(projection);
    const designBefore = designOf(projection);

    const workA = workOf(projection, workOverlay('WP-100', '支持部分取消'));
    expect(workA.view).toBe('work');
    expect(workA.workId).toBe('WP-100');
    expect(workA.notDelivered).toBe(true);
    expect(workA.baselineChanged).toBe(false);
    expect(workA.overlay?.goal).toBe('支持部分取消');
    expect(workA.overlay?.state).toBe('confirmed');
    expect(workA.overlay?.behaviors).toHaveLength(1);
    expect(workA.delivered.currentBehaviour.text).toBe(deliveredBefore.currentBehaviour.text);
    expect(JSON.stringify(workA)).not.toContain('支持批量取消');

    const workB = workOf(projection, workOverlay('WP-200', '支持批量取消'));
    expect(workB.workId).toBe('WP-200');
    expect(workB.overlay?.goal).toBe('支持批量取消');
    expect(JSON.stringify(workB)).not.toContain('支持部分取消');

    // Querying a Work changes no other view.
    const deliveredAfter = deliveredOf(projection);
    const designAfter = designOf(projection);
    expect(deliveredAfter).toEqual(deliveredBefore);
    expect(designAfter).toEqual(designBefore);
    expect(JSON.stringify(deliveredAfter)).not.toContain('支持部分取消');
    expect(JSON.stringify(designAfter)).not.toContain('支持部分取消');
  });

  it('marks an unconfirmed overlay as draft and an undeclared feature as no target', () => {
    const projection = published(build([featureDocument()]));

    const draft = workOf(projection, workOverlay('WP-300', '草稿目标', { confirmed: false }));
    expect(draft.overlay?.state).toBe('draft');
    expect(draft.unknowns.some((unknown) => unknown.includes('draft'))).toBe(true);

    const unrelated = workOf(
      projection,
      workOverlay('WP-400', '支付目标', { featureRefs: [PAYMENT_ID] }),
    );
    expect(unrelated.overlay).toBeNull();
    expect(unrelated.unknowns.some((unknown) => unknown.includes('未声明'))).toBe(true);
  });

  it('reports a baseline change when the Work base revision is not the projection code tree', () => {
    const projection = published(build([featureDocument()]));
    const work = workOf(
      projection,
      workOverlay('WP-500', '目标', { baseRevision: OTHER_REVISION }),
    );

    expect(work.baselineChanged).toBe(true);
    expect(work.baseRevision).toBe(OTHER_REVISION);
    expect(work.unknowns.some((unknown) => unknown.includes('基线'))).toBe(true);
  });

  it('lists recorded gaps and ignores a no-gap statement', () => {
    const projection = published(build([featureDocument(), paymentDocument()]));
    const gaps = listGaps(projection);

    expect(gaps).toEqual([
      {
        featureId: CANCEL_ID,
        featureName: '订单取消',
        description: CANCEL_GAP,
        source: '已知差距',
      },
    ]);
    expect(gaps.every((gap) => !gap.description.includes('无已登记差距'))).toBe(true);
  });

  it('lists observed-versus-confirmed gaps without accepting observed behaviour (AC-042)', () => {
    const projection = published(build([featureDocument(), paymentDocument()]));
    const divergences = observedVsConfirmed(projection.features);

    const observed = divergences.find((entry) => entry.featureId === PAYMENT_ID);
    expect(observed?.kind).toBe('observed_not_confirmed');
    expect(observed?.design).toBe('unconfirmed');
    expect(observed?.implementation).toBe('implemented');
    expect(observed?.sourceRefs).toEqual([`git:${REVISION}:src/payment/rule.ts`]);
    expect(observed?.mustNotAcceptObserved).toBe(true);
    expect(observed?.message).toContain('observed');

    const confirmed = divergences.find((entry) => entry.featureId === CANCEL_ID);
    expect(confirmed?.kind).toBe('confirmed_not_observed');
    expect(confirmed?.mustNotAcceptObserved).toBe(false);
    expect(divergences).toHaveLength(2);
  });

  it('never presents a stale projection as current (AC-040)', () => {
    const cache = createInMemoryProjectionCache();
    const fresh = published(build([featureDocument()], cache));
    const freshView = deliveredOf(fresh);
    expect(freshView.projectionState).toBe('valid');
    expect(freshView.current).toBe(true);

    const refused = build([featureDocument(), invalidDocument()], cache);
    expect(refused.published).toBe(false);
    const stale = cache.lastValid();
    expect(stale?.state).toBe('stale');

    const staleView = deliveredOf(stale ?? fresh);
    expect(staleView.projectionState).toBe('stale');
    expect(staleView.current).toBe(false);
    expect(staleView.sourceRevision).toBe(REVISION);
    expect(staleView.unknowns.some((unknown) => unknown.includes('过期'))).toBe(true);
    expect(staleView.currentBehaviour.text).toContain('约束：仅未付款订单可在 30 分钟内取消。');
  });

  it('returns typed errors for an unknown feature and a work view without an overlay', () => {
    const projection = published(build([featureDocument()]));

    const unknown = queryFeatureView(projection, { featureId: 'F-00000000', view: 'delivered' });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(unknown.errors[0]?.code).toBe('NOT_FOUND');
      expect(unknown.errors[0]?.featureId).toBe('F-00000000');
    }

    const missingOverlay = queryFeatureView(projection, { featureId: CANCEL_ID, view: 'work' });
    expect(missingOverlay.ok).toBe(false);
    if (!missingOverlay.ok) expect(missingOverlay.errors[0]?.code).toBe('VALIDATION_ERROR');
  });
});
