/**
 * WP-12 T4b integration: the documented requirement/control command surface over a
 * **real temporary Git repository**, a **real SQLite database** and the real
 * `RequirementSaveService`.
 *
 * Every assertion here is about a fact the acceptance criteria name: the board and
 * the requirement detail expose the record's branch/commit/unpushed state (AC-090),
 * `requirement.get` returns the committed body while `list` stays metadata-only
 * (`protocol.md` §8), archive/restore move the real Git record and honour
 * `workflow.md` §5.1, the completion write refuses to invent a completion fact, and
 * `work.control resume` cannot leave a half-resumed Work behind (WP11R5-01/02).
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ArtifactService,
  AttachmentService,
  ConfigStore,
  DownloadTokenStore,
  EventHub,
  FindingService,
  ProjectIntegrationLock,
  RUN_RECOVERED_EVENT,
  createRequirementSaveService,
  userIdFromSubject,
  type RequirementSaveService,
} from '@agentdev/core';
import { BlobStore, ProjectStore, projectIdFromRoot } from '@agentdev/storage';
import {
  createMemoryCasEvents,
  createMemoryCasJournal,
  createNodeWorktreeGitPort,
  runGit,
} from '@agentdev/workspace';
import type { JsonObject } from '@agentdev/contracts';
import {
  WorkbenchProtocol,
  parseEnvelope,
  statusForCode,
  type ExtensionSpec,
  type RunRecoveryPort,
  type WorkbenchCaller,
} from '../src/protocol.js';

const TIME = '2026-09-14T00:00:00.000Z';
const DELIVERY_BRANCH = 'agentdev/main';
const created: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

function writeFileAt(root: string, relativePath: string, content: string): void {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const gitPort = createNodeWorktreeGitPort();

interface Harness {
  readonly repo: string;
  readonly remote: string;
  readonly store: ProjectStore;
  readonly protocol: WorkbenchProtocol;
  readonly saves: RequirementSaveService;
  readonly projectId: string;
  readonly seedRevision: string;
}

/** A real delivery repository, a bare remote and the workbench protocol over both. */
function harness(options: { readonly extensions?: readonly ExtensionSpec[] } = {}): Harness {
  const repo = makeTempDir('agentdev-t4b-repo-');
  writeFileAt(repo, 'src/orders.ts', 'export const orders = [];\n');
  writeFileAt(repo, 'README.md', '# demo\n');
  const init = gitPort.initRepository(repo, { branch: DELIVERY_BRANCH });
  if (!init.ok) throw new Error('git init failed');
  writeFileAt(repo, '.gitignore', 'node_modules/\n.agentdev/work/\n');
  // The role contract `context.preview` reads is a real committed document
  // (`cold-start.ts` `CHIEF_RULES_PATH`), not an invented string.
  writeFileAt(repo, 'docs/rules/agents.md', '# Agent 固定规则\n\nChief 决定上下文。\n');
  const seed = gitPort.commitPaths(repo, 'chore: seed', [
    'src/orders.ts',
    'README.md',
    '.gitignore',
    'docs/rules/agents.md',
  ]);
  if (!seed.ok) throw new Error('seed commit failed');

  // A real bare remote so `unpushed` can flip after a real push.
  const remote = makeTempDir('agentdev-t4b-remote-');
  const bare = runGit(['init', '--bare', remote], { cwd: repo });
  if (!bare.ok) throw new Error(`git init --bare failed: ${bare.stderr}`);
  const added = runGit(['remote', 'add', 'origin', remote], { cwd: repo });
  if (!added.ok) throw new Error(`git remote add failed: ${added.stderr}`);

  const dataDir = makeTempDir('agentdev-t4b-state-');
  const projectId = projectIdFromRoot(repo);
  const store = ProjectStore.open({
    dataDir,
    canonicalRoot: repo,
    migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
  });
  store.projects.insert({
    id: projectId,
    root: repo,
    gitRoot: repo,
    codeRoot: 'src',
    documentRoot: 'docs',
    deliveryBranch: DELIVERY_BRANCH,
    trust: 'trusted',
    state: 'open',
  });
  const journal = createMemoryCasJournal();
  const casEvents = createMemoryCasEvents();
  const lock = new ProjectIntegrationLock({ projectId, leases: store.leases, now: () => TIME });
  const saves = createRequirementSaveService({
    store,
    worktrees: gitPort,
    journal,
    events: casEvents,
    lock,
    worktreeRoot: join(dataDir, 'save-worktrees'),
    now: () => TIME,
    keepWorktree: false,
  });
  const blobs = new BlobStore({ root: dataDir });
  const artifacts = new ArtifactService({ store, blobs });
  const config = ConfigStore.open({ globalDir: dataDir, projectRoot: dataDir });
  const protocol = new WorkbenchProtocol({
    store,
    blobs,
    events: new EventHub({ store }),
    attachments: new AttachmentService({ store, blobs }),
    artifacts,
    tokens: new DownloadTokenStore(),
    version: '0.0.0-test',
    config,
    requirementSaves: saves,
    // The Run control commands are thin views over the real findings service.
    findings: new FindingService({ store, artifacts }),
    requirementGit: {
      resolveRevision: (root, revision) => gitPort.resolveRevision(root, revision),
      isAncestor: (root, ancestor, descendant) => gitPort.isAncestor(root, ancestor, descendant),
    },
    ...(options.extensions === undefined ? {} : { extensions: options.extensions }),
  });
  return {
    repo,
    remote,
    store,
    protocol,
    saves,
    projectId,
    seedRevision: (seed.value as { revision: string }).revision,
  };
}

const caller: WorkbenchCaller = {
  subject: 'user:test',
  userId: userIdFromSubject('installation:local'),
  role: 'chief',
};

function call(
  h: Harness,
  method: string,
  params: JsonObject = {},
  extra: JsonObject = {},
): JsonObject {
  return JSON.parse(
    JSON.stringify(h.protocol.dispatch(method, params, { caller, ...extra })),
  ) as JsonObject;
}

function refusal(run: () => unknown): { code: string; message: string; details?: JsonObject } {
  try {
    run();
  } catch (error) {
    const failure = error as { code?: string; message?: string; details?: JsonObject };
    return {
      code: failure.code ?? '',
      message: failure.message ?? '',
      ...(failure.details === undefined ? {} : { details: failure.details }),
    };
  }
  throw new Error('expected the call to be refused');
}

/** Every durable event of the project, in cursor order. */
function eventsOf(h: Harness, name: string) {
  return h.store.events.readAfter(0, { limit: 1_000 }).filter((event) => event.name === name);
}

/** The six documented headings (`requirements.md` §6). */
function body(text: string, completion = '待明确'): string {
  return [
    '## 目标与背景',
    '',
    text,
    '',
    '## 范围与行为',
    '',
    '仅订单模块。',
    '',
    '## 验收说明',
    '',
    'AC-090。',
    '',
    '## 已确认决定',
    '',
    '无',
    '',
    '## 未决问题',
    '',
    '无',
    '',
    '## 完成摘要',
    '',
    completion,
    '',
  ].join('\n');
}

function createRequirement(h: Harness, overrides: JsonObject = {}): JsonObject {
  return call(h, 'requirement.create', {
    title: '未付款订单可取消',
    goal: '让未付款订单可取消',
    scope: { readPaths: [], writePaths: [], operations: ['edit'], networkTargets: [] },
    contentMarkdown: body('未付款订单可取消。'),
    ...overrides,
  });
}

/** One documented completion fact (`requirements.md` §2). */
function completionFact(overrides: JsonObject = {}): JsonObject {
  return {
    completedAt: TIME,
    summary: '已交付',
    codeRevision: 'a'.repeat(40),
    codeTree: 'b'.repeat(64),
    featureIds: [],
    verificationSummary: '独立测试通过',
    remainingIssues: [],
    ...overrides,
  };
}

describe('documented requirement commands over real Git (WP-12 T4b)', () => {
  it('exposes branch/commit/unpushed on board, get and list, and flips after a real push (AC-090)', () => {
    const h = harness();
    const createdRow = createRequirement(h);
    const requirementId = createdRow['requirementId'] as string;
    expect(createdRow['status']).toBe('accepted');

    const before = call(h, 'requirement.get', { requirementId });
    const gitBefore = before['git'] as JsonObject;
    expect(gitBefore['branch']).toBe(DELIVERY_BRANCH);
    expect(gitBefore['commit']).toBe(
      before['portableRef'] && (before['portableRef'] as JsonObject)['revision'],
    );
    expect(gitBefore['unpushed']).toBe(true);
    expect(gitBefore['upstreamRevision']).toBeNull();

    const board = call(h, 'board');
    const queued = (board['columns'] as JsonObject)['queued'] as JsonObject[];
    expect(queued).toHaveLength(1);
    expect((queued[0]?.['git'] as JsonObject)['unpushed']).toBe(true);

    const listed = call(h, 'requirement.list', {});
    const item = (listed['items'] as JsonObject[])[0] as JsonObject;
    expect((item['git'] as JsonObject)['unpushed']).toBe(true);

    // A real push moves `refs/remotes/origin/agentdev/main`, so the same committed
    // revision is now contained in the upstream and the flag flips.
    const pushed = runGit(['push', '-u', 'origin', DELIVERY_BRANCH], { cwd: h.repo });
    if (!pushed.ok) throw new Error(`git push failed: ${pushed.stderr}`);

    const after = call(h, 'requirement.get', { requirementId });
    const gitAfter = after['git'] as JsonObject;
    expect(gitAfter['commit']).toBe(gitBefore['commit']);
    expect(gitAfter['unpushed']).toBe(false);
    expect(gitAfter['upstreamRevision']).toBe(gitAfter['commit']);

    const boardAfter = call(h, 'board');
    const queuedAfter = (boardAfter['columns'] as JsonObject)['queued'] as JsonObject[];
    expect((queuedAfter[0]?.['git'] as JsonObject)['unpushed']).toBe(false);
  });

  it('returns the committed contentMarkdown from get and keeps list metadata-only (protocol.md §8)', () => {
    const h = harness();
    const text = '正文往返：未付款订单必须可取消。';
    const createdRow = createRequirement(h, { contentMarkdown: body(text) });
    const requirementId = createdRow['requirementId'] as string;

    const detail = call(h, 'requirement.get', { requirementId });
    expect(detail['contentMarkdown']).toContain(text);
    // The body carries the version marker and the six headings; the round-trip is
    // the committed file, not a re-rendered approximation.
    expect(detail['contentMarkdown']).toContain('## 完成摘要');

    const listed = call(h, 'requirement.list', {});
    const item = (listed['items'] as JsonObject[])[0] as JsonObject;
    expect(item['contentMarkdown']).toBeUndefined();
    expect(item['portableRef']).toBeDefined();
  });

  it('archives and restores the real Git record, with typed refusals (workflow.md §5.1)', () => {
    const h = harness();

    // A Queued requirement archives directly and restores to Queued.
    const queuedId = createRequirement(h)['requirementId'] as string;
    const archived = call(h, 'requirement.archive', { requirementId: queuedId });
    expect(archived['status']).toBe('accepted');
    expect(archived['lifecycle']).toBe('archived');
    expect((archived['git'] as JsonObject)['commit']).toBeTruthy();
    expect(call(h, 'requirement.get', { requirementId: queuedId })['lifecycle']).toBe('archived');

    const restored = call(h, 'requirement.restore', { requirementId: queuedId });
    expect(restored['status']).toBe('accepted');
    expect(restored['lifecycle']).toBe('queued');
    expect(call(h, 'requirement.get', { requirementId: queuedId })['lifecycle']).toBe('queued');

    // Restoring a non-archived requirement is refused.
    const restoreRefusal = refusal(() =>
      call(h, 'requirement.restore', { requirementId: queuedId }),
    );
    expect(restoreRefusal.code).toBe('INVALID_STATE');

    // A Completed requirement archives with previousLifecycle=completed and restores
    // back to completed, because its record carries the completion fact.
    const completedId = createRequirement(h, { title: '已完成需求' })['requirementId'] as string;
    call(h, 'requirement.save', { requirementId: completedId, patch: { lifecycle: 'active' } });
    call(h, 'requirement.save', {
      requirementId: completedId,
      patch: { lifecycle: 'completed', completion: completionFact() },
    });
    const archivedCompleted = call(h, 'requirement.archive', { requirementId: completedId });
    expect(archivedCompleted['lifecycle']).toBe('archived');
    const restoredCompleted = call(h, 'requirement.restore', { requirementId: completedId });
    expect(restoredCompleted['lifecycle']).toBe('completed');

    // An Active requirement may not archive; it must be completed or cancelled.
    const activeId = createRequirement(h, { title: '进行中需求' })['requirementId'] as string;
    call(h, 'requirement.save', { requirementId: activeId, patch: { lifecycle: 'active' } });
    const activeRefusal = refusal(() =>
      call(h, 'requirement.archive', { requirementId: activeId }),
    );
    expect(activeRefusal.code).toBe('INVALID_STATE');

    // A live Run under the requirement's Work blocks archiving.
    const requirementId = createRequirement(h, { title: '带活跃 Run 的需求' })[
      'requirementId'
    ] as string;
    const workId = h.store.newId();
    const budget = h.store.budgets.insert({
      projectId: h.projectId,
      workId,
      tokenLimit: 100_000,
      tokensUsed: 0,
      tokensReserved: 0,
      activeTimeLimit: 3_600,
      activeTimeUsed: 0,
      repairLimit: 3,
      repairUsed: 0,
      costKnown: true,
    });
    h.store.works.insert({
      id: workId,
      projectId: h.projectId,
      requirementId,
      intent: 'delivery',
      purpose: 'test',
      level: 'L2',
      goal: 'test',
      scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
      sourceRef: { kind: 'action', id: h.store.newId(), version: '1' },
      status: 'running',
      blockerIds: [],
      budgetId: budget.id,
      policyRevision: 1,
    } as never);
    h.store.requirements.update(
      requirementId,
      { workId },
      h.store.requirements.find(requirementId)?.version ?? 1,
    );
    h.store.runs.insert({
      projectId: h.projectId,
      workId,
      role: 'backend',
      purpose: 'implementation',
      stage: 'Develop',
      status: 'running',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: 'c'.repeat(64),
      contextSnapshotId: 'd'.repeat(64),
      dispatchSnapshotId: 'e'.repeat(64),
      budgetAllocation: 100,
    });
    const liveRefusal = refusal(() => call(h, 'requirement.archive', { requirementId }));
    expect(liveRefusal.code).toBe('INVALID_STATE');
    expect(liveRefusal.details?.['runId']).toBeDefined();
  });

  it('writes a completion only when the completion fact is supplied (requirements.md §2)', () => {
    const h = harness();
    const requirementId = createRequirement(h)['requirementId'] as string;
    h.store.requirements.update(
      requirementId,
      { lifecycle: 'active' },
      h.store.requirements.find(requirementId)?.version ?? 1,
    );

    // The bare lifecycle change the WebUI sends today cannot invent a completion
    // fact, so it is refused with the documented gate code.
    const bare = refusal(() =>
      call(h, 'requirement.save', { requirementId, patch: { lifecycle: 'completed' } }),
    );
    expect(bare.code).toBe('GATE_NOT_READY');

    const completed = call(h, 'requirement.save', {
      requirementId,
      patch: {
        lifecycle: 'completed',
        completion: {
          completedAt: TIME,
          summary: '已交付',
          codeRevision: 'a'.repeat(40),
          codeTree: 'b'.repeat(64),
          featureIds: [],
          verificationSummary: '独立测试通过',
          remainingIssues: [],
        },
      },
    });
    expect(completed['status']).toBe('applied');
    const row = call(h, 'requirement.get', { requirementId });
    expect(row['lifecycle']).toBe('completed');

    // The original `queued → completed` transition is refused (workflow.md §5.1).
    const otherId = createRequirement(h, { title: '另一个需求' })['requirementId'] as string;
    const jump = refusal(() =>
      call(h, 'requirement.save', {
        requirementId: otherId,
        patch: {
          lifecycle: 'completed',
          completion: {
            completedAt: TIME,
            summary: 'x',
            codeRevision: 'a'.repeat(40),
            codeTree: 'b'.repeat(64),
            featureIds: [],
            verificationSummary: 'x',
            remainingIssues: [],
          },
        },
      }),
    );
    expect(jump.code).toBe('INVALID_STATE');
  });

  it('imports the committed pool and reports per-record conflicts (protocol.md §4/§8)', () => {
    const h = harness();
    const requirementId = createRequirement(h)['requirementId'] as string;
    const revision = h.store.requirements.find(requirementId)?.portableRef.revision ?? '';
    expect(revision).not.toBe('');

    // Re-importing the same revision is an idempotent no-op: the projection already
    // holds those exact records, so the verdict is `unchanged`, never a conflict.
    const reimported = call(h, 'requirement.import', { revision });
    expect(reimported['status']).toBe('accepted');
    expect(reimported['conflicts']).toEqual([]);
    const imported = reimported['imported'] as JsonObject[];
    expect(imported).toHaveLength(1);
    expect(imported[0]?.['verdict']).toBe('unchanged');
  });

  it('starts a queued requirement: pre-allocated Work, active Git record, then Work (protocol.md §4)', () => {
    const h = harness();
    const requirementId = createRequirement(h)['requirementId'] as string;

    const started = call(h, 'requirement.start', {
      requirementId,
      budget: { tokenLimit: 42_000, timeLimit: 900, repairLimit: 2 },
    });
    expect(started['status']).toBe('accepted');
    const workId = started['workId'] as string;
    expect(workId).toBeTruthy();

    const row = call(h, 'requirement.get', { requirementId });
    expect(row['lifecycle']).toBe('active');
    expect(row['workId']).toBe(workId);
    const work = h.store.works.find(workId);
    expect(work?.requirementId).toBe(requirementId);
    expect(h.store.budgets.find(work?.budgetId ?? '')?.tokenLimit).toBe(42_000);

    // A second start is refused: the Work already exists.
    const again = refusal(() => call(h, 'requirement.start', { requirementId }));
    expect(again.code).toBe('INVALID_STATE');

    // Only a Queued requirement starts.
    const otherId = createRequirement(h, { title: '已归档需求' })['requirementId'] as string;
    h.store.requirements.update(
      otherId,
      { lifecycle: 'archived', previousLifecycle: 'queued' },
      h.store.requirements.find(otherId)?.version ?? 1,
    );
    const notQueued = refusal(() => call(h, 'requirement.start', { requirementId: otherId }));
    expect(notQueued.code).toBe('INVALID_STATE');
  });

  it('keeps `requirement.get` honest for a missing record', () => {
    const h = harness();
    const missing = refusal(() => call(h, 'requirement.get', { requirementId: h.store.newId() }));
    expect(missing.code).toBe('NOT_FOUND');
  });
});

describe('work.control resume over parked Runs (WP11R5-01/02)', () => {
  function seedParked(h: Harness, count: number): { workId: string; runIds: string[] } {
    const workId = h.store.newId();
    const budget = h.store.budgets.insert({
      projectId: h.projectId,
      workId,
      tokenLimit: 100_000,
      tokensUsed: 0,
      tokensReserved: 0,
      activeTimeLimit: 3_600,
      activeTimeUsed: 0,
      repairLimit: 3,
      repairUsed: 0,
      costKnown: true,
    });
    h.store.works.insert({
      id: workId,
      projectId: h.projectId,
      intent: 'delivery',
      purpose: 'resume test',
      level: 'L2',
      goal: 'resume test',
      scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
      sourceRef: { kind: 'action', id: h.store.newId(), version: '1' },
      status: 'running',
      blockerIds: [],
      budgetId: budget.id,
      policyRevision: 1,
    } as never);
    const runIds: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const run = h.store.runs.insert({
        projectId: h.projectId,
        workId,
        role: 'backend',
        purpose: 'implementation',
        stage: 'Develop',
        status: 'interrupted',
        requiredChild: false,
        join: 'none',
        childIds: [],
        configSnapshotId: 'c'.repeat(64),
        contextSnapshotId: 'd'.repeat(64),
        dispatchSnapshotId: 'e'.repeat(64),
        budgetAllocation: 100,
      });
      runIds.push(run.id);
    }
    return { workId, runIds };
  }

  function attachRecovery(h: Harness, port: RunRecoveryPort): void {
    h.protocol.attachRunRecovery(port);
  }

  it('answers accepted and emits a real work.control_changed event', () => {
    const h = harness();
    const { workId, runIds } = seedParked(h, 1);
    const resumed: string[] = [];
    attachRecovery(h, {
      recordResumeDecision: () => ({ ok: true }),
      resumeParkedRun: (runId) => {
        resumed.push(runId);
        return { ok: true };
      },
    });
    const result = call(h, 'work.control', { action: 'resume', workId, reason: 'operator' });
    expect(result['status']).toBe('accepted');
    expect(result['resumedRunIds']).toEqual(runIds);
    expect(resumed).toEqual(runIds);
    const events = eventsOf(h, 'work.control_changed');
    expect(events).toHaveLength(1);
    expect((events[0]?.data as JsonObject)['control']).toBe('resume');
    expect((events[0]?.data as JsonObject)['resumedRunIds']).toEqual(runIds);
  });

  it('removes the partial write when a later parked Run cannot resume (WP11R5-01)', () => {
    const h = harness();
    const { workId, runIds } = seedParked(h, 2);
    const second = runIds[1] as string;
    // A real recovery verdict that withholds the new Attempt for the second Run: the
    // same durable fault `newAttemptAdmission` reads (AC-057).
    h.store.events.append({
      name: RUN_RECOVERED_EVENT,
      entityId: second,
      entityVersion: 1,
      data: { newAttemptAllowed: false, requiresRecoveryDecision: true },
    });
    const resumed: string[] = [];
    attachRecovery(h, {
      // The unconfirmable process means no resume decision can be recorded.
      recordResumeDecision: () => ({
        ok: false,
        code: 'RECOVERY_REQUIRED',
        message: 'old process not confirmed terminated',
      }),
      resumeParkedRun: (runId) => {
        resumed.push(runId);
        return { ok: true };
      },
    });
    const failed = refusal(() =>
      call(h, 'work.control', { action: 'resume', workId, reason: 'operator' }),
    );
    expect(failed.code).toBe('RECOVERY_REQUIRED');
    // The first Run was never resumed: no partial write survived the refusal.
    expect(resumed).toEqual([]);
    expect(eventsOf(h, 'work.control_changed')).toEqual([]);
    const stillParked = h.store.runs
      .list({ where: 'work_id = ?', params: [workId] })
      .filter((run) => run.status === 'interrupted');
    expect(stillParked.map((run) => run.id)).toEqual(runIds);
  });

  it('reports the already-resumed Runs when a later spawn fails, so the failure is resumable', () => {
    const h = harness();
    const { workId, runIds } = seedParked(h, 2);
    attachRecovery(h, {
      recordResumeDecision: () => ({ ok: true }),
      resumeParkedRun: (runId) =>
        runId === runIds[1]
          ? { ok: false, code: 'BUSY', message: 'project capacity exhausted' }
          : { ok: true },
    });
    const failed = refusal(() =>
      call(h, 'work.control', { action: 'resume', workId, reason: 'operator' }),
    );
    expect(failed.code).toBe('BUSY');
    expect(failed.details?.['resumedRunIds']).toEqual([runIds[0]]);
    expect(failed.details?.['failedRunId'] ?? failed.details?.['runId']).toBe(runIds[1]);
    // No event claims the whole Work resumed.
    expect(eventsOf(h, 'work.control_changed')).toEqual([]);
  });
});

describe('documented control and read commands (WP-12 T4b)', () => {
  function seedWork(h: Harness, status = 'running'): { workId: string; runId: string } {
    const workId = h.store.newId();
    const budget = h.store.budgets.insert({
      projectId: h.projectId,
      workId,
      tokenLimit: 500_000,
      tokensUsed: 1_000,
      tokensReserved: 0,
      activeTimeLimit: 3_600,
      activeTimeUsed: 0,
      repairLimit: 3,
      repairUsed: 0,
      costKnown: true,
    });
    h.store.works.insert({
      id: workId,
      projectId: h.projectId,
      intent: 'delivery',
      purpose: 'control test',
      level: 'L2',
      goal: 'control test',
      scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
      sourceRef: { kind: 'action', id: h.store.newId(), version: '1' },
      status,
      blockerIds: [],
      budgetId: budget.id,
      policyRevision: 1,
    } as never);
    const run = h.store.runs.insert({
      projectId: h.projectId,
      workId,
      role: 'backend',
      purpose: 'implementation',
      stage: 'Develop',
      status: 'queued',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: 'c'.repeat(64),
      contextSnapshotId: 'd'.repeat(64),
      dispatchSnapshotId: 'e'.repeat(64),
      budgetAllocation: 100,
    });
    return { workId, runId: run.id };
  }

  it('command.get returns the recorded response to the same subject only (protocol.md §4)', () => {
    const h = harness();
    const key = 't4b-command-get-1';
    const created = call(
      h,
      'requirement.create',
      {
        title: '幂等需求',
        goal: '验证 command.get',
        scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
        contentMarkdown: body('幂等需求。'),
      },
      { idempotencyKey: key },
    );
    const found = call(h, 'command.get', {
      operation: 'requirement.create',
      idempotencyKey: key,
    });
    expect(found['state']).toBe('completed');
    expect((found['response'] as JsonObject)['requirementId']).toBe(created['requirementId']);

    // A different caller subject cannot read another session's recorded command.
    const foreign = refusal(() =>
      JSON.parse(
        JSON.stringify(
          h.protocol.dispatch(
            'command.get',
            { operation: 'requirement.create', idempotencyKey: key },
            {
              caller: {
                subject: 'user:other',
                userId: userIdFromSubject('installation:local'),
                role: 'chief',
              },
            },
          ),
        ),
      ),
    );
    expect(foreign.code).toBe('NOT_FOUND');

    const unknown = refusal(() =>
      call(h, 'command.get', { operation: 'requirement.create', idempotencyKey: 'never-used' }),
    );
    expect(unknown.code).toBe('NOT_FOUND');
  });

  it('run.pause and run.resume drive the real Work control (protocol.md §4)', () => {
    const h = harness();
    const { workId, runId } = seedWork(h, 'running');
    const paused = call(h, 'run.pause', { runId, reason: 'operator' });
    expect(paused['status']).toBe('accepted');
    expect(paused['workId']).toBe(workId);
    expect(h.store.works.find(workId)?.status).toBe('paused');

    const live = h.store.runs.find(runId);
    if (live === undefined) throw new Error('seed Run missing');
    if (live.status !== 'paused') h.store.runs.update(runId, { status: 'paused' }, live.version);
    const resumed = call(h, 'run.resume', { runId, reason: 'operator' });
    expect(resumed['status']).toBe('accepted');
    expect(h.store.works.find(workId)?.status).not.toBe('paused');

    const missing = refusal(() => call(h, 'run.pause', { runId: h.store.newId() }));
    expect(missing.code).toBe('NOT_FOUND');
  });

  it('run.cancel cancels through the real findings service', () => {
    const h = harness();
    const { workId, runId } = seedWork(h, 'queued');
    const cancelled = call(h, 'run.cancel', { runId, reason: 'operator' });
    expect(cancelled['status']).toBe('accepted');
    expect(cancelled['cancelledRunIds']).toContain(runId);
    expect(h.store.runs.find(runId)?.status).toBe('cancelled');
    expect(h.store.works.find(workId)?.status).toBe('cancelled');
  });

  it('work.budget.update raises the envelope and records a user budget decision (protocol.md §4)', () => {
    const h = harness();
    const conversationId = call(h, 'conversation.create', { title: 'budget' })[
      'conversationId'
    ] as string;
    const sent = call(h, 'conversation.message.send', {
      conversationId,
      body: '加预算',
      attachmentIds: [],
    });
    const workId = sent['workId'] as string;
    const messageId = sent['messageId'] as string;

    const applied = call(h, 'work.budget.update', {
      workId,
      tokenLimit: 900_000,
      timeLimit: 7_200,
      repairLimit: 5,
      sourceMessageId: messageId,
    });
    expect(applied['status']).toBe('applied');
    const budget = h.store.budgets.find(h.store.works.find(workId)?.budgetId ?? '');
    expect(budget?.tokenLimit).toBe(900_000);
    expect(budget?.activeTimeLimit).toBe(7_200);
    expect((applied['budget'] as JsonObject)['tokenLimit']).toBe(900_000);
    const decisions = h.store.decisions.list({ where: 'work_id = ?', params: [workId] });
    expect(decisions.some((decision) => decision.kind === 'budget')).toBe(true);
    expect(eventsOf(h, 'decision.created')).toHaveLength(1);

    // A limit below what the Work already spent is refused as BUDGET_EXCEEDED.
    const budgetRow = h.store.budgets.find(h.store.works.find(workId)?.budgetId ?? '');
    if (budgetRow === undefined) throw new Error('budget row missing');
    h.store.budgets.update(budgetRow.id, { tokensUsed: 2_000 }, budgetRow.version);
    const tooSmall = refusal(() =>
      call(h, 'work.budget.update', {
        workId,
        tokenLimit: 1,
        timeLimit: 60,
        repairLimit: 1,
        sourceMessageId: messageId,
      }),
    );
    expect(tooSmall.code).toBe('BUDGET_EXCEEDED');
  });

  it('file.list and file.read answer a real Git revision (protocol.md §5)', () => {
    const h = harness();
    const read = call(h, 'file.read', {
      revision: h.seedRevision,
      path: 'README.md',
    });
    expect(read['content']).toBe('# demo\n');
    expect(read['mime']).toBe('text/markdown');
    expect(read['truncated']).toBe(false);

    const listed = call(h, 'file.list', { revision: h.seedRevision, path: '' });
    const paths = (listed['items'] as JsonObject[]).map((item) => item['path']);
    expect(paths).toContain('README.md');
    expect(paths).toContain('src');
    // A directory listing is one level deep; the nested blob is listed by naming it.
    const nested = call(h, 'file.list', { revision: h.seedRevision, path: 'src' });
    const nestedPaths = (nested['items'] as JsonObject[]).map((item) => item['path']);
    expect(nestedPaths).toContain('src/orders.ts');

    const missing = refusal(() =>
      call(h, 'file.read', { revision: h.seedRevision, path: 'nope.txt' }),
    );
    expect(missing.code).toBe('NOT_FOUND');
    const badRevision = refusal(() => call(h, 'file.list', { revision: 'deadbeef', path: '' }));
    expect(badRevision.code).toBe('NOT_FOUND');
  });

  it('extension.list is the shipped whitelist and extension.set refuses unknown/critical ids (protocol.md §5)', () => {
    const h = harness();
    const listed = call(h, 'extension.list', {});
    expect(listed['items']).toEqual([]);

    const unknown = refusal(() => call(h, 'extension.set', { id: 'not-shipped', enabled: true }));
    expect(unknown.code).toBe('NOT_FOUND');

    const critical = harness({
      extensions: [
        {
          id: 'critical-sample',
          version: '1.0.0',
          apiVersion: 1,
          capabilities: ['sample'],
          critical: true,
          enabledByDefault: true,
        } satisfies ExtensionSpec,
      ],
    });
    const refusalCritical = refusal(() =>
      call(critical, 'extension.set', { id: 'critical-sample', enabled: false }),
    );
    expect(refusalCritical.code).toBe('INVALID_STATE');
    const enabled = call(critical, 'extension.set', { id: 'critical-sample', enabled: true });
    expect(enabled['status']).toBe('applied');
  });
});

describe('real HTTP /rpc probe for the documented commands (WP-12 T4b)', () => {
  it('routes every new command through the real /rpc route with the WebUI payloads', async () => {
    const h = harness();
    // A Work/Run/message the Run-control and budget commands name, seeded directly
    // because their producers (a real Chief Run) are not part of this probe.
    const workId = h.store.newId();
    const budget = h.store.budgets.insert({
      projectId: h.projectId,
      workId,
      tokenLimit: 500_000,
      tokensUsed: 0,
      tokensReserved: 0,
      activeTimeLimit: 3_600,
      activeTimeUsed: 0,
      repairLimit: 3,
      repairUsed: 0,
      costKnown: true,
    });
    h.store.works.insert({
      id: workId,
      projectId: h.projectId,
      intent: 'delivery',
      purpose: 'http probe',
      level: 'L2',
      goal: 'http probe',
      scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
      sourceRef: { kind: 'action', id: h.store.newId(), version: '1' },
      status: 'running',
      blockerIds: [],
      budgetId: budget.id,
      policyRevision: 1,
    } as never);
    const runId = h.store.runs.insert({
      projectId: h.projectId,
      workId,
      role: 'backend',
      purpose: 'implementation',
      stage: 'Develop',
      status: 'queued',
      requiredChild: false,
      join: 'none',
      childIds: [],
      configSnapshotId: 'c'.repeat(64),
      contextSnapshotId: 'd'.repeat(64),
      dispatchSnapshotId: 'e'.repeat(64),
      budgetAllocation: 100,
    }).id;
    const conversationId = call(h, 'conversation.create', { title: 'probe' })[
      'conversationId'
    ] as string;
    const messageId = call(h, 'conversation.message.send', {
      conversationId,
      body: 'probe',
      attachmentIds: [],
    })['messageId'] as string;

    const server = createServer((request, response) => {
      void (async () => {
        if ((request.url ?? '') !== '/rpc' || request.method !== 'POST') {
          response.writeHead(404).end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk as Buffer);
        try {
          const envelope = parseEnvelope(
            JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown,
          );
          const result = h.protocol.dispatchEnvelope(envelope, caller);
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({ v: 1, type: 'response', id: envelope.id, ok: true, result }),
          );
        } catch (error) {
          const failure = error as { status?: number; code?: string; message?: string };
          response.writeHead(failure.status ?? statusForCode(failure.code ?? 'INTERNAL_ERROR'), {
            'content-type': 'application/json',
          });
          response.end(
            JSON.stringify({
              ok: false,
              error: { code: failure.code ?? 'INTERNAL_ERROR', message: failure.message ?? '' },
            }),
          );
        }
      })();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address !== 'object') throw new Error('no address');
    const endpoint = `http://127.0.0.1:${String(address.port)}/rpc`;
    let counter = 0;
    const rpc = async (
      method: string,
      params: JsonObject,
      extra: JsonObject = {},
    ): Promise<{ status: number; result: JsonObject }> => {
      counter += 1;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          v: 1,
          type: 'request',
          id: `p-${String(counter)}`,
          method,
          params,
          ...extra,
        }),
      });
      const body = (await response.json()) as { result?: JsonObject };
      return { status: response.status, result: body.result ?? {} };
    };
    try {
      const created = await rpc('requirement.create', {
        title: 'HTTP 探针需求',
        goal: '探针',
        scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
        contentMarkdown: body('HTTP 探针需求。'),
      });
      expect(created.status).toBe(200);
      const requirementId = created.result['requirementId'] as string;

      const revision = h.store.requirements.find(requirementId)?.portableRef.revision ?? '';
      expect((await rpc('requirement.get', { requirementId })).status).toBe(200);
      expect((await rpc('requirement.list', {})).status).toBe(200);
      expect((await rpc('board', {})).status).toBe(200);
      expect((await rpc('requirement.import', { revision })).status).toBe(200);
      const updated = await rpc('requirement.update', {
        requirementId,
        patch: { goal: '探针（更新）' },
      });
      expect(updated.status).toBe(200);
      expect(
        (await rpc('requirement.archive', { requirementId }, { idempotencyKey: 'p-archive' }))
          .status,
      ).toBe(200);
      expect(
        (await rpc('requirement.restore', { requirementId }, { idempotencyKey: 'p-restore' }))
          .status,
      ).toBe(200);

      // `requirement.start` needs its own Queued record; the create above is already
      // active after the archive/restore round-trip.
      const startable = await rpc('requirement.create', {
        title: 'HTTP 探针启动需求',
        goal: '探针启动',
        scope: { readPaths: [], writePaths: [], operations: [], networkTargets: [] },
        contentMarkdown: body('HTTP 探针启动需求。'),
      });
      const startableId = startable.result['requirementId'] as string;
      expect(
        (
          await rpc(
            'requirement.start',
            {
              requirementId: startableId,
              budget: { tokenLimit: 20_000, timeLimit: 600, repairLimit: 1 },
            },
            { idempotencyKey: 'p-start' },
          )
        ).status,
      ).toBe(200);

      expect((await rpc('extension.list', {})).status).toBe(200);
      expect((await rpc('file.list', { revision: h.seedRevision, path: '' })).status).toBe(200);
      expect((await rpc('file.read', { revision: h.seedRevision, path: 'README.md' })).status).toBe(
        200,
      );
      expect(
        (
          await rpc('work.budget.update', {
            workId,
            tokenLimit: 600_000,
            timeLimit: 7_200,
            repairLimit: 4,
            sourceMessageId: messageId,
          })
        ).status,
      ).toBe(200);
      expect((await rpc('run.pause', { runId, reason: 'probe' })).status).toBe(200);
      expect((await rpc('run.resume', { runId, reason: 'probe' })).status).toBe(200);
      expect((await rpc('run.cancel', { runId, reason: 'probe' })).status).toBe(200);
      // `command.get` is a read of the recorded create; a never-used key is the
      // documented 404 through the same route.
      expect(
        (
          await rpc('command.get', {
            operation: 'requirement.create',
            idempotencyKey: 'p-never-used',
          })
        ).status,
      ).toBe(404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('context.preview over the production context ports (protocol.md §5)', () => {
  /** A running Work at the seeded delivery revision so the preview has a frozen base. */
  function seedPreviewWork(h: Harness): string {
    const workId = h.store.newId();
    const budget = h.store.budgets.insert({
      projectId: h.projectId,
      workId,
      tokenLimit: 200_000,
      tokensUsed: 0,
      tokensReserved: 0,
      activeTimeLimit: 3_600,
      activeTimeUsed: 0,
      repairLimit: 2,
      repairUsed: 0,
      costKnown: true,
    });
    h.store.works.insert({
      id: workId,
      projectId: h.projectId,
      intent: 'delivery',
      purpose: 'context preview',
      level: 'L2',
      goal: 'preview the context selection',
      scope: { readPaths: ['src'], writePaths: [], operations: ['read'], networkTargets: [] },
      // A user-sourced Work, so `context.preview` can honestly assert `userRequest`.
      sourceRef: { kind: 'message', id: h.store.newId(), version: '1' },
      status: 'running',
      blockerIds: [],
      baseRevision: h.seedRevision,
      budgetId: budget.id,
      policyRevision: 1,
    });
    return workId;
  }

  it('returns resolved/excluded/missing/estimatedTokens without freezing a snapshot', () => {
    const h = harness();
    const workId = seedPreviewWork(h);
    const selection = {
      goal: 'read the orders module',
      sourceRefs: [
        {
          kind: 'git',
          id: 'src/orders.ts',
          version: h.seedRevision,
          path: 'src/orders.ts',
        },
      ],
      reasonPerSource: { 'git:src/orders.ts': 'the module under preview' },
      featureRefs: [],
      codePaths: ['src/orders.ts'],
      artifactRefs: [],
      excluded: [],
      unknowns: [],
      readBudget: { initialTokens: 24_000, expansionTokens: 16_000 },
    };
    const result = call(h, 'context.preview', { workId, role: 'chief', selection });
    expect(result['status']).toBe('accepted');
    expect(result['role']).toBe('chief');
    expect(result['revision']).toBe(h.seedRevision);
    const resolved = result['resolved'] as JsonObject[];
    expect(resolved.some((entry) => entry['path'] === 'src/orders.ts')).toBe(true);
    expect(result['estimatedTokens']).toBeGreaterThan(0);
    expect(result['policyHash']).toMatch(/^[0-9a-f]{64}$/u);
    expect(result['readScopeDigest']).toMatch(/^[0-9a-f]{64}$/u);
    // Dry-run wrote no snapshot directory under the project data dir.
    expect(existsSync(join(h.store.dataDir, 'snapshots', 'context'))).toBe(false);

    // A missing committed path is reported as missing/excluded, never fabricated.
    const missing = call(h, 'context.preview', {
      workId,
      role: 'chief',
      selection: {
        ...selection,
        sourceRefs: [
          { kind: 'git', id: 'src/nope.ts', version: h.seedRevision, path: 'src/nope.ts' },
        ],
        reasonPerSource: { 'git:src/nope.ts': 'a path that does not exist' },
        codePaths: ['src/nope.ts'],
      },
    });
    expect(missing['status']).toBe('accepted');
    // The role contract is the gate's own fixed input, so the missing *selection*
    // source is what must not appear as resolved.
    const missingResolved = missing['resolved'] as JsonObject[];
    expect(missingResolved.some((entry) => entry['path'] === 'src/nope.ts')).toBe(false);
    expect((missing['missing'] as JsonObject[]).length).toBeGreaterThan(0);
  });

  it('refuses an out-of-scope transcript instead of widening the read scope (agents.md §2)', () => {
    const h = harness();
    const workId = seedPreviewWork(h);
    const refused = refusal(() =>
      call(h, 'context.preview', {
        workId,
        role: 'chief',
        selection: {
          goal: 'read another agent transcript',
          sourceRefs: [{ kind: 'transcript', id: h.store.newId(), version: '1' }],
          reasonPerSource: {},
          featureRefs: [],
          codePaths: [],
          artifactRefs: [],
          excluded: [],
          unknowns: [],
          readBudget: { initialTokens: 24_000, expansionTokens: 16_000 },
        },
      }),
    );
    expect(['CONTEXT_FORBIDDEN', 'VALIDATION_ERROR']).toContain(refused.code);
  });
});
