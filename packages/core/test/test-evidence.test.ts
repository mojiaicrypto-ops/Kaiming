/**
 * WP-12 W5 — the Test stage's executed evidence (unit layer).
 *
 * `workflow.md` §6: "报告不能以'应该通过'代替执行". These cases prove that the
 * `CheckResult` is computed from the real process outcomes (never from a model claim)
 * and that the stage gate refuses a `success` the executed evidence does not support.
 * The real container execution is proven in `broker.integration.test.ts`; the real
 * end-to-end chain is proven by the live drill (`scripts/lib/live-drills.mjs`).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CheckResult, Scope } from '@agentdev/contracts';
import { ProjectStore as Store, projectIdFromRoot } from '@agentdev/storage';
import {
  StageGate,
  TestEvidenceRegistry,
  boundTestOutput,
  buildBlockedTestCheckResult,
  buildTestCheckResult,
  recordedExitCode,
  type DeclaredCommandExecution,
} from '../src/index.js';

const ROOT = '/tmp/agentdev-test-evidence-root';
const PROJECT_ID = projectIdFromRoot(ROOT);
const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e01';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e40';
const TEST_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e10';
const REVIEW_RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e11';
const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e60';
const REVIEW_ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e61';
const SNAPSHOT_ID = 'c'.repeat(64);
const HASH = 'b'.repeat(64);
const ENVIRONMENT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e70';
const OUTPUT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e71';
const REVISION = 'a'.repeat(40);
const PATH = 'packages/core/src/test-environment.ts';

const SCOPE: Scope = {
  readPaths: [PATH],
  writePaths: [],
  operations: ['read'],
  networkTargets: [],
};

function execution(patch: Partial<DeclaredCommandExecution> = {}): DeclaredCommandExecution {
  return {
    command: 'node -e "process.exit(0)"',
    exitCode: 0,
    stdout: 'ok\n',
    stderr: '',
    signal: null,
    durationMs: 12,
    ...patch,
  };
}

function evidence(patch: Partial<CheckResult> = {}): CheckResult {
  return {
    status: 'passed',
    checks: [
      {
        acceptanceIds: ['AC-010'],
        command: 'node -e "process.exit(0)"',
        exitCode: 0,
        environmentRef: ENVIRONMENT_ID,
        inputTree: HASH,
        outputRef: OUTPUT_ID,
        result: 'exit=0 | 12ms | stdout: ok',
      },
    ],
    uncovered: [],
    ...patch,
  };
}

describe('declared acceptance commands → CheckResult (WP-12 W5)', () => {
  it('makes the status follow the real exit codes only', () => {
    const passed = buildTestCheckResult({
      executions: [execution(), execution({ command: 'second', exitCode: 0 })],
      environmentRef: ENVIRONMENT_ID,
      inputTree: HASH,
      acceptanceIds: ['AC-010'],
      outputRefs: [OUTPUT_ID, OUTPUT_ID],
    });
    expect(passed.status).toBe('passed');
    expect(passed.checks.map((check) => check.exitCode)).toEqual([0, 0]);

    const failed = buildTestCheckResult({
      executions: [execution(), execution({ command: 'second', exitCode: 3, stderr: 'boom' })],
      environmentRef: ENVIRONMENT_ID,
      inputTree: HASH,
      acceptanceIds: ['AC-010'],
      outputRefs: [OUTPUT_ID, OUTPUT_ID],
    });
    expect(failed.status).toBe('failed');
    expect(failed.checks[1]?.exitCode).toBe(3);
    expect(failed.checks[1]?.result).toContain('boom');
  });

  it('reports not_covered, never passed, when no command is configured', () => {
    const result = buildTestCheckResult({
      executions: [],
      environmentRef: ENVIRONMENT_ID,
      inputTree: HASH,
      acceptanceIds: ['AC-010', 'AC-011'],
      outputRefs: [],
    });
    expect(result.status).toBe('not_covered');
    expect(result.checks).toEqual([]);
    expect(result.uncovered.map((entry) => entry.acceptanceId)).toEqual(['AC-010', 'AC-011']);
    expect(result.uncovered[0]?.reason).toContain('no acceptance command is configured');
  });

  it('records a signalled process with the documented 128+signal convention', () => {
    expect(recordedExitCode(execution({ exitCode: null, signal: 'SIGTERM' }))).toBe(143);
    expect(recordedExitCode(execution({ exitCode: null, signal: null }))).toBe(-1);
  });

  it('bounds the recorded output instead of storing it whole', () => {
    const bounded = boundTestOutput('x'.repeat(10_000), 64);
    expect(bounded.length).toBeLessThan(200);
    expect(bounded).toContain('truncated');
  });

  it('records a blocked execution with no fabricated command', () => {
    const blocked = buildBlockedTestCheckResult({
      reason: 'PROVIDER_UNAVAILABLE: docker is not reachable',
      acceptanceIds: ['AC-010'],
    });
    expect(blocked.status).toBe('blocked');
    expect(blocked.checks).toEqual([]);
    expect(blocked.uncovered[0]?.reason).toContain('docker');
  });

  it('keeps one pending entry per Attempt until the real evidence replaces it', () => {
    const registry = new TestEvidenceRegistry();
    registry.begin(ATTEMPT_ID);
    expect(registry.get(ATTEMPT_ID)).toEqual({ state: 'pending' });
    registry.record(ATTEMPT_ID, evidence());
    expect(registry.get(ATTEMPT_ID)).toEqual({ state: 'ready', checkResult: evidence() });
    registry.release(ATTEMPT_ID);
    expect(registry.get(ATTEMPT_ID)).toBeUndefined();
  });
});

describe('StageGate refuses an asserted Test success (WP-12 W5)', () => {
  let dataDir: string;
  let store: Store;
  let registry: TestEvidenceRegistry;
  let gate: StageGate;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-test-evidence-'));
    store = Store.open({
      dataDir,
      canonicalRoot: ROOT,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    store.projects.insert({
      id: PROJECT_ID,
      root: ROOT,
      codeRoot: 'packages',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
    });
    const budget = store.budgets.insert({
      projectId: PROJECT_ID,
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
      projectId: PROJECT_ID,
      intent: 'delivery',
      purpose: 'verify the Test evidence',
      level: 'L2',
      goal: 'execute the declared acceptance commands',
      scope: SCOPE,
      sourceRef: { kind: 'message', id: WORK_ID, version: '1' },
      status: 'running',
      blockerIds: [],
      baseRevision: REVISION,
      budgetId: budget.id,
      policyRevision: 1,
    });
    store.tasks.insert({
      id: TASK_ID,
      workId: WORK_ID,
      planRef: { id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d7e50', version: 1, hash: HASH },
      role: 'backend',
      dependsOn: [],
      dependencyManifestRefs: [],
      scope: SCOPE,
      stage: 'review',
      acceptanceIds: ['AC-010'],
    });
    for (const [id, role, stage] of [
      [TEST_RUN_ID, 'test', 'test'],
      [REVIEW_RUN_ID, 'review', 'review'],
    ] as const) {
      store.runs.insert({
        id,
        projectId: PROJECT_ID,
        workId: WORK_ID,
        taskId: TASK_ID,
        role,
        purpose: role === 'test' ? 'test' : 'review',
        stage,
        status: 'running',
        requiredChild: false,
        join: 'none',
        childIds: [],
        configSnapshotId: SNAPSHOT_ID,
        contextSnapshotId: SNAPSHOT_ID,
        dispatchSnapshotId: SNAPSHOT_ID,
        budgetAllocation: 1_000,
      });
    }
    store.attempts.insert({
      id: ATTEMPT_ID,
      projectId: PROJECT_ID,
      runId: TEST_RUN_ID,
      number: 1,
      status: 'running',
      ownerEpoch: 3,
      runnerId: 'evidence-test-runner',
    });
    store.attempts.insert({
      id: REVIEW_ATTEMPT_ID,
      projectId: PROJECT_ID,
      runId: REVIEW_RUN_ID,
      number: 1,
      status: 'running',
      ownerEpoch: 3,
      runnerId: 'evidence-test-runner',
    });
    registry = new TestEvidenceRegistry();
    gate = new StageGate({ store, testEvidence: registry });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function successPayload(patch: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      status: 'success',
      summary: 'the declared commands passed',
      artifactRefs: [],
      evidenceRefs: [],
      changedPaths: [PATH],
      findingIds: [],
      unknowns: [],
      requestedActions: [],
      readLedgerSeq: 0,
      readLedgerHash: '0'.repeat(64),
      ...patch,
    };
  }

  function submit(payload: Record<string, unknown>) {
    return gate.submit({
      runId: TEST_RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 3,
      payload,
    });
  }

  it('refuses while the declared commands are still running', () => {
    registry.begin(ATTEMPT_ID);
    expect(() => submit(successPayload())).toThrowError(/still executing/);
    expect(store.stageResults.list({ where: 'run_id = ?', params: [TEST_RUN_ID] })).toEqual([]);
  });

  it('refuses a success claim when an executed command failed, naming the exit code', () => {
    registry.record(
      ATTEMPT_ID,
      evidence({
        status: 'failed',
        checks: [
          {
            acceptanceIds: ['AC-010'],
            command: 'node -e "process.exit(3)"',
            exitCode: 3,
            environmentRef: ENVIRONMENT_ID,
            inputTree: HASH,
            outputRef: OUTPUT_ID,
            result: 'exit=3',
          },
        ],
      }),
    );
    expect(() => submit(successPayload())).toThrowError(/exit 3/);
    expect(store.stageResults.list({ where: 'run_id = ?', params: [TEST_RUN_ID] })).toEqual([]);
  });

  it('refuses a success claim when no acceptance command is configured', () => {
    registry.record(
      ATTEMPT_ID,
      buildTestCheckResult({
        executions: [],
        environmentRef: ENVIRONMENT_ID,
        inputTree: HASH,
        acceptanceIds: ['AC-010'],
        outputRefs: [],
      }),
    );
    expect(() => submit(successPayload({ checkResult: evidence() }))).toThrowError(/not_covered/);
    expect(store.stageResults.list({ where: 'run_id = ?', params: [TEST_RUN_ID] })).toEqual([]);
  });

  it('records success together with Core executed evidence, replacing any claim', () => {
    const real = evidence();
    registry.record(ATTEMPT_ID, real);
    const outcome = submit(successPayload({ checkResult: evidence({ status: 'failed' }) }));
    expect(outcome.accepted).toBe(true);
    if (!outcome.accepted) throw new Error('unreachable');
    expect(outcome.row.status).toBe('success');
    expect(outcome.row.checkResult).toEqual(real);
  });

  it('accepts an honest failure and still persists the real executed evidence', () => {
    const real = evidence({
      status: 'failed',
      checks: [
        {
          acceptanceIds: ['AC-010'],
          command: 'node -e "process.exit(3)"',
          exitCode: 3,
          environmentRef: ENVIRONMENT_ID,
          inputTree: HASH,
          outputRef: OUTPUT_ID,
          result: 'exit=3',
        },
      ],
    });
    registry.record(ATTEMPT_ID, real);
    const outcome = submit(successPayload({ status: 'failed' }));
    expect(outcome.accepted).toBe(true);
    if (!outcome.accepted) throw new Error('unreachable');
    expect(outcome.row.status).toBe('failed');
    expect(outcome.row.checkResult).toEqual(real);
  });

  it('leaves a non-Test stage and a stack without an executor unchanged', () => {
    const reviewGate = new StageGate({ store, testEvidence: registry });
    const reviewOutcome = reviewGate.submit({
      runId: REVIEW_RUN_ID,
      attemptId: REVIEW_ATTEMPT_ID,
      epoch: 3,
      payload: successPayload(),
    });
    expect(reviewOutcome.accepted).toBe(true);
    if (!reviewOutcome.accepted) throw new Error('unreachable');
    expect(reviewOutcome.row.status).toBe('success');
    const bareGate = new StageGate({ store });
    const bare = bareGate.submit({
      runId: TEST_RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 3,
      payload: successPayload(),
    });
    expect(bare.accepted).toBe(true);
    if (!bare.accepted) throw new Error('unreachable');
    expect(bare.row.checkResult).toBeUndefined();
  });
});
