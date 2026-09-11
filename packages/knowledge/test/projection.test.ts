import { describe, expect, it } from 'vitest';
import {
  FEATURE_SECTION_HEADINGS,
  buildProjection,
  contentHash,
  deliveryBlockedByLinks,
  firstSentence,
  createInMemoryProjectionCache,
  parseFeatureDocument,
  type FeatureDocumentInput,
  type KnowledgeProjection,
  type ProjectionBuildResult,
  type ProjectionRejected,
  type RenderedDocument,
} from '../src/index.js';

const REVISION = '9f2c1a4b8d3e5f60718293a4b5c6d7e8f9012345';
const OTHER_REVISION = '0123456789abcdef0123456789abcdef01234567';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
const OTHER_DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e62';
const ARTIFACT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';
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
const PAYMENT_PURPOSE = '支付状态决定订单可取消范围。';
const PAYMENT_BEHAVIOUR = '支付成功后订单不可直接取消。';
const CONSTRAINT_REASON = '付款状态决定可取消范围';

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
    implementation: 'implemented',
    verification: 'passed',
    verification_evidence_refs: `artifact:${ARTIFACT_ID}@1`,
    verification_coverage: '未付款可取消；已付款拒绝',
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
    已知差距: '无已登记差距。',
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
      verification: 'unverified',
      verification_evidence_refs: '无',
      verification_coverage: '未调查',
      investigation_scope: '支付状态规则与测试',
      source_refs: `git:${REVISION}:src/payment/rule.ts`,
    },
    sections: {
      用途: PAYMENT_PURPOSE,
      当前行为: PAYMENT_BEHAVIOUR,
      关系: '无',
      实现入口: '- src/payment/rule.ts',
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

function rejected(result: ProjectionBuildResult): ProjectionRejected {
  expect(result.published, 'expected the projection to be refused').toBe(false);
  if (result.published) throw new Error('expected the projection to be refused');
  return result;
}

function expectDigest(document: RenderedDocument): void {
  expect(document.contentHash).toBe(contentHash(document.markdown));
  expect(document.contentHash).toMatch(/^[0-9a-f]{64}$/u);
}

describe('projection build', () => {
  it('publishes the index, features README, CODE_MAP and PROJECT navigation with links', () => {
    const projection = published(build([featureDocument(), paymentDocument()]));

    expect(projection.state).toBe('valid');
    expect(projection.staleSince).toBeUndefined();
    expect(projection.features.map((feature) => feature.featureId)).toEqual([
      CANCEL_ID,
      PAYMENT_ID,
    ]);
    expect(projection.index).toHaveLength(2);
    expect(projection.index[0]).toMatchObject({
      featureId: CANCEL_ID,
      name: '订单取消',
      module: 'orders',
      summary: '允许用户取消未付款订单',
      link: `features/${CANCEL_ID}/README.md`,
      design: 'confirmed',
      implementation: 'implemented',
      verification: 'passed',
    });
    expect(projection.index[1]?.summary).toBe('支付状态决定订单可取消范围');

    const readme = projection.documents.featuresReadme;
    expect(readme.path).toBe('docs/agentdev/features/README.md');
    expect(readme.markdown).toContain(
      `| ${CANCEL_ID} | 订单取消 | orders | 允许用户取消未付款订单 | [订单取消](${CANCEL_ID}/README.md) |`,
    );
    expect(readme.markdown).toContain(`[支付规则](${PAYMENT_ID}/README.md)`);
    expectDigest(readme);

    const codeMap = projection.documents.codeMap;
    expect(codeMap.path).toBe('docs/agentdev/CODE_MAP.md');
    expect(projection.codeMap).toContainEqual(
      expect.objectContaining({
        featureId: CANCEL_ID,
        module: 'orders',
        path: 'src/orders/cancel.ts',
        link: `features/${CANCEL_ID}/README.md`,
      }),
    );
    expect(codeMap.markdown).toContain(`[订单取消](features/${CANCEL_ID}/README.md)`);
    expect(codeMap.markdown).toContain('src/payment/rule.ts');
    expectDigest(codeMap);

    const project = projection.documents.project;
    expect(project.path).toBe('docs/agentdev/PROJECT.md');
    expect(project.markdown).toContain(`| orders | [订单取消](features/${CANCEL_ID}/README.md) |`);
    expect(project.markdown).toContain(
      `| payment | [支付规则](features/${PAYMENT_ID}/README.md) |`,
    );
    expect(project.markdown).toContain('[功能索引](features/README.md)');
    expect(project.markdown).toContain('[代码地图](CODE_MAP.md)');
    expectDigest(project);

    expect(projection.documents.features).toHaveLength(2);
    for (const document of projection.documents.features) expectDigest(document);

    expect(projection.relations.missingTargets).toEqual([]);
    expect(projection.relations.edges).toContainEqual({
      fromFeatureId: CANCEL_ID,
      toFeatureId: PAYMENT_ID,
      kind: 'constrained_by',
      reason: CONSTRAINT_REASON,
      source: `features/${PAYMENT_ID}/README.md`,
    });

    expect(published(build([])).documents.featuresReadme.markdown).toContain('无已登记功能。');
  });

  it('renders a feature body that parses back to the same facts (AC-037)', () => {
    const projection = published(build([featureDocument()]));
    const document = projection.documents.features[0];
    expect(document?.path).toBe(`docs/agentdev/features/${CANCEL_ID}/README.md`);
    expect(document?.markdown).toContain('## 当前行为');
    expect(document?.markdown).toContain('约束：仅未付款订单可在 30 分钟内取消。');

    const reparsed = parseFeatureDocument(document?.markdown ?? '', {
      relativePath: `features/${CANCEL_ID}/README.md`,
      revision: REVISION,
      codeTreeRevision: REVISION,
      knownIds: KNOWN_IDS,
    });
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.feature.featureId).toBe(CANCEL_ID);
    expect(reparsed.feature.sections.currentBehaviour.text).toContain(
      '约束：仅未付款订单可在 30 分钟内取消。',
    );
    expect(reparsed.feature.sections.currentBehaviour.text).toContain(
      '异常输出：已付款订单返回拒绝。',
    );
    expect(reparsed.feature.relations).toHaveLength(1);
    expect(reparsed.feature.verificationCoverage).toEqual(['未付款可取消', '已付款拒绝']);
  });

  it('never injects an unrelated document into the feature body or index (AC-037)', () => {
    const projection = published(build([featureDocument({ sections: { 关系: '无' } })]));

    expect(projection.features.map((feature) => feature.featureId)).toEqual([CANCEL_ID]);
    expect(projection.index).toHaveLength(1);
    expect(projection.documents.features).toHaveLength(1);
    const rendered = projection.documents.features[0]?.markdown ?? '';
    expect(rendered).not.toContain(PAYMENT_ID);
    expect(rendered).not.toContain(PAYMENT_PURPOSE);
    expect(rendered).not.toContain(PAYMENT_BEHAVIOUR);

    const both = published(build([featureDocument(), paymentDocument()]));
    const cancelOnly = both.documents.features.find(
      (document) => document.path === `docs/agentdev/features/${CANCEL_ID}/README.md`,
    );
    expect(cancelOnly?.markdown).not.toContain(PAYMENT_BEHAVIOUR);
    expect(cancelOnly?.markdown).not.toContain(PAYMENT_PURPOSE);
  });

  it('keeps the last valid projection, marks it stale and reports KNOWLEDGE_INVALID (AC-040)', () => {
    const cache = createInMemoryProjectionCache();
    const first = published(build([featureDocument()], cache));
    expect(cache.lastValid()?.state).toBe('valid');
    expect(cache.get(REVISION, CANCEL_ID)?.state).toBe('valid');
    expect(cache.getRevision(REVISION)).toHaveLength(1);

    const result = rejected(build([featureDocument(), invalidDocument()], cache));
    expect(result.stale).toBe(true);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.code).toBe('KNOWLEDGE_INVALID');
      expect(diagnostic.documentPath).toBe('features/F-99999999/README.md');
    }

    const retained = result.projection;
    expect(retained).not.toBeNull();
    expect(retained?.state).toBe('stale');
    expect(retained?.staleSince).toBe(REVISION);
    expect(retained?.staleReason).toContain('非法');
    expect(retained?.documents.featuresReadme.contentHash).toBe(
      first.documents.featuresReadme.contentHash,
    );
    expect(cache.lastValid()?.state).toBe('stale');
    expect(cache.get(REVISION, CANCEL_ID)?.state).toBe('stale');
  });

  it('republishes and clears stale after a valid document follows an invalid one (AC-040)', () => {
    const cache = createInMemoryProjectionCache();
    published(build([featureDocument()], cache));
    rejected(build([invalidDocument()], cache));
    expect(cache.lastValid()?.state).toBe('stale');

    const republished = published(build([featureDocument()], cache));
    expect(republished.state).toBe('valid');
    expect(republished.staleSince).toBeUndefined();
    expect(cache.lastValid()?.state).toBe('valid');
    expect(cache.get(REVISION, CANCEL_ID)?.state).toBe('valid');
  });

  it('refuses duplicate feature ids without merging the documents (required failure test)', () => {
    const cache = createInMemoryProjectionCache();
    published(build([featureDocument()], cache));

    const result = rejected(
      build(
        [featureDocument(), featureDocument({ sections: { 用途: '第二个同名文档。' } })],
        cache,
      ),
    );
    expect(result.diagnostics.some((error) => error.message.includes('duplicate feature id'))).toBe(
      true,
    );
    expect(result.projection?.state).toBe('stale');
  });

  it('returns no retained projection when nothing was ever published', () => {
    const cache = createInMemoryProjectionCache();
    const result = rejected(build([invalidDocument()], cache));
    expect(result.stale).toBe(true);
    expect(result.projection).toBeNull();
    expect(cache.lastValid()).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe('KNOWLEDGE_INVALID');
  });

  it('keys cache rows by revision and featureId', () => {
    const cache = createInMemoryProjectionCache();
    published(build([featureDocument()], cache));

    const otherRevision = OTHER_REVISION;
    const other = published(
      buildProjection({
        documents: [
          featureDocument({
            fields: {
              revision: otherRevision,
              source_refs: `git:${otherRevision}:src/orders/cancel.ts`,
            },
          }),
        ],
        revision: otherRevision,
        codeTreeRevision: otherRevision,
        knownIds: KNOWN_IDS,
        cache,
      }),
    );

    expect(other.revision).toBe(otherRevision);
    expect(cache.getRevision(REVISION).map((row) => row.revision)).toEqual([REVISION]);
    expect(cache.getRevision(otherRevision).map((row) => row.revision)).toEqual([otherRevision]);
    expect(cache.get(REVISION, CANCEL_ID)?.documentPath).toBe(`features/${CANCEL_ID}/README.md`);
    expect(cache.get(REVISION, CANCEL_ID)?.documentHash).toBe(
      contentHash(featureDocument().markdown),
    );
    expect(cache.get(REVISION, 'F-00000000')).toBeUndefined();
    expect(cache.lastValid()?.revision).toBe(otherRevision);
  });

  it('gives each rendered document a content hash that detects drift', () => {
    const baseline = published(build([featureDocument()]));
    const same = published(build([featureDocument()]));
    expect(same.documents.featuresReadme.contentHash).toBe(
      baseline.documents.featuresReadme.contentHash,
    );

    const changedPurpose = published(
      build([featureDocument({ sections: { 用途: '允许用户取消任意订单。' } })]),
    );
    expect(changedPurpose.documents.featuresReadme.contentHash).not.toBe(
      baseline.documents.featuresReadme.contentHash,
    );
    expect(changedPurpose.documents.project.contentHash).toBe(
      baseline.documents.project.contentHash,
    );

    const changedEntry = published(
      build([featureDocument({ sections: { 实现入口: '- src/orders/cancel_v2.ts' } })]),
    );
    expect(changedEntry.documents.codeMap.contentHash).not.toBe(
      baseline.documents.codeMap.contentHash,
    );
    expect(changedEntry.documents.featuresReadme.contentHash).toBe(
      baseline.documents.featuresReadme.contentHash,
    );
  });

  it('records unresolved relation targets as placeholders instead of inventing features', () => {
    const projection = published(
      build([
        featureDocument({
          sections: {
            关系: [
              '| target_feature_id | kind | reason | source |',
              '|---|---|---|---|',
              `| ${PAYMENT_ID} | depends_on | 取消依赖支付状态 | features/${PAYMENT_ID}/README.md |`,
            ].join('\n'),
          },
        }),
      ]),
    );

    expect(projection.features.map((feature) => feature.featureId)).toEqual([CANCEL_ID]);
    expect(projection.relations.missingTargets).toEqual([PAYMENT_ID]);
    expect(projection.relations.nodes).toContainEqual({
      featureId: PAYMENT_ID,
      name: '未调查',
      module: '未调查',
      resolved: false,
    });
    expect(projection.documents.features).toHaveLength(1);
  });
});

describe('broken-link diagnostics in a projection (AC-040)', () => {
  it('gates delivery for the current requirement only when the requirement touches the feature', () => {
    const documents = [featureDocument(), paymentDocument()];
    // The resolver knows the revision and the decision, but not the recorded source path,
    // and knows nothing about the payment feature's path either.
    const sources = {
      trees: new Map([[REVISION, ['src/orders/other.ts']]]),
      currentPaths: ['src/orders/other.ts'],
      decisionIds: [DECISION_ID],
    };
    const blocked = buildProjection({
      documents,
      revision: REVISION,
      codeTreeRevision: REVISION,
      knownIds: KNOWN_IDS,
      linkDiagnostics: { sources, currentRequirementFeatureIds: [CANCEL_ID] },
    });
    expect(blocked.published).toBe(true);
    const projection = published(blocked);
    expect(projection.links.diagnostics.length).toBeGreaterThan(0);
    expect(projection.links.blockedFeatureIds).toContain(CANCEL_ID);
    expect(deliveryBlockedByLinks(projection)).toBe(true);

    // The same broken links stay diagnostics when no requirement is in scope.
    const unblocked = buildProjection({
      documents,
      revision: REVISION,
      codeTreeRevision: REVISION,
      knownIds: KNOWN_IDS,
      linkDiagnostics: { sources },
    });
    const readable = published(unblocked);
    expect(readable.links.diagnostics.length).toBeGreaterThan(0);
    expect(readable.links.blockedFeatureIds).toEqual([]);
    expect(deliveryBlockedByLinks(readable)).toBe(false);
  });
});

describe('one-line summaries (W4R1-02 regression)', () => {
  it('does not truncate at a dot inside a version or an extension', () => {
    expect(firstSentence('支持 v1.2 语义与 .ts 扩展名。后续由 WP-05 消费。')).toBe(
      '支持 v1.2 语义与 .ts 扩展名',
    );
    expect(firstSentence('First sentence. Second sentence.')).toBe('First sentence');
    expect(firstSentence('只有一个句子没有终止符')).toBe('只有一个句子没有终止符');
  });
});
