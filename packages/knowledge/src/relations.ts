/**
 * Relation and source-ref resolution (`docs/architecture/context.md` §2/§3).
 *
 * `来源ref必须可解析为Git路径、Decision或Artifact` and
 * `断链为诊断，影响当前需求则阻断相关交付` — resolution never guesses. Every
 * reference form the Feature format allows is resolved against frozen facts
 * (tree listings, decision ids, artifact versions); anything unresolved becomes a
 * diagnostic, and only diagnostics that touch the current requirement set are
 * flagged as blocking.
 */
import type { ErrorCode } from '@agentdev/contracts';
import type { Feature } from './model.js';

/** The kinds a knowledge source ref can resolve to (`context.md` §2). */
export type SourceRefKind = 'git' | 'decision' | 'artifact' | 'requirement';

/**
 * Frozen facts a reference is resolved against. A caller freezes them with the
 * revision under analysis; nothing here is discovered lazily.
 */
export interface SourceResolutionContext {
  /**
   * Blob/directory listing per known full Git revision OID. A `git:<sha>:<path>`
   * ref needs both a known sha and a path present in that listing.
   */
  readonly trees?: ReadonlyMap<string, readonly string[]>;
  /**
   * Paths present in the frozen revision, used for bare repo-relative path refs
   * (the relation `source` column in `context.md` §2 is a plain path).
   */
  readonly currentPaths?: readonly string[];
  /** Decision ids that exist in the current Project scope. */
  readonly decisionIds?: readonly string[];
  /** Requirement ids whose Git record carries `confirmedDecisions`. */
  readonly requirementIds?: readonly string[];
  /** Known artifact ids mapped to their available versions. */
  readonly artifacts?: ReadonlyMap<string, readonly string[]>;
}

export interface SourceRefResolved {
  readonly ok: true;
  readonly kind: SourceRefKind;
  /** Revision OID, decision id, artifact id, requirement id or path. */
  readonly id: string;
  /** Artifact version or requirement record version, when the form carries one. */
  readonly version?: string;
  /** Repo-relative path, for git and bare-path refs. */
  readonly path?: string;
}

export interface SourceRefUnresolved {
  readonly ok: false;
  readonly code: ErrorCode;
  readonly reason: string;
}

/**
 * Result of resolving one source ref. Malformed forms are `KNOWLEDGE_INVALID`,
 * a missing git revision/path or decision is `NOT_FOUND`, and an unknown
 * artifact/version is `ARTIFACT_MISSING`.
 */
export type SourceRefResolution = SourceRefResolved | SourceRefUnresolved;

function unresolved(code: ErrorCode, reason: string): SourceRefUnresolved {
  return { ok: false, code, reason };
}

function treeContains(tree: readonly string[], path: string): boolean {
  const normalized = path.replace(/^\.\//u, '');
  if (normalized === '') return false;
  return tree.some((entry) => entry === normalized || entry.startsWith(`${normalized}/`));
}

/**
 * Resolves one source ref:
 *
 * - `git:<sha>:<path>` — sha must be a known revision and the path must exist in
 *   that revision's listing (a listed directory also counts);
 * - `decision:<id>` — the Decision must exist in the current scope;
 * - `artifact:<id>@<version>` — the id and version must be known;
 * - `requirement:<id>` / `requirement:<id>@<version>` — a Git requirement record
 *   whose `confirmedDecisions` the Feature claims as its design source;
 * - a bare repo-relative path — must exist in the frozen revision listing.
 */
export function resolveSourceRef(ref: string, ctx: SourceResolutionContext): SourceRefResolution {
  const value = ref.trim();
  if (value === '') return unresolved('KNOWLEDGE_INVALID', 'empty source ref');
  if (value.includes('<') || value.includes('>')) {
    return unresolved('KNOWLEDGE_INVALID', `placeholder source ref: ${value}`);
  }

  if (value.startsWith('git:')) {
    const rest = value.slice(4);
    const separator = rest.indexOf(':');
    const sha = separator === -1 ? rest : rest.slice(0, separator);
    const path = separator === -1 ? '' : rest.slice(separator + 1);
    if (sha === '' || path === '') {
      return unresolved('KNOWLEDGE_INVALID', `git ref must be git:<sha>:<path>: ${value}`);
    }
    const tree = ctx.trees?.get(sha);
    if (tree === undefined) return unresolved('NOT_FOUND', `unknown git revision: ${sha}`);
    if (!treeContains(tree, path)) {
      return unresolved('NOT_FOUND', `path ${path} is not in revision ${sha}`);
    }
    return { ok: true, kind: 'git', id: sha, path };
  }

  const decision = /^decision:(.*)$/u.exec(value);
  if (decision !== null) {
    const id = (decision[1] ?? '').trim();
    if (id === '') return unresolved('KNOWLEDGE_INVALID', `decision ref needs an id: ${value}`);
    if (!(ctx.decisionIds ?? []).includes(id)) {
      return unresolved('NOT_FOUND', `unknown decision: ${id}`);
    }
    return { ok: true, kind: 'decision', id };
  }

  const artifact = /^artifact:([^@\s]+)@(.+)$/u.exec(value);
  if (artifact !== null) {
    const id = artifact[1] ?? '';
    const version = (artifact[2] ?? '').trim();
    const versions = ctx.artifacts?.get(id);
    if (versions === undefined) return unresolved('ARTIFACT_MISSING', `unknown artifact: ${id}`);
    if (!versions.includes(version)) {
      return unresolved('ARTIFACT_MISSING', `artifact ${id} has no version ${version}`);
    }
    return { ok: true, kind: 'artifact', id, version };
  }
  if (value.startsWith('artifact:')) {
    return unresolved(
      'KNOWLEDGE_INVALID',
      `artifact ref must be artifact:<id>@<version>: ${value}`,
    );
  }

  const requirement = /^requirement:([^@#\s]+)(?:[@#](.+))?$/u.exec(value);
  if (requirement !== null) {
    const id = requirement[1] ?? '';
    if (!(ctx.requirementIds ?? []).includes(id)) {
      return unresolved('NOT_FOUND', `unknown requirement record: ${id}`);
    }
    const version = (requirement[2] ?? '').trim();
    return version === ''
      ? { ok: true, kind: 'requirement', id }
      : { ok: true, kind: 'requirement', id, version };
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(value)) {
    return unresolved(
      'KNOWLEDGE_INVALID',
      `source ref kind must be git, decision or artifact: ${value}`,
    );
  }

  if (!treeContains(ctx.currentPaths ?? [], value)) {
    return unresolved('NOT_FOUND', `path ${value} is not in the frozen revision`);
  }
  return { ok: true, kind: 'git', id: value, path: value };
}

/**
 * One broken-link diagnostic. `blocksRequirement` is `true` only when the broken
 * link touches the feature ids the current requirement passes in; an unrelated
 * region may stay partially ready (`无关区域可以部分就绪`, context.md §2).
 */
export interface LinkDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly featureId: string;
  /** Field or section that carries the broken link. */
  readonly field: string;
  readonly message: string;
  readonly blocksRequirement: boolean;
  /** The offending reference, when the diagnostic is about one. */
  readonly ref?: string;
  /** The missing relation target, when the diagnostic is about a relation. */
  readonly targetFeatureId?: string;
}

export interface LinkDiagnosticsContext {
  /** Facts used to resolve every ref. */
  readonly sources: SourceResolutionContext;
  /**
   * Feature ids known to the projection beyond the diagnosed list (e.g. features
   * already validated in this revision). Used to decide whether a relation target
   * is really missing.
   */
  readonly knownFeatureIds?: readonly string[];
  /**
   * Feature ids the current requirement touches. Omitted means "no requirement in
   * scope", in which case nothing is marked blocking.
   */
  readonly currentRequirementFeatureIds?: readonly string[];
  /** The current requirement id, echoed into messages when present. */
  readonly requirementId?: string;
}

function isBlocking(
  requirementFeatureIds: ReadonlySet<string> | undefined,
  ...featureIds: readonly string[]
): boolean {
  if (requirementFeatureIds === undefined) return false;
  return featureIds.some((featureId) => requirementFeatureIds.has(featureId));
}

/**
 * Diagnoses broken links across a validated Feature set.
 *
 * Reported as `error`: unresolved relation targets, unresolved relation sources,
 * unresolved `design_decision_refs` / `verification_evidence_refs` / `source_refs`,
 * and an observed implementation (`design=unconfirmed`, `implementation=implemented`)
 * with no sources. Reported as `warning`: a confirmed design with no implementation
 * (a gap, not an error) and the observed-not-confirmed state itself.
 *
 * The input features must already have passed `parseFeatureDocument`; enum and
 * required-field violations are parse errors, not link diagnostics.
 */
export function diagnoseLinks(
  features: readonly Feature[],
  ctx: LinkDiagnosticsContext,
): readonly LinkDiagnostic[] {
  const knownFeatureIds = new Set<string>(ctx.knownFeatureIds ?? []);
  for (const feature of features) knownFeatureIds.add(feature.featureId);
  const requirementFeatureIds =
    ctx.currentRequirementFeatureIds === undefined
      ? undefined
      : new Set(ctx.currentRequirementFeatureIds);
  const requirementSuffix =
    ctx.requirementId === undefined ? '' : ` (requirement ${ctx.requirementId})`;
  const diagnostics: LinkDiagnostic[] = [];

  const checkRef = (feature: Feature, field: string, ref: string): void => {
    const resolution = resolveSourceRef(ref, ctx.sources);
    if (resolution.ok) return;
    diagnostics.push({
      severity: 'error',
      featureId: feature.featureId,
      field,
      message: `unresolved ${field} reference "${ref}": ${resolution.reason}${requirementSuffix}`,
      blocksRequirement: isBlocking(requirementFeatureIds, feature.featureId),
      ref,
    });
  };

  for (const feature of features) {
    for (const relation of feature.relations) {
      if (!knownFeatureIds.has(relation.targetFeatureId)) {
        diagnostics.push({
          severity: 'error',
          featureId: feature.featureId,
          field: 'relations.targetFeatureId',
          message: `unresolved relation target: ${relation.targetFeatureId}${requirementSuffix}`,
          blocksRequirement: isBlocking(
            requirementFeatureIds,
            feature.featureId,
            relation.targetFeatureId,
          ),
          ref: relation.targetFeatureId,
          targetFeatureId: relation.targetFeatureId,
        });
      }
      checkRef(feature, 'relations.source', relation.source);
    }
    for (const ref of feature.designDecisionRefs) checkRef(feature, 'designDecisionRefs', ref);
    for (const ref of feature.verificationEvidenceRefs) {
      checkRef(feature, 'verificationEvidenceRefs', ref);
    }
    for (const ref of feature.sourceRefs) checkRef(feature, 'sourceRefs', ref);
  }

  for (const feature of features) {
    if (feature.design === 'confirmed' && feature.implementation === 'absent') {
      diagnostics.push({
        severity: 'warning',
        featureId: feature.featureId,
        field: 'implementation',
        message:
          'design=confirmed but implementation=absent; recorded as a known gap, not an error',
        blocksRequirement: false,
      });
    }
    if (feature.design === 'unconfirmed' && feature.implementation === 'implemented') {
      if (feature.sourceRefs.length === 0) {
        diagnostics.push({
          severity: 'error',
          featureId: feature.featureId,
          field: 'sourceRefs',
          message: `observed implementation requires source_refs before it may be recorded${requirementSuffix}`,
          blocksRequirement: isBlocking(requirementFeatureIds, feature.featureId),
        });
      } else {
        diagnostics.push({
          severity: 'warning',
          featureId: feature.featureId,
          field: 'design',
          message:
            'implementation observed but design unconfirmed; recorded as observed, not confirmed',
          blocksRequirement: false,
        });
      }
    }
  }

  return diagnostics;
}
