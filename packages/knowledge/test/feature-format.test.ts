import { describe, expect, it } from 'vitest';
import type { ErrorCode } from '@agentdev/contracts';
import {
  FEATURE_SECTION_HEADINGS,
  isEmptyValue,
  parseFeatureDocument,
  parseFeatureSet,
  readMultiValue,
  type FeatureDocumentError,
  type FeatureParseResult,
  type FeatureSetResult,
} from '../src/index.js';

const REVISION = '9f2c1a4b8d3e5f60718293a4b5c6d7e8f9012345';
const OTHER_REVISION = '0123456789abcdef0123456789abcdef01234567';
const FEATURE_ID = 'F-1a2b3c4d';
const OTHER_FEATURE_ID = 'F-5e6f7a8b';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f';
const REQUIREMENT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e61';
const ARTIFACT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';
const OWNER_PATH = `features/${FEATURE_ID}/README.md`;

type ValueOverrides = Readonly<Record<string, string | null>>;

interface DocumentOptions {
  readonly fields?: ValueOverrides;
  readonly extraFieldRows?: readonly string[];
  readonly sections?: Readonly<Record<string, string | null>>;
  readonly omitFieldTable?: boolean;
  readonly ownerPath?: string;
  readonly append?: readonly string[];
}

const DEFAULT_SECTIONS: Readonly<Record<string, string>> = {
  用途: '允许用户取消未付款订单。',
  当前行为: '已付款订单返回已确认的拒绝结果。',
  关系: [
    '| target_feature_id | kind | reason | source |',
    '|---|---|---|---|',
    `| ${OTHER_FEATURE_ID} | constrained_by | 付款状态决定可取消范围 | product/payment.md |`,
  ].join('\n'),
  实现入口: ['- src/orders/cancel.ts', '- tests/orders/cancel.test.ts'].join('\n'),
  已知差距: '无已登记差距。',
  关键决定: `- decision:${DECISION_ID}：已付款取消使用退款流程。`,
};

function buildDocument(options: DocumentOptions = {}): string {
  const ownerPath = options.ownerPath ?? OWNER_PATH;
  const fields: Record<string, string | null> = {
    feature_id: FEATURE_ID,
    name: '订单取消',
    module: 'orders',
    owner_document: ownerPath,
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
  const lines = ['# 订单取消', ''];
  if (options.omitFieldTable !== true) {
    lines.push('| 字段 | 值 |', '|---|---|');
    for (const [key, value] of Object.entries(fields)) {
      if (value === null) continue;
      lines.push(`| ${key} | ${value} |`);
    }
    for (const row of options.extraFieldRows ?? []) lines.push(row);
  }
  lines.push('');
  const sections: Record<string, string | null> = { ...DEFAULT_SECTIONS, ...options.sections };
  for (const heading of FEATURE_SECTION_HEADINGS) {
    const body = sections[heading];
    if (body === null || body === undefined) continue;
    lines.push(`## ${heading}`, body, '');
  }
  for (const line of options.append ?? []) lines.push(line);
  return lines.join('\n');
}

interface ParseOverrides {
  readonly relativePath?: string;
  /** `null` omits the code tree revision, i.e. the equality rule cannot be checked. */
  readonly codeTreeRevision?: string | null;
  readonly knownIds?: readonly string[];
}

function parseDocument(markdown: string, overrides: ParseOverrides = {}): FeatureParseResult {
  const codeTreeRevision =
    overrides.codeTreeRevision === undefined ? REVISION : overrides.codeTreeRevision;
  return parseFeatureDocument(markdown, {
    relativePath: overrides.relativePath ?? OWNER_PATH,
    revision: REVISION,
    knownIds: overrides.knownIds ?? [DECISION_ID, REQUIREMENT_ID],
    ...(codeTreeRevision === null ? {} : { codeTreeRevision }),
  });
}

function parseSet(
  markdowns: readonly { relativePath: string; markdown: string }[],
): FeatureSetResult {
  return parseFeatureSet(markdowns, {
    revision: REVISION,
    codeTreeRevision: REVISION,
    knownIds: [DECISION_ID, REQUIREMENT_ID],
  });
}

function errorsOf(result: FeatureParseResult): readonly FeatureDocumentError[] {
  expect(result.ok, 'expected the document to be rejected').toBe(false);
  return result.ok ? [] : result.errors;
}

function expectError(
  result: FeatureParseResult,
  field: string,
  code: ErrorCode = 'KNOWLEDGE_INVALID',
): void {
  const errors = errorsOf(result);
  const match = errors.find((error) => error.field === field);
  expect(match, `expected an error on field ${field}, got ${JSON.stringify(errors)}`).toBeDefined();
  expect(match?.code).toBe(code);
}

describe('readMultiValue / isEmptyValue', () => {
  it('treats the literal 无/未调查 as an empty value', () => {
    expect(readMultiValue('无')).toEqual([]);
    expect(readMultiValue('未调查')).toEqual([]);
    expect(readMultiValue('无。')).toEqual([]);
    expect(isEmptyValue('未调查。')).toBe(true);
    expect(isEmptyValue('无已登记差距。')).toBe(false);
  });

  it('splits both semicolon widths and trims', () => {
    expect(readMultiValue('a; b；c')).toEqual(['a', 'b', 'c']);
    expect(readMultiValue('git:x:y;')).toEqual(['git:x:y']);
  });
});

describe('parseFeatureDocument', () => {
  it('parses a complete document with real-valued fields', () => {
    const result = parseDocument(buildDocument());
    if (!result.ok) throw new Error(`unexpected errors: ${JSON.stringify(result.errors)}`);
    const feature = result.feature;

    expect(feature.title).toBe('订单取消');
    expect(feature.name).toBe('订单取消');
    expect(feature.featureId).toBe(FEATURE_ID);
    expect(feature.module).toBe('orders');
    expect(feature.ownerDocument).toBe(OWNER_PATH);
    expect(feature.documentPath).toBe(OWNER_PATH);
    expect(feature.documentRevision).toBe(REVISION);
    expect(feature.design).toBe('confirmed');
    expect(feature.designDecisionRefs).toEqual([`decision:${DECISION_ID}`]);
    expect(feature.implementation).toBe('implemented');
    expect(feature.verification).toBe('passed');
    expect(feature.verificationEvidenceRefs).toEqual([`artifact:${ARTIFACT_ID}@1`]);
    expect(feature.verificationCoverage).toEqual(['未付款可取消', '已付款拒绝']);
    expect(feature.investigation).toBe('investigated');
    expect(feature.investigationScope).toEqual(['订单取消路由、状态转换和测试']);
    expect(feature.sourceRefs).toEqual([`git:${REVISION}:src/orders/cancel.ts`]);
    expect(feature.revision).toBe(REVISION);
    expect(feature.relations).toEqual([
      {
        targetFeatureId: OTHER_FEATURE_ID,
        kind: 'constrained_by',
        reason: '付款状态决定可取消范围',
        source: 'product/payment.md',
      },
    ]);
    expect(feature.sections.purpose.text).toBe('允许用户取消未付款订单。');
    expect(feature.sections.currentBehaviour.text).toBe('已付款订单返回已确认的拒绝结果。');
    expect(feature.sections.entries.items).toEqual([
      'src/orders/cancel.ts',
      'tests/orders/cancel.test.ts',
    ]);
    expect(feature.sections.gaps.text).toBe('无已登记差距。');
    expect(feature.sections.decisions.items).toEqual([
      `decision:${DECISION_ID}：已付款取消使用退款流程。`,
    ]);
  });

  it('accepts the literal 无/未调查 for empty relations, entries and optional refs', () => {
    const result = parseDocument(
      buildDocument({
        fields: {
          design: 'unconfirmed',
          design_decision_refs: '无',
          implementation: 'absent',
          verification: 'unverified',
          verification_evidence_refs: '无',
          verification_coverage: '未调查',
          investigation: 'unexplored',
          investigation_scope: '未调查',
          source_refs: '无',
        },
        sections: { 关系: '无', 实现入口: '未调查' },
      }),
    );
    if (!result.ok) throw new Error(`unexpected errors: ${JSON.stringify(result.errors)}`);
    expect(result.feature.relations).toEqual([]);
    expect(result.feature.designDecisionRefs).toEqual([]);
    expect(result.feature.verificationEvidenceRefs).toEqual([]);
    expect(result.feature.verificationCoverage).toEqual([]);
    expect(result.feature.investigationScope).toEqual([]);
    expect(result.feature.sourceRefs).toEqual([]);
    expect(result.feature.sections.entries.items).toEqual([]);
    expect(result.feature.sections.entries.text).toBe('未调查');
  });

  it('accepts a requirement confirmedDecisions reference for design=confirmed', () => {
    const result = parseDocument(
      buildDocument({ fields: { design_decision_refs: `requirement:${REQUIREMENT_ID}` } }),
    );
    if (!result.ok) throw new Error(`unexpected errors: ${JSON.stringify(result.errors)}`);
    expect(result.feature.designDecisionRefs).toEqual([`requirement:${REQUIREMENT_ID}`]);
  });

  it('skips the revision equality rule when no code tree revision is supplied', () => {
    const result = parseDocument(buildDocument(), { codeTreeRevision: null });
    if (!result.ok) throw new Error(`unexpected errors: ${JSON.stringify(result.errors)}`);
    expect(result.feature.revision).toBe(REVISION);
  });

  it('splits multi-value refs written with either semicolon', () => {
    const result = parseDocument(
      buildDocument({
        fields: {
          verification_evidence_refs: `artifact:${ARTIFACT_ID}@1; artifact:${ARTIFACT_ID}@2`,
        },
      }),
    );
    if (!result.ok) throw new Error(`unexpected errors: ${JSON.stringify(result.errors)}`);
    expect(result.feature.verificationEvidenceRefs).toEqual([
      `artifact:${ARTIFACT_ID}@1`,
      `artifact:${ARTIFACT_ID}@2`,
    ]);
  });

  it('rejects a missing required heading', () => {
    expectError(parseDocument(buildDocument({ sections: { 已知差距: null } })), '已知差距');
  });

  it('does not let a level-1 heading satisfy a required section (W4R1-06)', () => {
    // The document title is a level-1 heading; only `## 用途` counts.
    expectError(
      parseDocument(
        buildDocument({ sections: { 用途: null }, append: ['# 用途', '标题不是小节。', ''] }),
      ),
      '用途',
    );
  });

  it('rejects a duplicate required heading', () => {
    expectError(
      parseDocument(buildDocument({ append: ['## 已知差距', '重复标题。', ''] })),
      '已知差距',
    );
  });

  it.each(['design', 'implementation', 'verification', 'investigation'])(
    'rejects an unknown %s enum value',
    (field) => {
      expectError(parseDocument(buildDocument({ fields: { [field]: 'maybe' } })), field);
    },
  );

  it('rejects a missing required field', () => {
    expectError(parseDocument(buildDocument({ fields: { module: null } })), 'module');
  });

  it('rejects a duplicate field', () => {
    expectError(
      parseDocument(buildDocument({ extraFieldRows: ['| name | 另一个名字 |'] })),
      'name',
    );
  });

  it('rejects an unknown field key', () => {
    expectError(parseDocument(buildDocument({ extraFieldRows: ['| owner | orders |'] })), 'owner');
  });

  it('rejects a field row that is not key/value', () => {
    expectError(
      parseDocument(buildDocument({ extraFieldRows: ['| module | orders | extra |'] })),
      'module',
    );
  });

  it('rejects an empty field value that does not use the literal marker', () => {
    expectError(parseDocument(buildDocument({ fields: { module: '   ' } })), 'module');
  });

  it('rejects a document whose owner_document is another path', () => {
    expectError(
      parseDocument(
        buildDocument({ fields: { owner_document: `features/${OTHER_FEATURE_ID}/README.md` } }),
      ),
      'ownerDocument',
    );
  });

  it('rejects a feature_id that is not F- plus 8 hex digits', () => {
    expectError(parseDocument(buildDocument({ fields: { feature_id: 'F-123' } })), 'featureId');
  });

  it('rejects the template example feature id in a formal document', () => {
    expectError(
      parseDocument(buildDocument({ fields: { feature_id: 'F-a1b2c3d4' } })),
      'featureId',
    );
  });

  it('rejects an angle-bracket placeholder value', () => {
    expectError(
      parseDocument(buildDocument({ fields: { revision: '<真实Git SHA>' } })),
      'revision',
    );
  });

  it('rejects design=confirmed without one resolvable decision reference', () => {
    expectError(
      parseDocument(
        buildDocument({
          fields: { design_decision_refs: 'decision:018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4eff' },
        }),
      ),
      'designDecisionRefs',
    );
  });

  it('rejects a placeholder decision reference', () => {
    expectError(
      parseDocument(buildDocument({ fields: { design_decision_refs: 'decision:<真实ID>' } })),
      'designDecisionRefs',
    );
  });

  it('rejects verification=passed without evidence references', () => {
    expectError(
      parseDocument(buildDocument({ fields: { verification_evidence_refs: '无' } })),
      'verificationEvidenceRefs',
    );
  });

  it('rejects verification=passed without coverage', () => {
    expectError(
      parseDocument(buildDocument({ fields: { verification_coverage: '未调查' } })),
      'verificationCoverage',
    );
  });

  it('rejects verification=passed recorded against another code tree', () => {
    expectError(parseDocument(buildDocument(), { codeTreeRevision: OTHER_REVISION }), 'revision');
  });

  it('rejects investigation=investigated without a scope', () => {
    expectError(
      parseDocument(buildDocument({ fields: { investigation_scope: '无' } })),
      'investigationScope',
    );
  });

  it('rejects investigation=investigated without sources', () => {
    expectError(parseDocument(buildDocument({ fields: { source_refs: '未调查' } })), 'sourceRefs');
  });

  it('rejects an empty relation table', () => {
    const table = ['| target_feature_id | kind | reason | source |', '|---|---|---|---|'].join(
      '\n',
    );
    expectError(parseDocument(buildDocument({ sections: { 关系: table } })), 'relations');
  });

  it('rejects a relation table with the wrong header', () => {
    const table = [
      '| target | kind | reason | source |',
      '|---|---|---|---|',
      `| ${OTHER_FEATURE_ID} | affects | 影响 | src/orders/cancel.ts |`,
    ].join('\n');
    expectError(parseDocument(buildDocument({ sections: { 关系: table } })), 'relations');
  });

  it('rejects an unknown relation kind', () => {
    const table = [
      '| target_feature_id | kind | reason | source |',
      '|---|---|---|---|',
      `| ${OTHER_FEATURE_ID} | replaces | 替换 | src/orders/cancel.ts |`,
    ].join('\n');
    expectError(parseDocument(buildDocument({ sections: { 关系: table } })), 'relations.kind');
  });

  it('rejects a relation row with a missing cell', () => {
    const table = [
      '| target_feature_id | kind | reason | source |',
      '|---|---|---|---|',
      `| ${OTHER_FEATURE_ID} | affects | 影响 |`,
    ].join('\n');
    expectError(parseDocument(buildDocument({ sections: { 关系: table } })), 'relations');
  });

  it('rejects a relation row with an empty cell', () => {
    const table = [
      '| target_feature_id | kind | reason | source |',
      '|---|---|---|---|',
      `| ${OTHER_FEATURE_ID} | affects |  | src/orders/cancel.ts |`,
    ].join('\n');
    expectError(parseDocument(buildDocument({ sections: { 关系: table } })), 'relations');
  });

  it('rejects a placeholder relation target', () => {
    const table = [
      '| target_feature_id | kind | reason | source |',
      '|---|---|---|---|',
      '| F-a1b2c3d4 | affects | 影响 | src/orders/cancel.ts |',
    ].join('\n');
    expectError(parseDocument(buildDocument({ sections: { 关系: table } })), 'relations');
  });

  it('rejects an empty 实现入口 section', () => {
    expectError(parseDocument(buildDocument({ sections: { 实现入口: '   ' } })), '实现入口');
  });

  it('rejects a missing field table', () => {
    expectError(parseDocument(buildDocument({ omitFieldTable: true })), 'fields');
  });

  it('does not trust an HTML heading as a required section', () => {
    expectError(
      parseDocument(buildDocument({ sections: { 用途: null }, append: ['<h2>用途</h2>', ''] })),
      '用途',
    );
  });

  it('does not trust a heading inside a fenced code block', () => {
    expectError(
      parseDocument(
        buildDocument({
          sections: { 已知差距: null },
          append: ['```markdown', '## 已知差距', '```', ''],
        }),
      ),
      '已知差距',
    );
  });

  it('does not trust a field table hidden in an HTML comment', () => {
    const result = parseDocument(
      buildDocument({
        omitFieldTable: true,
        append: ['<!--', '| 字段 | 值 |', '|---|---|', `| feature_id | ${FEATURE_ID} |`, '-->', ''],
      }),
    );
    expectError(result, 'fields');
  });
});

describe('parseFeatureSet', () => {
  it('parses a set of unique documents at one revision', () => {
    const otherPath = `features/${OTHER_FEATURE_ID}/README.md`;
    const result = parseSet([
      { relativePath: OWNER_PATH, markdown: buildDocument() },
      {
        relativePath: otherPath,
        markdown: buildDocument({
          ownerPath: otherPath,
          fields: { feature_id: OTHER_FEATURE_ID, design_decision_refs: `decision:${DECISION_ID}` },
        }),
      },
    ]);
    if (!result.ok) throw new Error(`unexpected errors: ${JSON.stringify(result.errors)}`);
    expect(result.errors).toEqual([]);
    expect(result.features.map((feature) => feature.featureId)).toEqual([
      FEATURE_ID,
      OTHER_FEATURE_ID,
    ]);
  });

  it('reports a duplicate feature id instead of merging the documents', () => {
    const duplicatePath = `features/${FEATURE_ID}/duplicate.md`;
    const otherPath = `features/${OTHER_FEATURE_ID}/README.md`;
    const result = parseSet([
      { relativePath: OWNER_PATH, markdown: buildDocument() },
      {
        relativePath: duplicatePath,
        markdown: buildDocument({ ownerPath: duplicatePath, append: [''] }),
      },
      {
        relativePath: otherPath,
        markdown: buildDocument({ ownerPath: otherPath, fields: { feature_id: OTHER_FEATURE_ID } }),
      },
    ]);

    expect(result.ok).toBe(false);
    const duplicates = result.errors.filter((error) => error.field === 'featureId');
    expect(duplicates.map((error) => error.documentPath)).toEqual([OWNER_PATH, duplicatePath]);
    for (const error of duplicates) expect(error.code).toBe('KNOWLEDGE_INVALID');
    expect(duplicates[0]?.message).toContain(FEATURE_ID);
    // Only the unique document remains available: duplicates are never merged.
    expect(result.features.map((feature) => feature.featureId)).toEqual([OTHER_FEATURE_ID]);
  });

  it('keeps valid documents available when another document is invalid', () => {
    const brokenPath = `features/${OTHER_FEATURE_ID}/README.md`;
    const result = parseSet([
      { relativePath: OWNER_PATH, markdown: buildDocument() },
      {
        relativePath: brokenPath,
        markdown: buildDocument({
          ownerPath: brokenPath,
          fields: { feature_id: OTHER_FEATURE_ID, design: 'maybe' },
        }),
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.documentPath).toBe(brokenPath);
    expect(result.errors[0]?.field).toBe('design');
    expect(result.errors[0]?.code).toBe('KNOWLEDGE_INVALID');
    expect(result.features.map((feature) => feature.featureId)).toEqual([FEATURE_ID]);
  });
});
