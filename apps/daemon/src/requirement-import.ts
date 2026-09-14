/**
 * First-open requirement-pool import (WP-12 T5.4).
 *
 * `protocol.md` §8 fixes the behaviour: "新Project首次open自动启动已知目录的需求导入，
 * 不要求Provider；导入结果在project snapshot中可见." `requirements.md` §? fixes the
 * branch rule — the delivery branch is where the durable pool lives
 * (`ARCHITECTURE.md` §4 `agentdev/main`) — and `data.md` §2 fixes the per-record
 * import rules (the local `project_id` is bound; the portable id/version are
 * preserved; a directory-format problem is a `REQUIREMENT_CONFLICT`, never a silent
 * overwrite).
 *
 * This module drives the **real** path — `git` at a real revision →
 * `readRequirementPoolAtRevision` → `RequirementProjection.import` — so a fresh
 * installation that clones the repository sees its history without a single seeded
 * row and without starting any Run (AC-087/AC-088/AC-089).
 */
import { readRequirementPoolAtRevision, RequirementProjection } from '@agentdev/core';
import type { ProjectStore } from '@agentdev/storage';
import type { WorktreeGitPort } from '@agentdev/workspace';

/** The branch whose committed requirement pool is the import source. */
export const DELIVERY_BRANCH = 'agentdev/main';

export interface RequirementImportConflict {
  readonly recordPath: string;
  readonly reason: string;
  readonly message: string;
  readonly requirementId?: string;
}

export interface RequirementImportRecord {
  readonly requirementId: string;
  readonly recordVersion: number;
  readonly recordHash: string;
  readonly verdict: string;
  readonly lifecycle: string | null;
}

export interface RequirementImportResult {
  /** The revision the pool was read from, or `null` when the project has no Git. */
  readonly revision: string | null;
  /** Which rule selected the revision (`branch`, `origin-branch`, `head`, `none`). */
  readonly source: 'branch' | 'origin-branch' | 'head' | 'none';
  readonly imported: readonly RequirementImportRecord[];
  readonly conflicts: readonly RequirementImportConflict[];
  /** `true` when any record conflicted; valid records are imported regardless. */
  readonly writeBlocked: boolean;
  /** Convenience count for the project snapshot. */
  readonly total: number;
}

/**
 * Resolves the revision to import from (`requirements.md`: the delivery branch).
 *
 * Order: the local `agentdev/main`, then `origin/agentdev/main` (a fresh clone has
 * only the remote-tracking ref until it is checked out), then the current HEAD so a
 * repository that never used the delivery branch still imports what it has.
 */
export function resolveImportRevision(
  git: WorktreeGitPort,
  repoRoot: string,
  branch: string = DELIVERY_BRANCH,
): { revision: string | null; source: RequirementImportResult['source'] } {
  for (const [candidate, source] of [
    [branch, 'branch'],
    [`origin/${branch}`, 'origin-branch'],
  ] as const) {
    const resolved = git.resolveRevision(repoRoot, candidate);
    if (resolved.ok && resolved.value !== null) return { revision: resolved.value, source };
  }
  const head = git.headRevision(repoRoot);
  if (head.ok && head.value !== null) return { revision: head.value, source: 'head' };
  return { revision: null, source: 'none' };
}

/**
 * Imports the committed requirement pool of one revision into the local projection.
 *
 * No Provider, no Run and no seeded row: every imported requirement is a real
 * `RequirementProjection.import` of a record read out of Git, so `active` records
 * arrive as *imported history* that waits to continue rather than as new work
 * (`workflow.md`, AC-089).
 */
export function importRequirementsFromDelivery(input: {
  readonly store: ProjectStore;
  readonly repoRoot: string;
  readonly git: WorktreeGitPort;
  readonly branch?: string;
}): RequirementImportResult {
  const { revision, source } = resolveImportRevision(
    input.git,
    input.repoRoot,
    input.branch ?? DELIVERY_BRANCH,
  );
  if (revision === null) {
    return {
      revision: null,
      source: 'none',
      imported: [],
      conflicts: [],
      writeBlocked: false,
      total: 0,
    };
  }
  const pool = readRequirementPoolAtRevision({
    git: input.git,
    repoRoot: input.repoRoot,
    revision,
  });
  const projection = new RequirementProjection({ store: input.store });
  const imported: RequirementImportRecord[] = [];
  const conflicts: RequirementImportConflict[] = pool.conflicts.map((conflict) => ({
    recordPath: conflict.recordPath,
    reason: conflict.reason,
    message: conflict.message,
  }));
  for (const record of pool.records) {
    let metadata: unknown;
    try {
      metadata = JSON.parse(record.metadataJson);
    } catch (error) {
      conflicts.push({
        recordPath: record.recordPath,
        reason: 'invalid-metadata',
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
      conflicts.push({
        recordPath: record.recordPath,
        reason: 'invalid-metadata',
        message: 'requirement.json is not an object',
      });
      continue;
    }
    let outcome;
    try {
      outcome = projection.import({
        record: {
          ...(metadata as Record<string, unknown>),
          contentMarkdown: record.contentMarkdown,
        },
        rawMetadata: record.metadataJson,
        portableRef: { path: record.recordPath, revision },
        recordCommitted: true,
      });
    } catch (error) {
      // `protocol.md` §8: one unusable record is reported as a conflict and every other
      // valid record is still imported and queryable. An invalid record must never
      // abort the whole first-open import.
      conflicts.push({
        recordPath: record.recordPath,
        reason: 'REQUIREMENT_CONFLICT',
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (outcome.verdict === 'conflict') {
      conflicts.push({
        recordPath: record.recordPath,
        reason: 'REQUIREMENT_CONFLICT',
        message: outcome.conflict.reason,
        requirementId: outcome.conflict.requirementId,
      });
      continue;
    }
    imported.push({
      requirementId: outcome.requirementId,
      recordVersion: outcome.recordVersion,
      recordHash: outcome.recordHash,
      verdict: outcome.verdict,
      lifecycle: outcome.row?.lifecycle ?? null,
    });
  }
  return {
    revision,
    source,
    imported,
    conflicts,
    // `protocol.md` §8: an unresolved conflict blocks writes to that record only; the
    // caller sees the fact instead of a silent partial success.
    writeBlocked: conflicts.length > 0,
    total: pool.records.length,
  };
}
