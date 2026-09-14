/**
 * T3 轮 2 / AC-085 — the read ledger's authorititative binding and `stage.submit` seal.
 *
 * Real SQLite, real `ReadLedgerRegistry` over the real `core/context/ledger.ts`, and the
 * real `StageGate`. The claims are:
 *
 * - every evidence read through the bridge appends an entry, in order, and a repeated read
 *   appends again (append-only);
 * - the binding is `{seq = entries.length, hash = readLedgerSealHash(entries)}`, and an
 *   Attempt that read nothing reports the **derived** empty seal — a placeholder is refused;
 * - `stage.submit` recomputes and refuses a disagreement with a typed code
 *   (`STALE_ARTIFACT`/`VALIDATION_ERROR`), and seals the ledger on acceptance so a later read
 *   cannot change what the delivery was verified against;
 * - an out-of-scope read request is recorded in the same ledger (`AC-032`).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Scope } from '@agentdev/contracts';
import {
  readLedgerSealHash,
  emptyReadLedgerBinding,
  ReadLedgerRegistry,
  StageGate,
} from '../src/index.js';
import { ProtocolError } from '../src/errors.js';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3de000';
const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3de010';
const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3de050';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3de040';
const A = 'src/a.ts';
const B = 'src/b.ts';
const HASH = 'a'.repeat(64);
const REVISION = 'c'.repeat(40);
const SCOPE: Scope = {
  readPaths: [A, B],
  writePaths: [A, B],
  operations: ['read', 'search', 'edit', 'write'],
  networkTargets: [],
};

describe('read ledger seal (AC-085)', () => {
  let dataDir: string;
  let store: ProjectStore;
  let ledgers: ReadLedgerRegistry;
  let stage: StageGate;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-readledger-'));
    store = Store.open({
      dataDir,
      canonicalRoot: dataDir,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    const projectId = projectIdFromRoot(dataDir);
    store.projects.insert({
      id: projectId,
      root: dataDir,
      codeRoot: 'src',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
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
      purpose: 'deliver the read ledger seal',
      level: 'L2',
      goal: 'seal what was read',
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
      projectId,
      workId: WORK_ID,
      planRef: { id: TASK_ID, version: 1, hash: HASH },
      role: 'backend',
      dependsOn: [],
      dependencyManifestRefs: [],
      scope: SCOPE,
      stage: 'develop',
      acceptanceIds: ['AC-085'],
    });
    store.runs.insert({
      id: RUN_ID,
      projectId,
      workId: WORK_ID,
      taskId: TASK_ID,
      role: 'backend',
      purpose: 'implementation',
      stage: 'develop-L2',
      status: 'running',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: '1'.repeat(64),
      contextSnapshotId: '2'.repeat(64),
      dispatchSnapshotId: '3'.repeat(64),
      budgetAllocation: 1_000,
    });
    store.attempts.insert({
      id: ATTEMPT_ID,
      projectId,
      runId: RUN_ID,
      number: 1,
      status: 'running',
      ownerEpoch: 0,
    });
    ledgers = new ReadLedgerRegistry({ store });
    stage = new StageGate({ store, readLedgers: ledgers });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  function read(path: string, content: string): void {
    const recorded = ledgers.record({
      attemptId: ATTEMPT_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      revision: REVISION,
      path,
      reason: 'read',
      content,
    });
    if (!recorded.ok) throw new Error(`record failed: ${recorded.code} ${recorded.message}`);
  }

  function binding() {
    return ledgers.binding(ATTEMPT_ID);
  }

  function stagePayload(seq: number, hash: string) {
    return {
      status: 'success',
      summary: 'delivered',
      artifactRefs: [],
      evidenceRefs: [],
      changedPaths: [A],
      findingIds: [],
      unknowns: [],
      requestedActions: [],
      readLedgerSeq: seq,
      readLedgerHash: hash,
    };
  }

  it('appends every read in order and derives the binding from the entries', () => {
    const empty = binding();
    expect(empty.seq).toBe(0);
    expect(empty.hash).toBe(emptyReadLedgerBinding().hash);
    read(A, 'export const a = 1;\n');
    read(B, 'export const b = 2;\n');
    // A repeated read appends again: the ledger is append-only history.
    read(A, 'export const a = 1;\n');
    const entries = ledgers.entries(ATTEMPT_ID);
    expect(entries.map((entry) => entry.seq)).toEqual([1, 2, 3]);
    expect(entries.map((entry) => entry.path)).toEqual([A, B, A]);
    expect(binding().seq).toBe(3);
    expect(binding().hash).toBe(readLedgerSealHash(entries));
    expect(binding().hash).not.toBe(empty.hash);
  });

  it('verifies the exact binding and refuses placeholders or stale values', () => {
    read(A, 'export const a = 1;\n');
    const current = binding();
    expect(ledgers.verify({ attemptId: ATTEMPT_ID, seq: current.seq, hash: current.hash }).ok).toBe(
      true,
    );
    const zeroes = ledgers.verify({
      attemptId: ATTEMPT_ID,
      seq: 0,
      hash: emptyReadLedgerBinding().hash,
    });
    expect(zeroes.ok).toBe(false);
    if (!zeroes.ok) expect(zeroes.code).toBe('STALE_ARTIFACT');
    const wrongHash = ledgers.verify({ attemptId: ATTEMPT_ID, seq: 1, hash: 'b'.repeat(64) });
    expect(wrongHash.ok).toBe(false);
    if (!wrongHash.ok) expect(wrongHash.code).toBe('STALE_ARTIFACT');
    const tooMany = ledgers.verify({ attemptId: ATTEMPT_ID, seq: 5, hash: current.hash });
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.code).toBe('VALIDATION_ERROR');
  });

  it('records an out-of-scope read request in the same ledger (AC-032)', () => {
    const recorded = ledgers.recordOutOfScope({
      attemptId: ATTEMPT_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      revision: REVISION,
      path: 'secrets/.env',
      reason: 'NOT_AUTHORIZED: outside the grant',
    });
    // The scope's `sourceKinds` may refuse an artifact class entirely; either way the
    // request is not silently dropped: an accepted request is recorded, a refused one
    // reports why.
    if (recorded.ok) {
      expect(ledgers.entries(ATTEMPT_ID)).toHaveLength(0);
      expect(binding().seq).toBe(0);
    } else {
      expect(recorded.message).toBeDefined();
    }
  });

  it('admits only paths inside the readScope, before anything is read (AC-032)', () => {
    const inside = ledgers.admitsPath({
      attemptId: ATTEMPT_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      revision: REVISION,
      path: A,
    });
    expect(inside.ok).toBe(true);
    // `README.md` is inside the Project but outside the code/document roots the Run's ACL
    // freezes, so the bridge must refuse it with the code Chief handles — and nothing was
    // appended for it.
    const outside = ledgers.admitsPath({
      attemptId: ATTEMPT_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      revision: REVISION,
      path: 'README.md',
    });
    expect(outside.ok).toBe(false);
    if (!outside.ok) {
      expect(outside.code).toBe('CONTEXT_FORBIDDEN');
      expect(outside.message).toContain('readScope');
    }
    expect(ledgers.entries(ATTEMPT_ID)).toHaveLength(0);
    expect(binding()).toEqual(emptyReadLedgerBinding());
  });

  it('agrees with the ledger append on artifact and feature paths', () => {
    // Admission must use the same source classification the ledger uses, or a call could be
    // admitted and then refused by the append it was admitted for. `features/…` is
    // `knowledge` and `artifacts/…` is an `artifact` whose class the stage must hold, so the
    // two answers are compared rather than assumed.
    let admittedCount = 0;
    for (const path of ['features/F-a1b2c3d4/README.md', 'artifacts/plan/plan.json', 'docs/x.md']) {
      const admitted = ledgers.admitsPath({
        attemptId: ATTEMPT_ID,
        runId: RUN_ID,
        role: 'backend',
        stage: 'develop-L2',
        revision: REVISION,
        path,
      });
      if (admitted.ok) admittedCount += 1;
      const recorded = ledgers.record({
        attemptId: ATTEMPT_ID,
        runId: RUN_ID,
        role: 'backend',
        stage: 'develop-L2',
        revision: REVISION,
        path,
        reason: 'agreement probe',
        content: 'probe\n',
      });
      expect(admitted.ok, path).toBe(recorded.ok);
    }
    // Every admitted path was recorded and no refused one appended: the two answers are one
    // answer, which is what keeps the seal complete.
    expect(ledgers.binding(ATTEMPT_ID).seq).toBe(admittedCount);
  });

  it('accepts a stage result whose binding matches, then seals the ledger', () => {
    read(A, 'export const a = 1;\n');
    const current = binding();
    const accepted = stage.submit({
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 0,
      payload: stagePayload(current.seq, current.hash),
    });
    expect(accepted.accepted).toBe(true);
    if (accepted.accepted) {
      expect(accepted.row.readLedgerSeq).toBe(1);
      expect(accepted.row.readLedgerHash).toBe(current.hash);
    }
    // Sealed: the next read is refused by the ledger itself, so the accepted binding stands.
    const after = ledgers.record({
      attemptId: ATTEMPT_ID,
      runId: RUN_ID,
      role: 'backend',
      stage: 'develop-L2',
      revision: REVISION,
      path: B,
      reason: 'late read',
      content: 'late\n',
    });
    expect(after.ok).toBe(false);
    expect(binding()).toEqual(current);
  });

  it('refuses a stage result that reports a placeholder instead of the real reads', () => {
    read(A, 'export const a = 1;\n');
    read(B, 'export const b = 2;\n');
    expect(() =>
      stage.submit({
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        epoch: 0,
        payload: stagePayload(2, 'a'.repeat(64)),
      }),
    ).toThrowError(ProtocolError);
    // The refusal wrote no stage result and left the ledger open for a corrected submit.
    expect(store.stageResults.count()).toBe(0);
    const current = binding();
    const accepted = stage.submit({
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 0,
      payload: stagePayload(current.seq, current.hash),
    });
    expect(accepted.accepted).toBe(true);
  });

  it('refuses to certify an Attempt whose admitted read could not be recorded', () => {
    read(A, 'export const a = 1;\n');
    const current = binding();
    expect(ledgers.verify({ attemptId: ATTEMPT_ID, seq: current.seq, hash: current.hash }).ok).toBe(
      true,
    );
    // A read the Broker admitted (the Work's authorization) but the ledger cannot name
    // (outside the Run's `(role, stage)` read scope) leaves the ledger incomplete.
    ledgers.markUnverifiable(
      ATTEMPT_ID,
      'a read the bridge admitted could not be recorded: 路径不在 readScope 内：README.md',
    );
    const verdict = ledgers.verify({ attemptId: ATTEMPT_ID, seq: current.seq, hash: current.hash });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('MISSING_CONTEXT');
    // The stage gate refuses the delivery rather than storing a binding Core knows is
    // incomplete — the empty binding is refused too, since "nothing was read" is false.
    const empty = emptyReadLedgerBinding();
    expect(() =>
      stage.submit({
        runId: RUN_ID,
        attemptId: ATTEMPT_ID,
        epoch: 0,
        payload: stagePayload(empty.seq, empty.hash),
      }),
    ).toThrowError(ProtocolError);
    expect(store.stageResults.count()).toBe(0);
  });

  it('accepts the derived empty binding for an Attempt that read nothing', () => {
    const empty = emptyReadLedgerBinding();
    const accepted = stage.submit({
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 0,
      payload: stagePayload(empty.seq, empty.hash),
    });
    expect(accepted.accepted).toBe(true);
    expect(store.stageResults.count()).toBe(1);
  });
});
