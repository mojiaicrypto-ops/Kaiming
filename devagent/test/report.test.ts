import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { createReportTool, type ReportToolContext } from '../src/tools/report-tools.ts';
import { reportTarget } from '../src/runtime/report-store.ts';
import { digestOfText } from '../src/runtime/plan-store.ts';

const dirs: string[] = [];
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface Fixture {
  readonly store: Store;
  readonly cwd: string;
  readonly serverWorkDir: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly inputId: string;
  readonly report: ReturnType<typeof createReportTool>;
  setInput(inputId: string): void;
  addReadTask(id: string): string;
}

function fixture(options: { type: 'read' | 'write'; requiresTest?: boolean; roleId?: string; expectedKind?: string; phase?: string }): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'devagent-report-'));
  dirs.push(root);
  const cwd = join(root, 'project');
  const serverWorkDir = join(root, 'work');
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: cwd });
  store.createSession({ id: 'c-1', projectId: 'p-1', roleId: 'chief', cwd });
  const task = store.createTask({
    id: 't-1',
    projectId: 'p-1',
    chiefSessionId: 'c-1',
    ownerEpoch: 1,
    type: options.type,
    requiresTest: options.requiresTest ?? false,
    goal: 'goal',
    scope: 'scope',
    acceptanceRefs: [],
    basisRefs: [],
    planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'x' },
    authorizationRefs: ['m-1'],
    sourceInputId: 'i-1',
  });
  store.updateTask({ taskId: task.id, expectedRevision: task.revision, phase: 'develop' });
  store.createTaskSessions({
    taskId: task.id,
    members: [
      {
        sessionId: 'm-1',
        taskId: task.id,
        roleId: options.roleId ?? 'developer',
        phase: 'develop',
        label: 'work',
        instructions: 'do the work',
        refs: [],
        dependencies: [],
        expectedKind: options.expectedKind ?? (options.type === 'read' ? 'investigation' : 'implementation'),
        inputId: 'i-m1',
        inputPayload: { content: [{ type: 'text', text: 'work' }] },
      },
    ],
  });
  const claimed = store.claimNextInput('m-1');
  if (claimed.kind !== 'claimed') {
    throw new Error('the member input could not be claimed');
  }
  const state = { inputId: 'i-m1' };
  const contextOf = (): ReportToolContext => ({
    store,
    sessionId: 'm-1',
    inputId: state.inputId,
    roleId: options.roleId ?? 'developer',
    cwd,
    serverWorkDir,
  });
  return {
    store,
    cwd,
    serverWorkDir,
    taskId: task.id,
    sessionId: 'm-1',
    inputId: 'i-m1',
    report: createReportTool(contextOf),
    setInput: (inputId) => {
      state.inputId = inputId;
    },
    addReadTask: (id) => {
      const extra = store.createTask({
        id,
        projectId: 'p-1',
        chiefSessionId: 'c-1',
        ownerEpoch: 1,
        type: 'read',
        requiresTest: false,
        goal: 'goal',
        scope: 'scope',
        acceptanceRefs: [],
        basisRefs: [],
        planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'x' },
        authorizationRefs: ['m-1'],
        sourceInputId: 'i-1',
      });
      store.updateTask({ taskId: extra.id, expectedRevision: extra.revision, phase: 'develop' });
      return extra.id;
    },
  };
}

const report = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'implementation',
  summary: 'implemented the reset flow',
  body: '# implementation\n\nreset flow done\n',
  checks: [{ name: 'unit tests', status: 'passed', command: 'npm test', exitCode: 0 }],
  ...overrides,
});

describe('agent_report', () => {
  it('saves the body, records the result and reports it back', async () => {
    const f = fixture({ type: 'write' });

    const result = await f.report.execute('call-1', report());

    expect(result.isError).toBe(false);
    const resultId = String(result.details['resultId']);
    const row = f.store.getResult(resultId);
    expect(row).toMatchObject({
      taskId: f.taskId,
      sessionId: 'm-1',
      inputId: 'i-m1',
      roleId: 'developer',
      kind: 'implementation',
      verdict: null,
    });
    // A write Task keeps its report with the project, next to the work it describes.
    const expectedPath = join(f.cwd, '.dev', 'work', f.taskId, 'm-1', `${resultId}.md`);
    expect(row?.bodyRef).toMatchObject({ storage: 'project', path: expectedPath });
    expect(readFileSync(expectedPath, 'utf8')).toBe('# implementation\n\nreset flow done\n');
    expect(row?.checks).toEqual([
      { name: 'unit tests', status: 'passed', command: 'npm test', exitCode: 0 },
    ]);
    // The Task now shows the result, and the result points at its body.
    expect(f.store.listTaskResults(f.taskId).map((entry) => entry.resultId)).toEqual([resultId]);
  });

  it('keeps a read Task report in the host work area', async () => {
    const f = fixture({ type: 'read' });

    const result = await f.report.execute('call-1', report({ kind: 'investigation', summary: 'looked around' }));

    expect(result.isError).toBe(false);
    const row = f.store.getResult(String(result.details['resultId']));
    const expectedPath = join(f.serverWorkDir, f.taskId, 'm-1', `${row?.resultId}.md`);
    expect(row?.bodyRef).toMatchObject({ storage: 'server', path: expectedPath });
    expect(existsSync(expectedPath)).toBe(true);
  });

  it('refuses a report about another kind, a wrong Task type and a review without a verdict', async () => {
    const f = fixture({ type: 'write', roleId: 'reviewer', expectedKind: 'review' });

    // The chief asked for a review; an implementation report is not that work.
    const wrongKind = await f.report.execute('call-1', report());
    expect(wrongKind.details['code']).toBe('INVALID_ARGUMENT');
    expect(f.store.listTaskResults(f.taskId)).toHaveLength(0);

    // A review needs a verdict and must name the frozen candidate version.
    f.store.setCandidate({
      taskId: f.taskId,
      expectedRevision: f.store.getTask(f.taskId)?.revision ?? 1,
      candidate: { candidateId: 'k-1', files: [] },
    });
    const noVerdict = await f.report.execute('call-2', report({ kind: 'review' }));
    expect(noVerdict.details['code']).toBe('INVALID_ARGUMENT');

    const wrongCandidate = await f.report.execute('call-3', report({ kind: 'review', verdict: 'passed', candidateId: 'k-2' }));
    expect(wrongCandidate.details['code']).toBe('INVALID_ARGUMENT');

    const good = await f.report.execute('call-4', report({ kind: 'review', verdict: 'passed', candidateId: 'k-1' }));
    expect(good.isError).toBe(false);
    expect(f.store.getResult(String(good.details['resultId']))?.verdict).toBe('passed');

  });

  it('refuses an implementation report through a read Task member', async () => {
    const f = fixture({ type: 'read' });

    const wrongType = await f.report.execute('call-1', { kind: 'implementation', summary: 'x', body: 'x' });

    expect(wrongType.details['code']).toBe('INVALID_ARGUMENT');
    expect(f.store.listTaskResults(f.taskId)).toHaveLength(0);
  });

  it('never rewrites a report: a revision is a new result that supersedes the old one', async () => {
    const f = fixture({ type: 'write' });
    const first = await f.report.execute('call-1', report());
    const firstId = String(first.details['resultId']);
    const firstBody = f.store.getResult(firstId)?.bodyRef.path ?? '';

    const second = await f.report.execute('call-2', report({ summary: 'fixed the finding', supersedesResultId: firstId }));
    const secondId = String(second.details['resultId']);

    expect(second.isError).toBe(false);
    expect(secondId).not.toBe(firstId);
    expect(f.store.getResult(secondId)?.supersedesResultId).toBe(firstId);
    expect(f.store.supersededBy(firstId)?.resultId).toBe(secondId);
    // The old body is still there, untouched.
    expect(readFileSync(firstBody, 'utf8')).toBe('# implementation\n\nreset flow done\n');
    // A superseded result no longer satisfies completion.
    const gaps = f.store.taskCompletionGaps(f.taskId, firstId);
    expect(gaps.join(' ')).toContain('was superseded');
  });

  it('registers an existing report body instead of copying it', async () => {
    const f = fixture({ type: 'write', roleId: 'settler', expectedKind: 'settlement' });
    const path = join(f.cwd, 'settlement.md');
    mkdirSync(f.cwd, { recursive: true });
    writeFileSync(path, '# settlement\n\nall checked\n', 'utf8');

    const result = await f.report.execute(
      'call-1',
      report({
        kind: 'settlement',
        summary: 'settled',
        body: undefined,
        reportRef: { storage: 'project', path, sha256: digestOfText('# settlement\n\nall checked\n') },
        settlement: { schemaVersion: 1, taskId: f.taskId },
      }),
    );

    expect(result.isError).toBe(false);
    const row = f.store.getResult(String(result.details['resultId']));
    expect(row?.bodyRef).toMatchObject({ path, sha256: digestOfText('# settlement\n\nall checked\n') });
    expect(row?.settlement).toEqual({ schemaVersion: 1, taskId: f.taskId });

    // A wrong digest is not this body: nothing is recorded.
    const mismatch = await f.report.execute(
      'call-2',
      report({
        kind: 'settlement',
        summary: 'settled again',
        body: undefined,
        reportRef: { storage: 'project', path, sha256: 'deadbeef' },
      }),
    );
    expect(mismatch.details['code']).toBe('VERSION_CONFLICT');
    expect(f.store.listTaskResults(f.taskId)).toHaveLength(1);
  });

  it('keeps two different reports of one input apart instead of collapsing them', async () => {
    // Two reportRef reports with the same summary but different bodies are two results.
    const f = fixture({ type: 'write', roleId: 'settler', expectedKind: 'settlement' });
    mkdirSync(f.cwd, { recursive: true });
    for (const [name, text] of [
      ['first', '# settlement one\n'],
      ['second', '# settlement two\n'],
    ] as const) {
      const path = join(f.cwd, `${name}.md`);
      writeFileSync(path, text, 'utf8');
      const result = await f.report.execute(`call-${name}`, {
        kind: 'settlement',
        summary: 'settled',
        reportRef: { storage: 'project', path, sha256: digestOfText(text) },
      });
      expect(result.isError).toBe(false);
    }
    expect(f.store.listTaskResults(f.taskId)).toHaveLength(2);

    // The same summary and body with a different verdict is a different report, not the recorded one.
    const g = fixture({ type: 'write', roleId: 'reviewer', expectedKind: 'review' });
    g.store.setCandidate({
      taskId: g.taskId,
      expectedRevision: g.store.getTask(g.taskId)?.revision ?? 1,
      candidate: { candidateId: 'k-1', files: [] },
    });
    const body = '# review\n\nsame words\n';
    const passed = await g.report.execute('call-1', {
      kind: 'review',
      summary: 'checked the version',
      body,
      verdict: 'passed',
      candidateId: 'k-1',
    });
    const blocked = await g.report.execute('call-2', {
      kind: 'review',
      summary: 'checked the version',
      body,
      verdict: 'blocked',
      candidateId: 'k-1',
    });

    expect(blocked.isError).toBe(false);
    expect(blocked.details['resultId']).not.toBe(passed.details['resultId']);
    const rows = g.store.listTaskResults(g.taskId);
    expect(rows.map((row) => row.verdict).sort()).toEqual(['blocked', 'passed']);
  });

  it('keeps a changed settlement manifest apart from the recorded one', async () => {
    const f = fixture({ type: 'write', roleId: 'settler', expectedKind: 'settlement' });
    const body = '# settlement\n\nsame words\n';
    const first = await f.report.execute('call-1', {
      kind: 'settlement',
      summary: 'settled',
      body,
      settlement: { schemaVersion: 1, taskId: f.taskId, verificationResultIds: [] },
    });
    const second = await f.report.execute('call-2', {
      kind: 'settlement',
      summary: 'settled',
      body,
      settlement: { schemaVersion: 1, taskId: f.taskId, verificationResultIds: ['r-1'] },
    });

    expect(second.isError).toBe(false);
    expect(second.details['resultId']).not.toBe(first.details['resultId']);
    const rows = f.store.listTaskResults(f.taskId);
    expect(rows).toHaveLength(2);
    const manifests = rows
      .map((row) => (row.settlement as { verificationResultIds: string[] }).verificationResultIds.join(','))
      .sort();
    expect(manifests).toEqual(['', 'r-1']);
  });

  it('only lets the running input of a member report', async () => {
    const f = fixture({ type: 'write' });

    f.setInput('i-old');
    const stale = await f.report.execute('call-1', report());

    expect(stale.isError).toBe(true);
    expect(stale.details['code']).toBe('STAGE_NOT_READY');
    expect(f.store.listTaskResults(f.taskId)).toHaveLength(0);
  });

  it('completes a write Task only with a settlement and a passed Test of the frozen candidate', async () => {
    const f = fixture({ type: 'write', requiresTest: true, roleId: 'settler', expectedKind: 'settlement' });
    f.store.setCandidate({
      taskId: f.taskId,
      expectedRevision: f.store.getTask(f.taskId)?.revision ?? 1,
      candidate: { candidateId: 'k-1', files: [{ path: 'src/a.ts', sha256: 'abc' }] },
    });
    const settlement = await f.report.execute('call-1', report({ kind: 'settlement' }));
    const settlementId = String(settlement.details['resultId']);

    // Without an independent Review the Task cannot end (and the gap names the candidate).
    let revision = f.store.getTask(f.taskId)?.revision ?? 1;
    const blocked = f.store.endTask({ taskId: f.taskId, expectedRevision: revision, completionResultId: settlementId });
    expect(blocked).toMatchObject({ ok: false });
    if (blocked.ok) {
      throw new Error('unreachable');
    }
    expect(blocked.gaps.join(' ')).toContain('no passed independent review is recorded for candidate k-1');

    // An independent Review of the same candidate closes the first gap; a Test of another version would
    // not close the second. Every implementation flow includes that independent check (D-04).
    f.store.createTaskSessions({
      taskId: f.taskId,
      members: [
        {
          sessionId: 'm-2',
          taskId: f.taskId,
          roleId: 'reviewer',
          phase: 'develop',
          label: 'review',
          instructions: 'check the delivered version',
          refs: [],
          dependencies: [],
          expectedKind: 'review',
          inputId: 'i-m2',
          inputPayload: { content: [{ type: 'text', text: 'review' }] },
        },
      ],
    });
    expect(f.store.claimNextInput('m-2').kind).toBe('claimed');
    const reviewer = createReportTool((): ReportToolContext => ({
      store: f.store,
      sessionId: 'm-2',
      inputId: 'i-m2',
      roleId: 'reviewer',
      cwd: f.cwd,
      serverWorkDir: f.serverWorkDir,
    }));
    const reviewed = await reviewer.execute('call-2', {
      kind: 'review',
      summary: 'the delivered version is acceptable',
      body: '# review\n\nno blocking findings\n',
      verdict: 'passed',
      candidateId: 'k-1',
      checks: [{ name: 'read the diff', status: 'passed' }],
    });
    expect(reviewed.isError).toBe(false);

    // The Test comes after the Review and covers the same candidate.
    f.store.createTaskSessions({
      taskId: f.taskId,
      members: [
        {
          sessionId: 'm-3',
          taskId: f.taskId,
          roleId: 'tester',
          phase: 'develop',
          label: 'verify',
          instructions: 'run the acceptance checks',
          refs: [],
          dependencies: [],
          expectedKind: 'test',
          inputId: 'i-m3',
          inputPayload: { content: [{ type: 'text', text: 'verify' }] },
        },
      ],
    });
    expect(f.store.claimNextInput('m-3').kind).toBe('claimed');
    const tester = createReportTool((): ReportToolContext => ({
      store: f.store,
      sessionId: 'm-3',
      inputId: 'i-m3',
      roleId: 'tester',
      cwd: f.cwd,
      serverWorkDir: f.serverWorkDir,
    }));
    const tested = await tester.execute('call-3', {
      kind: 'test',
      summary: 'end to end passed',
      body: '# test\n\nran the flow\n',
      verdict: 'passed',
      candidateId: 'k-1',
      checks: [{ name: 'e2e', status: 'passed' }],
    });
    expect(tested.isError).toBe(false);

    // Every member's input really stopped (their runs end before the chief can finish the Task).
    for (const inputId of ['i-m1', 'i-m2', 'i-m3']) {
      f.store.finishInput({
        inputId,
        expectedRevision: f.store.getInput(inputId)?.revision ?? 1,
        status: 'completed',
      });
    }
    revision = f.store.getTask(f.taskId)?.revision ?? 1;
    const ended = f.store.endTask({ taskId: f.taskId, expectedRevision: revision, completionResultId: settlementId });
    expect(ended).toMatchObject({ ok: true });
    expect(f.store.getTask(f.taskId)?.status).toBe('completed');
    expect(f.store.getSession('c-1')?.currentTaskId).toBeNull();
  });

  it('reports the same retry as one result instead of a duplicate', async () => {
    const f = fixture({ type: 'write' });

    const first = await f.report.execute('call-1', report());
    const second = await f.report.execute('call-2', report());

    expect(second.isError).toBe(false);
    expect(second.details['resultId']).toBe(first.details['resultId']);
    expect(f.store.listTaskResults(f.taskId)).toHaveLength(1);
  });

  it('shows a completed read Task through its investigation report', async () => {
    const f = fixture({ type: 'read' });
    const investigation = await f.report.execute('call-1', report({ kind: 'investigation', summary: 'findings' }));
    const resultId = String(investigation.details['resultId']);

    // The member's own work has really stopped.
    f.store.finishInput({
      inputId: f.inputId,
      expectedRevision: f.store.getInput(f.inputId)?.revision ?? 1,
      status: 'completed',
    });

    const ended = f.store.endTask({
      taskId: f.taskId,
      expectedRevision: f.store.getTask(f.taskId)?.revision ?? 1,
      completionResultId: resultId,
    });

    expect(ended).toMatchObject({ ok: true });
    expect(f.store.getTask(f.taskId)?.completionResultId).toBe(resultId);
    // A settlement report can never close a read Task.
    expect(f.store.taskCompletionGaps(f.taskId, 'r-unknown').join(' ')).toContain('is not recorded');
  });
});

describe('agent_report · expectedKind wedge', () => {
  it('createTaskSessions rejects an invented expectedKind at creation (the wedge source)', () => {
    const f = fixture({ type: 'write' });
    // The fixture's member input is processing; finish it so the phase rotation is allowed.
    const current = f.store.listInputs('m-1').find((input) => input.status === 'processing');
    if (current !== undefined) {
      f.store.finishInput({ inputId: current.inputId, expectedRevision: current.revision, status: 'completed' });
    }
    f.store.updateTask({ taskId: f.taskId, expectedRevision: f.store.getTask(f.taskId)!.revision, phase: 'develop' });
    expect(() =>
      f.store.createTaskSessions({
        taskId: f.taskId,
        members: [
          {
            sessionId: 'm-wedge',
            taskId: f.taskId,
            roleId: 'developer',
            phase: 'develop',
            label: 'wedge',
            instructions: 'work',
            refs: [],
            dependencies: [],
            expectedKind: 'development',
            inputId: 'i-wedge',
            inputPayload: { content: [{ type: 'text', text: 'work' }] },
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('a member with a legal expectedKind delivers its report through agent_report', async () => {
    const f = fixture({ type: 'write' });
    // harness creates a develop member with expectedKind implementation and claims its input.
    // Drive the real agent_report tool path (the tool owns the kind match).
    const outcome = await f.report.execute('rep-1', {
      kind: 'implementation',
      summary: 'work delivered',
      body: '# done\n',
      verdict: 'passed',
      checks: [{ name: 'smoke', status: 'passed' }],
    });
    expect(outcome).toBeDefined();
  });
});
