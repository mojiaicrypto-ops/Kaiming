/**
 * Knowledge projection build and cache (`docs/architecture/context.md` §2,
 * `docs/product/knowledge.md` §1/§2).
 *
 * One build reads a whole Feature document set at one revision and publishes an
 * immutable projection: the one-line Feature index (first sentence of 用途 plus a
 * link), the `features/README.md` index document, the `PROJECT.md` navigation,
 * the `CODE_MAP.md` entries collected from every feature's 实现入口, and the
 * relation graph. Every rendered document carries a content hash so a caller can
 * detect drift between the projection and the formal Git files.
 *
 * Fail-closed: `非法格式拒绝发布，保留最后有效并标stale` (context.md §2). When any
 * document violates the format the build publishes nothing, the retained last
 * valid projection is marked `stale`, and the parser errors are returned as
 * `KNOWLEDGE_INVALID` diagnostics. A stale projection is visibly marked by
 * `state`/`staleSince`/`staleReason` and is never presented as current.
 *
 * Cache: `feature_projection` is keyed `(revision, featureId)` and may be rebuilt
 * from Git (`data.md` §2, `context.md` §2). The SQLite-backed cache lands with the
 * integration package (WP-08); `ProjectionCache` is the seam it plugs into, and
 * the in-memory implementation below keeps this package independent of storage.
 */
import { createHash } from 'node:crypto';
import type { JsonObject, ProjectionState } from '@agentdev/contracts';
import {
  parseFeatureSet,
  type FeatureDocumentInput,
  type FeatureSetError,
  type ParsedFeature,
} from './feature-format.js';
import { diagnoseLinks, type LinkDiagnostic, type LinkDiagnosticsContext } from './relations.js';
import {
  type DesignState,
  type Feature,
  type FeatureRelation,
  type FeatureSectionBody,
  type ImplementationState,
  type RelationKind,
  type VerificationState,
} from './model.js';

/** Default `document-root` (`context.md` §4: `document-root=docs/agentdev`). */
export const DEFAULT_DOCUMENT_ROOT = 'docs/agentdev';

/** Document-root-relative path of the generated Feature index. */
export const FEATURES_INDEX_PATH = 'features/README.md';
/** Document-root-relative path of the generated code map. */
export const CODE_MAP_PATH = 'CODE_MAP.md';
/** Document-root-relative path of the generated project navigation. */
export const PROJECT_PATH = 'PROJECT.md';

/**
 * Sentence end for a one-line summary.
 *
 * CJK/full-width terminators always end the sentence; an ASCII dot only counts when
 * whitespace or the end of the text follows it, so `支持 v1.2 语义与 .ts 扩展名`
 * is never truncated to `支持 v1` (W4R1-02).
 */
const SENTENCE_END = /[。．！？!?\n]|\.(?=\s|$)/u;

/** Lowercase SHA256 over the UTF-8 Markdown bytes of a rendered document. */
export function contentHash(markdown: string): string {
  return createHash('sha256').update(markdown, 'utf8').digest('hex');
}

/**
 * First sentence of a body: whitespace is collapsed, the terminator removed, so
 * a summary always fits on one index line.
 */
export function firstSentence(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim();
  if (normalized === '') return '';
  const end = SENTENCE_END.exec(normalized);
  return (end === null ? normalized : normalized.slice(0, end.index)).trim();
}

/**
 * One-line summary of a feature: the first sentence of 用途, falling back to the
 * first 用途 list item and then to the literal `未调查` — never to inferred prose
 * (`禁止虚构行为`).
 */
export function featureSummary(feature: Pick<Feature, 'sections'>): string {
  const fromText = firstSentence(feature.sections.purpose.text);
  if (fromText !== '') return fromText;
  for (const item of feature.sections.purpose.items) {
    const fromItem = firstSentence(item);
    if (fromItem !== '') return fromItem;
  }
  return '未调查';
}

/** One rendered formal document plus its drift hash. */
export interface RenderedDocument {
  /** Repo-relative path (`documentRoot` joined with the document-root-relative path). */
  readonly path: string;
  readonly markdown: string;
  /** Lowercase SHA256 of `markdown`. */
  readonly contentHash: string;
}

/** One row of the one-line Feature index. */
export interface FeatureIndexEntry {
  readonly featureId: string;
  readonly name: string;
  readonly module: string;
  /** First sentence of 用途. */
  readonly summary: string;
  /** Document-root-relative path of the Feature document. */
  readonly link: string;
  readonly design: DesignState;
  readonly implementation: ImplementationState;
  readonly verification: VerificationState;
}

/** One code/test path collected from a feature's 实现入口. */
export interface CodeMapEntry {
  readonly featureId: string;
  readonly featureName: string;
  readonly module: string;
  /** Repo-relative code or test path. */
  readonly path: string;
  /** Symbol inside the path, when the entry wrote `path#symbol`. */
  readonly symbol?: string;
  /** Trailing annotation on the entry line, kept rather than dropped. */
  readonly note?: string;
  /** Document-root-relative link to the owning Feature document. */
  readonly link: string;
}

/** A relation target placeholder node in the graph. */
export interface RelationsGraphNode {
  readonly featureId: string;
  readonly name: string;
  readonly module: string;
  /** `false` when the node exists only as a relation target without a document. */
  readonly resolved: boolean;
}

/** One relation edge, oriented from the declaring feature to its target. */
export interface RelationEdge {
  readonly fromFeatureId: string;
  readonly toFeatureId: string;
  readonly kind: RelationKind;
  readonly reason: string;
  readonly source: string;
}

/** The relation graph of one revision. */
export interface RelationsGraph {
  readonly nodes: readonly RelationsGraphNode[];
  readonly edges: readonly RelationEdge[];
  /**
   * Relation targets with no document in this revision. `knowledge.md` §2
   * requires a minimal 未调查 placeholder for each; creating it is a settlement /
   * initialization action, so the projection only reports the ids.
   */
  readonly missingTargets: readonly string[];
}

/** A validated document plus the projection-only facts derived from it. */
export interface ProjectedFeature extends ParsedFeature {
  /** First sentence of 用途. */
  readonly summary: string;
  /** Document-root-relative path of this feature's document. */
  readonly link: string;
  readonly codeMapEntries: readonly CodeMapEntry[];
}

/** The published projection of one revision. */
export interface KnowledgeProjection {
  /** `valid` for the newest successful build; `stale` when retained after a failure. */
  readonly state: ProjectionState;
  /** Knowledge revision the documents were read at (`feature_projection.revision`). */
  readonly revision: string;
  /** Code tree revision the projection was built against. */
  readonly codeTreeRevision: string;
  /** Revision of the failed build that made this projection stale. */
  readonly staleSince?: string;
  /** Why the projection is stale; present exactly when `state` is `stale`. */
  readonly staleReason?: string;
  /** Features in deterministic `(module, name, featureId)` order. */
  readonly features: readonly ProjectedFeature[];
  /** One-line index rows, rendered into `features/README.md`. */
  readonly index: readonly FeatureIndexEntry[];
  /** Code map rows, rendered into `CODE_MAP.md`. */
  readonly codeMap: readonly CodeMapEntry[];
  readonly relations: RelationsGraph;
  /**
   * Broken-link diagnostics for this revision (`context.md` §2: 断链为诊断，
   * 影响当前需求则阻断相关交付). Diagnostics never suppress publication; they
   * gate delivery through `blockedFeatureIds`/`deliveryBlocked`.
   */
  readonly links: ProjectionLinks;
  /** Source document hash per document-root-relative path, for drift detection. */
  readonly documentHashes: Readonly<Record<string, string>>;
  readonly documents: {
    /** `documentRoot/features/README.md`. */
    readonly featuresReadme: RenderedDocument;
    /** `documentRoot/CODE_MAP.md`. */
    readonly codeMap: RenderedDocument;
    /** `documentRoot/PROJECT.md` navigation. */
    readonly project: RenderedDocument;
    /** One rendered `features/<featureId>/README.md` per feature. */
    readonly features: readonly RenderedDocument[];
  };
}

/** One cache row; mirrors `feature_projection` (`data.md` §2). */
export interface CachedFeatureProjection {
  readonly revision: string;
  readonly featureId: string;
  readonly documentPath: string;
  readonly documentHash: string;
  readonly fields: JsonObject;
  readonly relations: JsonObject;
  readonly state: ProjectionState;
}

/**
 * The projection cache seam, keyed `(revision, featureId)` exactly as
 * `feature_projection` is (`data.md` §2: `UNIQUE(revision,featureId)`).
 *
 * The SQLite-backed implementation lands with the integration package (WP-08);
 * this Port is the seam it plugs into, so the knowledge layer stays free of
 * storage and can be exercised with the in-memory implementation below.
 */
export interface ProjectionCache {
  /** Reads the cached row for `(revision, featureId)`, or `undefined`. */
  get(revision: string, featureId: string): CachedFeatureProjection | undefined;
  /** Every cached row of one revision, in insertion order. */
  getRevision(revision: string): readonly CachedFeatureProjection[];
  /** Publishes one projection's rows as `valid` and records it as the last valid projection. */
  put(revision: string, projection: KnowledgeProjection): void;
  /** The last valid projection, stale-marked when a later build failed; `undefined` before any publish. */
  lastValid(): KnowledgeProjection | undefined;
  /**
   * Marks the last valid projection (and its rows) stale after a failed build and
   * returns it, or `undefined` when nothing was ever published.
   */
  markStale(revision: string, reason: string): KnowledgeProjection | undefined;
}

export interface ProjectionBuildOptions {
  /** Every Feature document read at `revision`. */
  readonly documents: readonly FeatureDocumentInput[];
  /** Knowledge revision the documents are read at. */
  readonly revision: string;
  /** Code tree the recorded `revision` field is compared against. */
  readonly codeTreeRevision: string;
  /** Decision/requirement ids that resolve `design_decision_refs` (`relations.ts`). */
  readonly knownIds?: readonly string[];
  /** `document-root`; defaults to `docs/agentdev`. */
  readonly documentRoot?: string;
  /** Cache to publish into and to retain the last valid projection from. */
  readonly cache?: ProjectionCache;
  /** Facts and requirement scope for broken-link diagnosis; omitted skips the check. */
  readonly linkDiagnostics?: LinkDiagnosticsContext;
}

export interface ProjectionPublished {
  readonly published: true;
  readonly stale: false;
  readonly projection: KnowledgeProjection;
  readonly diagnostics: readonly [];
}

export interface ProjectionRejected {
  readonly published: false;
  /**
   * `true` whenever the newest document set could not be published, whether or
   * not a previously published projection exists to retain.
   */
  readonly stale: true;
  /** The retained last valid projection, already marked `stale`; `null` when none exists. */
  readonly projection: KnowledgeProjection | null;
  /** The parser errors that blocked publication, all `KNOWLEDGE_INVALID`. */
  readonly diagnostics: readonly FeatureSetError[];
}

/** Result of one projection build. */
export type ProjectionBuildResult = ProjectionPublished | ProjectionRejected;

/** Broken-link diagnostics attached to one published projection. */
export interface ProjectionLinks {
  readonly diagnostics: readonly LinkDiagnostic[];
  /** Features with a broken link that affects the current requirement. */
  readonly blockedFeatureIds: readonly string[];
  /** `true` when the current requirement's delivery must not proceed. */
  readonly deliveryBlocked: boolean;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Escapes a table cell: a pipe cannot end the cell, a newline cannot end the row. */
function cell(value: string): string {
  return value.replace(/\|/gu, '\\|').replace(/\r?\n/gu, ' ').trim();
}

/** Renders a section as prose plus list items; the literal 无 when empty. */
function renderSectionBody(section: FeatureSectionBody): string {
  const blocks: string[] = [];
  if (section.text.trim() !== '') blocks.push(section.text.trim());
  for (const item of section.items) blocks.push(`- ${item}`);
  return blocks.length === 0 ? '无' : blocks.join('\n');
}

/** Renders the four-column relation table, or the literal 无. */
function renderRelationTable(relations: readonly FeatureRelation[]): string {
  if (relations.length === 0) return '无';
  const lines = ['| target_feature_id | kind | reason | source |', '|---|---|---|---|'];
  for (const relation of relations) {
    lines.push(
      `| ${cell(relation.targetFeatureId)} | ${cell(relation.kind)} | ${cell(relation.reason)} | ${cell(relation.source)} |`,
    );
  }
  return lines.join('\n');
}

/** Multi-value cell: semicolon-separated, or the literal 无 when empty. */
function multiValue(values: readonly string[]): string {
  return values.length === 0 ? '无' : values.map((value) => value.trim()).join('；');
}

/**
 * Renders the `features/README.md` index document: one line per feature with its
 * one-line summary and its document link (relative to the index document).
 * Rendering preserves the given order; `buildProjection` passes sorted input.
 */
export function renderIndex(entries: readonly FeatureIndexEntry[]): string {
  const lines = ['# 功能索引', '', '> 由知识投影重建；每条为功能的一句话摘要与文档链接。', ''];
  if (entries.length === 0) {
    lines.push('无已登记功能。', '');
    return lines.join('\n');
  }
  lines.push('| feature_id | 名称 | module | 摘要 | 文档 |', '|---|---|---|---|---|');
  for (const entry of entries) {
    lines.push(
      `| ${cell(entry.featureId)} | ${cell(entry.name)} | ${cell(entry.module)} | ${cell(entry.summary)} | [${cell(entry.name)}](${linkFromIndex(entry.link)}) |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** Relative link from `features/README.md` to a document-root-relative feature path. */
function linkFromIndex(link: string): string {
  return link.startsWith('features/') ? link.slice('features/'.length) : link;
}

/**
 * Renders one Feature document (`features/<featureId>/README.md`) from validated
 * projection facts. The output uses the fixed format of `context.md` §2, so a
 * rendered document parses back to the same facts.
 */
export function renderReadme(feature: ParsedFeature): string {
  const lines: string[] = [`# ${feature.name}`, '', '| 字段 | 值 |', '|---|---|'];
  const fields: readonly (readonly [string, string])[] = [
    ['feature_id', feature.featureId],
    ['name', feature.name],
    ['module', feature.module],
    ['owner_document', feature.documentPath],
    ['design', feature.design],
    ['design_decision_refs', multiValue(feature.designDecisionRefs)],
    ['implementation', feature.implementation],
    ['verification', feature.verification],
    ['verification_evidence_refs', multiValue(feature.verificationEvidenceRefs)],
    ['verification_coverage', multiValue(feature.verificationCoverage)],
    ['investigation', feature.investigation],
    ['investigation_scope', multiValue(feature.investigationScope)],
    ['source_refs', multiValue(feature.sourceRefs)],
    ['revision', feature.revision],
  ];
  for (const [key, value] of fields) lines.push(`| ${key} | ${cell(value)} |`);
  lines.push('');
  lines.push('## 用途', renderSectionBody(feature.sections.purpose), '');
  lines.push('## 当前行为', renderSectionBody(feature.sections.currentBehaviour), '');
  lines.push('## 关系', renderRelationTable(feature.relations), '');
  lines.push('## 实现入口', renderSectionBody(feature.sections.entries), '');
  lines.push('## 已知差距', renderSectionBody(feature.sections.gaps), '');
  lines.push('## 关键决定', renderSectionBody(feature.sections.decisions), '');
  return lines.join('\n');
}

/**
 * Renders the `CODE_MAP.md` index from 实现入口 entries. Rendering preserves the
 * given order; `buildProjection` passes entries in projection order.
 */
export function renderCodeMap(entries: readonly CodeMapEntry[]): string {
  const lines = ['# 代码地图', '', '> 由知识投影重建；来源为各 Feature 的「实现入口」。', ''];
  if (entries.length === 0) {
    lines.push('无已登记实现入口。', '');
    return lines.join('\n');
  }
  lines.push('| 路径 | 符号 | module | 功能 |', '|---|---|---|---|');
  for (const entry of entries) {
    lines.push(
      `| ${cell(entry.path)} | ${cell(entry.symbol ?? '')} | ${cell(entry.module)} | [${cell(entry.featureName)}](${entry.link}) |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** One feature link inside the Project navigation. */
export interface NavigationFeatureEntry {
  readonly featureId: string;
  readonly name: string;
  /** Document-root-relative path of the feature document. */
  readonly link: string;
}

/** One module group inside the Project navigation. */
export interface NavigationModule {
  readonly module: string;
  readonly features: readonly NavigationFeatureEntry[];
}

/** `PROJECT.md` navigation (`knowledge.md` §1: 主要模块及导航). */
export interface ProjectNavigation {
  readonly modules: readonly NavigationModule[];
}

/**
 * Renders the `PROJECT.md` navigation. Only the derived sections are rendered —
 * 用户/目标/边界 stay owned by the formal document, so a projection rebuild does
 * not overwrite them.
 */
export function renderProject(navigation: ProjectNavigation): string {
  const lines = [
    '# 项目知识导航',
    '',
    '> 本文件由知识投影重建，只包含「主要模块及导航」；用户、目标、边界以正式 PROJECT.md 正文为准。',
    '',
    '## 主要模块',
    '',
  ];
  if (navigation.modules.length === 0) {
    lines.push('无已登记模块。', '');
  } else {
    lines.push('| module | 功能 |', '|---|---|');
    for (const group of navigation.modules) {
      const links = group.features
        .map((feature) => `[${cell(feature.name)}](${feature.link})`)
        .join('；');
      lines.push(`| ${cell(group.module)} | ${links} |`);
    }
    lines.push('');
  }
  lines.push(
    '## 导航',
    '',
    `- [功能索引](${FEATURES_INDEX_PATH})`,
    `- [代码地图](${CODE_MAP_PATH})`,
    '',
  );
  return lines.join('\n');
}

/**
 * Builds the relation graph of a validated feature set. A target without a
 * document becomes an unresolved placeholder node and is listed in
 * `missingTargets`, so the caller can create the minimal 未调查 Feature instead
 * of inventing one here.
 */
export function buildRelationsGraph(features: readonly Feature[]): RelationsGraph {
  const nodes = new Map<string, RelationsGraphNode>();
  for (const feature of features) {
    nodes.set(feature.featureId, {
      featureId: feature.featureId,
      name: feature.name,
      module: feature.module,
      resolved: true,
    });
  }
  const edges: RelationEdge[] = [];
  const missing = new Set<string>();
  for (const feature of features) {
    for (const relation of feature.relations) {
      edges.push({
        fromFeatureId: feature.featureId,
        toFeatureId: relation.targetFeatureId,
        kind: relation.kind,
        reason: relation.reason,
        source: relation.source,
      });
      if (!nodes.has(relation.targetFeatureId)) {
        missing.add(relation.targetFeatureId);
        nodes.set(relation.targetFeatureId, {
          featureId: relation.targetFeatureId,
          name: '未调查',
          module: '未调查',
          resolved: false,
        });
      }
    }
  }
  return {
    nodes: [...nodes.values()].sort((left, right) => compareText(left.featureId, right.featureId)),
    edges,
    missingTargets: [...missing].sort(compareText),
  };
}

/** Parses the 实现入口 list items into code-map rows. */
function codeMapEntriesOf(feature: ParsedFeature): readonly CodeMapEntry[] {
  return feature.sections.entries.items.map((item) => {
    const trimmed = item.trim();
    const hashAt = trimmed.indexOf('#');
    const pathPart = (hashAt === -1 ? trimmed : trimmed.slice(0, hashAt)).trim();
    const symbol = hashAt === -1 ? '' : trimmed.slice(hashAt + 1).trim();
    const spaceAt = pathPart.search(/\s/u);
    const path = spaceAt === -1 ? pathPart : pathPart.slice(0, spaceAt).trim();
    const note = spaceAt === -1 ? '' : pathPart.slice(spaceAt).trim();
    return {
      featureId: feature.featureId,
      featureName: feature.name,
      module: feature.module,
      path,
      link: feature.documentPath,
      ...(symbol === '' ? {} : { symbol }),
      ...(note === '' ? {} : { note }),
    };
  });
}

function projectFeature(feature: ParsedFeature): ProjectedFeature {
  return {
    ...feature,
    summary: featureSummary(feature),
    link: feature.documentPath,
    codeMapEntries: codeMapEntriesOf(feature),
  };
}

function indexOf(features: readonly ProjectedFeature[]): readonly FeatureIndexEntry[] {
  return features.map((feature) => ({
    featureId: feature.featureId,
    name: feature.name,
    module: feature.module,
    summary: feature.summary,
    link: feature.link,
    design: feature.design,
    implementation: feature.implementation,
    verification: feature.verification,
  }));
}

function navigationOf(features: readonly ProjectedFeature[]): ProjectNavigation {
  const modules = new Map<string, NavigationFeatureEntry[]>();
  for (const feature of features) {
    const entries = modules.get(feature.module) ?? [];
    entries.push({ featureId: feature.featureId, name: feature.name, link: feature.link });
    modules.set(feature.module, entries);
  }
  return {
    modules: [...modules.entries()]
      .sort((left, right) => compareText(left[0], right[0]))
      .map(([module, entries]) => ({ module, features: entries })),
  };
}

function documentPathOf(documentRoot: string, relativePath: string): string {
  const normalized = relativePath.replace(/^\.\//u, '');
  if (normalized.startsWith(`${documentRoot}/`)) return normalized;
  return `${documentRoot}/${normalized}`;
}

function rendered(path: string, markdown: string): RenderedDocument {
  return { path, markdown, contentHash: contentHash(markdown) };
}

function fieldsOf(feature: Feature): JsonObject {
  return {
    featureId: feature.featureId,
    name: feature.name,
    module: feature.module,
    ownerDocument: feature.ownerDocument,
    design: feature.design,
    designDecisionRefs: [...feature.designDecisionRefs],
    implementation: feature.implementation,
    verification: feature.verification,
    verificationEvidenceRefs: [...feature.verificationEvidenceRefs],
    verificationCoverage: [...feature.verificationCoverage],
    investigation: feature.investigation,
    investigationScope: [...feature.investigationScope],
    sourceRefs: [...feature.sourceRefs],
    revision: feature.revision,
  };
}

function relationsOf(feature: Feature): JsonObject {
  return {
    items: feature.relations.map((relation) => ({
      targetFeatureId: relation.targetFeatureId,
      kind: relation.kind,
      reason: relation.reason,
      source: relation.source,
    })),
  };
}

/**
 * In-memory `ProjectionCache` for tests and for callers that keep no database.
 * Rows are keyed `(revision, featureId)`; `lastValid` is the last published
 * projection and is stale-marked after a failed build.
 */
export function createInMemoryProjectionCache(): ProjectionCache {
  const rows = new Map<string, CachedFeatureProjection>();
  let last: KnowledgeProjection | undefined;

  const rowKey = (revision: string, featureId: string): string => `${revision}\u0000${featureId}`;

  return {
    get(revision, featureId) {
      return rows.get(rowKey(revision, featureId));
    },
    getRevision(revision) {
      return [...rows.values()].filter((row) => row.revision === revision);
    },
    put(revision, projection) {
      const publishedIds = new Set(projection.features.map((feature) => feature.featureId));
      for (const [key, row] of rows) {
        if (row.revision === revision && !publishedIds.has(row.featureId)) rows.delete(key);
      }
      for (const feature of projection.features) {
        rows.set(rowKey(revision, feature.featureId), {
          revision,
          featureId: feature.featureId,
          documentPath: feature.documentPath,
          documentHash:
            projection.documentHashes[feature.documentPath] ?? contentHash(feature.documentPath),
          fields: fieldsOf(feature),
          relations: relationsOf(feature),
          state: 'valid',
        });
      }
      last = projection;
    },
    lastValid() {
      return last;
    },
    markStale(revision, reason) {
      if (last === undefined) return undefined;
      last = { ...last, state: 'stale', staleSince: revision, staleReason: reason };
      for (const [key, row] of rows) {
        if (row.revision === last.revision) rows.set(key, { ...row, state: 'stale' });
      }
      return last;
    },
  };
}

/**
 * Builds and (unless the cache is a caller-owned store) publishes the projection.
 *
 * Every document is parsed with `parseFeatureSet`. When all of them are valid the
 * projection is published as `{published:true, projection}` and written to the
 * cache. When any document is invalid nothing is published: the last valid
 * projection is retained, marked `stale`, and returned with the parser errors as
 * `{published:false, stale:true, diagnostics}`.
 */
export function buildProjection(options: ProjectionBuildOptions): ProjectionBuildResult {
  const documentRoot = (options.documentRoot ?? DEFAULT_DOCUMENT_ROOT).replace(/\/+$/u, '');
  const parse = parseFeatureSet(options.documents, {
    revision: options.revision,
    codeTreeRevision: options.codeTreeRevision,
    ...(options.knownIds === undefined ? {} : { knownIds: options.knownIds }),
  });

  if (!parse.ok) {
    const first = parse.errors[0];
    const detail = first === undefined ? '' : `（首个 ${first.documentPath}: ${first.message}）`;
    const retained =
      options.cache?.markStale(
        options.revision,
        `非法 Feature 知识，拒绝发布：${parse.errors.length} 项${detail}`,
      ) ?? null;
    return { published: false, stale: true, projection: retained, diagnostics: parse.errors };
  }

  const features = parse.features
    .map((feature) => projectFeature(feature))
    .sort(
      (left, right) =>
        compareText(left.module, right.module) ||
        compareText(left.name, right.name) ||
        compareText(left.featureId, right.featureId),
    );
  const documentHashes: Record<string, string> = {};
  for (const document of options.documents) {
    documentHashes[document.relativePath] = contentHash(document.markdown);
  }

  const index = indexOf(features);
  const codeMap: CodeMapEntry[] = [];
  for (const feature of features) codeMap.push(...feature.codeMapEntries);

  const linkDiagnostics =
    options.linkDiagnostics === undefined ? [] : diagnoseLinks(features, options.linkDiagnostics);
  const blockedFeatureIds = [
    ...new Set(
      linkDiagnostics
        .filter((diagnostic) => diagnostic.blocksRequirement)
        .map((diagnostic) => diagnostic.featureId),
    ),
  ].sort(compareText);
  const links: ProjectionLinks = {
    diagnostics: linkDiagnostics,
    blockedFeatureIds,
    deliveryBlocked: blockedFeatureIds.length > 0,
  };

  const projection: KnowledgeProjection = {
    state: 'valid',
    revision: options.revision,
    codeTreeRevision: options.codeTreeRevision,
    features,
    index,
    codeMap,
    relations: buildRelationsGraph(features),
    links,
    documentHashes,
    documents: {
      featuresReadme: rendered(
        documentPathOf(documentRoot, FEATURES_INDEX_PATH),
        renderIndex(index),
      ),
      codeMap: rendered(documentPathOf(documentRoot, CODE_MAP_PATH), renderCodeMap(codeMap)),
      project: rendered(
        documentPathOf(documentRoot, PROJECT_PATH),
        renderProject(navigationOf(features)),
      ),
      features: features.map((feature) =>
        rendered(documentPathOf(documentRoot, feature.documentPath), renderReadme(feature)),
      ),
    },
  };

  options.cache?.put(options.revision, projection);
  return { published: true, stale: false, projection, diagnostics: [] };
}

/**
 * Whether broken links block delivery for the current requirement.
 *
 * `断链为诊断，影响当前需求则阻断相关交付；无关区域可以部分就绪` (context.md §2):
 * the projection stays readable, and only a requirement-scoped broken link stops
 * the delivery (AC-040).
 */
export function deliveryBlockedByLinks(projection: KnowledgeProjection): boolean {
  return projection.links.deliveryBlocked;
}
