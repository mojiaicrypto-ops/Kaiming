/**
 * Feature Markdown parser and validator (`docs/architecture/context.md` §2).
 *
 * Structure is read only from Markdown headings and pipe tables; inline HTML is
 * never executed or trusted as structure (`不执行内联HTML`). Nothing is inferred
 * from prose: a field value exists only in the field table, a relation only in
 * the four-column relation table.
 *
 * Every violation is a `KNOWLEDGE_INVALID` error so the caller can refuse to
 * publish a projection and keep the last valid one marked `stale`
 * (`非法格式拒绝发布，保留最后有效并标stale`). Both entry points return explicit
 * result objects and never throw for malformed input.
 *
 * Field table: `| 字段 | 值 |` with the fourteen keys of `FEATURE_FIELDS`.
 * Sections: 用途 / 当前行为 / 关系 / 实现入口 / 已知差距 / 关键决定.
 * Relation table: `target_feature_id | kind | reason | source`.
 */
import {
  FEATURE_ENTRIES_HEADING,
  FEATURE_FIELDS,
  FEATURE_FIELD_KEYS,
  FEATURE_RELATION_HEADING,
  FEATURE_SECTION_HEADINGS,
  RELATION_COLUMNS,
  featureFieldModelName,
  isDesignState,
  isImplementationState,
  isInvestigationState,
  isRelationKind,
  isEmptyValue,
  isVerificationState,
  knowledgeError,
  readMultiValue,
  type DesignState,
  type Feature,
  type FeatureDocumentError,
  type FeatureRelation,
  type FeatureSectionBody,
  type FeatureSections,
  type ImplementationState,
  type InvestigationState,
  type VerificationState,
} from './model.js';

/** One document of a set read at the same revision. */
export interface FeatureDocumentInput {
  /** Repo-relative document path; must equal `owner_document`. */
  readonly relativePath: string;
  readonly markdown: string;
}

/** Options for a single-document parse. */
export interface ParseFeatureOptions {
  /** Repo-relative document path; `owner_document` must equal it. */
  readonly relativePath: string;
  /**
   * Revision the documents are read at. Stamped onto the parse result as
   * `documentRevision` so a caller can key `feature_projection(revision, featureId)`.
   */
  readonly revision: string;
  /**
   * Code tree the recorded `revision` field is compared against when
   * `verification=passed`. Callers that publish formally must supply it; when it
   * is omitted the equality rule cannot be checked and is skipped.
   */
  readonly codeTreeRevision?: string;
  /**
   * Ids the current context can resolve for `design_decision_refs`: Decision ids
   * of the current Project plus requirement ids whose Git record carries
   * confirmed decisions (`confirmedDecisions`). Formal publication must supply
   * the ids of the current scope so `design=confirmed` cannot be claimed without
   * a real confirmation.
   */
  readonly knownIds?: readonly string[];
}

/** A validated document plus its read context. */
export interface ParsedFeature extends Feature {
  /** First heading of the document (the human-readable name). */
  readonly title: string;
  /** Repo-relative document path the Markdown was read from. */
  readonly documentPath: string;
  /** Revision the document was read at (`feature_projection.revision`). */
  readonly documentRevision: string;
}

export interface FeatureParseSuccess {
  readonly ok: true;
  readonly feature: ParsedFeature;
  readonly errors: readonly [];
}

export interface FeatureParseFailure {
  readonly ok: false;
  readonly feature: null;
  readonly errors: readonly FeatureDocumentError[];
}

/** Result of parsing and validating one Feature document. */
export type FeatureParseResult = FeatureParseSuccess | FeatureParseFailure;

/** Set-level error: the per-document error plus the document it came from. */
export interface FeatureSetError extends FeatureDocumentError {
  readonly documentPath: string;
}

export interface ParseFeatureSetOptions {
  readonly revision: string;
  readonly codeTreeRevision?: string;
  readonly knownIds?: readonly string[];
}

export interface FeatureSetSuccess {
  readonly ok: true;
  /** Valid documents with a unique feature id. */
  readonly features: readonly ParsedFeature[];
  readonly errors: readonly [];
}

export interface FeatureSetFailure {
  readonly ok: false;
  /**
   * Valid, uniquely identified documents. A duplicate or invalid document is
   * never merged or dropped silently: it is excluded here and reported in
   * `errors` so the caller can keep the last valid projection.
   */
  readonly features: readonly ParsedFeature[];
  readonly errors: readonly FeatureSetError[];
}

/** Result of parsing a whole document set at one revision. */
export type FeatureSetResult = FeatureSetSuccess | FeatureSetFailure;

const FIELD_TABLE_HEADER: readonly string[] = ['字段', '值'];
const TEMPLATE_FEATURE_IDS: readonly string[] = ['F-a1b2c3d4', 'F-e5f6a7b8'];
const FEATURE_ID_PATTERN = /^F-[0-9a-f]{8}$/u;

interface Heading {
  readonly level: number;
  readonly text: string;
  readonly line: number;
}

interface Table {
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly line: number;
}

interface ScanResult {
  readonly lines: readonly string[];
  readonly headings: readonly Heading[];
  readonly tables: readonly Table[];
}

/** Removes inline HTML from text used for structure matching. */
function stripHtml(text: string): string {
  return text.replace(/<[^<>]*>/gu, '');
}

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/u, '').replace(/\|$/u, '');
  return inner.split(/(?<!\\)\|/u).map((cell) => cell.replace(/\\\|/gu, '|').trim());
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/u.test(cell));
}

/**
 * Scans Markdown structure. Fenced code blocks, HTML comments and raw HTML
 * blocks are skipped, so a heading or table written inside them is not trusted.
 */
function scanMarkdown(markdown: string): ScanResult {
  const lines = markdown.split(/\r?\n/u);
  const headings: Heading[] = [];
  const tables: Table[] = [];
  let fence: string | undefined;
  let inComment = false;
  let inHtmlBlock = false;
  let index = 0;
  while (index < lines.length) {
    const line = (lines[index] ?? '').trim();
    if (fence !== undefined) {
      if (line.startsWith(fence)) fence = undefined;
      index += 1;
      continue;
    }
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      index += 1;
      continue;
    }
    if (inHtmlBlock) {
      if (line === '') inHtmlBlock = false;
      index += 1;
      continue;
    }
    if (line.startsWith('```') || line.startsWith('~~~')) {
      fence = line.slice(0, 3);
      index += 1;
      continue;
    }
    const commentAt = line.indexOf('<!--');
    if (commentAt !== -1) {
      if (!line.includes('-->', commentAt + 4)) inComment = true;
      index += 1;
      continue;
    }
    if (/^<\/?[a-zA-Z!]/u.test(line)) {
      inHtmlBlock = true;
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/u.exec(line);
    if (heading !== null) {
      const text = stripHtml(heading[2] ?? '')
        .replace(/\s+#+\s*$/u, '')
        .trim();
      headings.push({ level: (heading[1] ?? '#').length, text, line: index });
      index += 1;
      continue;
    }
    if (line.startsWith('|')) {
      const start = index;
      const block: string[] = [];
      while (index < lines.length && (lines[index] ?? '').trim().startsWith('|')) {
        block.push((lines[index] ?? '').trim());
        index += 1;
      }
      const header = splitRow(block[0] ?? '');
      const separator = splitRow(block[1] ?? '');
      if (block.length >= 2 && header.length > 0 && isSeparatorRow(separator)) {
        tables.push({ header, rows: block.slice(2).map(splitRow), line: start });
      }
      continue;
    }
    index += 1;
  }
  return { lines, headings, tables };
}

function sameRow(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((cell, index) => cell === right[index]);
}

/** Lines after `heading` up to the next heading of any level. */
function sectionLines(scan: ScanResult, heading: Heading): readonly string[] {
  const position = scan.headings.indexOf(heading);
  const next = position >= 0 ? scan.headings[position + 1] : undefined;
  const end = next === undefined ? scan.lines.length : next.line;
  return scan.lines.slice(heading.line + 1, end);
}

function buildSection(heading: string, bodyLines: readonly string[]): FeatureSectionBody {
  const items: string[] = [];
  const text: string[] = [];
  let fence: string | undefined;
  for (const raw of bodyLines) {
    const line = raw.trim();
    if (fence !== undefined) {
      if (line.startsWith(fence)) fence = undefined;
      continue;
    }
    if (line.startsWith('```') || line.startsWith('~~~')) {
      fence = line.slice(0, 3);
      continue;
    }
    if (line === '' || line.startsWith('|') || line.startsWith('<!--')) continue;
    const bullet = /^(?:[-*+]|\d+\.)\s+(.*)$/u.exec(line);
    if (bullet !== null) {
      const item = stripHtml(bullet[1] ?? '').trim();
      if (item !== '') items.push(item);
      continue;
    }
    text.push(stripHtml(line).trim());
  }
  return { heading, text: text.join('\n').trim(), items };
}

/**
 * Finds a placeholder or HTML token in a structured value. `示例占位只能用于模板，
 * 写入正式Feature时必须是真实值` (context.md §2), so angle-bracket tokens and the
 * template example ids are invalid in a formal document.
 */
export function findPlaceholder(value: string): string | undefined {
  const angled = /<[^<>]*>/u.exec(value);
  if (angled !== null) return angled[0];
  if (value.includes('<') || value.includes('>')) return value.includes('<') ? '<' : '>';
  for (const id of TEMPLATE_FEATURE_IDS) {
    if (value.includes(id)) return id;
  }
  return undefined;
}

/** Resolves a `design_decision_refs` entry against the ids of the current context. */
function designRefResolves(ref: string, knownIds: readonly string[]): boolean {
  const decision = /^decision:(.+)$/u.exec(ref);
  if (decision !== null) return knownIds.includes((decision[1] ?? '').trim());
  // A Git requirement record with confirmedDecisions; the record version is optional.
  const requirement = /^requirement:([^@#\s]+)(?:[@#].*)?$/u.exec(ref);
  if (requirement !== null) return knownIds.includes((requirement[1] ?? '').trim());
  return false;
}

function parseRelations(
  scan: ScanResult,
  heading: Heading,
  errors: FeatureDocumentError[],
): readonly FeatureRelation[] {
  const bodyLines = sectionLines(scan, heading);
  const end = heading.line + 1 + bodyLines.length;
  const table = scan.tables.find(
    (candidate) => candidate.line > heading.line && candidate.line < end,
  );
  if (table === undefined) {
    const body = buildSection(FEATURE_RELATION_HEADING, bodyLines);
    if (!isEmptyValue(body.text)) {
      errors.push(
        knowledgeError(
          FEATURE_RELATION_HEADING,
          '关系 must contain a four-column table, or the literal 无/未调查 when there is none',
        ),
      );
    }
    return [];
  }
  if (!sameRow(table.header, RELATION_COLUMNS)) {
    errors.push(
      knowledgeError(
        'relations',
        `relation table header must be ${RELATION_COLUMNS.join(' | ')}, got ${table.header.join(' | ')}`,
      ),
    );
    return [];
  }
  if (table.rows.length === 0) {
    errors.push(
      knowledgeError(
        'relations',
        'empty relation table; write 无 or 未调查 instead of an empty table',
      ),
    );
    return [];
  }
  const relations: FeatureRelation[] = [];
  for (const [rowIndex, cells] of table.rows.entries()) {
    const position = rowIndex + 1;
    if (cells.length !== RELATION_COLUMNS.length) {
      errors.push(knowledgeError('relations', `relation row ${position} must have four cells`));
      continue;
    }
    const targetFeatureId = cells[0] ?? '';
    const kind = cells[1] ?? '';
    const reason = cells[2] ?? '';
    const source = cells[3] ?? '';
    if (targetFeatureId === '' || kind === '' || reason === '' || source === '') {
      errors.push(knowledgeError('relations', `relation row ${position} must fill all four cells`));
      continue;
    }
    if (!isRelationKind(kind)) {
      errors.push(knowledgeError('relations.kind', `unknown relation kind: ${kind}`));
      continue;
    }
    const placeholder =
      findPlaceholder(targetFeatureId) ?? findPlaceholder(source) ?? findPlaceholder(reason);
    if (placeholder !== undefined) {
      errors.push(
        knowledgeError(
          'relations',
          `placeholder value in relation row ${position}: ${placeholder}`,
        ),
      );
      continue;
    }
    relations.push({ targetFeatureId, kind, reason, source });
  }
  return relations;
}

function emptySection(heading: string): FeatureSectionBody {
  return { heading, text: '', items: [] };
}

/**
 * Parses and validates one Feature document.
 *
 * Returns `{ok:true, feature}` only when every rule holds; otherwise
 * `{ok:false, feature:null, errors}` with one entry per violation (code
 * `KNOWLEDGE_INVALID`, `field` naming the offending field or heading).
 */
export function parseFeatureDocument(
  markdown: string,
  options: ParseFeatureOptions,
): FeatureParseResult {
  const errors: FeatureDocumentError[] = [];
  const scan = scanMarkdown(markdown);
  const title = scan.headings[0]?.text ?? '';
  if (title === '') {
    errors.push(
      knowledgeError('name', 'document has no heading; the first heading is the feature name'),
    );
  }
  if (options.revision === '') {
    errors.push(knowledgeError('revision', 'the document revision is required'));
  }

  for (const heading of FEATURE_SECTION_HEADINGS) {
    // The six sections are level-2 headings (`## 用途`); a level-1 title that happens
    // to read 用途 must not satisfy the format (W4R1-06).
    const count = scan.headings.filter((item) => item.text === heading && item.level === 2).length;
    if (count === 0) errors.push(knowledgeError(heading, `missing required heading: ${heading}`));
    else if (count > 1) errors.push(knowledgeError(heading, `duplicate heading: ${heading}`));
  }

  const fieldTable = scan.tables.find((table) => sameRow(table.header, FIELD_TABLE_HEADER));
  const values = new Map<string, string>();
  if (fieldTable === undefined) {
    errors.push(knowledgeError('fields', `missing field table: ${FIELD_TABLE_HEADER.join(' | ')}`));
  } else {
    for (const row of fieldTable.rows) {
      const rawKey = row[0] ?? '';
      const key = rawKey.trim();
      if (row.length !== 2) {
        errors.push(
          knowledgeError(
            key === '' ? 'fields' : featureFieldModelName(key),
            `field row for ${key === '' ? '<empty>' : key} must have exactly two cells`,
          ),
        );
        continue;
      }
      if (key === '') {
        errors.push(knowledgeError('fields', 'field key must not be empty'));
        continue;
      }
      if (!FEATURE_FIELD_KEYS.includes(key)) {
        errors.push(knowledgeError(key, `unknown field: ${key}`));
        continue;
      }
      if (values.has(key)) {
        errors.push(knowledgeError(featureFieldModelName(key), `duplicate field: ${key}`));
        continue;
      }
      const value = (row[1] ?? '').trim();
      if (value === '') {
        errors.push(
          knowledgeError(
            featureFieldModelName(key),
            `field ${key} must not be empty; use 无 or 未调查 for an empty value`,
          ),
        );
        continue;
      }
      const placeholder = findPlaceholder(value);
      if (placeholder !== undefined) {
        errors.push(
          knowledgeError(featureFieldModelName(key), `placeholder value in ${key}: ${placeholder}`),
        );
        continue;
      }
      values.set(key, value);
    }
  }
  for (const field of FEATURE_FIELDS) {
    if (!values.has(field.key)) {
      errors.push(knowledgeError(field.model, `missing required field: ${field.key}`));
    }
  }

  const featureId = values.get('feature_id') ?? '';
  if (featureId !== '' && !FEATURE_ID_PATTERN.test(featureId)) {
    errors.push(
      knowledgeError('featureId', `feature_id must be F- plus 8 hex digits: ${featureId}`),
    );
  }

  const designValue = values.get('design') ?? '';
  let design: DesignState | undefined;
  if (isDesignState(designValue)) design = designValue;
  else if (designValue !== '')
    errors.push(knowledgeError('design', `unknown design state: ${designValue}`));

  const implementationValue = values.get('implementation') ?? '';
  let implementation: ImplementationState | undefined;
  if (isImplementationState(implementationValue)) implementation = implementationValue;
  else if (implementationValue !== '')
    errors.push(
      knowledgeError('implementation', `unknown implementation state: ${implementationValue}`),
    );

  const verificationValue = values.get('verification') ?? '';
  let verification: VerificationState | undefined;
  if (isVerificationState(verificationValue)) verification = verificationValue;
  else if (verificationValue !== '')
    errors.push(knowledgeError('verification', `unknown verification state: ${verificationValue}`));

  const investigationValue = values.get('investigation') ?? '';
  let investigation: InvestigationState | undefined;
  if (isInvestigationState(investigationValue)) investigation = investigationValue;
  else if (investigationValue !== '')
    errors.push(
      knowledgeError('investigation', `unknown investigation state: ${investigationValue}`),
    );

  const ownerDocument = values.get('owner_document') ?? '';
  if (ownerDocument !== '' && ownerDocument !== options.relativePath) {
    errors.push(
      knowledgeError(
        'ownerDocument',
        `owner_document ${ownerDocument} must equal the document path ${options.relativePath}`,
      ),
    );
  }

  const designDecisionRefs = readMultiValue(values.get('design_decision_refs') ?? '');
  const verificationEvidenceRefs = readMultiValue(values.get('verification_evidence_refs') ?? '');
  const verificationCoverage = readMultiValue(values.get('verification_coverage') ?? '');
  const investigationScope = readMultiValue(values.get('investigation_scope') ?? '');
  const sourceRefs = readMultiValue(values.get('source_refs') ?? '');
  const revision = values.get('revision') ?? '';

  if (design === 'confirmed') {
    const knownIds = options.knownIds ?? [];
    if (!designDecisionRefs.some((ref) => designRefResolves(ref, knownIds))) {
      errors.push(
        knowledgeError(
          'designDecisionRefs',
          'design=confirmed requires at least one resolvable design_decision_refs entry (decision:<realId> or requirement:<id>)',
        ),
      );
    }
  }

  if (verification === 'passed') {
    if (verificationEvidenceRefs.length === 0) {
      errors.push(
        knowledgeError(
          'verificationEvidenceRefs',
          'verification=passed requires verification_evidence_refs',
        ),
      );
    }
    if (verificationCoverage.length === 0) {
      errors.push(
        knowledgeError(
          'verificationCoverage',
          'verification=passed requires verification_coverage',
        ),
      );
    }
    if (options.codeTreeRevision !== undefined && revision !== options.codeTreeRevision) {
      errors.push(
        knowledgeError(
          'revision',
          `verification=passed requires revision ${options.codeTreeRevision}, got ${revision}`,
        ),
      );
    }
  }

  if (investigation === 'investigated') {
    if (investigationScope.length === 0) {
      errors.push(
        knowledgeError(
          'investigationScope',
          'investigation=investigated requires investigation_scope',
        ),
      );
    }
    if (sourceRefs.length === 0) {
      errors.push(knowledgeError('sourceRefs', 'investigation=investigated requires source_refs'));
    }
  }

  const bodies = new Map<string, FeatureSectionBody>();
  for (const heading of FEATURE_SECTION_HEADINGS) {
    const first = scan.headings.find((item) => item.text === heading && item.level === 2);
    if (first === undefined) continue;
    bodies.set(heading, buildSection(heading, sectionLines(scan, first)));
  }

  const entries = bodies.get(FEATURE_ENTRIES_HEADING);
  if (entries !== undefined && entries.items.length === 0 && !isEmptyValue(entries.text)) {
    errors.push(
      knowledgeError(FEATURE_ENTRIES_HEADING, '实现入口 must list entries, or say 无/未调查'),
    );
  }

  const relationHeading = scan.headings.find((item) => item.text === FEATURE_RELATION_HEADING);
  const relations =
    relationHeading === undefined ? [] : parseRelations(scan, relationHeading, errors);

  for (const section of [bodies.get(FEATURE_ENTRIES_HEADING), bodies.get('关键决定')]) {
    if (section === undefined) continue;
    for (const item of section.items) {
      const placeholder = findPlaceholder(item);
      if (placeholder !== undefined) {
        errors.push(knowledgeError(section.heading, `placeholder value: ${placeholder}`));
      }
    }
  }

  const sections: FeatureSections = {
    purpose: bodies.get('用途') ?? emptySection('用途'),
    currentBehaviour: bodies.get('当前行为') ?? emptySection('当前行为'),
    entries: bodies.get(FEATURE_ENTRIES_HEADING) ?? emptySection(FEATURE_ENTRIES_HEADING),
    gaps: bodies.get('已知差距') ?? emptySection('已知差距'),
    decisions: bodies.get('关键决定') ?? emptySection('关键决定'),
  };

  if (
    errors.length > 0 ||
    design === undefined ||
    implementation === undefined ||
    verification === undefined ||
    investigation === undefined
  ) {
    return { ok: false, feature: null, errors };
  }

  return {
    ok: true,
    errors: [],
    feature: {
      title,
      documentPath: options.relativePath,
      documentRevision: options.revision,
      featureId,
      name: values.get('name') ?? '',
      module: values.get('module') ?? '',
      ownerDocument,
      design,
      designDecisionRefs,
      implementation,
      verification,
      verificationEvidenceRefs,
      verificationCoverage,
      investigation,
      investigationScope,
      sourceRefs,
      revision,
      relations,
      sections,
    },
  };
}

/**
 * Parses a whole document set read at one revision.
 *
 * Per-document violations are reported with their `documentPath`; a feature id
 * that appears in more than one document is a `KNOWLEDGE_INVALID` set-level error
 * (`重复ID`), and the duplicated documents are excluded from `features` rather
 * than merged. Valid, uniquely identified documents stay available so the caller
 * can decide what to keep.
 */
export function parseFeatureSet(
  documents: readonly FeatureDocumentInput[],
  options: ParseFeatureSetOptions,
): FeatureSetResult {
  const errors: FeatureSetError[] = [];
  const parsed: ParsedFeature[] = [];
  for (const document of documents) {
    const result = parseFeatureDocument(document.markdown, {
      relativePath: document.relativePath,
      revision: options.revision,
      ...(options.codeTreeRevision === undefined
        ? {}
        : { codeTreeRevision: options.codeTreeRevision }),
      ...(options.knownIds === undefined ? {} : { knownIds: options.knownIds }),
    });
    if (!result.ok) {
      for (const error of result.errors) {
        errors.push({ ...error, documentPath: document.relativePath });
      }
      continue;
    }
    parsed.push(result.feature);
  }

  const byId = new Map<string, ParsedFeature[]>();
  for (const feature of parsed) {
    const list = byId.get(feature.featureId);
    if (list === undefined) byId.set(feature.featureId, [feature]);
    else list.push(feature);
  }

  const features: ParsedFeature[] = [];
  const duplicateIds: string[] = [];
  for (const feature of parsed) {
    const list = byId.get(feature.featureId) ?? [];
    if (list.length > 1) {
      if (!duplicateIds.includes(feature.featureId)) duplicateIds.push(feature.featureId);
      continue;
    }
    features.push(feature);
  }
  for (const id of duplicateIds) {
    const paths = (byId.get(id) ?? []).map((feature) => feature.documentPath);
    for (const path of paths) {
      errors.push({
        code: 'KNOWLEDGE_INVALID',
        field: 'featureId',
        message: `duplicate feature id ${id} appears in ${paths.join(', ')}`,
        documentPath: path,
      });
    }
  }

  if (errors.length > 0) return { ok: false, features, errors };
  return { ok: true, features, errors: [] };
}
