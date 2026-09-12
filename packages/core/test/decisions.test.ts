import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Artifact, PlanTask, Scope } from '@agentdev/contracts';
import {
  BlobStore,
  ProjectStore as Store,
  projectIdFromRoot,
  type ProjectStore,
} from '@agentdev/storage';
import { ArtifactService, DecisionService, PlanGateService, type PlanDraft } from '../src/index.js';
import { scanEvents } from '../src/events.js';

/**
 * Behaviour Decisions over a real SQLite ProjectStore (AC-015/016).
 *
 * The three branches are checked against persisted state: `now` bumps the
 * Product/Plan versions and invalidates the affected evidence, `later` queues a
 * Requirement, `decline` records a reason and leaves the acceptance alone.
 */
const ROOT = '/tmp/agentdev-decisions-root';
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e01';
const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e10';
const AUTHORIZATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e20';
const REQUIREMENT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e30';
const CONVERSATION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e40';
const OWNER_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e41';
const REVIEW_ARTIFACT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e50';
const TEST_ARTIFACT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e51';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e60';
const REVISION = 'c'.repeat(40);
const PATH = 'packages/core/src/decisions.ts';

const SCOPE: Scope = {
  readPaths: [],
  writePaths: [PATH],
  operations: ['edit'],
  networkTargets: [],
};

let clock = Date.parse('2026-09-11T00:00:00.000Z');

function nextTime(): string {
  clock += 1_000;
  return new Date(clock).toISOString();
}

function planTask(): PlanTask {
  return {
    id: TASK_ID,
    role: 'backend',
    goal: 'record decisions',
    paths: [PATH],
    dependsOn: [],
    acceptanceIds: ['AC-015'],
    checks: ['pnpm test:unit'],
  };
}

function draft(): PlanDraft {
  return {
    goal: 'record behaviour Decisions',
    scope: SCOPE,
    tasks: [planTask()],
    interfaceChanges: [],
    dataChanges: [],
    risks: [],
    rollback: [],
  };
}

describe('behaviour Decisions (AC-015, AC-016)', () => {
  let dataDir: string;
  let store: ProjectStore;
  let gates: PlanGateService;
  let decisions: DecisionService;
  let artifacts: ArtifactService;
  let projectId: string;

  beforeEach(() => {
    clock = Date.parse('2026-09-11T00:00:00.000Z');
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-decisions-'));
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
    artifacts = new ArtifactService({ store, blobs, now: () => clock });
    gates = new PlanGateService({ store, artifacts, blobs });
    decisions = new DecisionService({ store, artifacts, gates, blobs });

    store.conversations.insert({
      id: CONVERSATION_ID,
      projectId,
      title: 'chief',
      archived: false,
    });
    const budget = store.budgets.insert({
      projectId,
      workId: WORK_ID,
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
      id: WORK_ID,
      projectId,
      intent: 'delivery',
      purpose: 'record behaviour decisions',
      level: 'L2',
      goal: 'deliver WP-06 T2 decisions',
      scope: SCOPE,
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      status: 'running',
      blockerIds: [],
      baseRevision: REVISION,
      requirementId: REQUIREMENT_ID,
      budgetId: budget.id,
      policyRevision: 1,
    });
    store.requirements.insert({
      id: REQUIREMENT_ID,
      projectId,
      workId: WORK_ID,
      title: 'Ship WP-06 decisions',
      goal: 'record behaviour decisions',
      lifecycle: 'active',
      phase: 'plan',
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      recordVersion: 1,
      portableRef: {
        path: `.agentdev/requirements/${REQUIREMENT_ID}`,
        revision: 'working-tree',
        hash: 'd'.repeat(64),
      },
      executionAvailability: 'local',
      evidenceAvailability: 'full',
    });
    store.runs.insert({
      id: RUN_ID,
      projectId,
      workId: WORK_ID,
      role: 'planning',
      purpose: 'analysis',
      stage: 'Plan',
      status: 'running',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: 'a'.repeat(64),
      contextSnapshotId: 'b'.repeat(64),
      dispatchSnapshotId: 'c'.repeat(64),
      budgetAllocation: 1_000,
    });
    store.authorizations.insert({
      id: AUTHORIZATION_ID,
      projectId,
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      workId: WORK_ID,
      goal: 'authorized plan write scope',
      scope: SCOPE,
      operations: ['edit'],
      acceptedAt: '2026-09-11T00:00:00.000Z',
    });
    seedEvidenceArtifact(REVIEW_ARTIFACT_ID, 'review');
    seedEvidenceArtifact(TEST_ARTIFACT_ID, 'test');
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  /** A user-origin artifact row, as the review/test summaries really are. */
  function seedEvidenceArtifact(artifactId: string, kind: 'review' | 'test'): Artifact {
    const attachmentId = store.newId();
    store.attachments.insert({
      id: attachmentId,
      conversationId: CONVERSATION_ID,
      ownerUserId: OWNER_ID,
      mime: 'text/markdown',
      state: 'bound',
      expiresAt: '2027-01-01T00:00:00.000Z',
      boundMessageId: WORK_ID,
      workId: WORK_ID,
      contentHash: (kind === 'review' ? 'e' : 'f').repeat(64),
      relativeBlobPath: `blobs/${kind}/${artifactId}`,
      bytes: 12,
    });
    return store.artifacts.insert({
      id: artifactId,
      workId: WORK_ID,
      origin: 'user',
      attachmentId,
      kind,
      artifactVersion: 1,
      contentHash: (kind === 'review' ? 'e' : 'f').repeat(64),
      relativeBlobPath: `blobs/${kind}/${artifactId}`,
      mime: 'text/markdown',
      bytes: 12,
      validity: 'valid',
      acl: [],
    });
  }

  function approvePlan(): void {
    const result = gates.submitPlan({
      workId: WORK_ID,
      revision: REVISION,
      plan: draft(),
      approval: {
        authorizationRef: AUTHORIZATION_ID,
        runId: RUN_ID,
        productChanged: false,
        at: nextTime(),
      },
    });
    if (!result.approved) throw new Error(`plan was not approved: ${result.code}`);
  }

  it('handles a product change now: new Product/Plan versions and invalidated evidence (AC-015)', () => {
    approvePlan();
    const before = decisions.getCurrentPlanVersion(WORK_ID);
    expect(before.source).toBe('gate');
    expect(before.version).toBe(1);

    const result = decisions.recordBehaviourDecision({
      workId: WORK_ID,
      choice: 'now',
      summary: 'the cancel endpoint must reject unpaid orders',
      decidedAt: nextTime(),
      evidenceRefs: [REVIEW_ARTIFACT_ID, TEST_ARTIFACT_ID],
      affectedEvidenceRefs: [REVIEW_ARTIFACT_ID],
    });

    expect(result.choice).toBe('now');
    expect(result.decisionState).toBe('accepted');
    expect(result.currentAcceptanceUnchanged).toBe(false);
    expect(result.invalidatedEvidenceRefs).toContain(REVIEW_ARTIFACT_ID);
    // The unaffected evidence survives and is named explicitly.
    expect(result.reusableEvidenceRefs).toContain(TEST_ARTIFACT_ID);
    expect(result.newProductVersion?.version).toBe(1);
    expect(result.newPlanVersion?.version).toBe(2);

    // The decision record is persisted and readable.
    const record = decisions.getDecisionRecord(result.decisionId);
    expect(record.kind).toBe('product');
    expect(record.state).toBe('accepted');
    expect(record.choice).toBe('now');
    expect(record.workId).toBe(WORK_ID);

    // The invalidated evidence is persisted as its own record...
    const invalidated = decisions.getInvalidatedEvidence(result.decisionId);
    expect(invalidated.invalidatedEvidenceRefs).toContain(REVIEW_ARTIFACT_ID);
    expect(invalidated.reusableEvidenceRefs).toContain(TEST_ARTIFACT_ID);
    // ...and the artifact itself is marked invalid with a reason.
    expect(store.artifacts.find(REVIEW_ARTIFACT_ID)?.validity).toBe('invalid');
    expect(store.artifacts.find(REVIEW_ARTIFACT_ID)?.invalidReason).toContain(result.decisionId);
    expect(store.artifacts.find(TEST_ARTIFACT_ID)?.validity).toBe('valid');

    // The Requirement moved back to the product phase and carries the new versions.
    const requirement = store.requirements.find(REQUIREMENT_ID);
    expect(requirement?.phase).toBe('product');
    expect(requirement?.planRef?.hash).toBe(result.newPlanVersion?.hash);
    expect(requirement?.productRef?.hash).toBe(result.newProductVersion?.hash);

    // The Product moved, so the old approved Plan no longer gates a write.
    const previousPlan = decisions.getCurrentPlanVersion(WORK_ID);
    expect(previousPlan.ref).toBeDefined();
    const write = gates.requestCodeWrite({
      workId: WORK_ID,
      revision: REVISION,
      targets: [PATH],
      ...(previousPlan.ref === undefined ? {} : { planRef: previousPlan.ref }),
    });
    expect(write.allowed).toBe(false);
    if (write.allowed) throw new Error('unreachable');
    expect(write.code).toBe('GATE_NOT_READY');
    expect(write.stalePlan).toBe(true);
    expect(decisions.getCurrentPlanVersion(WORK_ID).version).toBe(2);
  });

  it('queues a Requirement for later without moving the current acceptance (AC-016)', () => {
    approvePlan();
    const requirementBefore = store.requirements.find(REQUIREMENT_ID);
    const planBefore = requirementBefore?.planRef?.hash;

    const result = decisions.recordBehaviourDecision({
      workId: WORK_ID,
      choice: 'later',
      summary: 'support partial refunds in a follow-up',
      decidedAt: nextTime(),
      evidenceRefs: [REVIEW_ARTIFACT_ID, TEST_ARTIFACT_ID],
    });

    expect(result.choice).toBe('later');
    expect(result.currentAcceptanceUnchanged).toBe(true);
    expect(result.invalidatedEvidenceRefs).toEqual([]);
    expect(result.queuedRequirement?.lifecycle).toBe('queued');
    expect(result.queuedRequirement?.executionAvailability).toBe('needs_replan');
    expect(result.queuedRequirement?.title).toBe('support partial refunds in a follow-up');

    // A real Queued Requirement row exists and is separate from the current one.
    const queuedId = result.queuedRequirement?.requirementId ?? '';
    const queued = store.requirements.find(queuedId);
    expect(queued?.lifecycle).toBe('queued');
    expect(queued?.workId).toBeUndefined();
    expect(queued?.sourceRef.kind).toBe('decision');
    expect(queued?.sourceRef.id).toBe(result.decisionId);
    expect(queued?.id).not.toBe(REQUIREMENT_ID);

    // The current acceptance did not move.
    const requirementAfter = store.requirements.find(REQUIREMENT_ID);
    expect(requirementAfter?.lifecycle).toBe('active');
    expect(requirementAfter?.planRef?.hash).toBe(planBefore);
    expect(requirementAfter?.recordVersion).toBe(requirementBefore?.recordVersion);
    expect(store.artifacts.find(REVIEW_ARTIFACT_ID)?.validity).toBe('valid');
    expect(decisions.getCurrentPlanVersion(WORK_ID).version).toBe(1);
  });

  it('records a reason when the suggestion is declined and leaves acceptance unchanged (AC-016)', () => {
    approvePlan();
    const requirementBefore = store.requirements.find(REQUIREMENT_ID);
    const queuedBefore = store.requirements.count('lifecycle = ?', ['queued']);

    const result = decisions.recordBehaviourDecision({
      workId: WORK_ID,
      choice: 'decline',
      summary: 'partial refunds are out of scope for this release',
      decidedAt: nextTime(),
      evidenceRefs: [REVIEW_ARTIFACT_ID],
      affectedEvidenceRefs: [REVIEW_ARTIFACT_ID],
    });

    expect(result.choice).toBe('decline');
    expect(result.decisionState).toBe('rejected');
    expect(result.reason).toBe('partial refunds are out of scope for this release');
    expect(result.queuedRequirement).toBeUndefined();
    expect(result.currentAcceptanceUnchanged).toBe(true);
    expect(result.invalidatedEvidenceRefs).toEqual([]);

    const record = decisions.getDecisionRecord(result.decisionId);
    expect(record.state).toBe('rejected');
    expect(record.choice).toBe('decline');
    // No new Requirement, no moved acceptance, no invalidated evidence.
    expect(store.requirements.count('lifecycle = ?', ['queued'])).toBe(queuedBefore);
    expect(store.requirements.find(REQUIREMENT_ID)?.planRef?.hash).toBe(
      requirementBefore?.planRef?.hash,
    );
    expect(store.artifacts.find(REVIEW_ARTIFACT_ID)?.validity).toBe('valid');
    expect(decisions.getCurrentPlanVersion(WORK_ID).version).toBe(1);

    // The decline is an auditable record in the event trail, reason included.
    const events = scanEvents(store, { names: ['decision.created'] }).filter(
      (event) => event.data['decisionId'] === result.decisionId,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.data['choice']).toBe('decline');
    expect(events[0]?.data['state']).toBe('rejected');
  });

  it('keeps Product and Plan versions monotonic across several decisions (AC-015)', () => {
    approvePlan();
    const first = decisions.recordBehaviourDecision({
      workId: WORK_ID,
      choice: 'now',
      summary: 'first change',
      decidedAt: nextTime(),
    });
    const second = decisions.recordBehaviourDecision({
      workId: WORK_ID,
      choice: 'now',
      summary: 'second change',
      decidedAt: nextTime(),
    });

    expect(first.newProductVersion?.version).toBe(1);
    expect(first.newPlanVersion?.version).toBe(2);
    expect(second.newProductVersion?.version).toBe(2);
    expect(second.newPlanVersion?.version).toBe(3);
    expect(decisions.getCurrentProductVersion(WORK_ID).version).toBe(2);
    expect(decisions.getCurrentPlanVersion(WORK_ID).version).toBe(3);

    // A later Plan submission cannot move the chain backwards either.
    const next = gates.submitPlan({
      workId: WORK_ID,
      revision: REVISION,
      plan: draft(),
      approval: {
        authorizationRef: AUTHORIZATION_ID,
        runId: RUN_ID,
        productChanged: false,
        at: nextTime(),
      },
    });
    expect(next.approved).toBe(true);
    if (!next.approved) throw new Error('unreachable');
    expect(next.planRef.version).toBe(4);
    expect(decisions.getCurrentPlanVersion(WORK_ID).version).toBe(4);
  });

  it('refuses a decision for an unknown Work without writing anything', () => {
    const decisionsBefore = store.decisions.count();
    const requirementsBefore = store.requirements.count();
    expect(() =>
      decisions.recordBehaviourDecision({
        workId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d5e99',
        choice: 'now',
        summary: 'unknown work',
        decidedAt: nextTime(),
      }),
    ).toThrowError(/does not exist/);
    expect(store.decisions.count()).toBe(decisionsBefore);
    expect(store.requirements.count()).toBe(requirementsBefore);
  });
});
