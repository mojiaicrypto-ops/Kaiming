/**
 * The Run Checkpoint (`docs/architecture/context.md` §5, `AC-033`, `AC-034`,
 * `AC-035`).
 *
 * Every test is one documented obligation of `§5`:
 *
 * - the checkpoint carries exactly the listed fields — work/task/stage, the valid
 *   Manifest, pending decisions, artifact refs, last tool outcome, next action and
 *   recent message refs — and a round trip on the same Run returns them unchanged;
 * - `Checkpoint仅来自当前Run`: another Run cannot write one and another Run/role
 *   reads `CONTEXT_FORBIDDEN` **without any content** (`AC-033`, `AC-034`);
 * - a session rotation changes only the physical session: role/task/permissions/
 *   sources come back correct and the approval state is untouched (`AC-035`);
 * - compaction drops the oldest message refs and *nothing else*: the Manifest ref,
 *   pending decisions and approval survive by identity, and the approval-free
 *   summary cannot flip an approval (`AC-035`);
 * - a malformed checkpoint is refused with `VALIDATION_ERROR`, never repaired.
 */
import { describe, expect, it } from 'vitest';
import type { DecisionState, Hash, Ref, Role, SourceRef, Time } from '@agentdev/contracts';
import {
  APPROVAL_STATES,
  compactCheckpoint,
  createCheckpointStore,
  checkpointHash,
  loadCheckpoint,
  saveCheckpoint,
  summaryOf,
  validateCheckpoint,
  type CheckpointDraft,
  type CheckpointRun,
  type CheckpointToolOutcome,
  type ContextError,
  type ContextResult,
} from '../src/context/index.js';

const PROJECT_ID = '11111111111111111111111111111111';
const OTHER_PROJECT_ID = '22222222222222222222222222222222';
const OTHER_RUN_ID = '0191f000-0000-7000-8000-0000000000bb';
const RUN_ID = '0191f000-0000-7000-8000-0000000000aa';
const WORK_ID = 'WP-05';
const TASK_ID = '0191f000-0000-7000-8000-0000000000c1';
const SESSION_A = 'session-a';
const SESSION_B = 'session-b';
const T0 = '2026-09-11T00:00:00.000Z';
const T1 = '2026-09-11T01:00:00.000Z';

const hash = (seed: string): Hash => seed.repeat(64).slice(0, 64);

const MANIFEST: Ref = { id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e5f', version: 3, hash: hash('a') };
const APPROVAL_REF: Ref = {
  id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e60',
  version: 1,
  hash: hash('b'),
};
const ARTIFACT_REF: Ref = {
  id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d4e61',
  version: 2,
  hash: hash('c'),
};

const SOURCE_REFS: readonly SourceRef[] = [
  { kind: 'git', id: 'src/orders/cancel.ts', version: 'rev-1', path: 'src/orders/cancel.ts' },
  { kind: 'policy', id: 'docs/rules/agents.md', version: 'rev-1', path: 'docs/rules/agents.md' },
];

const TOOL_OUTCOME: CheckpointToolOutcome = {
  operationId: 'op-1',
  toolName: 'read',
  state: 'finished',
  inputHash: hash('d'),
  resultHash: hash('e'),
  at: T0,
};

function messageRef(seq: number) {
  return {
    conversationId: 'conversation-1',
    seq,
    bodyRef: `body-${seq}`,
    role: 'backend' as Role,
    summary: `message ${seq}`,
  };
}

function decision(id: string, state: DecisionState = 'pending') {
  return {
    id,
    kind: 'permission' as const,
    state,
    summary: `等待用户决定 ${id}`,
    targetRef: MANIFEST,
    requestedAt: T0,
  };
}

/** A complete, valid checkpoint draft; `overrides` replace individual fields. */
function draft(overrides: Partial<CheckpointDraft> = {}): CheckpointDraft {
  return {
    runId: RUN_ID,
    projectId: PROJECT_ID,
    role: 'backend',
    sessionRef: SESSION_A,
    workId: WORK_ID,
    taskId: TASK_ID,
    stage: 'develop-L2',
    manifest: MANIFEST,
    pendingDecisions: [decision('d-1'), decision('d-2', 'accepted')],
    artifactRefs: [{ ref: ARTIFACT_REF, kind: 'diff', summary: 'candidate diff' }],
    lastToolOutcome: TOOL_OUTCOME,
    nextAction: '运行 task 验收并提交 stage_result',
    recentMessages: Array.from({ length: 30 }, (_unused, index) => messageRef(index + 1)),
    approval: { state: 'approved', authorizationRef: APPROVAL_REF, decidedAt: T0, role: 'backend' },
    sourceRefs: SOURCE_REFS,
    ...overrides,
  };
}

function run(overrides: Partial<CheckpointRun> = {}): CheckpointRun {
  return {
    runId: RUN_ID,
    role: 'backend',
    projectId: PROJECT_ID,
    workId: WORK_ID,
    sessionRef: SESSION_A,
    ...overrides,
  };
}

function expectOk<T>(result: ContextResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.errors.map((error) => error.message).join('; '));
  return result;
}

function expectRefusal<T>(
  result: ContextResult<T>,
  code: ContextError['code'],
): readonly ContextError[] {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error(`expected a refusal with ${code}`);
  expect(result.errors[0]?.code).toBe(code);
  return result.errors;
}

/** `true` when a refused result leaks no checkpoint payload at all. */
function hasNoContent(result: unknown): boolean {
  expect(result).toBeDefined();
  const record = result as Record<string, unknown>;
  return record['checkpoint'] === undefined && record['checkpointHash'] === undefined;
}

describe('checkpoint: documented fields and round trip (context.md §5)', () => {
  it('carries exactly the §5 fields and returns them unchanged on the same Run', () => {
    const store = createCheckpointStore({ now: () => T0 });
    expectOk(store.registerRun(run()));
    const saved = expectOk(store.save({ runId: RUN_ID, checkpoint: draft() }));
    const loaded = expectOk(
      store.load({
        runId: RUN_ID,
        role: 'backend',
        runScope: { projectId: PROJECT_ID, workId: WORK_ID },
      }),
    );

    expect(loaded.checkpoint).toEqual(saved.checkpoint);
    expect(Object.keys(loaded.checkpoint).sort()).toEqual(
      [
        'approval',
        'artifactRefs',
        'createdAt',
        'lastToolOutcome',
        'manifest',
        'nextAction',
        'pendingDecisions',
        'projectId',
        'recentMessages',
        'role',
        'runId',
        'sessionRef',
        'sourceRefs',
        'stage',
        'taskId',
        'updatedAt',
        'workId',
      ].sort(),
    );
    // The round trip preserves the specific facts a resume depends on.
    expect(loaded.checkpoint.workId).toBe(WORK_ID);
    expect(loaded.checkpoint.taskId).toBe(TASK_ID);
    expect(loaded.checkpoint.stage).toBe('develop-L2');
    expect(loaded.checkpoint.manifest).toEqual(MANIFEST);
    expect(loaded.checkpoint.pendingDecisions).toHaveLength(2);
    expect(loaded.checkpoint.artifactRefs[0]?.ref).toEqual(ARTIFACT_REF);
    expect(loaded.checkpoint.lastToolOutcome).toEqual(TOOL_OUTCOME);
    expect(loaded.checkpoint.nextAction).toBe('运行 task 验收并提交 stage_result');
    expect(loaded.checkpoint.recentMessages).toHaveLength(30);
    expect(loaded.checkpoint.approval.state).toBe('approved');
    expect(loaded.checkpoint.sourceRefs).toEqual(SOURCE_REFS);
    expect(loaded.rotated).toBe(false);
    expect(loaded.checkpointHash).toBe(checkpointHash(saved.checkpoint));

    // A second save of identical content is idempotent: the stored pointer is the
    // same content hash.
    const savedAgain = expectOk(store.save({ runId: RUN_ID, checkpoint: draft() }));
    expect(checkpointHash(savedAgain.checkpoint)).toBe(loaded.checkpointHash);
    expect(loaded.checkpoint.createdAt).toBe(T0);
  });

  it('refuses a malformed checkpoint with VALIDATION_ERROR and stores nothing', () => {
    const store = createCheckpointStore({ now: () => T0 });
    expectOk(store.registerRun(run()));

    const noApproval = draft({ approval: undefined as unknown as CheckpointDraft['approval'] });
    const approvalErrors = validateCheckpoint(noApproval);
    expect(approvalErrors.map((error) => error.code)).toContain('VALIDATION_ERROR');
    expect(approvalErrors.some((error) => error.message.includes('approval'))).toBe(true);
    expectRefusal(store.save({ runId: RUN_ID, checkpoint: noApproval }), 'VALIDATION_ERROR');

    const badManifest = draft({
      manifest: { id: '', version: 0, hash: 'not-a-hash' },
    });
    const manifestErrors = validateCheckpoint(badManifest);
    expect(manifestErrors.filter((error) => error.message.includes('manifest')).length).toBe(3);
    expectRefusal(store.save({ runId: RUN_ID, checkpoint: badManifest }), 'VALIDATION_ERROR');

    const emptyNextAction = draft({ nextAction: '   ' });
    expect(
      validateCheckpoint(emptyNextAction).some((error) => error.message.includes('nextAction')),
    ).toBe(true);

    // Nothing was stored by any of the refusals.
    expectRefusal(
      store.load({ runId: RUN_ID, role: 'backend', runScope: { projectId: PROJECT_ID } }),
      'NOT_FOUND',
    );
  });

  it('exposes the approval states the document requires and freezes what it returns', () => {
    expect([...APPROVAL_STATES]).toEqual(['pending', 'approved', 'rejected']);
    const store = createCheckpointStore({ now: () => T0 });
    expectOk(store.registerRun(run()));
    const saved = expectOk(store.save({ runId: RUN_ID, checkpoint: draft() }));
    expect(Object.isFrozen(saved.checkpoint)).toBe(true);
    expect(Object.isFrozen(saved.checkpoint.recentMessages)).toBe(true);
    expect(() => {
      (saved.checkpoint as { nextAction: string }).nextAction = 'tampered';
    }).toThrow();
  });
});

describe('checkpoint: only the current Run may write or read it (AC-033, AC-034)', () => {
  it('refuses a checkpoint that carries facts of another Run (no content in the answer)', () => {
    const store = createCheckpointStore({ now: () => T0 });
    expectOk(store.registerRun(run()));
    const errors = expectRefusal(
      store.save({ runId: RUN_ID, checkpoint: draft({ runId: OTHER_RUN_ID }) }),
      'CONTEXT_FORBIDDEN',
    );
    expect(errors[0]?.message).toContain(OTHER_RUN_ID);
    // The foreign facts were not stored.
    expectRefusal(
      store.load({ runId: RUN_ID, role: 'backend', runScope: { projectId: PROJECT_ID } }),
      'NOT_FOUND',
    );
  });

  it('gives another Run/role no checkpoint content (AC-033/AC-034)', () => {
    const store = createCheckpointStore({ now: () => T0 });
    expectOk(store.registerRun(run()));
    expectOk(store.save({ runId: RUN_ID, checkpoint: draft() }));

    // Another Run of the same Work: refused and carries no content.
    const otherRun = expectRefusal(
      store.load({
        runId: OTHER_RUN_ID,
        role: 'backend',
        runScope: { projectId: PROJECT_ID, workId: WORK_ID },
      }),
      'NOT_FOUND',
    );
    expect(otherRun[0]?.message).toContain(OTHER_RUN_ID);

    // A Reviewer/Test Run presenting the same Run id: refused without content.
    for (const role of ['review', 'test'] as const) {
      const refused = expectRefusal(
        store.load({ runId: RUN_ID, role, runScope: { projectId: PROJECT_ID, workId: WORK_ID } }),
        'CONTEXT_FORBIDDEN',
      );
      expect(refused[0]?.message).toContain(role);
      expect(hasNoContent(refused[0])).toBe(true);
    }

    // Another Project cannot read it either.
    const crossProject = expectRefusal(
      store.load({
        runId: RUN_ID,
        role: 'backend',
        runScope: { projectId: OTHER_PROJECT_ID, workId: WORK_ID },
      }),
      'CONTEXT_FORBIDDEN',
    );
    expect(hasNoContent(crossProject[0])).toBe(true);

    // A different Work of the same Project is refused as well.
    expectRefusal(
      store.load({
        runId: RUN_ID,
        role: 'backend',
        runScope: { projectId: PROJECT_ID, workId: 'WP-99' },
      }),
      'CONTEXT_FORBIDDEN',
    );

    // The legitimate reader still succeeds, so the refusals were not a blanket denial.
    const owned = expectOk(
      store.load({ runId: RUN_ID, role: 'backend', runScope: { projectId: PROJECT_ID } }),
    );
    expect(owned.checkpoint.runId).toBe(RUN_ID);
  });

  it('refuses a Reviewer/Test Run registration from reading a development Run', () => {
    const store = createCheckpointStore({ now: () => T0 });
    expectOk(store.registerRun(run()));
    expectOk(
      store.registerRun(run({ runId: OTHER_RUN_ID, role: 'review', sessionRef: 'session-review' })),
    );
    expectOk(store.save({ runId: RUN_ID, checkpoint: draft() }));
    expectRefusal(
      store.load({
        runId: RUN_ID,
        role: 'review',
        runScope: { projectId: PROJECT_ID, workId: WORK_ID },
      }),
      'CONTEXT_FORBIDDEN',
    );
    // The review Run has no checkpoint of its own, so nothing leaked across.
    expectRefusal(
      store.load({
        runId: OTHER_RUN_ID,
        role: 'review',
        runScope: { projectId: PROJECT_ID, workId: WORK_ID },
      }),
      'NOT_FOUND',
    );
  });

  it('refuses a checkpoint that claims another Work (W5R1-09)', () => {
    const store = createCheckpointStore({ now: () => T0 });
    expectOk(store.registerRun(run()));
    const errors = expectRefusal(
      store.save({ runId: RUN_ID, checkpoint: draft({ workId: 'WP-99' }) }),
      'VALIDATION_ERROR',
    );
    expect(errors[0]?.message).toContain('WP-99');
    // Nothing was stored for the foreign Work...
    expectRefusal(
      store.load({ runId: RUN_ID, role: 'backend', runScope: { projectId: PROJECT_ID } }),
      'NOT_FOUND',
    );
    // ...and the Run's real Work still saves, so the rule is not a blanket denial.
    expectOk(store.save({ runId: RUN_ID, checkpoint: draft() }));
    const loaded = expectOk(
      store.load({ runId: RUN_ID, role: 'backend', runScope: { projectId: PROJECT_ID } }),
    );
    expect(loaded.checkpoint.workId).toBe(WORK_ID);
  });
});

describe('checkpoint: session rotation (AC-035)', () => {
  it('recovers role/task/permissions/sources and keeps the approval state', () => {
    const store = createCheckpointStore({ now: () => T0 });
    expectOk(store.registerRun(run()));
    expectOk(store.save({ runId: RUN_ID, checkpoint: draft() }));

    const rotated = expectOk(
      store.rotateSession({
        runId: RUN_ID,
        fromSessionRef: SESSION_A,
        toSessionRef: SESSION_B,
        role: 'backend',
        runScope: { projectId: PROJECT_ID, workId: WORK_ID },
        at: T1,
      }),
    );
    expect(rotated.run.sessionRef).toBe(SESSION_B);

    const loaded = expectOk(
      store.load({
        runId: RUN_ID,
        role: 'backend',
        runScope: { projectId: PROJECT_ID, workId: WORK_ID },
      }),
    );
    expect(loaded.sessionRef).toBe(SESSION_B);
    expect(loaded.rotated).toBe(true);
    expect(loaded.checkpoint.sessionRef).toBe(SESSION_B);
    expect(loaded.checkpoint.updatedAt).toBe(T1);
    // Role / task / stage / line are unchanged.
    expect(loaded.checkpoint.role).toBe('backend');
    expect(loaded.checkpoint.taskId).toBe(TASK_ID);
    expect(loaded.checkpoint.workId).toBe(WORK_ID);
    expect(loaded.checkpoint.stage).toBe('develop-L2');
    expect(loaded.checkpoint.nextAction).toBe('运行 task 验收并提交 stage_result');
    // Permissions and sources come back exactly.
    expect(loaded.checkpoint.sourceRefs).toEqual(SOURCE_REFS);
    expect(loaded.checkpoint.pendingDecisions).toEqual(draft().pendingDecisions);
    expect(loaded.checkpoint.manifest).toEqual(MANIFEST);
    // …and the old summary never changed the approval.
    expect(loaded.checkpoint.approval.state).toBe('approved');
    expect(loaded.checkpoint.approval.authorizationRef).toEqual(APPROVAL_REF);
    expect(loaded.checkpoint.approval.decidedAt).toBe(T0);

    // A rotation from a stale session is refused rather than silently renaming.
    expectRefusal(
      store.rotateSession({
        runId: RUN_ID,
        fromSessionRef: SESSION_A,
        toSessionRef: 'session-c',
        role: 'backend',
        runScope: { projectId: PROJECT_ID },
      }),
      'INVALID_STATE',
    );
  });

  it('leaves the stored session unchanged when there is no checkpoint to rotate (W5R1-08)', () => {
    const store = createCheckpointStore({ now: () => T0 });
    expectOk(store.registerRun(run()));
    expectRefusal(
      store.rotateSession({
        runId: RUN_ID,
        fromSessionRef: SESSION_A,
        toSessionRef: SESSION_B,
        role: 'backend',
        runScope: { projectId: PROJECT_ID, workId: WORK_ID },
      }),
      'NOT_FOUND',
    );
    // Validate first, mutate last: the rejected rotation did not bind session-b.
    expect(store.runOf(RUN_ID)?.sessionRef).toBe(SESSION_A);
    // The Run is still usable once a real checkpoint exists.
    expectOk(store.save({ runId: RUN_ID, checkpoint: draft() }));
    const rotated = expectOk(
      store.rotateSession({
        runId: RUN_ID,
        fromSessionRef: SESSION_A,
        toSessionRef: SESSION_B,
        role: 'backend',
        runScope: { projectId: PROJECT_ID, workId: WORK_ID },
        at: T1,
      }),
    );
    expect(rotated.run.sessionRef).toBe(SESSION_B);
  });

  it('does not let a staleness/rotation of the message list touch the approval', () => {
    const store = createCheckpointStore({ now: () => T0 });
    expectOk(store.registerRun(run()));
    const saved = expectOk(store.save({ runId: RUN_ID, checkpoint: draft() }));
    const summary = summaryOf(saved.checkpoint);
    // The summary has no approval field at all, so it cannot carry a flipped one.
    expect(Object.keys(summary)).not.toContain('approval');
    expect(summary.manifest).toEqual(MANIFEST);
    expect(summary.pendingDecisionIds).toEqual(['d-1', 'd-2']);

    const afterSummary = expectOk(
      store.load({ runId: RUN_ID, role: 'backend', runScope: { projectId: PROJECT_ID } }),
    );
    expect(afterSummary.checkpoint.approval).toEqual(saved.checkpoint.approval);
    expect(validateCheckpoint(afterSummary.checkpoint)).toEqual([]);
  });
});

describe('checkpoint: closed clock and validated rotation stamp (W5R2-08, W5R2-11)', () => {
  it('closes a throwing store clock instead of escaping with its raw message (W5R2-08)', () => {
    const secret = 'CHECKPOINT-CLOCK-EXPLODED';
    const broken = createCheckpointStore({
      now: () => {
        throw new Error(secret);
      },
    });
    expectOk(broken.registerRun(run()));
    const saved = broken.save({ runId: RUN_ID, checkpoint: draft() });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.errors[0]?.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(saved)).not.toContain(secret);
    // A closed failure stores nothing: the Run has no checkpoint to load.
    expectRefusal(
      broken.load({ runId: RUN_ID, role: 'backend', runScope: { projectId: PROJECT_ID } }),
      'NOT_FOUND',
    );

    // `rotateSession` reads the same clock: with an explicit `at` it can proceed,
    // but without one it must close the same way and leave the session untouched.
    let explode = false;
    const store = createCheckpointStore({
      now: () => {
        if (explode) throw new Error(secret);
        return T0;
      },
    });
    expectOk(store.registerRun(run()));
    const stored = expectOk(store.save({ runId: RUN_ID, checkpoint: draft() }));
    expect(stored.checkpoint.updatedAt).toBe(T0);
    explode = true;
    const rotated = store.rotateSession({
      runId: RUN_ID,
      fromSessionRef: SESSION_A,
      toSessionRef: SESSION_B,
      role: 'backend',
      runScope: { projectId: PROJECT_ID, workId: WORK_ID },
    });
    expect(rotated.ok).toBe(false);
    if (rotated.ok) return;
    expect(rotated.errors[0]?.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(rotated)).not.toContain(secret);
    // Validate first, mutate last: nothing partial was written.
    expect(store.runOf(RUN_ID)?.sessionRef).toBe(SESSION_A);
    const reloaded = expectOk(
      store.load({ runId: RUN_ID, role: 'backend', runScope: { projectId: PROJECT_ID } }),
    );
    expect(reloaded.sessionRef).toBe(SESSION_A);
    expect(reloaded.checkpoint.updatedAt).toBe(T0);
  });

  it('refuses an unvalidated rotation timestamp (W5R2-11)', () => {
    const store = createCheckpointStore({ now: () => T0 });
    expectOk(store.registerRun(run()));
    expectOk(store.save({ runId: RUN_ID, checkpoint: draft() }));

    for (const at of ['NOT-A-TIME', '2026-09-11', '', 42 as unknown as Time]) {
      expectRefusal(
        store.rotateSession({
          runId: RUN_ID,
          fromSessionRef: SESSION_A,
          toSessionRef: SESSION_B,
          role: 'backend',
          runScope: { projectId: PROJECT_ID, workId: WORK_ID },
          at,
        }),
        'VALIDATION_ERROR',
      );
    }
    // The rejected rotations bound nothing and stored no bad stamp.
    expect(store.runOf(RUN_ID)?.sessionRef).toBe(SESSION_A);
    const still = expectOk(
      store.load({ runId: RUN_ID, role: 'backend', runScope: { projectId: PROJECT_ID } }),
    );
    expect(still.checkpoint.updatedAt).toBe(T0);
    expect(still.checkpoint.sessionRef).toBe(SESSION_A);

    // A valid stamp is still accepted and recorded.
    const rotated = expectOk(
      store.rotateSession({
        runId: RUN_ID,
        fromSessionRef: SESSION_A,
        toSessionRef: SESSION_B,
        role: 'backend',
        runScope: { projectId: PROJECT_ID, workId: WORK_ID },
        at: T1,
      }),
    );
    expect(rotated.checkpoint.updatedAt).toBe(T1);
  });
});

describe('checkpoint: compaction (AC-035)', () => {
  it('reduces recent message refs but leaves manifest/decisions/approval unchanged', () => {
    const store = createCheckpointStore({ now: () => T0 });
    expectOk(store.registerRun(run()));
    const saved = expectOk(store.save({ runId: RUN_ID, checkpoint: draft() }));
    expect(saved.checkpoint.recentMessages).toHaveLength(30);

    const compacted = expectOk(
      store.compact({
        runId: RUN_ID,
        role: 'backend',
        runScope: { projectId: PROJECT_ID },
        keep: 5,
      }),
    );
    expect(compacted.droppedMessages).toBe(25);
    expect(compacted.checkpoint.recentMessages).toHaveLength(5);
    // The newest refs survive; the oldest are the ones dropped.
    expect(compacted.checkpoint.recentMessages.map((entry) => entry.seq)).toEqual([
      26, 27, 28, 29, 30,
    ]);
    expect(compacted.manifest).toEqual(MANIFEST);
    expect(compacted.approval).toBe('approved');
    expect(compacted.checkpoint.manifest).toEqual(MANIFEST);
    expect(compacted.checkpoint.pendingDecisions).toEqual(saved.checkpoint.pendingDecisions);
    expect(compacted.checkpoint.approval).toEqual(saved.checkpoint.approval);
    // Everything else is identical field-for-field.
    expect({ ...compacted.checkpoint, recentMessages: [] }).toEqual({
      ...saved.checkpoint,
      recentMessages: [],
    });

    // The stored checkpoint is the compacted one, and it is still valid.
    const reloaded = expectOk(
      store.load({ runId: RUN_ID, role: 'backend', runScope: { projectId: PROJECT_ID } }),
    );
    expect(reloaded.checkpoint.recentMessages).toHaveLength(5);
    expect(validateCheckpoint(reloaded.checkpoint)).toEqual([]);
  });

  it('is a pure helper whose result carries the input approval and manifest', () => {
    const store = createCheckpointStore({ now: () => T0 });
    expectOk(store.registerRun(run()));
    const saved = expectOk(store.save({ runId: RUN_ID, checkpoint: draft() }));
    const result = compactCheckpoint(saved.checkpoint, 0);
    expect(result.droppedMessages).toBe(30);
    expect(result.checkpoint.recentMessages).toEqual([]);
    expect(result.manifest).toEqual(MANIFEST);
    expect(result.approval).toBe('approved');
    // The input object was not mutated.
    expect(saved.checkpoint.recentMessages).toHaveLength(30);
    expect(saved.checkpoint.approval.state).toBe('approved');
  });
});

describe('checkpoint: the bound save/load API', () => {
  it('saves and loads through saveCheckpoint/loadCheckpoint with the same rules', () => {
    const store = createCheckpointStore({ now: () => T0 });
    expectOk(store.registerRun(run()));
    const saved = expectOk(saveCheckpoint({ runId: RUN_ID, checkpoint: draft() }, store));
    expect(saved.checkpointHash).toBe(checkpointHash(saved.checkpoint));
    const loaded = expectOk(
      loadCheckpoint(
        { runId: RUN_ID, role: 'backend', runScope: { projectId: PROJECT_ID } },
        store,
      ),
    );
    expect(loaded.checkpoint).toEqual(saved.checkpoint);
    expect(loaded.checkpointHash).toBe(saved.checkpointHash);
  });

  it('refuses a cross-Run save and a foreign load through the bound API too', () => {
    const store = createCheckpointStore({ now: () => T0 });
    expectOk(store.registerRun(run()));
    expectOk(store.registerRun(run({ runId: OTHER_RUN_ID, sessionRef: 'session-other' })));
    expectRefusal(
      saveCheckpoint({ runId: OTHER_RUN_ID, checkpoint: draft() }, store),
      'CONTEXT_FORBIDDEN',
    );
    expectRefusal(
      loadCheckpoint({ runId: RUN_ID, role: 'review', runScope: { projectId: PROJECT_ID } }, store),
      'CONTEXT_FORBIDDEN',
    );
  });
});
