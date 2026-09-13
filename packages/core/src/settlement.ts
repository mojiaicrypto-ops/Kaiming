/**
 * Settlement: the final Manifest, the knowledge patch and the crash-after-ref
 * completion (`docs/architecture/reliability.md` §4/§5, `docs/product/knowledge.md`
 * §6, AC-041, AC-063).
 *
 * Three artefacts make a delivery's final facts checkable:
 *
 * - **The final `CompletionManifest`.** It binds the Work, the verified
 *   `VerificationManifest`s, the delivered revision and its code tree, the
 *   knowledge tree, the Settlement result and the accepted risk decisions
 *   (`data.md` §3). Everything in it is read from real state — a manifest whose
 *   `codeRevision`/`codeTree` is not the delivered revision is refused rather than
 *   recorded as "verified".
 * - **The knowledge patch.** A patch updates a Feature's body, relations and
 *   implementation entries and records the invalidation notes; it is applied
 *   through `buildProjection`, so knowledge that violates the format is never
 *   published, the last valid projection is retained and marked `stale`, and a
 *   cold start finds the new facts (`AC-041`). `feature_projection` is the
 *   SQLite-backed `ProjectionCache` the knowledge package documents as landing
 *   here.
 * - **The crash-after-ref completion.** `reliability.md` §5: "Git commit存在则复用；
 *   ref已指向目标则补记完成". The operation row written before the CAS names the
 *   commit and the manifest, so a recovery after the ref update reuses the *same*
 *   commit, completes the missing database state and emits the settlement
 *   completion event exactly once (`AC-063`).
 */
import { type CompletionManifest, type ErrorCode, type JsonObject } from '@agentdev/contracts';
import {
  buildProjection,
  contentHash,
  parseFeatureDocument,
  renderReadme,
  type CachedFeatureProjection,
  type Feature,
  type FeatureDocumentInput,
  type FeatureRelation,
  type FeatureSetError,
  type KnowledgeProjection,
  type LinkDiagnosticsContext,
  type ParsedFeature,
  type ProjectionBuildResult,
  type ProjectionCache,
  type RelationKind,
} from '@agentdev/knowledge';
import { canTransitionRequirement, canTransitionWork } from '@agentdev/domain';
import { parseJson, sha256, withTransaction, type ProjectStore } from '@agentdev/storage';
import { runGit } from '@agentdev/workspace';
import type {
  CasEventPort,
  CasJournal,
  CasRequest,
  CasService,
  RequirementPoolCommit,
  WorktreeGitPort,
} from '@agentdev/workspace';
import type { SnapshotWriter } from './snapshots.js';
import { ProtocolError, type ProtocolErrorCode } from './errors.js';
import { scanEvents } from './events.js';

/** `Event.name` of the one durable settlement completion event. */
export const SETTLEMENT_COMPLETED_EVENT = 'settlement.completed';

/** `operation.kind` of a settlement (`data.md` §2). */
export const SETTLEMENT_OPERATION_KIND = 'settle';

/** Snapshot payload `kind` of a frozen `CompletionManifest`. */
export const COMPLETION_MANIFEST_KIND = 'completion_manifest';

/** Snapshot payload `kind` of a frozen `VerificationManifest`. */
export const VERIFICATION_MANIFEST_KIND = 'verification_manifest';

const FULL_OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const HASH = /^[0-9a-f]{64}$/u;

function fail(code: ProtocolErrorCode, message: string, details?: JsonObject): never {
  throw new ProtocolError(code, message, details === undefined ? {} : { details });
}

// ---------------------------------------------------------------------------
// SQLite projection cache (`feature_projection`, `data.md` §2)
// ---------------------------------------------------------------------------

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

export interface SqliteProjectionCache extends ProjectionCache {
  /** Revisions the cache holds, newest first. */
  revisions(): readonly string[];
  /** Marks every row of one revision stale without a rebuild. */
  markRevisionStale(revision: string): number;
}

/**
 * The `feature_projection`-backed `ProjectionCache` (`data.md` §2).
 *
 * Rows are keyed `(revision, featureId)` and are rebuildable from Git, so the
 * process-local "last valid projection" is only remembered after this process
 * published one; a cold process rebuilds it from the delivered documents rather
 * than pretending a row set is a projection.
 */
export function createSqliteProjectionCache(options: {
  readonly store: ProjectStore;
}): SqliteProjectionCache {
  const store = options.store;
  let last: KnowledgeProjection | undefined;

  const rowKey = (revision: string, featureId: string): string => `${revision}\u0000${featureId}`;
  const rows = (): CachedFeatureProjection[] => {
    const found = store.featureProjections.list({ orderBy: 'revision ASC, feature_id ASC' });
    return found.map((row) => ({
      revision: row.revision,
      featureId: row.featureId,
      documentPath: row.documentPath,
      documentHash: row.documentHash,
      fields: row.fields,
      relations: row.relations,
      state: row.state,
    }));
  };

  return {
    get(revision, featureId) {
      return rows().find(
        (row) => rowKey(row.revision, row.featureId) === rowKey(revision, featureId),
      );
    },
    getRevision(revision) {
      return rows().filter((row) => row.revision === revision);
    },
    put(revision, projection) {
      withTransaction(store.db, () => {
        // The projection is keyed `(revision, featureId)` and is rebuildable, so a
        // publish replaces the whole revision's row set.
        store.db.prepare('DELETE FROM feature_projection WHERE revision = ?').run(revision);
        for (const feature of projection.features) {
          store.featureProjections.insert({
            projectId: store.projectId,
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
      });
      last = projection;
    },
    lastValid() {
      return last;
    },
    markStale(revision, reason) {
      // The *newest* published revision is the one that must be marked stale: a
      // failed build never publishes rows of its own.
      const staleRevision =
        last?.revision ??
        (
          store.db
            .prepare('SELECT revision FROM feature_projection ORDER BY rowid DESC LIMIT 1')
            .get() as { readonly revision?: unknown } | undefined
        )?.revision;
      if (typeof staleRevision === 'string' && staleRevision !== '') {
        this.markRevisionStale(staleRevision);
      }
      if (last === undefined) return undefined;
      last = { ...last, state: 'stale', staleSince: revision, staleReason: reason };
      return last;
    },
    revisions() {
      return [...new Set(rows().map((row) => row.revision))].sort().reverse();
    },
    markRevisionStale(revision) {
      let changed = 0;
      for (const row of store.featureProjections.list({
        where: 'revision = ? AND state = ?',
        params: [revision, 'valid'],
      })) {
        store.featureProjections.update(row.id, { state: 'stale' }, row.version);
        changed += 1;
      }
      return changed;
    },
  };
}

// ---------------------------------------------------------------------------
// Knowledge patch (AC-041)
// ---------------------------------------------------------------------------

/** A body update: the paragraph and/or the list items of one section. */
export interface FeatureBodyUpdate {
  readonly text?: string;
  readonly items?: readonly string[];
}

/** The structured Feature fields a settlement may update. */
export interface FeatureFieldUpdate {
  readonly name?: string;
  readonly module?: string;
  readonly design?: Feature['design'];
  readonly designDecisionRefs?: readonly string[];
  readonly implementation?: Feature['implementation'];
  readonly verification?: Feature['verification'];
  readonly verificationEvidenceRefs?: readonly string[];
  readonly verificationCoverage?: readonly string[];
  readonly investigation?: Feature['investigation'];
  readonly investigationScope?: readonly string[];
  readonly sourceRefs?: readonly string[];
  readonly revision?: string;
}

/** One relation row the patch writes. */
export interface FeatureRelationUpdate {
  readonly targetFeatureId: string;
  readonly kind: RelationKind;
  readonly reason: string;
  readonly source: string;
}

export interface KnowledgePatchInput {
  /** Repository-relative Feature document path (`owner_document`). */
  readonly documentPath: string;
  /** The document exactly as it is committed at the base revision. */
  readonly currentMarkdown: string;
  /** Revision the current document was read at (for the parse/validation). */
  readonly baseRevision: string;
  /** Code tree the current document's `revision` field is compared against. */
  readonly codeTreeRevision?: string;
  /** Ids that resolve `design_decision_refs`; required for `design=confirmed`. */
  readonly knownIds?: readonly string[];
  readonly fields?: FeatureFieldUpdate;
  readonly purpose?: FeatureBodyUpdate;
  readonly currentBehaviour?: FeatureBodyUpdate;
  /** The full 实现入口 list after the change. */
  readonly entries?: readonly string[];
  /** Extra 已知差距 lines (recorded gaps) to add. */
  readonly gaps?: readonly string[];
  /** The full 关系 table after the change; omitted keeps the current relations. */
  readonly relations?: readonly FeatureRelationUpdate[];
  /**
   * Invalidation notes (`AC-041` "失效说明"): each line is appended to 已知差距 so a
   * superseded fact stays visible instead of being silently replaced.
   */
  readonly invalidationNotes?: readonly string[];
  /**
   * `true` replaces 实现入口/已知差距/关系 with the supplied values instead of
   * appending to the current ones. Default `false` (append/merge).
   */
  readonly replace?: boolean;
}

export interface KnowledgePatch {
  readonly featureId: string;
  readonly documentPath: string;
  readonly baseRevision: string;
  readonly baseMarkdown: string;
  readonly baseHash: string;
  readonly markdown: string;
  readonly sha256: string;
  readonly changedFields: readonly string[];
  readonly feature: ParsedFeature;
  readonly entries: readonly string[];
  readonly relations: readonly FeatureRelation[];
  readonly invalidationNotes: readonly string[];
}

export type KnowledgePatchResult =
  | { readonly ok: true; readonly patch: KnowledgePatch }
  | {
      readonly ok: false;
      readonly code: Extract<ErrorCode, 'KNOWLEDGE_INVALID'>;
      readonly message: string;
      readonly errors: readonly { readonly message: string; readonly field?: string }[];
    };

function mergeSection(
  current: Feature['sections']['purpose'],
  update: FeatureBodyUpdate | undefined,
): { readonly text: string; readonly items: readonly string[] } | undefined {
  if (update === undefined) return undefined;
  return {
    text: update.text ?? current.text,
    items: update.items ?? current.items,
  };
}

/**
 * Builds one Feature document patch from the committed document.
 *
 * The patch is rendered from parsed facts, so it cannot produce a document the
 * format does not describe; whether the *result* is publishable is decided by
 * `applyKnowledgePatch` through the projection rules.
 */
export function buildKnowledgePatch(input: KnowledgePatchInput): KnowledgePatchResult {
  const parsed = parseFeatureDocument(input.currentMarkdown, {
    relativePath: input.documentPath,
    revision: input.baseRevision,
    // The *current* document predates the settlement, so its `revision` field is not
    // expected to equal the new code tree; the equality rule is applied to the
    // rendered result below and again by `buildProjection`.
    ...(input.knownIds === undefined ? {} : { knownIds: input.knownIds }),
  });
  if (!parsed.ok) {
    return {
      ok: false,
      code: 'KNOWLEDGE_INVALID',
      message: `当前 Feature 文档不合法，拒绝在其上构建知识补丁：${input.documentPath}`,
      errors: parsed.errors,
    };
  }
  const current = parsed.feature;
  const fields = input.fields;
  const replace = input.replace === true;

  const entries = replace
    ? [...(input.entries ?? [])]
    : [...new Set([...current.sections.entries.items, ...(input.entries ?? [])])];
  const gaps = replace
    ? [...(input.gaps ?? []), ...(input.invalidationNotes ?? [])]
    : [...current.sections.gaps.items, ...(input.gaps ?? []), ...(input.invalidationNotes ?? [])];
  const relations: readonly FeatureRelation[] = (input.relations ?? current.relations).map(
    (relation) => ({
      targetFeatureId: relation.targetFeatureId,
      kind: relation.kind,
      reason: relation.reason,
      source: relation.source,
    }),
  );

  const purpose = mergeSection(current.sections.purpose, input.purpose);
  const currentBehaviour = mergeSection(current.sections.currentBehaviour, input.currentBehaviour);

  const updated: ParsedFeature = {
    ...current,
    featureId: current.featureId,
    name: fields?.name ?? current.name,
    module: fields?.module ?? current.module,
    ownerDocument: input.documentPath,
    design: fields?.design ?? current.design,
    designDecisionRefs: fields?.designDecisionRefs ?? current.designDecisionRefs,
    implementation: fields?.implementation ?? current.implementation,
    verification: fields?.verification ?? current.verification,
    verificationEvidenceRefs: fields?.verificationEvidenceRefs ?? current.verificationEvidenceRefs,
    verificationCoverage: fields?.verificationCoverage ?? current.verificationCoverage,
    investigation: fields?.investigation ?? current.investigation,
    investigationScope: fields?.investigationScope ?? current.investigationScope,
    sourceRefs: fields?.sourceRefs ?? current.sourceRefs,
    revision: fields?.revision ?? current.revision,
    relations,
    sections: {
      ...current.sections,
      ...(purpose === undefined
        ? {}
        : { purpose: { heading: current.sections.purpose.heading, ...purpose } }),
      ...(currentBehaviour === undefined
        ? {}
        : {
            currentBehaviour: {
              heading: current.sections.currentBehaviour.heading,
              ...currentBehaviour,
            },
          }),
      entries: { heading: current.sections.entries.heading, text: '', items: entries },
      gaps: { heading: current.sections.gaps.heading, text: '', items: gaps },
    },
  };

  const markdown = renderReadme(updated);
  const effective = parseFeatureDocument(markdown, {
    relativePath: input.documentPath,
    revision: input.baseRevision,
    ...(input.codeTreeRevision === undefined ? {} : { codeTreeRevision: input.codeTreeRevision }),
    ...(input.knownIds === undefined ? {} : { knownIds: input.knownIds }),
  });
  if (!effective.ok) {
    return {
      ok: false,
      code: 'KNOWLEDGE_INVALID',
      message: `知识补丁渲染出的文档不合法：${input.documentPath}`,
      errors: effective.errors,
    };
  }

  const changedFields: string[] = [];
  if (markdown !== input.currentMarkdown) changedFields.push('document');
  for (const key of Object.keys(fields ?? {})) changedFields.push(key);
  if (purpose !== undefined) changedFields.push('purpose');
  if (currentBehaviour !== undefined) changedFields.push('currentBehaviour');
  if (input.entries !== undefined) changedFields.push('entries');
  if (input.gaps !== undefined) changedFields.push('gaps');
  if (input.relations !== undefined) changedFields.push('relations');
  if ((input.invalidationNotes ?? []).length > 0) changedFields.push('invalidationNotes');

  return {
    ok: true,
    patch: {
      featureId: current.featureId,
      documentPath: input.documentPath,
      baseRevision: input.baseRevision,
      baseMarkdown: input.currentMarkdown,
      baseHash: contentHash(input.currentMarkdown),
      markdown,
      sha256: contentHash(markdown),
      changedFields: [...new Set(changedFields)],
      feature: effective.feature,
      entries,
      relations,
      invalidationNotes: [...(input.invalidationNotes ?? [])],
    },
  };
}

export interface ApplyKnowledgePatchInput {
  readonly patch: KnowledgePatch;
  /** Every Feature document of the set the projection is built from. */
  readonly documents: readonly FeatureDocumentInput[];
  /** Revision the patched set is published under. */
  readonly revision: string;
  /** Code tree the projection is bound to. */
  readonly codeTreeRevision: string;
  readonly documentRoot?: string;
  readonly knownIds?: readonly string[];
  readonly cache?: ProjectionCache;
  readonly linkDiagnostics?: LinkDiagnosticsContext;
}

export type ApplyKnowledgePatchOutcome =
  | {
      readonly ok: true;
      readonly published: true;
      readonly projection: KnowledgeProjection;
      readonly document: {
        readonly path: string;
        readonly markdown: string;
        readonly sha256: string;
      };
    }
  | {
      readonly ok: false;
      readonly published: false;
      readonly code: 'KNOWLEDGE_INVALID';
      readonly stale: true;
      /** The retained last valid projection, already marked `stale`; `null` if none. */
      readonly retained: KnowledgeProjection | null;
      readonly diagnostics: readonly FeatureSetError[];
    };

/**
 * Applies a knowledge patch through the projection rules.
 *
 * `buildProjection` is the only publication path: valid knowledge publishes, and
 * invalid knowledge is refused with the parser diagnostics while the last valid
 * projection is retained and marked `stale` (`AC-040`, `AC-041`).
 */
export function applyKnowledgePatch(input: ApplyKnowledgePatchInput): ApplyKnowledgePatchOutcome {
  const documents: FeatureDocumentInput[] = [];
  let replaced = false;
  for (const document of input.documents) {
    if (document.relativePath === input.patch.documentPath) {
      documents.push({ relativePath: document.relativePath, markdown: input.patch.markdown });
      replaced = true;
    } else {
      documents.push({ relativePath: document.relativePath, markdown: document.markdown });
    }
  }
  if (!replaced) {
    documents.push({ relativePath: input.patch.documentPath, markdown: input.patch.markdown });
  }

  const result: ProjectionBuildResult = buildProjection({
    documents,
    revision: input.revision,
    codeTreeRevision: input.codeTreeRevision,
    ...(input.documentRoot === undefined ? {} : { documentRoot: input.documentRoot }),
    ...(input.knownIds === undefined ? {} : { knownIds: input.knownIds }),
    ...(input.cache === undefined ? {} : { cache: input.cache }),
    ...(input.linkDiagnostics === undefined ? {} : { linkDiagnostics: input.linkDiagnostics }),
  });
  if (!result.published) {
    return {
      ok: false,
      published: false,
      code: 'KNOWLEDGE_INVALID',
      stale: true,
      retained: result.projection,
      diagnostics: result.diagnostics,
    };
  }
  return {
    ok: true,
    published: true,
    projection: result.projection,
    document: {
      path: input.patch.documentPath,
      markdown: input.patch.markdown,
      sha256: input.patch.sha256,
    },
  };
}

// ---------------------------------------------------------------------------
// Final manifest (AC-041)
// ---------------------------------------------------------------------------

/** One verification contract the final manifest binds. */
export interface VerifiedManifestInput {
  readonly manifestId: string;
  readonly workId: string;
  readonly kind: 'task' | 'integration' | 'document';
  readonly codeRevision: string;
  readonly codeTree: string;
  readonly acceptanceIds: readonly string[];
  /** `false` when a Finding/Decision invalidated the evidence behind it. */
  readonly valid: boolean;
  readonly evidenceRefs?: readonly string[];
}

/** One path-level change of the delivered diff. */
export interface SettlementPathChange {
  readonly path: string;
  readonly change: 'added' | 'modified' | 'deleted' | 'other';
}

export interface FinalManifestInput {
  readonly workId: string;
  readonly requirementId?: string;
  readonly verifiedManifests: readonly VerifiedManifestInput[];
  /** The delivered revision the CAS installed. */
  readonly finalRevision: string;
  /** The tree of `finalRevision`. */
  readonly finalTree: string;
  /** Tree hash of the delivered knowledge documents. */
  readonly knowledgeTree: string;
  /** Id of the frozen `SettlementResult`. */
  readonly settlementResultRef: string;
  readonly riskDecisionIds?: readonly string[];
  /** Paths of the delivered diff (evidence), when the caller measured them. */
  readonly changedPaths?: readonly SettlementPathChange[];
  /** The revision the code work started from, for the diff evidence. */
  readonly codeStartRevision?: string | null;
  /** Artifact/evidence refs the manifest should name, when the caller has them. */
  readonly evidenceRefs?: readonly string[];
}

/** The extra, human-checkable evidence of one final manifest. */
export interface FinalManifestEvidence {
  readonly workId: string;
  readonly finalRevision: string;
  readonly finalTree: string;
  readonly knowledgeTree: string;
  readonly casRef: string;
  readonly verifiedManifestIds: readonly string[];
  readonly verifiedRevisions: readonly string[];
  readonly acceptanceIds: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly changedPaths: readonly SettlementPathChange[];
  readonly codeStartRevision: string | null;
}

export type FinalManifestResult =
  | {
      readonly ok: true;
      readonly manifest: CompletionManifest;
      readonly evidence: FinalManifestEvidence;
    }
  | {
      readonly ok: false;
      readonly code: 'GATE_NOT_READY' | 'STALE_ARTIFACT' | 'VALIDATION_ERROR';
      readonly message: string;
      readonly reasons: readonly string[];
    };

/**
 * Builds the Work's final `CompletionManifest` from verified facts.
 *
 * A manifest that cannot name a verified revision equal to the delivered one is
 * `STALE_ARTIFACT`: reuse of another tree's evidence is exactly what
 * `checkCompletionSettlement` refuses, and recording it as verified would make the
 * completion list a claim instead of evidence.
 */
export function buildFinalManifest(input: FinalManifestInput): FinalManifestResult {
  const reasons: string[] = [];
  if (input.workId.trim() === '') reasons.push('workId 不得为空');
  if (!FULL_OID.test(input.finalRevision)) {
    reasons.push(`finalRevision 不是完整 Git OID：${input.finalRevision}`);
  }
  if (!HASH.test(input.finalTree)) reasons.push(`finalTree 不是 SHA256：${input.finalTree}`);
  if (!HASH.test(input.knowledgeTree)) {
    reasons.push(`knowledgeTree 不是 SHA256：${input.knowledgeTree}`);
  }
  if (input.settlementResultRef.trim() === '') reasons.push('settlementResultRef 不得为空');
  if (input.verifiedManifests.length === 0) {
    reasons.push('完成清单没有引用任何已通过的验证 Manifest');
  }
  for (const manifest of input.verifiedManifests) {
    if (manifest.workId !== input.workId) {
      reasons.push(`Manifest ${manifest.manifestId} 属于其他 Work ${manifest.workId}`);
      continue;
    }
    if (!manifest.valid) {
      reasons.push(`Manifest ${manifest.manifestId} 已失效，不能作为完成证据`);
      continue;
    }
    if (manifest.codeRevision !== input.finalRevision || manifest.codeTree !== input.finalTree) {
      reasons.push(
        `Manifest ${manifest.manifestId} 验证的是 ${manifest.codeRevision}（tree ${manifest.codeTree}），不是最终 ${input.finalRevision}`,
      );
    }
  }
  if (reasons.length > 0) {
    const code: 'GATE_NOT_READY' | 'STALE_ARTIFACT' | 'VALIDATION_ERROR' =
      input.verifiedManifests.length === 0
        ? 'GATE_NOT_READY'
        : reasons.some((reason) => reason.includes('不是完整') || reason.includes('不是 SHA256'))
          ? 'VALIDATION_ERROR'
          : 'STALE_ARTIFACT';
    return { ok: false, code, message: reasons.join('；'), reasons };
  }

  const manifest: CompletionManifest = {
    workId: input.workId,
    ...(input.requirementId === undefined ? {} : { requirementId: input.requirementId }),
    verifiedManifestIds: input.verifiedManifests.map((entry) => entry.manifestId),
    finalRevision: input.finalRevision,
    verifiedCodeTree: input.finalTree,
    knowledgeTree: input.knowledgeTree,
    settlementResultRef: input.settlementResultRef,
    riskDecisionIds: [...(input.riskDecisionIds ?? [])],
  };
  const evidenceRefs = [
    ...new Set([
      ...(input.evidenceRefs ?? []),
      ...input.verifiedManifests.flatMap((entry) => [...(entry.evidenceRefs ?? [])]),
    ]),
  ].sort();
  return {
    ok: true,
    manifest,
    evidence: {
      workId: input.workId,
      finalRevision: input.finalRevision,
      finalTree: input.finalTree,
      knowledgeTree: input.knowledgeTree,
      casRef: input.settlementResultRef,
      verifiedManifestIds: [...manifest.verifiedManifestIds],
      verifiedRevisions: input.verifiedManifests.map((entry) => entry.codeRevision),
      acceptanceIds: [
        ...new Set(input.verifiedManifests.flatMap((entry) => entry.acceptanceIds)),
      ].sort(),
      evidenceRefs,
      changedPaths: [...(input.changedPaths ?? [])],
      codeStartRevision: input.codeStartRevision ?? null,
    },
  };
}

/**
 * The `codeTree` hash of a delivered revision (`data.md` §3 `codeTree`).
 *
 * A Git tree OID is a 40/64-hex object name, while the contract's `codeTree` is a
 * SHA256 over the tree's contents. Hashing the full recursive listing of the
 * revision binds every path and blob the delivery contains, so two revisions with
 * different content can never present the same `codeTree`.
 */
export function deliveredCodeTreeHash(input: {
  readonly repoRoot: string;
  readonly revision: string;
}): string {
  const result = runGit(['ls-tree', '-r', '-z', '--full-tree', input.revision], {
    cwd: input.repoRoot,
  });
  if (!result.ok) {
    fail('STALE_ARTIFACT', `无法读取 ${input.revision} 的代码树`, {
      revision: input.revision,
    });
  }
  return sha256(result.stdout);
}

/** Freezes a `CompletionManifest` exactly as `findings.ts` reads it back. */ export function freezeFinalManifest(input: {
  readonly snapshots: SnapshotWriter;
  readonly manifest: CompletionManifest;
}): { readonly hash: string; readonly created: boolean } {
  const frozen = input.snapshots.freeze('verification', {
    kind: COMPLETION_MANIFEST_KIND,
    workId: input.manifest.workId,
    manifest: input.manifest as unknown as JsonObject,
  });
  return { hash: frozen.hash, created: frozen.created };
}

/** Reads a frozen `CompletionManifest` back by hash; `null` when absent. */
export function readFrozenFinalManifest(
  store: ProjectStore,
  hash: string,
): CompletionManifest | null {
  const row = store.db
    .prepare("SELECT payload FROM snapshot WHERE hash = ? AND type = 'verification' LIMIT 1")
    .get(hash) as { readonly payload?: unknown } | undefined;
  if (row === undefined) return null;
  const payload = parseJson(row.payload, 'snapshot.payload');
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as { readonly kind?: unknown; readonly manifest?: unknown };
  if (record.kind !== COMPLETION_MANIFEST_KIND) return null;
  return (record.manifest as CompletionManifest | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Settlement + crash-after-ref recovery (AC-063)
// ---------------------------------------------------------------------------

export interface SettlementServiceOptions {
  readonly store: ProjectStore;
  readonly worktrees: WorktreeGitPort;
  readonly cas: CasService;
  readonly journal: CasJournal;
  readonly events: CasEventPort;
  readonly snapshots: SnapshotWriter;
  /** Optionally injected so the completion event is durable in the store too. */
  readonly now?: () => string;
}

export interface SettleRequest {
  readonly operationId: string;
  readonly workId: string;
  readonly requirementId?: string;
  readonly ref: string;
  /** The delivery revision the caller believes is current. */
  readonly expectedRevision: string;
  /** The commit the settlement installs (already created by the code route). */
  readonly candidateRevision: string;
  /**
   * The delivered **code tree hash** (SHA256 over the recursive tree listing,
   * `data.md` §3 `codeTree`) when the caller measured it itself. It is *not* the Git
   * tree OID: the two are reported separately as `codeTreeHash` and `commitTree`.
   */
  readonly candidateTree?: string;
  /** The final manifest to freeze and bind. */
  readonly manifest: CompletionManifest;
  readonly message?: string;
  readonly taskIds?: readonly string[];
  readonly requirementPool?: readonly RequirementPoolCommit[];
}

export interface PreparedSettlement {
  readonly operationRowId: string;
  readonly operationId: string;
  readonly repoRoot: string;
  readonly manifest: CompletionManifest;
  readonly manifestHash: string;
  readonly targetRevision: string;
  /** `git rev-parse <targetRevision>^{tree}` — the Git tree OID. */
  readonly commitTree: string;
  /** The SHA256 code tree of `targetRevision` (`data.md` §3 `codeTree`). */
  readonly codeTreeHash: string;
  readonly casRequest: CasRequest;
}

export type PrepareSettlementResult =
  | { readonly ok: true; readonly prepared: PreparedSettlement }
  | {
      readonly ok: false;
      readonly code: ProtocolErrorCode;
      readonly message: string;
      readonly reasons: readonly string[];
    };

export type SettlementOutcome =
  | {
      readonly ok: true;
      readonly state: 'completed';
      readonly operationId: string;
      readonly operationRowId: string;
      readonly revision: string;
      /**
       * Git tree OID of `revision` (`git rev-parse <revision>^{tree}`).
       *
       * `W8R1-08`: this is deliberately **not** the same value as `codeTreeHash` —
       * an OID names a Git object, while the contract's `codeTree` is a SHA256 over
       * the recursive listing. The two used to share the single `tree` field, so the
       * direct `settle` path and the crash-`recover` path reported different things
       * under one name.
       */
      readonly commitTree: string;
      /** SHA256 code tree of `revision` (`data.md` §3 `codeTree`). */
      readonly codeTreeHash: string;
      readonly manifestId: string;
      readonly manifestHash: string;
      /** `true` when this call created no commit (the documented reuse). */
      readonly reusedCommit: boolean;
      readonly refUpdated: boolean;
      /** `true` when this call appended the one completion event. */
      readonly emittedEvent: boolean;
      readonly completionEventCursor: number;
      readonly workCompleted: boolean;
      readonly requirementCompleted: boolean;
    }
  | {
      readonly ok: false;
      readonly code: ProtocolErrorCode;
      readonly message: string;
      readonly reasons: readonly string[];
      readonly branchUntouched: boolean;
      readonly operationId: string;
    };

interface SettlementOperationState {
  readonly operationRowId: string;
  readonly operationId: string;
  readonly repoRoot: string;
  readonly ref: string;
  readonly expectedRevision: string;
  readonly targetRevision: string;
  readonly commitTree: string;
  readonly codeTreeHash: string;
  readonly manifestHash: string;
  readonly manifestId: string;
  readonly workId: string;
  readonly requirementId: string | null;
  readonly state: string;
}

/** What `finish` needs to complete a settlement, from either path. */
interface SettlementFinishInput {
  readonly operationRowId: string;
  readonly operationId: string;
  readonly manifest: CompletionManifest;
  readonly manifestHash: string;
  readonly revision: string;
  readonly commitTree: string;
  readonly codeTreeHash: string;
  readonly reusedCommit: boolean;
  readonly refUpdated: boolean;
}

/**
 * The settlement step of `reliability.md` §4 steps 5–9.
 *
 * `prepareSettlement` persists the intent (ref, expected revision, commit, frozen
 * manifest) before anything moves; `settle` then runs the CAS; `recover` finishes
 * an operation whose ref already moved (`AC-063`).
 */
export class SettlementService {
  private readonly store: ProjectStore;
  private readonly worktrees: WorktreeGitPort;
  private readonly cas: CasService;
  private readonly journal: CasJournal;
  private readonly snapshots: SnapshotWriter;
  private readonly now: () => string;

  constructor(options: SettlementServiceOptions) {
    this.store = options.store;
    this.worktrees = options.worktrees;
    this.cas = options.cas;
    this.journal = options.journal;
    this.snapshots = options.snapshots;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** The repo root of a Work's Project, or a typed refusal. */
  private repoRoot(): string {
    const project = this.store.projects.find(this.store.projectId);
    if (project === undefined) fail('INVALID_STATE', `Project ${this.store.projectId} 不存在`);
    return project.gitRoot ?? project.root;
  }

  /**
   * Freezes the final manifest and writes the durable settlement intent.
   *
   * The operation row is the recovery anchor: it names the ref, the expected and
   * target revisions, the manifest and its hash, so a crash after the ref update
   * can be finished without creating a second commit or a second event.
   */
  prepareSettlement(request: SettleRequest): PrepareSettlementResult {
    const repoRoot = this.repoRoot();
    if (request.operationId.trim() === '') {
      return this.refusal('VALIDATION_ERROR', '结算需要 operationId', ['缺少幂等键']);
    }
    if (!request.ref.startsWith('refs/')) {
      return this.refusal('VALIDATION_ERROR', `ref 必须是完整 ref 名：${request.ref}`, []);
    }
    if (request.manifest.workId !== request.workId) {
      return this.refusal('VALIDATION_ERROR', 'CompletionManifest 的 workId 与请求不一致', []);
    }
    const existing = this.operationState(request.operationId);
    if (existing !== null) {
      // A legacy row that predates the field split has no `commitTree`; derive it so
      // the CAS still receives a real Git tree OID (`W8R1-08`).
      let commitTree = existing.commitTree;
      if (commitTree === '') {
        const derived = this.worktrees.mergeTree(repoRoot, existing.targetRevision);
        commitTree = derived.ok && derived.value !== null ? derived.value : '';
      }
      return {
        ok: true,
        prepared: {
          operationRowId: existing.operationRowId,
          operationId: existing.operationId,
          repoRoot: existing.repoRoot,
          manifest: request.manifest,
          manifestHash: existing.manifestHash,
          targetRevision: existing.targetRevision,
          commitTree,
          codeTreeHash: existing.codeTreeHash,
          casRequest: this.casRequest(request, commitTree),
        },
      };
    }
    const frozen = freezeFinalManifest({ snapshots: this.snapshots, manifest: request.manifest });
    // `codeTreeHash` is the contract's SHA256 code tree (`data.md` §3), derived from
    // the candidate when the caller did not measure it itself. `commitTree` is the
    // Git tree OID the CAS journals and the event records — a different identifier
    // that must never be reported under the same name (`W8R1-08`).
    let codeTreeHash = request.candidateTree;
    if (codeTreeHash === undefined) {
      try {
        codeTreeHash = deliveredCodeTreeHash({ repoRoot, revision: request.candidateRevision });
      } catch (error) {
        return this.refusal(
          'INTERNAL_ERROR',
          `无法读取候选提交 ${request.candidateRevision} 的代码树：${error instanceof Error ? error.message : String(error)}`,
          [],
        );
      }
    }
    if (!HASH.test(codeTreeHash)) {
      return this.refusal(
        'VALIDATION_ERROR',
        `candidateTree 必须是 SHA256 代码树 Hash：${codeTreeHash}`,
        [],
      );
    }
    const commitTreeResult = this.worktrees.mergeTree(repoRoot, request.candidateRevision);
    const commitTree = commitTreeResult.ok ? commitTreeResult.value : null;
    if (commitTree === null) {
      return this.refusal(
        'INTERNAL_ERROR',
        `无法读取候选提交 ${request.candidateRevision} 的 Git tree OID`,
        [],
      );
    }
    const operationRowId = this.store.newId();
    const stepResults: JsonObject = {
      operationId: request.operationId,
      ref: request.ref,
      expectedRevision: request.expectedRevision,
      targetRevision: request.candidateRevision,
      commitTree,
      codeTree: codeTreeHash,
      manifestHash: frozen.hash,
      manifestId: request.manifest.settlementResultRef,
      workId: request.workId,
      requirementId: request.requirementId ?? null,
    };
    this.store.operations.insert({
      id: operationRowId,
      projectId: this.store.projectId,
      workId: request.workId,
      ...(request.requirementId === undefined ? {} : { requirementId: request.requirementId }),
      sourceRef: { kind: 'action', id: request.operationId, version: '1' },
      kind: SETTLEMENT_OPERATION_KIND,
      state: 'running',
      expectedHead: request.expectedRevision,
      candidateRevision: request.candidateRevision,
      stepResults,
      createdAt: this.now(),
      updatedAt: this.now(),
    });
    return {
      ok: true,
      prepared: {
        operationRowId,
        operationId: request.operationId,
        repoRoot,
        manifest: request.manifest,
        manifestHash: frozen.hash,
        targetRevision: request.candidateRevision,
        commitTree,
        codeTreeHash,
        casRequest: this.casRequest(request, commitTree),
      },
    };
  }

  /** Prepares, installs the candidate through the CAS and completes the state. */
  settle(request: SettleRequest): SettlementOutcome {
    const prepared = this.prepareSettlement(request);
    if (!prepared.ok) {
      return {
        ok: false,
        code: prepared.code,
        message: prepared.message,
        reasons: prepared.reasons,
        branchUntouched: true,
        operationId: request.operationId,
      };
    }
    const cas = this.cas.integrate(prepared.prepared.casRequest);
    if (!cas.ok) {
      // A CAS refusal may still be a recoverable partial: if the journal already
      // names a commit that is now the ref target, the operation only lacks state.
      const journal = this.journal.load(request.operationId);
      const current = this.refRevision(request.ref);
      if (journal?.targetRevision !== undefined && current === journal.targetRevision) {
        return this.recover(request.operationId);
      }
      this.store.operations.update(
        prepared.prepared.operationRowId,
        { state: 'failed', error: { code: cas.code, message: cas.message } },
        this.store.operations.find(prepared.prepared.operationRowId)?.version ?? 1,
      );
      return {
        ok: false,
        code: cas.code,
        message: cas.message,
        reasons: [cas.message],
        branchUntouched: cas.branchUntouched,
        operationId: request.operationId,
      };
    }
    return this.finish({
      operationRowId: prepared.prepared.operationRowId,
      operationId: prepared.prepared.operationId,
      manifest: prepared.prepared.manifest,
      manifestHash: prepared.prepared.manifestHash,
      revision: cas.targetRevision,
      // `cas.targetTree` is the Git tree OID (the CAS journals exactly that);
      // `codeTreeHash` is the SHA256 code tree measured at prepare time.
      commitTree: cas.targetTree,
      codeTreeHash: prepared.prepared.codeTreeHash,
      reusedCommit: cas.reused,
      refUpdated: cas.refUpdated,
    });
  }

  /**
   * Finishes a settlement whose ref may already have moved (`AC-063`).
   *
   * Reuses the commit named by the operation/CAS journal — it never creates a new
   * one — completes the missing database state, and emits the settlement
   * completion event exactly once.
   */
  recover(operationId: string): SettlementOutcome {
    const state = this.operationState(operationId);
    if (state === null) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `找不到 operationId ${operationId} 的结算记录`,
        reasons: ['没有可恢复的结算意图'],
        branchUntouched: true,
        operationId,
      };
    }
    const journal = this.journal.load(operationId);
    const targetRevision = journal?.targetRevision ?? state.targetRevision;
    const manifest = readFrozenFinalManifest(this.store, state.manifestHash);
    if (manifest === null) {
      return {
        ok: false,
        code: 'STALE_ARTIFACT',
        message: `结算缺少已冻结的 CompletionManifest ${state.manifestHash}，无法补齐完成状态`,
        reasons: ['frozen CompletionManifest 不存在'],
        branchUntouched: true,
        operationId,
      };
    }
    // Two distinct values, two distinct sources (`W8R1-08`): the Git tree OID (the
    // CAS journal's `targetTree`, or the persisted `commitTree`) and the SHA256 code
    // tree (the persisted `codeTree`, the manifest's `verifiedCodeTree`, or derived
    // from the revision when a legacy operation row predates the split).
    const repoRoot = this.repoRoot();
    let commitTree = state.commitTree !== '' ? state.commitTree : (journal?.targetTree ?? '');
    if (commitTree === '') {
      const derived = this.worktrees.mergeTree(repoRoot, targetRevision);
      commitTree = derived.ok && derived.value !== null ? derived.value : '';
    }
    let codeTreeHash = state.codeTreeHash;
    if (codeTreeHash === '') {
      try {
        codeTreeHash = deliveredCodeTreeHash({ repoRoot, revision: targetRevision });
      } catch {
        codeTreeHash = manifest.verifiedCodeTree;
      }
    }
    const finishInput = {
      operationRowId: state.operationRowId,
      operationId: state.operationId,
      manifest,
      manifestHash: state.manifestHash,
      revision: targetRevision,
      commitTree,
      codeTreeHash,
    };
    const actual = this.refRevision(state.ref);
    if (actual === targetRevision) {
      // The ref already points at the operation's own commit: reuse it.
      return this.finish({ ...finishInput, reusedCommit: true, refUpdated: false });
    }
    if (actual !== state.expectedRevision) {
      return {
        ok: false,
        code: 'VERSION_CONFLICT',
        message: `交付分支 ${state.ref} 当前为 ${actual ?? 'unborn'}，既不是本操作的 ${targetRevision} 也不是基线 ${state.expectedRevision}；拒绝恢复`,
        reasons: ['交付基线已改变'],
        branchUntouched: true,
        operationId,
      };
    }
    // The ref never moved: complete the operation by installing the commit that
    // already exists (the CAS never creates a second commit for a candidate). The CAS
    // takes the Git tree OID as its `candidateTree`.
    const cas = this.cas.integrate({
      operationId,
      kind: 'settle',
      repoRoot: state.repoRoot,
      ref: state.ref,
      expectedRevision: state.expectedRevision,
      candidateRevision: targetRevision,
      candidateTree: commitTree,
      message: `chore: settle Work ${state.workId}`,
      workId: state.workId,
      ...(state.requirementId === null ? {} : { requirementId: state.requirementId }),
    });
    if (!cas.ok) {
      return {
        ok: false,
        code: cas.code,
        message: cas.message,
        reasons: [cas.message],
        branchUntouched: cas.branchUntouched,
        operationId,
      };
    }
    return this.finish({
      ...finishInput,
      revision: cas.targetRevision,
      commitTree: cas.targetTree,
      reusedCommit: cas.reused,
      refUpdated: cas.refUpdated,
    });
  }

  /** Reads the persisted settlement intent for an operation, when one exists. */
  operationState(operationId: string): SettlementOperationState | null {
    const rows = this.store.operations.list({
      where: 'kind = ?',
      params: [SETTLEMENT_OPERATION_KIND],
      orderBy: 'created_at DESC',
      limit: 100,
    });
    for (const row of rows) {
      if (row.stepResults['operationId'] !== operationId) continue;
      const step = (key: string): string | null => {
        const value = row.stepResults[key];
        return typeof value === 'string' ? value : null;
      };
      const targetRevision = step('targetRevision');
      const manifestHash = step('manifestHash');
      if (targetRevision === null || manifestHash === null) continue;
      return {
        operationRowId: row.id,
        operationId,
        repoRoot: this.repoRoot(),
        ref: step('ref') ?? '',
        expectedRevision: step('expectedRevision') ?? row.expectedHead ?? '',
        targetRevision,
        commitTree: step('commitTree') ?? '',
        codeTreeHash: step('codeTree') ?? '',
        manifestHash,
        manifestId: step('manifestId') ?? '',
        workId: step('workId') ?? row.workId ?? '',
        requirementId: step('requirementId') ?? row.requirementId ?? null,
        state: row.state,
      };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** The CAS request for a settlement; `commitTree` is a Git tree OID, not a SHA256. */
  private casRequest(request: SettleRequest, commitTree: string): CasRequest {
    return {
      operationId: request.operationId,
      kind: 'settle',
      repoRoot: this.repoRoot(),
      ref: request.ref,
      expectedRevision: request.expectedRevision,
      candidateRevision: request.candidateRevision,
      candidateTree: commitTree,
      message: request.message ?? `chore: settle Work ${request.workId}`,
      ...(request.taskIds === undefined ? {} : { taskIds: request.taskIds }),
      ...(request.requirementPool === undefined
        ? {}
        : { requirementPool: request.requirementPool }),
      workId: request.workId,
      ...(request.requirementId === undefined ? {} : { requirementId: request.requirementId }),
    };
  }

  private finish(input: SettlementFinishInput): SettlementOutcome {
    return withTransaction(this.store.db, () => {
      const row = this.store.operations.find(input.operationRowId);
      const work = this.store.works.find(input.manifest.workId);
      let workCompleted = false;
      let workVersion = work?.version ?? 0;
      if (work !== undefined && canTransitionWork(work.status, 'completed')) {
        const updated = this.store.works.update(work.id, { status: 'completed' }, work.version);
        workCompleted = true;
        workVersion = updated.version;
      }
      let requirementCompleted = false;
      const requirementId = input.manifest.requirementId;
      if (requirementId !== undefined) {
        const requirement = this.store.requirements.find(requirementId);
        if (
          requirement !== undefined &&
          canTransitionRequirement(requirement.lifecycle, 'completed')
        ) {
          this.store.requirements.update(
            requirement.id,
            {
              lifecycle: 'completed',
              // `workflow.md` §5.1: `phase` is only meaningful for an *active*
              // Requirement, so completing it clears the phase in the same
              // transaction instead of leaving `lifecycle='completed' phase='settle'`
              // (W8R1-06). The repository turns an explicit `undefined` into SQL NULL.
              phase: undefined,
              // `finalManifestId` is an id, and the CompletionManifest is addressed
              // by its settlement-result id (the manifest itself is frozen by hash).
              finalManifestId: input.manifest.settlementResultRef,
            },
            requirement.version,
          );
          requirementCompleted = true;
        }
      }
      const existingEvent = this.completionEvent(input.operationId);
      let eventCursor = existingEvent?.cursor ?? 0;
      let emittedEvent = false;
      if (existingEvent === undefined) {
        const appended = this.store.events.append({
          name: SETTLEMENT_COMPLETED_EVENT,
          entityId: input.manifest.workId,
          entityVersion: workVersion,
          data: {
            operationId: input.operationId,
            workId: input.manifest.workId,
            requirementId: requirementId ?? null,
            revision: input.revision,
            // `W8R1-08`: the event records the two identifiers under their own names,
            // so a reader never has to guess which kind of "tree" it received.
            commitTree: input.commitTree,
            codeTreeHash: input.codeTreeHash,
            manifestHash: input.manifestHash,
            verifiedManifestIds: [...input.manifest.verifiedManifestIds],
            reusedCommit: input.reusedCommit,
            refUpdated: input.refUpdated,
            workCompleted,
            requirementCompleted,
          },
        });
        eventCursor = appended.cursor;
        emittedEvent = true;
      }
      if (row !== undefined && row.state !== 'completed') {
        this.store.operations.update(
          row.id,
          {
            state: 'completed',
            candidateRevision: input.revision,
            stepResults: {
              ...row.stepResults,
              targetRevision: input.revision,
              commitTree: input.commitTree,
              codeTree: input.codeTreeHash,
              manifestHash: input.manifestHash,
              completionEventId: String(eventCursor),
              reusedCommit: input.reusedCommit,
            },
          },
          row.version,
        );
      }
      return {
        ok: true,
        state: 'completed',
        operationId: input.operationId,
        operationRowId: input.operationRowId,
        revision: input.revision,
        commitTree: input.commitTree,
        codeTreeHash: input.codeTreeHash,
        manifestId: input.manifest.settlementResultRef,
        manifestHash: input.manifestHash,
        reusedCommit: input.reusedCommit,
        refUpdated: input.refUpdated,
        emittedEvent,
        completionEventCursor: eventCursor,
        workCompleted,
        requirementCompleted,
      };
    });
  }

  private completionEvent(operationId: string) {
    return scanEvents(this.store, { names: [SETTLEMENT_COMPLETED_EVENT] }).find(
      (event) => event.data['operationId'] === operationId,
    );
  }

  private refRevision(ref: string): string | null {
    const result = this.worktrees.resolveRevision(this.repoRoot(), ref);
    return result.ok ? result.value : null;
  }

  private refusal(
    code: ProtocolErrorCode,
    message: string,
    reasons: readonly string[],
  ): Extract<PrepareSettlementResult, { ok: false }> {
    return { ok: false, code, message, reasons: reasons.length === 0 ? [message] : reasons };
  }
}
