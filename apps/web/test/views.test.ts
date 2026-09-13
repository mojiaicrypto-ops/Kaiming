/**
 * WP-09 T3 unit coverage for the workbench view models.
 *
 * Every assertion here is an acceptance-criteria rule stated in `views.ts`, driven
 * by a protocol-shaped input rather than by a rendered page:
 *
 * - AC-068 board identity, the L1 exclusion and the "Queued without Work" flags;
 * - AC-074 Inbox de-duplication per target version and the internal-repair summary;
 * - AC-070 artifact version/validity and the expired Plan card;
 * - AC-069 run status is only a success when the server says so;
 * - AC-076 the client half of the attachment limits;
 * - AC-077 the file path boundary and the revision label.
 */
import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_LIMITS,
  BOARD_COLUMNS,
  agentsModel,
  boardModel,
  chiefModel,
  filesModel,
  inboxModel,
  isSuccessfulRun,
  liveEventOf,
  requirementDetail,
  runDetail,
  runsModel,
  settingsModel,
  validateAttachments,
} from '../src/views.js';
import {
  FILE_LIMITS,
  FileBoundaryError,
  isTextMime,
  mimeOf,
  relativeToRoot,
  resolveInsideRoot,
} from '../src/files.js';
import type { JsonObject } from '@agentdev/contracts';

const boardPayload: JsonObject = {
  columns: {
    queued: [
      {
        requirementId: 'req-queued',
        identity: 'req-queued',
        title: 'queued one',
        goal: 'goal',
        lifecycle: 'queued',
        previousLifecycle: null,
        phase: null,
        recordVersion: 2,
        executionAvailability: 'needs_replan',
        evidenceAvailability: 'summary_only',
        saveState: 'saved',
        work: null,
        tasks: { total: 0, done: 0 },
        awaitingDecision: 0,
        canCancelWithoutWork: true,
        canPause: false,
      },
    ],
    active: [
      {
        requirementId: 'req-active',
        identity: 'req-active',
        title: 'active one',
        goal: 'goal',
        lifecycle: 'active',
        previousLifecycle: 'queued',
        phase: 'execute',
        recordVersion: 5,
        executionAvailability: 'local',
        evidenceAvailability: 'full',
        saveState: 'saving',
        work: {
          id: 'work-1',
          status: 'running',
          level: 'L2',
          intent: 'delivery',
          blockers: ['b1'],
        },
        tasks: { total: 4, done: 2 },
        awaitingDecision: 1,
        canCancelWithoutWork: false,
        canPause: true,
      },
    ],
    completed: [],
    archived: [],
  },
  requirementIds: ['req-queued', 'req-active'],
  excludedWorkIds: ['l1-work'],
  rule: {
    l1NotOnBoard: true,
    queuedWithoutWorkCancellable: true,
    pauseQueuedWithoutWork: 'INVALID_STATE',
  },
};

describe('board projection (AC-068)', () => {
  it('keeps one identity per requirement, in the documented four columns', () => {
    const model = boardModel(boardPayload);
    expect(Object.keys(model.columns)).toEqual([...BOARD_COLUMNS]);
    expect(model.columns.queued).toHaveLength(1);
    expect(model.columns.active).toHaveLength(1);
    // The identity shown to the user is the Requirement id, never the Work id.
    expect(model.columns.active[0]?.identity).toBe('req-active');
    expect(model.columns.active[0]?.work?.workId).toBe('work-1');
    expect(model.duplicatedIdentities).toEqual([]);
    // L1 / assist work is excluded by the server and reported as such.
    expect(model.excludedWorkIds).toEqual(['l1-work']);
    expect(model.rules.l1NotOnBoard).toBe(true);
  });

  it('reports the pause refusal for a Queued requirement without local Work', () => {
    const model = boardModel(boardPayload);
    const card = model.columns.queued[0];
    expect(card?.canCancelWithoutWork).toBe(true);
    expect(card?.canPause).toBe(false);
    expect(model.rules.pauseQueuedWithoutWork).toBe('INVALID_STATE');
  });

  it('flags a requirement that appears in two columns as a duplicated identity', () => {
    const duplicated = boardModel({
      columns: {
        queued: [{ requirementId: 'r', identity: 'r', lifecycle: 'queued' }],
        active: [{ requirementId: 'r', identity: 'r', lifecycle: 'active' }],
      },
    });
    expect(duplicated.duplicatedIdentities).toEqual(['r']);
  });

  it('reads the save state and the task ratio from the projection', () => {
    const card = boardModel(boardPayload).columns.active[0];
    expect(card?.tasksDone).toBe(2);
    expect(card?.tasksTotal).toBe(4);
    expect(card?.blockers).toBe(1);
    expect(card?.awaitingDecision).toBe(1);
    expect(card?.saveState).toBe('saving');
  });
});

describe('inbox projection (AC-074)', () => {
  const inbox: JsonObject = {
    items: [
      {
        kind: 'decision',
        id: 'd1',
        workId: 'w1',
        decisionKind: 'start',
        targetRef: { id: 'target-1', version: 3 },
        targetVersion: 3,
        choices: ['now', 'later'],
        state: 'pending',
        actionable: true,
      },
      {
        kind: 'decision',
        id: 'd2',
        workId: 'w1',
        decisionKind: 'start',
        targetRef: { id: 'target-1', version: 3 },
        targetVersion: 3,
        choices: ['now', 'later'],
        state: 'pending',
        actionable: true,
      },
      {
        kind: 'decision',
        id: 'd3',
        workId: 'w1',
        decisionKind: 'start',
        targetRef: { id: 'target-1', version: 4 },
        targetVersion: 4,
        choices: ['now', 'later'],
        state: 'expired',
        actionable: false,
      },
      { kind: 'finding', id: 'f1', workId: 'w1', severity: 'P1', count: 1, actionable: true },
      { kind: 'finding', id: 'f2', workId: 'w1', severity: 'P1', count: 1, actionable: true },
      { kind: 'finding', id: 'f3', workId: 'w1', severity: 'P2', count: 2, actionable: true },
      { kind: 'recovery', id: 'r1', workId: 'w2', runId: 'run-9', status: 'recovery_required' },
    ],
    unread: 3,
  };

  it('collapses a decision to one row per target version', () => {
    const model = inboxModel(inbox);
    expect(model.decisions).toHaveLength(2);
    expect(model.decisions.map((row) => row.targetVersion)).toEqual([3, 4]);
  });

  it('marks an expired decision actionable=none and expired=true', () => {
    const model = inboxModel(inbox);
    const expired = model.decisions.find((row) => row.targetVersion === 4);
    expect(expired?.expired).toBe(true);
    expect(expired?.actionable).toBe(false);
  });

  it('summarises internal repairs per Work+severity instead of listing them', () => {
    const model = inboxModel(inbox);
    expect(model.findings).toHaveLength(2);
    const p1 = model.findings.find((row) => row.severity === 'P1');
    expect(p1?.count).toBe(2);
    expect(p1?.internalRepair).toBe(true);
  });

  it('keeps a recovery wait as its own row', () => {
    const model = inboxModel(inbox);
    expect(model.recoveries).toHaveLength(1);
    expect(model.recoveries[0]?.runId).toBe('run-9');
  });
});

describe('requirement detail (AC-070)', () => {
  const requirement: JsonObject = {
    id: 'req-1',
    title: 'Ship it',
    goal: 'goal',
    lifecycle: 'active',
    recordVersion: 4,
    portableRef: 'ref',
    saveState: 'saved',
    executionAvailability: 'local',
    evidenceAvailability: 'full',
    work: { id: 'work-1', status: 'running' },
    acceptance: ['a'],
    openQuestions: [],
  };

  it('marks the plan card expired when the shown version is not the current one', () => {
    const detail = requirementDetail({
      requirement,
      artifacts: [],
      runs: [],
      plan: { workId: 'work-1', revision: 'rev', currentVersion: 7, requestedVersion: 6 },
    });
    expect(detail.plan?.expired).toBe(true);
    expect(detail.plan?.currentVersion).toBe(7);
  });

  it('keeps a current plan card approvable', () => {
    const detail = requirementDetail({
      requirement,
      artifacts: [],
      runs: [],
      plan: { workId: 'work-1', revision: 'rev', currentVersion: 7, requestedVersion: 7 },
    });
    expect(detail.plan?.expired).toBe(false);
  });

  it('carries artifact version and validity without presenting history as current', () => {
    const detail = requirementDetail({
      requirement,
      artifacts: [
        {
          id: 'art-1',
          kind: 'diff',
          authorRole: 'backend',
          artifactVersion: 1,
          validity: 'invalidated',
          isLatest: false,
          versionCount: 2,
          mime: 'text/plain',
          bytes: 12,
          hash: 'h',
        },
        {
          id: 'art-2',
          kind: 'diff',
          authorRole: 'backend',
          artifactVersion: 2,
          validity: 'valid',
          isLatest: true,
          versionCount: 2,
          mime: 'text/plain',
          bytes: 20,
          hash: 'h2',
        },
      ],
      runs: [],
    });
    expect(detail.artifacts).toHaveLength(2);
    expect(detail.artifacts[0]).toMatchObject({
      artifactVersion: 1,
      validity: 'invalidated',
      isLatest: false,
    });
    expect(detail.artifacts[1]).toMatchObject({
      artifactVersion: 2,
      validity: 'valid',
      isLatest: true,
    });
  });

  it('states waiting-to-continue for an imported active record with no Work', () => {
    const detail = requirementDetail({
      requirement: { ...requirement, work: null, lifecycle: 'active' },
      artifacts: [],
      runs: [],
    });
    expect(detail.waitingToContinue).toBe(true);
    expect(detail.workId).toBeNull();
  });

  it('surfaces attempts, epoch and evidence in a Run detail', () => {
    const detail = runDetail({
      run: { id: 'run-1', workId: 'work-1', role: 'backend', status: 'running' },
      attempts: [
        { id: 'att-1', number: 1, ownerEpoch: 3, status: 'running', runnerId: 'runner-1' },
      ],
      stageResults: [{ id: 'sr-1', stage: 'execute', status: 'completed', evidenceRefs: ['e1'] }],
    });
    expect(detail.attempts[0]?.epoch).toBe(3);
    expect(detail.evidenceRefs).toEqual(['e1']);
  });
});

describe('run status honesty (AC-069/AC-070)', () => {
  it('treats only a completed Run as a success', () => {
    expect(isSuccessfulRun({ status: 'completed', outcome: null })).toBe(true);
    expect(isSuccessfulRun({ status: 'failed', outcome: null })).toBe(false);
    expect(isSuccessfulRun({ status: 'cancelled', outcome: null })).toBe(false);
    expect(isSuccessfulRun({ status: 'recovery_required', outcome: null })).toBe(false);
    expect(isSuccessfulRun({ status: 'timed_out', outcome: null })).toBe(false);
  });

  it('separates direct/L1 work from board work in the Runs page', () => {
    const model = runsModel([
      { id: 'w1', goal: 'g', level: 'L2', intent: 'delivery', status: 'running' },
      { id: 'w2', goal: 'g', level: 'L1', intent: 'delivery', status: 'completed' },
      { id: 'w3', goal: 'g', level: 'none', intent: 'assist', status: 'completed' },
    ]);
    expect(model.onBoard.map((row) => row.workId)).toEqual(['w1']);
    expect(model.direct.map((row) => row.workId)).toEqual(['w2', 'w3']);
  });
});

describe('attachment limits (AC-076)', () => {
  const file = (name: string, mime: string, bytes: number) => ({ name, mime, bytes });

  it('accepts a documented set', () => {
    expect(validateAttachments([file('a.md', 'text/markdown', 10)])).toEqual({ ok: true });
  });

  it('refuses more than five attachments', () => {
    const many = Array.from({ length: ATTACHMENT_LIMITS.maxCount + 1 }, (_, index) =>
      file(`f${String(index)}.png`, 'image/png', 1),
    );
    expect(validateAttachments(many)).toMatchObject({
      ok: false,
      reasonKey: 'chief.attachmentTooMany',
    });
  });

  it('refuses one file over 20 MiB and a total over 50 MiB', () => {
    expect(
      validateAttachments([file('big.png', 'image/png', ATTACHMENT_LIMITS.maxFileBytes + 1)]),
    ).toMatchObject({ ok: false, reasonKey: 'chief.attachmentTooLarge' });
    const four = Array.from({ length: 4 }, (_, index) =>
      file(`f${String(index)}.png`, 'image/png', 19 * 1024 * 1024),
    );
    expect(validateAttachments(four)).toMatchObject({
      ok: false,
      reasonKey: 'chief.attachmentTotalTooLarge',
    });
  });

  it('refuses an unsupported mime type', () => {
    expect(validateAttachments([file('a.zip', 'application/zip', 10)])).toMatchObject({
      ok: false,
      reasonKey: 'chief.attachmentMime',
    });
  });

  it('treats a mime parameter as the same type', () => {
    expect(validateAttachments([file('a.txt', 'text/plain; charset=utf-8', 10)])).toEqual({
      ok: true,
    });
  });
});

describe('file boundary (AC-077)', () => {
  it('resolves a nested relative path inside the root', () => {
    expect(resolveInsideRoot('/repo', 'src/index.ts')).toBe('/repo/src/index.ts');
  });

  it('refuses a path that escapes the root', () => {
    expect(() => resolveInsideRoot('/repo', '../etc/passwd')).toThrow(FileBoundaryError);
    expect(() => resolveInsideRoot('/repo', 'src/../../etc/passwd')).toThrow(FileBoundaryError);
  });

  it('refuses an absolute path instead of re-rooting it', () => {
    expect(() => resolveInsideRoot('/repo', '/etc/passwd')).toThrow(FileBoundaryError);
  });

  it('renders a root-relative path for the wire', () => {
    expect(relativeToRoot('/repo', '/repo/src/index.ts')).toBe('src/index.ts');
  });

  it('maps mime types and keeps the inline line/byte limits explicit', () => {
    expect(mimeOf('notes.md')).toBe('text/markdown');
    expect(mimeOf('image.png')).toBe('image/png');
    expect(isTextMime('text/plain')).toBe(true);
    expect(isTextMime('image/png')).toBe(false);
    expect(FILE_LIMITS.maxInlineLines).toBe(2_000);
    expect(FILE_LIMITS.maxInlineBytes).toBe(1024 * 1024);
  });
});

describe('chief, agents, settings and live projections', () => {
  it('marks every conversation message non-translatable', () => {
    const model = chiefModel({
      conversation: { id: 'c1', title: 'Chief' },
      conversations: [{ id: 'c1', title: 'Chief' }],
      messages: [
        { id: 'm1', seq: 1, role: 'user', state: 'received', body: 'hello', createdAt: 'now' },
      ],
    });
    expect(model.messages[0]?.translatable).toBe(false);
    expect(model.messages[0]?.body).toBe('hello');
  });

  it('keeps the provider-unavailable flag honest', () => {
    const model = chiefModel({
      conversation: { id: 'c1', title: 'Chief' },
      conversations: [],
      messages: [],
      providerReady: false,
    });
    expect(model.providerReady).toBe(false);
  });

  it('reads an unusable role with its reason and provenance', () => {
    const model = agentsModel({
      roles: [
        {
          role: 'chief',
          usable: false,
          unavailableReason: 'provider p is not configured',
          profile: null,
          overrides: {},
        },
        {
          role: 'backend',
          usable: true,
          unavailableReason: null,
          profile: {
            providerId: 'p',
            modelId: 'm',
            reasoning: 'high',
            effectiveContextLimit: 100000,
            sources: { modelId: 'globalRole' },
            toolSubset: ['read_file'],
          },
        },
      ],
      providers: [
        {
          providerId: 'p',
          type: 'openai',
          baseUrl: 'http://x',
          enabled: true,
          secretConfigured: true,
          models: ['m'],
        },
      ],
      activeRuns: 2,
    });
    expect(model.roles[0]?.usable).toBe(false);
    expect(model.roles[0]?.unavailableReason).toContain('not configured');
    expect(model.roles[1]?.sources['modelId']).toBe('globalRole');
    expect(model.roles[1]?.tools).toEqual(['read_file']);
    expect(model.providers[0]?.secretConfigured).toBe(true);
    expect(model.activeRuns).toBe(2);
  });

  it('reads the config revision and never invents a provider secret', () => {
    const model = settingsModel({
      scope: 'global',
      version: 3,
      revision: '3',
      providers: [
        {
          providerId: 'p',
          type: 'openai',
          baseUrl: 'http://x',
          enabled: true,
          secretRef: null,
          secretConfigured: false,
        },
      ],
      roleProfiles: {},
      limits: {},
      effectiveLimits: { roleConcurrency: 2 },
      policy: { permissionMode: 'auto' },
    });
    expect(model.revision).toBe('3');
    expect(model.providers[0]?.secretConfigured).toBe(false);
    expect(model.effectiveLimits['roleConcurrency']).toBe(2);
  });

  it('keeps the revision label on a file listing', () => {
    const model = filesModel({
      root: '/repo',
      revision: 'abc123',
      branch: 'agentdev/main',
      entries: [],
    });
    expect(model.revision).toBe('abc123');
    expect(model.branch).toBe('agentdev/main');
  });

  it('parses a live event frame but ignores anything else', () => {
    expect(
      liveEventOf({
        type: 'event',
        cursor: 7,
        name: 'run.started',
        entityId: 'r1',
        entityVersion: 2,
      }),
    ).toMatchObject({
      cursor: 7,
      name: 'run.started',
    });
    expect(liveEventOf({ type: 'response', id: 'x' })).toBeUndefined();
    expect(liveEventOf({ type: 'event', name: 'x' })).toBeUndefined();
  });
});
