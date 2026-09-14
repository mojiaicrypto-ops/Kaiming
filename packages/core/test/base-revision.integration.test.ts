/**
 * T3 轮 2 / Q-T3-4 — `work.baseRevision` gets a real writer, proved against a real Git repo.
 *
 * `core/gates.ts` `requestCodeWrite` refuses every source write with `GATE_NOT_READY`
 * while `work.baseRevision` is empty (W6R3-04), and nothing wrote that field, so AC-013
 * could not pass even with an approved Plan. This suite drives the real writer
 * (`messages.ts` `defaultBaseRevisionReader` + `createAssistWork`) over a real repository
 * and then lets the **real** `PlanGateService` decide a write, so the evidence is
 * "the gate opened", not "the port returned a string".
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Scope } from '@agentdev/contracts';
import {
  ArtifactService,
  PlanGateService,
  defaultBaseRevisionReader,
  sendMessage,
  userIdFromSubject,
  type PlanDraft,
} from '../src/index.js';
import {
  BlobStore,
  ProjectStore as Store,
  projectIdFromRoot,
  type ProjectStore,
} from '@agentdev/storage';
import { AttachmentService } from '../src/attachments.js';

const PATH = 'docs/notes.md';
/** The body the deterministic router classifies as a delivery of exactly `PATH`. */
const BODY = `请把 ${PATH} 更新一下`;
const SCOPE: Scope = {
  readPaths: [PATH],
  writePaths: [PATH],
  operations: ['read', 'edit'],
  networkTargets: [],
};

let clock = Date.parse('2026-09-11T00:00:00.000Z');

function task() {
  return {
    id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dd040',
    role: 'backend' as const,
    goal: 'update the notes',
    paths: [PATH],
    dependsOn: [],
    acceptanceIds: ['AC-013'],
    checks: ['pnpm test:unit'],
  };
}

function draft(): PlanDraft {
  return {
    goal: 'update the notes document',
    scope: SCOPE,
    tasks: [task()],
    interfaceChanges: [],
    dataChanges: [],
    risks: [],
    rollback: [],
  };
}

describe('work.baseRevision writer (Q-T3-4, AC-013)', () => {
  let home: string;
  let repo: string;
  let store: ProjectStore;
  let projectId: string;
  let head: string;

  beforeEach(() => {
    clock = Date.parse('2026-09-11T00:00:00.000Z');
    home = mkdtempSync(join(tmpdir(), 'agentdev-baserev-home-'));
    repo = mkdtempSync(join(tmpdir(), 'agentdev-baserev-repo-'));
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, PATH), '# notes\n', 'utf8');
    execFileSync('git', ['init', '-q', '-b', 'agentdev/main'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: repo });
    execFileSync('git', ['add', '.'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: repo });
    head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

    store = Store.open({
      dataDir: home,
      canonicalRoot: repo,
      migrations: { backup: () => undefined, backupPath: join(home, 'pre.sqlite') },
    });
    projectId = projectIdFromRoot(repo);
    store.projects.insert({
      id: projectId,
      root: repo,
      gitRoot: repo,
      codeRoot: 'docs',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
      head,
    });
    store.conversations.insert({
      id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dd001',
      projectId,
      title: 'base revision',
      archived: false,
    });
  });

  afterEach(() => {
    store.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  function send(body = BODY) {
    const blobs = new BlobStore({ root: home });
    return sendMessage(
      {
        projectId,
        store,
        attachments: new AttachmentService({ store, blobs }),
        artifacts: new ArtifactService({ store, blobs }),
        blobs,
        now: () => clock,
        readBaseRevision: defaultBaseRevisionReader,
      },
      {
        conversationId: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dd001',
        body,
        ownerUserId: userIdFromSubject('installation:local'),
      },
    );
  }

  it('reads the delivery ref the project really points at', () => {
    const project = store.projects.get(projectId);
    expect(defaultBaseRevisionReader(project)).toBe(head);
  });

  it('binds a new Work to that revision and lets requestCodeWrite pass', () => {
    const sent = send();
    const created = store.works.get(sent.workId);
    expect(created.baseRevision).toBe(head);
    expect(created.authorizationRef).toBeDefined();
    // The Chief's assessment moves the Work from `queued` to `running` in the real
    // lifecycle; the gate only admits a write on a running Work (`workflow.md` §7).
    const work = store.works.update(created.id, { status: 'running' }, created.version);

    // The real gate: a planning Run, a plan approved against that revision, then a write.
    const gates = new PlanGateService({ store });
    const run = store.runs.insert({
      id: '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3dd010',
      projectId,
      workId: work.id,
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
    const approved = gates.submitPlan({
      workId: work.id,
      revision: work.baseRevision ?? '',
      plan: draft(),
      approval: {
        authorizationRef: work.authorizationRef ?? '',
        runId: run.id,
        productChanged: false,
        at: new Date(clock).toISOString(),
      },
    });
    expect(approved.approved).toBe(true);

    const write = gates.requestCodeWrite({
      workId: work.id,
      revision: head,
      targets: [PATH],
    });
    expect(write.allowed).toBe(true);
    if (write.allowed) expect(write.workLevel).toBe('L2');

    // A different revision is still refused: the binding is the real delivery head.
    const stale = gates.requestCodeWrite({
      workId: work.id,
      revision: 'd'.repeat(40),
      targets: [PATH],
    });
    expect(stale.allowed).toBe(false);
    if (!stale.allowed) expect(stale.code).toBe('VALIDATION_ERROR');
  });

  it('binds nothing when the project has no delivery ref yet', () => {
    // A branch that does not exist: the reader returns `undefined` and the Work keeps an
    // empty baseRevision, which is the documented `GATE_NOT_READY` state, not a guess.
    store.projects.update(projectId, { deliveryBranch: 'agentdev/missing' }, 1);
    expect(defaultBaseRevisionReader(store.projects.get(projectId))).toBeUndefined();
    const sent = send();
    expect(store.works.get(sent.workId).baseRevision).toBeUndefined();
    const gates = new PlanGateService({ store });
    const write = gates.requestCodeWrite({
      workId: sent.workId,
      revision: head,
      targets: [PATH],
    });
    expect(write.allowed).toBe(false);
    if (!write.allowed) expect(write.code).toBe('GATE_NOT_READY');
  });
});
