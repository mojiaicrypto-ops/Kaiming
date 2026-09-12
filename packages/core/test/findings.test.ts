import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckStatus, Ref, Run, RunStatus, Scope } from '@agentdev/contracts';
import {
  BlobStore,
  ProjectStore as Store,
  projectIdFromRoot,
  type ProjectStore,
} from '@agentdev/storage';
import { scanEvents } from '../src/events.js';
import { ArtifactService, FindingService, StageGate, StoreSourceHashPort } from '../src/index.js';

/**
 * Finding lifecycle, the completion gate and the pause/resume/cancel controls over
 * a real SQLite ProjectStore (AC-017, AC-018, AC-019, AC-020, AC-021, AC-083).
 *
 * Every case drives the persisted state: a refusal must leave the store exactly as
 * it was, a closure must name a genuinely new verification Run, and a pause must be
 * observable as "nothing writes any more" rather than as a claim.
 */
const ROOT = '/tmp/agentdev-findings-root';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e01';
const OTHER_WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e02';
const REQUIREMENT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e30';
const REVIEW_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e10';
const OLD_REVIEW_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e11';
const FIX_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e12';
const NEW_REVIEW_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e13';
const NEW_TEST_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e14';
const CHIEF_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e15';
const CHILD_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e16';
const PAUSE_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e17';
const RECOVERY_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e18';
const BARE_TEST_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e19';
const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e40';
const FOREIGN_TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e41';
const PLAN_REF_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e42';
const TARGET_REF_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e43';
const MANIFEST_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e44';
const RISK_DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e50';
const PENDING_DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e51';
const FOREIGN_DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e52';
const PRODUCT_DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e53';
const REVISION = 'a'.repeat(40);
const HASH = 'b'.repeat(64);
const SNAPSHOT_ID = 'c'.repeat(64);
const CHECK_ENVIRONMENT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e70';
const CHECK_OUTPUT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e71';
const PATH = 'packages/core/src/findings.ts';

const BASE_TIME = Date.parse('2026-09-11T00:00:00.000Z');

function iso(offsetSeconds: number): string {
  return new Date(BASE_TIME + offsetSeconds * 1_000).toISOString();
}

function manifestRef(): Ref {
  return { id: MANIFEST_ID, version: 1, hash: HASH };
}

const SCOPE: Scope = {
  readPaths: [],
  writePaths: [PATH],
  operations: ['read', 'edit'],
  networkTargets: [],
};

describe('Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083)', () => {
  let dataDir: string;
  let store: ProjectStore;
  let projectId: string;
  let service: FindingService;
  let artifacts: ArtifactService;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-findings-'));
    store = Store.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    projectId = projectIdFromRoot(ROOT);
    store.projects.insert({
      id: projectId,
      root: ROOT,
      codeRoot: 'packages',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
    });
    const blobs = new BlobStore({ root: dataDir });
    let clock = BASE_TIME + 1_000_000;
    artifacts = new ArtifactService({
      store,
      blobs,
      now: () => {
        clock += 1_000;
        return clock;
      },
    });
    service = new FindingService({ store, artifacts, blobs });

    addWork(WORK_ID, 'L2', REQUIREMENT_ID);
    addWork(OTHER_WORK_ID, 'L2');

    store.requirements.insert({
      id: REQUIREMENT_ID,
      projectId,
      workId: WORK_ID,
      title: 'Ship the Finding lifecycle',
      goal: 'persist Findings and controls',
      lifecycle: 'active',
      phase: 'execute',
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      recordVersion: 1,
      portableRef: {
        path: `.agentdev/requirements/${REQUIREMENT_ID}`,
        revision: 'working-tree',
        hash: HASH,
      },
      executionAvailability: 'local',
      evidenceAvailability: 'full',
    });

    store.tasks.insert({
      id: TASK_ID,
      workId: WORK_ID,
      requirementId: REQUIREMENT_ID,
      planRef: { id: PLAN_REF_ID, version: 1, hash: HASH },
      role: 'backend',
      dependsOn: [],
      dependencyManifestRefs: [],
      scope: SCOPE,
      stage: 'review',
      acceptanceIds: ['AC-017', 'AC-018'],
    });
    store.tasks.insert({
      id: FOREIGN_TASK_ID,
      workId: OTHER_WORK_ID,
      planRef: { id: PLAN_REF_ID, version: 1, hash: HASH },
      role: 'backend',
      dependsOn: [],
      dependencyManifestRefs: [],
      scope: SCOPE,
      stage: 'review',
      acceptanceIds: [],
    });

    addRun({ id: CHIEF_RUN_ID, role: 'chief', status: 'running', createdAt: iso(0) });
    addRun({
      id: CHILD_RUN_ID,
      role: 'backend',
      status: 'running',
      createdAt: iso(0),
      parentRunId: CHIEF_RUN_ID,
    });
    addRun({
      id: PAUSE_RUN_ID,
      role: 'review',
      status: 'running',
      createdAt: iso(0),
      stage: 'Review',
      purpose: 'review',
    });
    addRun({
      id: REVIEW_RUN_ID,
      role: 'review',
      status: 'completed',
      createdAt: iso(0),
      stage: 'Review',
      purpose: 'review',
    });
    addRun({
      id: OLD_REVIEW_RUN_ID,
      role: 'review',
      status: 'completed',
      createdAt: iso(0),
      stage: 'Review',
      purpose: 'review',
    });
    addRun({
      id: FIX_RUN_ID,
      role: 'backend',
      status: 'completed',
      createdAt: iso(10),
      stage: 'Develop',
      purpose: 'implementation',
    });
    addRun({
      id: NEW_REVIEW_RUN_ID,
      role: 'review',
      status: 'completed',
      createdAt: iso(20),
      stage: 'Review',
      purpose: 'review',
    });
    addRun({
      id: NEW_TEST_RUN_ID,
      role: 'test',
      status: 'completed',
      createdAt: iso(30),
      stage: 'Test',
      purpose: 'test',
    });
    // A completed Test Run that recorded no CheckResult at all.
    addRun({
      id: BARE_TEST_RUN_ID,
      role: 'test',
      status: 'completed',
      createdAt: iso(40),
      stage: 'Test',
      purpose: 'test',
    });
    store.attempts.insert({
      id: ATTEMPT_ID,
      runId: PAUSE_RUN_ID,
      number: 1,
      status: 'running',
      ownerEpoch: 0,
    });

    store.decisions.insert({
      id: RISK_DECISION_ID,
      workId: WORK_ID,
      kind: 'risk',
      targetRef: { id: WORK_ID, version: 1, hash: HASH },
      choices: ['accept', 'reject'],
      state: 'accepted',
      choice: 'accept',
      actor: 'user',
      effectRefs: [],
    });
    store.decisions.insert({
      id: PENDING_DECISION_ID,
      workId: WORK_ID,
      kind: 'risk',
      targetRef: { id: WORK_ID, version: 1, hash: HASH },
      choices: ['accept', 'reject'],
      state: 'pending',
      actor: 'user',
      effectRefs: [],
    });
    store.decisions.insert({
      id: PRODUCT_DECISION_ID,
      workId: WORK_ID,
      kind: 'product',
      targetRef: { id: WORK_ID, version: 1, hash: HASH },
      choices: ['now', 'later', 'decline'],
      state: 'accepted',
      choice: 'now',
      actor: 'user',
      effectRefs: [],
    });
    store.decisions.insert({
      id: FOREIGN_DECISION_ID,
      workId: OTHER_WORK_ID,
      kind: 'risk',
      targetRef: { id: OTHER_WORK_ID, version: 1, hash: HASH },
      choices: ['accept', 'reject'],
      state: 'accepted',
      choice: 'accept',
      actor: 'user',
      effectRefs: [],
    });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function addWork(workId: string, level: 'L1' | 'L2', requirementId?: string): void {
    const budget = store.budgets.insert({
      projectId,
      workId,
      tokenLimit: 100_000,
      tokensUsed: 0,
      tokensReserved: 0,
      activeTimeLimit: 600,
      activeTimeUsed: 0,
      repairLimit: 3,
      repairUsed: 0,
      costKnown: true,
    });
    store.works.insert({
      id: workId,
      projectId,
      intent: 'delivery',
      purpose: 'deliver WP-06 T3',
      level,
      goal: 'findings and controls',
      scope: SCOPE,
      sourceRef: { kind: 'message', id: workId, version: '1' },
      status: 'running',
      blockerIds: [],
      baseRevision: REVISION,
      budgetId: budget.id,
      policyRevision: 1,
      ...(requirementId === undefined ? {} : { requirementId }),
    });
  }

  function addRun(input: {
    readonly id: string;
    readonly role: Run['role'];
    readonly status: RunStatus;
    readonly createdAt: string;
    readonly stage?: string;
    readonly purpose?: Run['purpose'];
    readonly parentRunId?: string;
    readonly taskId?: string;
  }): Run {
    return store.runs.insert({
      id: input.id,
      projectId,
      workId: WORK_ID,
      createdAt: input.createdAt,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      role: input.role,
      purpose: input.purpose ?? 'analysis',
      ...(input.parentRunId === undefined ? {} : { parentRunId: input.parentRunId }),
      stage: input.stage ?? 'Develop',
      status: input.status,
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: SNAPSHOT_ID,
      contextSnapshotId: SNAPSHOT_ID,
      dispatchSnapshotId: SNAPSHOT_ID,
      budgetAllocation: 1_000,
    });
  }

  function submitIntegrationFinding(): string {
    const result = service.submitFinding({
      reviewRunId: REVIEW_RUN_ID,
      target: {
        targetKind: 'integration',
        targetRef: { id: TARGET_REF_ID, version: 1, hash: HASH },
      },
      manifestRef: manifestRef(),
      finding: { description: 'the integration misses the new gate', severity: 'P1' },
    });
    if (!result.ok) throw new Error(`expected a Finding, got ${result.code}: ${result.message}`);
    return result.finding.id;
  }

  /**
   * The fix Run's own frozen evidence: the revision the fix was made against.
   *
   * `W6R1-01` binds every verifier to this revision, so a fix without one cannot
   * be verified at all.
   */
  function recordFixArtifact(runId: string, revision = REVISION): string {
    return artifacts.createAgent({
      run: { id: runId, workId: WORK_ID, role: 'backend' },
      kind: 'diff',
      mime: 'text/plain',
      bytes: Buffer.from('--- a\n+++ b\n+fixed\n'),
      sourceRevision: revision,
    }).id;
  }

  /** A Review Run's artifact, frozen against the revision it reviewed. */
  function recordReviewArtifact(runId: string, revision = REVISION): string {
    return artifacts.createAgent({
      run: { id: runId, workId: WORK_ID, role: 'review' },
      kind: 'review',
      mime: 'text/markdown',
      bytes: Buffer.from('# review of the post-fix revision\n'),
      sourceRevision: revision,
    }).id;
  }

  /**
   * A Test Run's persisted result.
   *
   * The artifact freezes the revision the Test ran against and the `stage_result`
   * carries the real `CheckResult`; completion and Finding closure both read this
   * evidence rather than a caller-asserted status (`W6R1-01`/`W6R1-02`).
   */
  function recordTestCheck(
    runId: string,
    input: {
      readonly status: CheckStatus;
      readonly revision?: string;
      readonly noEnvironment?: boolean;
      readonly uncovered?: readonly {
        readonly acceptanceId: string;
        readonly reason: string;
      }[];
    },
  ): void {
    artifacts.createAgent({
      run: { id: runId, workId: WORK_ID, role: 'test' },
      kind: 'test',
      mime: 'text/markdown',
      bytes: Buffer.from(`# test ${input.status}\n`),
      sourceRevision: input.revision ?? REVISION,
    });
    const attempt = store.attempts.insert({
      runId,
      number: store.attempts.count('run_id = ?', [runId]) + 1,
      status: 'running',
      ownerEpoch: 0,
    });
    store.stageResults.insert({
      runId,
      attemptId: attempt.id,
      status: input.status === 'passed' ? 'success' : 'failed',
      summary: `test ${input.status}`,
      artifactRefs: [],
      evidenceRefs: [],
      changedPaths: [],
      findingIds: [],
      unknowns: [],
      requestedActions: [],
      readLedgerSeq: 0,
      readLedgerHash: HASH,
      checkResult: {
        status: input.status,
        // `noEnvironment` models a CheckResult that recorded no environment at all
        // (the schema forbids an empty environment id, so the absence is structural).
        checks:
          input.noEnvironment === true
            ? []
            : [
                {
                  command: 'pnpm test:unit',
                  environmentRef: CHECK_ENVIRONMENT_ID,
                  acceptanceIds: [],
                  inputTree: HASH,
                  exitCode: input.status === 'passed' ? 0 : 1,
                  outputRef: CHECK_OUTPUT_ID,
                  result: input.status,
                },
              ],
        uncovered: [...(input.uncovered ?? [])],
      },
    });
  }

  // -------------------------------------------------------------------------
  // AC-083 / AC-017
  // -------------------------------------------------------------------------

  it('binds a task-less integration Finding and sends it straight back to development (AC-083, AC-017)', () => {
    const reviewArtifact = artifacts.createAgent({
      run: { id: REVIEW_RUN_ID, workId: WORK_ID, role: 'review' },
      kind: 'review',
      mime: 'text/markdown',
      bytes: Buffer.from('# review v1'),
    });
    const testArtifact = artifacts.createAgent({
      run: { id: NEW_TEST_RUN_ID, workId: WORK_ID, role: 'test' },
      kind: 'test',
      mime: 'text/markdown',
      bytes: Buffer.from('# test v1'),
    });

    const result = service.submitFinding({
      reviewRunId: REVIEW_RUN_ID,
      target: {
        targetKind: 'integration',
        targetRef: { id: TARGET_REF_ID, version: 1, hash: HASH },
      },
      manifestRef: manifestRef(),
      finding: {
        description: 'the integration misses the new gate',
        severity: 'P1',
        path: PATH,
        line: 42,
        evidenceRefs: [reviewArtifact.id],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // No task is required for an integration target, and none is fabricated.
    expect(result.finding.taskId).toBeUndefined();
    expect(result.finding.targetKind).toBe('integration');
    expect(result.finding.reviewRunId).toBe(REVIEW_RUN_ID);
    expect(result.finding.manifestId).toBe(MANIFEST_ID);
    expect(result.finding.state).toBe('open');
    expect(result.finding.blocking).toBe(true);
    expect(result.binding.manifestRef.hash).toBe(HASH);
    expect(result.binding.recordHash).toMatch(/^[0-9a-f]{64}$/);

    // AC-017: returning it to development invalidates the old Review/Test evidence
    // and requires a new independent Review and Test.
    expect(result.routing.transition).toBe('return_to_development');
    expect(result.routing.requiresNewReview).toBe(true);
    expect(result.routing.requiresNewTest).toBe(true);
    expect(result.invalidatedEvidenceRefs).toEqual(
      expect.arrayContaining([reviewArtifact.id, testArtifact.id]),
    );
    expect(store.artifacts.find(reviewArtifact.id)?.validity).toBe('invalid');
    expect(store.artifacts.find(testArtifact.id)?.validity).toBe('invalid');
    expect(store.artifacts.find(reviewArtifact.id)?.invalidReason).toContain(result.finding.id);

    // The affected task goes back to development too.
    expect(result.returnedTaskIds).toEqual([TASK_ID]);
    expect(store.tasks.list({ where: 'work_id = ?', params: [WORK_ID] })[0]?.stage).toBe('develop');

    // Binding evidence is frozen, and the event trail names the transition.
    const snapshots = store.db
      .prepare("SELECT COUNT(*) AS n FROM snapshot WHERE type = 'verification'")
      .get() as { n: number };
    expect(snapshots.n).toBeGreaterThan(0);
    const created = scanEvents(store, { names: ['finding.created'] });
    expect(created).toHaveLength(1);
    expect(created[0]?.data['invalidatedEvidenceRefs']).toEqual(
      expect.arrayContaining([reviewArtifact.id, testArtifact.id]),
    );
  });

  it('refuses a task target without a taskId, a foreign task and a developer Run, writing nothing (AC-083)', () => {
    const port = new StoreSourceHashPort({ store });
    const before = port.snapshot(WORK_ID);

    const missingTask = service.submitFinding({
      reviewRunId: REVIEW_RUN_ID,
      target: { targetKind: 'task', targetRef: { id: TARGET_REF_ID, version: 1, hash: HASH } },
      manifestRef: manifestRef(),
      finding: { description: 'no task bound', severity: 'P2' },
    });
    expect(missingTask.ok).toBe(false);
    if (missingTask.ok) throw new Error('unreachable');
    expect(missingTask.code).toBe('VALIDATION_ERROR');

    const foreignTask = service.submitFinding({
      reviewRunId: REVIEW_RUN_ID,
      target: { targetKind: 'task', targetRef: { id: TARGET_REF_ID, version: 1, hash: HASH } },
      manifestRef: manifestRef(),
      taskId: FOREIGN_TASK_ID,
      finding: { description: 'another Work task', severity: 'P2' },
    });
    expect(foreignTask.ok).toBe(false);
    if (foreignTask.ok) throw new Error('unreachable');
    expect(foreignTask.code).toBe('NOT_AUTHORIZED');

    const developerRun = service.submitFinding({
      reviewRunId: FIX_RUN_ID,
      target: {
        targetKind: 'integration',
        targetRef: { id: TARGET_REF_ID, version: 1, hash: HASH },
      },
      manifestRef: manifestRef(),
      finding: { description: 'self-filed', severity: 'P1' },
    });
    expect(developerRun.ok).toBe(false);
    if (developerRun.ok) throw new Error('unreachable');
    expect(developerRun.code).toBe('NOT_AUTHORIZED');

    const after = port.snapshot(WORK_ID);
    expect(after.digest).toBe(before.digest);
    expect(store.findings.count()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // AC-018
  // -------------------------------------------------------------------------

  it('closes a fixed Finding only after a new independent Review and Test, and refuses a developer self-verify (AC-018)', () => {
    const findingId = submitIntegrationFinding();
    const fixArtifactId = recordFixArtifact(FIX_RUN_ID);
    recordReviewArtifact(NEW_REVIEW_RUN_ID);
    recordTestCheck(NEW_TEST_RUN_ID, { status: 'passed' });

    // Open: nothing may close it yet.
    const early = service.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: NEW_REVIEW_RUN_ID },
      testRun: { runId: NEW_TEST_RUN_ID },
    });
    expect(early.ok).toBe(false);
    if (early.ok) throw new Error('unreachable');
    expect(early.code).toBe('INVALID_STATE');

    // The developer records the fix; only an implementation role may do that.
    const wrongActor = service.markAddressed({
      findingId,
      actorRole: 'review',
      fixRunId: FIX_RUN_ID,
    });
    expect(wrongActor.ok).toBe(false);
    if (wrongActor.ok) throw new Error('unreachable');
    expect(wrongActor.code).toBe('NOT_AUTHORIZED');

    const addressed = service.markAddressed({
      findingId,
      actorRole: 'backend',
      fixRunId: FIX_RUN_ID,
    });
    expect(addressed.ok).toBe(true);
    if (!addressed.ok) throw new Error('unreachable');
    expect(addressed.finding.state).toBe('addressed');
    expect(addressed.finding.resolutionRef).toBe(FIX_RUN_ID);
    expect(store.artifacts.find(fixArtifactId)?.sourceRevision).toBe(REVISION);

    // The developer that fixed it cannot verify it, even with real Runs in hand.
    const selfVerify = service.verifyFinding({
      findingId,
      actorRole: 'backend',
      reviewRun: { runId: NEW_REVIEW_RUN_ID },
      testRun: { runId: NEW_TEST_RUN_ID },
    });
    expect(selfVerify.ok).toBe(false);
    if (selfVerify.ok) throw new Error('unreachable');
    expect(selfVerify.code).toBe('NOT_AUTHORIZED');
    expect(store.findings.find(findingId)?.state).toBe('addressed');

    // A Review alone is not enough: the fix needs a new Test as well.
    const reviewOnly = service.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: NEW_REVIEW_RUN_ID },
    });
    expect(reviewOnly.ok).toBe(false);
    if (reviewOnly.ok) throw new Error('unreachable');
    expect(reviewOnly.code).toBe('GATE_NOT_READY');
    expect(reviewOnly.requiresNewTest).toBe(true);
    expect(store.findings.find(findingId)?.state).toBe('addressed');

    // The new, independent Review plus Test close it.
    const closed = service.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: NEW_REVIEW_RUN_ID },
      testRun: { runId: NEW_TEST_RUN_ID },
    });
    expect(closed.ok).toBe(true);
    if (!closed.ok) throw new Error('unreachable');
    expect(closed.state).toBe('verified');
    expect(closed.reviewRunId).toBe(NEW_REVIEW_RUN_ID);
    expect(store.findings.find(findingId)?.state).toBe('verified');
    expect(scanEvents(store, { names: ['finding.verified'] })).toHaveLength(1);

    // A verified Finding is terminal.
    const again = service.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: NEW_REVIEW_RUN_ID },
      testRun: { runId: NEW_TEST_RUN_ID },
    });
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error('unreachable');
    expect(again.code).toBe('INVALID_STATE');
  });

  it('refuses a pre-fix revision and a non-passed Test conclusion even when the Runs are new (AC-018, W6R1-01/W6R1-08)', () => {
    const findingId = submitIntegrationFinding();
    // The fix froze REVISION; the verifying Runs exist and are created after it.
    recordFixArtifact(FIX_RUN_ID);
    expect(
      service.markAddressed({ findingId, actorRole: 'backend', fixRunId: FIX_RUN_ID }).ok,
    ).toBe(true);

    // A new Review whose own evidence is the pre-fix revision cannot verify, even
    // though the Run itself is new and independent by identity/order.
    recordReviewArtifact(NEW_REVIEW_RUN_ID, 'OLDREVISION'.padEnd(40, '0'));
    recordTestCheck(NEW_TEST_RUN_ID, { status: 'passed' });
    const preFixRevision = service.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: NEW_REVIEW_RUN_ID },
      testRun: { runId: NEW_TEST_RUN_ID },
    });
    expect(preFixRevision.ok).toBe(false);
    if (preFixRevision.ok) throw new Error('unreachable');
    expect(preFixRevision.code).toBe('GATE_NOT_READY');
    expect(store.findings.find(findingId)?.state).toBe('addressed');

    // A Test Run that completed with `failed` is not a passing Test: the old code
    // mapped `completed` to `passed` and closed the Finding anyway.
    recordReviewArtifact(NEW_REVIEW_RUN_ID);
    recordTestCheck(NEW_TEST_RUN_ID, { status: 'failed' });
    const failedTest = service.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: NEW_REVIEW_RUN_ID },
      testRun: { runId: NEW_TEST_RUN_ID },
    });
    expect(failedTest.ok).toBe(false);
    if (failedTest.ok) throw new Error('unreachable');
    expect(failedTest.code).toBe('GATE_NOT_READY');
    expect(scanEvents(store, { names: ['finding.verified'] })).toHaveLength(0);

    // A Test Run with no persisted CheckResult is never assumed to have passed.
    const noEvidenceTest = service.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: NEW_REVIEW_RUN_ID },
      testRun: { runId: BARE_TEST_RUN_ID },
    });
    expect(noEvidenceTest.ok).toBe(false);
    expect(store.findings.find(findingId)?.state).toBe('addressed');
  });

  it('refuses an old Review, the raising Review and a wrong-role Run as the fix verifier (AC-017, AC-018)', () => {
    const findingId = submitIntegrationFinding();
    recordFixArtifact(FIX_RUN_ID);
    expect(
      service.markAddressed({ findingId, actorRole: 'backend', fixRunId: FIX_RUN_ID }).ok,
    ).toBe(true);
    recordReviewArtifact(NEW_REVIEW_RUN_ID);
    recordTestCheck(NEW_TEST_RUN_ID, { status: 'passed' });

    // The Review that raised the Finding can never verify its own fix.
    const raisingReview = service.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: REVIEW_RUN_ID },
      testRun: { runId: NEW_TEST_RUN_ID },
    });
    expect(raisingReview.ok).toBe(false);
    if (raisingReview.ok) throw new Error('unreachable');
    expect(raisingReview.code).toBe('GATE_NOT_READY');

    // A Review created before the fix reviewed the pre-fix revision.
    const staleReview = service.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: OLD_REVIEW_RUN_ID },
      testRun: { runId: NEW_TEST_RUN_ID },
    });
    expect(staleReview.ok).toBe(false);
    if (staleReview.ok) throw new Error('unreachable');
    expect(staleReview.code).toBe('GATE_NOT_READY');

    // A Test Run cannot stand in for the Review role.
    const wrongRole = service.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: NEW_TEST_RUN_ID },
      testRun: { runId: NEW_TEST_RUN_ID },
    });
    expect(wrongRole.ok).toBe(false);
    if (wrongRole.ok) throw new Error('unreachable');
    expect(wrongRole.code).toBe('GATE_NOT_READY');

    expect(store.findings.find(findingId)?.state).toBe('addressed');

    // The genuinely new pair still closes it, so the refusals were not a blanket block.
    const closed = service.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: NEW_REVIEW_RUN_ID },
      testRun: { runId: NEW_TEST_RUN_ID },
    });
    expect(closed.ok).toBe(true);
  });

  it('records a user-accepted residual risk only from a real accepted risk Decision (AC-018)', () => {
    const findingId = submitIntegrationFinding();
    const pending = service.acceptFindingRisk({ findingId, decisionId: PENDING_DECISION_ID });
    expect(pending.ok).toBe(false);
    if (pending.ok) throw new Error('unreachable');
    expect(pending.code).toBe('VALIDATION_ERROR');

    const wrongKind = service.acceptFindingRisk({ findingId, decisionId: PRODUCT_DECISION_ID });
    expect(wrongKind.ok).toBe(false);
    if (wrongKind.ok) throw new Error('unreachable');
    expect(wrongKind.code).toBe('VALIDATION_ERROR');

    const foreign = service.acceptFindingRisk({ findingId, decisionId: FOREIGN_DECISION_ID });
    expect(foreign.ok).toBe(false);
    if (foreign.ok) throw new Error('unreachable');
    expect(foreign.code).toBe('VALIDATION_ERROR');

    const accepted = service.acceptFindingRisk({ findingId, decisionId: RISK_DECISION_ID });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error('unreachable');
    expect(accepted.finding.state).toBe('accepted_risk');
    expect(accepted.decisionId).toBe(RISK_DECISION_ID);
  });

  // -------------------------------------------------------------------------
  // AC-019
  // -------------------------------------------------------------------------

  it('never completes on a blocked Test result and never on a caller-asserted one (AC-019, W6R1-02)', () => {
    recordTestCheck(NEW_TEST_RUN_ID, { status: 'blocked' });
    const port = new StoreSourceHashPort({ store });
    const before = port.snapshot(WORK_ID);

    const blocked = service.completeWork({ workId: WORK_ID, testRunId: NEW_TEST_RUN_ID });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) throw new Error('unreachable');
    expect(blocked.code).toBe('GATE_NOT_READY');
    expect(blocked.reasons.join(' ')).toContain('blocked');

    // No Test Run at all is a refusal, not an assumed pass.
    const missing = service.completeWork({ workId: WORK_ID });
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('unreachable');
    expect(missing.reasons.join(' ')).toContain('no Test Run');

    // A Test Run of another Work, or with a non-Test role, is refused too.
    const foreignRun = service.completeWork({ workId: WORK_ID, testRunId: CHILD_RUN_ID });
    expect(foreignRun.ok).toBe(false);
    if (foreignRun.ok) throw new Error('unreachable');
    expect(foreignRun.code).toBe('GATE_NOT_READY');
    expect(foreignRun.reasons.join(' ')).toContain('Test Run');

    // A completed Test Run with no persisted CheckResult is not evidence either.
    const noEvidence = service.completeWork({ workId: WORK_ID, testRunId: BARE_TEST_RUN_ID });
    expect(noEvidence.ok).toBe(false);
    if (noEvidence.ok) throw new Error('unreachable');
    expect(noEvidence.code).toBe('GATE_NOT_READY');
    expect(noEvidence.reasons.join(' ')).toContain('CheckResult');

    expect(store.works.find(WORK_ID)?.status).toBe('running');
    expect(scanEvents(store, { names: ['delivery.work_completed'] })).toHaveLength(0);
    const after = port.snapshot(WORK_ID);
    expect(after.digest).toBe(before.digest);
  });

  it('refuses a Test evidence bound to another revision or without an environment (AC-019, W6R1-02)', () => {
    // The Work revision is REVISION; this Test evidence froze a different one.
    recordTestCheck(NEW_TEST_RUN_ID, { status: 'passed', revision: 'e'.repeat(40) });
    const foreignRevision = service.completeWork({ workId: WORK_ID, testRunId: NEW_TEST_RUN_ID });
    expect(foreignRevision.ok).toBe(false);
    if (foreignRevision.ok) throw new Error('unreachable');
    expect(foreignRevision.code).toBe('GATE_NOT_READY');
    expect(foreignRevision.reasons.join(' ')).toContain('revision');

    // A Test that names no verification environment cannot carry the completion.
    recordTestCheck(NEW_TEST_RUN_ID, { status: 'passed', noEnvironment: true });
    const noEnvironment = service.completeWork({ workId: WORK_ID, testRunId: NEW_TEST_RUN_ID });
    expect(noEnvironment.ok).toBe(false);
    if (noEnvironment.ok) throw new Error('unreachable');
    expect(noEnvironment.code).toBe('GATE_NOT_READY');
    expect(noEnvironment.reasons.join(' ')).toContain('environment');

    expect(store.works.find(WORK_ID)?.status).toBe('running');
  });

  it('requires an explicit risk disposition for every not_covered acceptance id (AC-019)', () => {
    const uncovered = [{ acceptanceId: 'AC-019', reason: 'the fixture has no live provider' }];
    // The Test result is persisted now; the dispositions below are what varies.
    recordTestCheck(NEW_TEST_RUN_ID, { status: 'not_covered', uncovered });

    const undisposed = service.completeWork({
      workId: WORK_ID,
      testRunId: NEW_TEST_RUN_ID,
    });
    expect(undisposed.ok).toBe(false);
    if (undisposed.ok) throw new Error('unreachable');
    expect(undisposed.code).toBe('GATE_NOT_READY');
    expect(undisposed.needsRiskDisposition).toEqual(['AC-019']);
    expect(store.works.find(WORK_ID)?.status).toBe('running');

    const pending = service.completeWork({
      workId: WORK_ID,
      testRunId: NEW_TEST_RUN_ID,
      riskDispositions: [{ acceptanceId: 'AC-019', decisionId: PENDING_DECISION_ID }],
    });
    expect(pending.ok).toBe(false);
    if (pending.ok) throw new Error('unreachable');
    expect(pending.code).toBe('VALIDATION_ERROR');
    expect(pending.needsRiskDisposition).toEqual(['AC-019']);

    const unmatched = service.completeWork({
      workId: WORK_ID,
      testRunId: NEW_TEST_RUN_ID,
      riskDispositions: [{ acceptanceId: 'AC-999', decisionId: RISK_DECISION_ID }],
    });
    expect(unmatched.ok).toBe(false);
    if (unmatched.ok) throw new Error('unreachable');
    expect(unmatched.code).toBe('VALIDATION_ERROR');

    const disposed = service.completeWork({
      workId: WORK_ID,
      testRunId: NEW_TEST_RUN_ID,
      riskDispositions: [{ acceptanceId: 'AC-019', decisionId: RISK_DECISION_ID }],
    });
    expect(disposed.ok).toBe(true);
    if (!disposed.ok) throw new Error('unreachable');
    expect(disposed.riskDecisionIds).toEqual([RISK_DECISION_ID]);
    expect(disposed.testRunId).toBe(NEW_TEST_RUN_ID);
    expect(disposed.work.status).toBe('completed');
    expect(store.works.find(WORK_ID)?.status).toBe('completed');
    const completed = scanEvents(store, { names: ['delivery.work_completed'] });
    expect(completed).toHaveLength(1);
    expect(completed[0]?.data['riskDecisionIds']).toEqual([RISK_DECISION_ID]);
    expect(completed[0]?.data['testRunId']).toBe(NEW_TEST_RUN_ID);
    expect(completed[0]?.data['testStatus']).toBe('not_covered');
  });

  it('completes a passed Test result with no uncovered acceptance ids (AC-019)', () => {
    recordTestCheck(NEW_TEST_RUN_ID, { status: 'passed' });
    const result = service.completeWork({ workId: WORK_ID, testRunId: NEW_TEST_RUN_ID });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.testStatus).toBe('passed');
    expect(result.testRunId).toBe(NEW_TEST_RUN_ID);
    expect(store.works.find(WORK_ID)?.status).toBe('completed');
  });

  it('blocks completion while a blocking Finding is open or addressed (AC-017, AC-019)', () => {
    const findingId = submitIntegrationFinding();
    recordFixArtifact(FIX_RUN_ID);
    recordReviewArtifact(NEW_REVIEW_RUN_ID);
    recordTestCheck(NEW_TEST_RUN_ID, { status: 'passed' });

    const open = service.completeWork({ workId: WORK_ID, testRunId: NEW_TEST_RUN_ID });
    expect(open.ok).toBe(false);
    if (open.ok) throw new Error('unreachable');
    expect(open.code).toBe('GATE_NOT_READY');
    expect(open.reasons.join(' ')).toContain(findingId);
    expect(store.works.find(WORK_ID)?.status).toBe('running');

    expect(
      service.markAddressed({ findingId, actorRole: 'backend', fixRunId: FIX_RUN_ID }).ok,
    ).toBe(true);
    const addressed = service.completeWork({ workId: WORK_ID, testRunId: NEW_TEST_RUN_ID });
    expect(addressed.ok).toBe(false);

    const closed = service.verifyFinding({
      findingId,
      actorRole: 'review',
      reviewRun: { runId: NEW_REVIEW_RUN_ID },
      testRun: { runId: NEW_TEST_RUN_ID },
    });
    expect(closed.ok).toBe(true);
    const done = service.completeWork({ workId: WORK_ID, testRunId: NEW_TEST_RUN_ID });
    expect(done.ok).toBe(true);
    expect(store.works.find(WORK_ID)?.status).toBe('completed');
  });

  // -------------------------------------------------------------------------
  // AC-020
  // -------------------------------------------------------------------------

  it('pauses at a safe point, admits no write, and resumes into a new Attempt after the version check (AC-020)', () => {
    const paused = service.pauseWork({ workId: WORK_ID, reason: 'user paused' });
    expect(paused.ok).toBe(true);
    if (!paused.ok) throw new Error('unreachable');
    expect(paused.work.status).toBe('paused');
    expect(paused.previousStatus).toBe('running');
    expect(paused.barrierRef).toMatch(/^[0-9a-f]{64}$/);

    const pausedRun = paused.pausedRuns.find((entry) => entry.runId === PAUSE_RUN_ID);
    expect(pausedRun?.status).toBe('paused');
    expect(pausedRun?.stoppedAttemptIds).toEqual([ATTEMPT_ID]);
    expect(pausedRun?.checkpointRef).toMatch(/^[0-9a-f]{64}$/);
    expect(store.runs.find(PAUSE_RUN_ID)?.status).toBe('paused');
    expect(store.attempts.find(ATTEMPT_ID)?.status).toBe('stopped');
    expect(paused.attemptsClosed).toBeGreaterThanOrEqual(1);

    expect(service.writeAdmission(PAUSE_RUN_ID).admitted).toBe(false);
    expect(service.writeAdmission(PAUSE_RUN_ID).reason).toContain('paused');

    // AC-020's "no new write": a delivery against the paused Run is refused and the
    // measured store is byte-identical afterwards.
    const port = new StoreSourceHashPort({ store });
    const before = port.snapshot(WORK_ID);
    const stageResultsBefore = store.stageResults.count();
    const gate = new StageGate({ store });
    expect(() =>
      gate.submit({
        runId: PAUSE_RUN_ID,
        attemptId: ATTEMPT_ID,
        epoch: 0,
        payload: {
          status: 'success',
          summary: 'should never land',
          artifactRefs: [],
          evidenceRefs: [],
          changedPaths: [],
          findingIds: [],
          unknowns: [],
          requestedActions: [],
          readLedgerSeq: 0,
          readLedgerHash: HASH,
        },
      }),
    ).toThrowError();
    expect(store.stageResults.count()).toBe(stageResultsBefore);
    const after = port.snapshot(WORK_ID);
    expect(after.digest).toBe(before.digest);
    expect(after.storeCounts).toEqual(before.storeCounts);

    // The version check refuses a stale resume and opens no Attempt.
    const stale = service.resumeWork({
      workId: WORK_ID,
      expectedWorkVersion: paused.work.version + 1,
    });
    expect(stale.ok).toBe(false);
    if (stale.ok) throw new Error('unreachable');
    expect(stale.code).toBe('VERSION_CONFLICT');
    expect(stale.currentVersion).toBe(paused.work.version);
    expect(store.attempts.count('run_id = ?', [PAUSE_RUN_ID])).toBe(1);

    const staleTask = service.resumeWork({
      workId: WORK_ID,
      expectedWorkVersion: paused.work.version,
      expectedTaskVersions: { [TASK_ID]: 99 },
    });
    expect(staleTask.ok).toBe(false);
    if (staleTask.ok) throw new Error('unreachable');
    expect(staleTask.code).toBe('VERSION_CONFLICT');
    expect(store.attempts.count('run_id = ?', [PAUSE_RUN_ID])).toBe(1);

    const resumed = service.resumeWork({
      workId: WORK_ID,
      expectedWorkVersion: paused.work.version,
      expectedTaskVersions: {
        [TASK_ID]: store.tasks.find(TASK_ID)?.version ?? 1,
      },
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error('unreachable');
    expect(resumed.work.status).toBe('running');
    expect(resumed.barrierRef).toBe(paused.barrierRef);

    const opened = resumed.attempts.find((entry) => entry.runId === PAUSE_RUN_ID);
    expect(opened).toBeDefined();
    if (opened === undefined) throw new Error('unreachable');
    expect(opened.number).toBe(2);
    expect(store.attempts.find(opened.attemptId)?.number).toBe(2);
    expect(store.runs.find(PAUSE_RUN_ID)?.status).toBe('running');
    // W6R1-09: the resumed Attempt is only `starting`, so a write immediately after
    // resume is refused. It is admitted once the Runner confirms readiness.
    expect(store.attempts.find(opened.attemptId)?.status).toBe('starting');
    const beforeReady = service.writeAdmission(PAUSE_RUN_ID);
    expect(beforeReady.admitted).toBe(false);
    expect(beforeReady.reason).toContain('ready Attempt');
    const readyAttempt = store.attempts.find(opened.attemptId);
    if (readyAttempt === undefined) throw new Error('unreachable');
    store.attempts.update(opened.attemptId, { status: 'running' }, readyAttempt.version);
    expect(service.writeAdmission(PAUSE_RUN_ID).admitted).toBe(true);
    expect(scanEvents(store, { names: ['work.control_changed'] }).length).toBeGreaterThan(0);
  });

  it('refuses to resume a Work that changed while it was paused (AC-020)', () => {
    const paused = service.pauseWork({ workId: WORK_ID, reason: 'user paused' });
    expect(paused.ok).toBe(true);
    if (!paused.ok) throw new Error('unreachable');
    const current = store.works.find(WORK_ID);
    if (current === undefined) throw new Error('unreachable');
    store.works.update(WORK_ID, { goal: 'a different semantic baseline' }, current.version);

    const changed = store.works.find(WORK_ID);
    if (changed === undefined) throw new Error('unreachable');
    const resumed = service.resumeWork({
      workId: WORK_ID,
      expectedWorkVersion: changed.version,
    });
    expect(resumed.ok).toBe(false);
    if (resumed.ok) throw new Error('unreachable');
    expect(resumed.code).toBe('VERSION_CONFLICT');
    expect(resumed.message).toContain('changed while paused');
    expect(store.works.find(WORK_ID)?.status).toBe('paused');
  });

  it('refuses to pause while a Run still needs recovery (AC-020)', () => {
    addRun({
      id: RECOVERY_RUN_ID,
      role: 'backend',
      status: 'recovery_required',
      createdAt: iso(5),
      purpose: 'implementation',
    });
    const paused = service.pauseWork({ workId: WORK_ID, reason: 'user paused' });
    expect(paused.ok).toBe(false);
    if (paused.ok) throw new Error('unreachable');
    expect(paused.code).toBe('RECOVERY_REQUIRED');
    expect(paused.recoveryRunIds).toEqual([RECOVERY_RUN_ID]);
    expect(store.works.find(WORK_ID)?.status).toBe('running');
    expect(store.attempts.find(ATTEMPT_ID)?.status).toBe('running');
    expect(store.runs.find(PAUSE_RUN_ID)?.status).toBe('running');
  });

  it('refuses to resume while a Run still needs recovery (AC-020)', () => {
    const paused = service.pauseWork({ workId: WORK_ID, reason: 'user paused' });
    expect(paused.ok).toBe(true);
    if (!paused.ok) throw new Error('unreachable');

    // While the Work is paused the Run's side effects turn out to be unresolved.
    const current = store.runs.find(PAUSE_RUN_ID);
    if (current === undefined) throw new Error('unreachable');
    store.runs.update(PAUSE_RUN_ID, { status: 'recovery_required' }, current.version);

    const resumed = service.resumeWork({
      workId: WORK_ID,
      expectedWorkVersion: paused.work.version,
    });
    expect(resumed.ok).toBe(false);
    if (resumed.ok) throw new Error('unreachable');
    expect(resumed.code).toBe('RECOVERY_REQUIRED');
    expect(store.works.find(WORK_ID)?.status).toBe('paused');
  });

  it('refuses to pause a blocked Work, which recovers through its own path (AC-020)', () => {
    const current = store.works.find(WORK_ID);
    if (current === undefined) throw new Error('unreachable');
    store.works.update(WORK_ID, { status: 'blocked' }, current.version);

    const paused = service.pauseWork({ workId: WORK_ID });
    expect(paused.ok).toBe(false);
    if (paused.ok) throw new Error('unreachable');
    expect(paused.code).toBe('INVALID_STATE');
    expect(store.works.find(WORK_ID)?.status).toBe('blocked');
  });

  it('walks a queued Work to the pause safe point (AC-020)', () => {
    const current = store.works.find(WORK_ID);
    if (current === undefined) throw new Error('unreachable');
    store.works.update(WORK_ID, { status: 'queued' }, current.version);

    const paused = service.pauseWork({ workId: WORK_ID, reason: 'paused before admission' });
    expect(paused.ok).toBe(true);
    if (!paused.ok) throw new Error('unreachable');
    expect(paused.previousStatus).toBe('queued');
    expect(paused.work.status).toBe('paused');
  });

  // -------------------------------------------------------------------------
  // AC-021
  // -------------------------------------------------------------------------

  it('cancels the Run tree through cancelling to cancelled, keeping the artifacts un-integrated (AC-021)', () => {
    const diff = artifacts.createAgent({
      run: { id: CHIEF_RUN_ID, workId: WORK_ID, role: 'chief' },
      kind: 'diff',
      mime: 'text/plain',
      bytes: Buffer.from('candidate patch'),
    });

    const result = service.cancelWork({ workId: WORK_ID, reason: 'user cancelled' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.status).toBe('cancelled');
    expect(result.recoveryRequired).toBe(false);
    expect(result.integrated).toBe(false);
    expect(result.recoveryDecisionId).toBeNull();
    expect(result.cancelledRunIds).toEqual(
      expect.arrayContaining([CHIEF_RUN_ID, CHILD_RUN_ID, PAUSE_RUN_ID]),
    );
    expect(store.runs.find(CHIEF_RUN_ID)?.status).toBe('cancelled');
    expect(store.runs.find(CHILD_RUN_ID)?.status).toBe('cancelled');
    expect(store.runs.find(PAUSE_RUN_ID)?.status).toBe('cancelled');
    expect(result.stoppedAttemptIds).toContain(ATTEMPT_ID);
    expect(store.attempts.find(ATTEMPT_ID)?.status).toBe('stopped');

    // Cancelling precedes cancelled in the durable trail.
    const statuses = scanEvents(store, { names: ['work.control_changed'] })
      .filter((event) => event.data['workId'] === WORK_ID && event.data['control'] === 'cancel')
      .map((event) => (typeof event.data['status'] === 'string' ? event.data['status'] : ''));
    expect(statuses[0]).toBe('cancelling');
    expect(statuses.indexOf('cancelling')).toBeLessThan(statuses.indexOf('cancelled'));

    // The produced artifacts stay readable and valid; nothing was integrated.
    expect(result.preservedArtifactIds).toContain(diff.id);
    expect(store.artifacts.find(diff.id)?.validity).toBe('valid');
    expect(result.recordRef).toMatch(/^[0-9a-f]{64}$/);

    // The Requirement is cancelled with the Work.
    expect(result.requirementStatus).toBe('cancelled');
    expect(store.requirements.find(REQUIREMENT_ID)?.lifecycle).toBe('cancelled');
  });

  it('stops at blocked(recovery) when side effects are unknown and only then reaches cancelled (AC-021)', () => {
    const cancel = service.cancelWork({
      workId: WORK_ID,
      reason: 'user cancelled during a tool call',
      sideEffectsUnknown: true,
    });
    expect(cancel.ok).toBe(true);
    if (!cancel.ok) throw new Error('unreachable');
    expect(cancel.status).toBe('blocked');
    expect(cancel.recoveryRequired).toBe(true);
    expect(cancel.recoveryDecisionId).not.toBeNull();
    if (cancel.recoveryDecisionId === null) throw new Error('unreachable');

    const blocked = store.works.find(WORK_ID);
    expect(blocked?.status).toBe('blocked');
    expect(blocked?.blockerIds).toContain(cancel.recoveryDecisionId);
    // `reliability.md` §6: a Work waiting for recovery keeps its Requirement active.
    expect(store.requirements.find(REQUIREMENT_ID)?.lifecycle).toBe('active');
    expect(store.runs.find(CHIEF_RUN_ID)?.status).toBe('cancelled');

    const decision = store.decisions.find(cancel.recoveryDecisionId);
    expect(decision?.kind).toBe('recovery');
    expect(decision?.state).toBe('pending');
    expect(decision?.choices).toEqual(['resume', 'accept_cancel', 'abandon']);

    const resolved = service.resolveCancellation({
      workId: WORK_ID,
      decisionId: cancel.recoveryDecisionId,
      disposition: 'accept_cancel',
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) throw new Error('unreachable');
    expect(resolved.status).toBe('cancelled');
    expect(store.works.find(WORK_ID)?.status).toBe('cancelled');
    expect(store.works.find(WORK_ID)?.blockerIds).toEqual([]);
    expect(store.decisions.find(cancel.recoveryDecisionId)?.state).toBe('accepted');
    expect(store.decisions.find(cancel.recoveryDecisionId)?.choice).toBe('accept_cancel');
    expect(store.requirements.find(REQUIREMENT_ID)?.lifecycle).toBe('cancelled');
  });

  it('lets a recovery decision resume the Work instead of cancelling it (AC-021)', () => {
    const cancel = service.cancelWork({
      workId: WORK_ID,
      reason: 'unknown side effects',
      sideEffectsUnknown: true,
    });
    expect(cancel.ok).toBe(true);
    if (!cancel.ok) throw new Error('unreachable');
    if (cancel.recoveryDecisionId === null) throw new Error('unreachable');

    const resumed = service.resolveCancellation({
      workId: WORK_ID,
      decisionId: cancel.recoveryDecisionId,
      disposition: 'resume',
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error('unreachable');
    expect(resumed.status).toBe('running');
    expect(store.works.find(WORK_ID)?.blockerIds).toEqual([]);
    expect(store.requirements.find(REQUIREMENT_ID)?.lifecycle).toBe('active');
  });

  it('refuses to cancel a finished Work', () => {
    recordTestCheck(NEW_TEST_RUN_ID, { status: 'passed' });
    const completed = service.completeWork({ workId: WORK_ID, testRunId: NEW_TEST_RUN_ID });
    expect(completed.ok).toBe(true);
    const cancelled = service.cancelWork({ workId: WORK_ID });
    expect(cancelled.ok).toBe(false);
    if (cancelled.ok) throw new Error('unreachable');
    expect(cancelled.code).toBe('INVALID_STATE');
  });
});
