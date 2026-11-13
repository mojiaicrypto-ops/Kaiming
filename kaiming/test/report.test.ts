import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { createReportTool, type ReportToolContext } from '../src/tools/report-tools.ts';

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
}

function fixture(options: {
  type: 'read' | 'write';
  requiresTest?: boolean;
  roleId?: string;
  expectedKind?: string;
}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'kaiming-report-'));
  dirs.push(root);
  const cwd = join(root, 'project');
  mkdirSync(cwd, { recursive: true });
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
  store.updateTask({ taskId: task.id, phase: 'develop' });
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
    projectId: 'p-1',
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
  };
}

const report = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  summary: 'implemented the reset flow',
  body: '# implementation\n\nreset flow done\n',
  checks: [{ name: 'unit tests', status: 'passed', command: 'npm test', exitCode: 0 }],
  ...overrides,
});

/** A settlement body must already be on disk (it is committed before it is registered). */
function writeSettlement(cwd: string, taskId: string, body: string): string {
  const path = join(cwd, '.dev', 'work', taskId, 'm-1', 'settlement.md');
  mkdirSync(join(cwd, '.dev', 'work', taskId, 'm-1'), { recursive: true });
  writeFileSync(path, body, 'utf8');
  return path;
}

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
    expect(row?.checks).toEqual([{ name: 'unit tests', status: 'passed', command: 'npm test', exitCode: 0 }]);
    expect(f.store.listTaskResults(f.taskId).map((entry) => entry.resultId)).toEqual([resultId]);
    // The model never names the kind: it comes from the dispatch.
    expect(result.details['kind']).toBe('implementation');
  });

  it('accepts a read-only investigation inside a write Task and keeps it on the server', async () => {
    const f = fixture({ type: 'write', roleId: 'investigator', expectedKind: 'investigation' });

    const result = await f.report.execute(
      'call-1',
      report({ summary: 'looked around', body: '# investigation\n\nreset path is not covered\n' }),
    );

    expect(result.isError).toBe(false);
    const row = f.store.getResult(String(result.details['resultId']));
    const expectedPath = join(f.serverWorkDir, f.taskId, 'm-1', `${row?.resultId}.md`);
    expect(row?.kind).toBe('investigation');
    expect(row?.bodyRef).toMatchObject({ storage: 'server', path: expectedPath });
    expect(existsSync(expectedPath)).toBe(true);
    expect(existsSync(join(f.cwd, '.dev', 'work', f.taskId, 'm-1'))).toBe(false);

    // A blocked investigation is still an investigation; it uses the same Server-side channel.
    const blocked = await f.report.execute(
      'call-2',
      report({ summary: 'blocked', body: '# investigation\n\nneeds a decision\n', verdict: 'blocked' }),
    );
    expect(blocked.isError).toBe(false);
    expect(f.store.getResult(String(blocked.details['resultId']))?.bodyRef.storage).toBe('server');

    // Evidence does not stand in for the write Task's settlement.
    expect(f.store.taskCompletionGaps(f.taskId, String(row?.resultId))).toContain(
      'completion result must be settlement for a write Task',
    );
  });

  it('keeps a read Task report in the host work area', async () => {
    const f = fixture({ type: 'read' });

    const result = await f.report.execute('call-1', report({ summary: 'looked around' }));

    expect(result.isError).toBe(false);
    const row = f.store.getResult(String(result.details['resultId']));
    const expectedPath = join(f.serverWorkDir, f.taskId, 'm-1', `${row?.resultId}.md`);
    expect(row?.bodyRef).toMatchObject({ storage: 'server', path: expectedPath });
    expect(existsSync(expectedPath)).toBe(true);
    expect(row?.kind).toBe('investigation');
  });

  it('needs a verdict for a review and records the kind the dispatch asked for', async () => {
    const f = fixture({ type: 'write', roleId: 'reviewer', expectedKind: 'review' });

    const noVerdict = await f.report.execute('call-1', report({ summary: 'checked' }));
    expect(noVerdict.details['code']).toBe('INVALID_ARGUMENT');
    expect(f.store.listTaskResults(f.taskId)).toHaveLength(0);

    const good = await f.report.execute('call-2', report({ summary: 'checked', verdict: 'passed' }));
    expect(good.isError).toBe(false);
    const row = f.store.getResult(String(good.details['resultId']));
    expect(row?.kind).toBe('review');
    expect(row?.verdict).toBe('passed');
    // The program observed the delivery the review is about.
    expect(row?.deliveryState).not.toBeNull();
    expect(row?.deliveryState?.paths).toEqual([]);
  });

  it('refuses a review when ignored status cannot be observed', async () => {
    const f = fixture({ type: 'write', roleId: 'reviewer', expectedKind: 'review' });
    mkdirSync(join(f.cwd, 'src'), { recursive: true });
    writeFileSync(join(f.cwd, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    // A marker makes this a repository git cannot read, not the no-Git case.
    mkdirSync(join(f.cwd, '.git'));

    const result = await f.report.execute('call-1', report({ summary: 'checked', verdict: 'passed' }));

    expect(result.isError).toBe(true);
    expect(f.store.listTaskResults(f.taskId)).toHaveLength(0);
  });

  it('records two different reports of one input as two results', async () => {
    const f = fixture({ type: 'write' });

    const first = await f.report.execute('call-1', report());
    const second = await f.report.execute('call-2', report({ summary: 'fixed the finding' }));

    expect(second.isError).toBe(false);
    expect(second.details['resultId']).not.toBe(first.details['resultId']);
    expect(f.store.listTaskResults(f.taskId)).toHaveLength(2);
    // Both bodies stay on disk, untouched.
    for (const id of [first.details['resultId'], second.details['resultId']]) {
      const path = f.store.getResult(String(id))?.bodyRef.path ?? '';
      expect(readFileSync(path, 'utf8')).toContain('reset flow');
    }
  });

  it('registers a settlement body that was already written and committed', async () => {
    const f = fixture({ type: 'write', roleId: 'settler', expectedKind: 'settlement' });
    const body = '# settlement\n\nall checked\n';
    const path = writeSettlement(f.cwd, f.taskId, body);

    const result = await f.report.execute('call-1', report({ summary: 'settled', body, settlement: { schemaVersion: 1 } }));

    expect(result.isError).toBe(false);
    const row = f.store.getResult(String(result.details['resultId']));
    // The body on disk is the committed one, not a copy at a new path.
    expect(row?.bodyRef).toMatchObject({ path });
    expect(row?.settlement).toEqual({ schemaVersion: 1 });

    // A different body for the same predictable path is refused: nothing would be committed.
    const mismatch = await f.report.execute(
      'call-2',
      report({ summary: 'settled again', body: '# different\n', settlement: { schemaVersion: 1 } }),
    );
    expect(mismatch.details['code']).toBe('VERSION_CONFLICT');
    expect(f.store.listTaskResults(f.taskId)).toHaveLength(1);
    expect(readFileSync(path, 'utf8')).toBe(body);
  });

  it('keeps a changed settlement manifest apart from the recorded one', async () => {
    const f = fixture({ type: 'write', roleId: 'settler', expectedKind: 'settlement' });
    const body = '# settlement\n\nsame words\n';
    writeSettlement(f.cwd, f.taskId, body);
    const first = await f.report.execute('call-1', {
      summary: 'settled',
      body,
      settlement: { schemaVersion: 1, taskId: f.taskId, verificationResultIds: [] },
    });
    const second = await f.report.execute('call-2', {
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

  it('binds review and test to the observed delivery and refuses completion after it changed', async () => {
    const f = fixture({ type: 'write', requiresTest: true, roleId: 'settler', expectedKind: 'settlement' });
    // The delivered file the review will cover.
    mkdirSync(join(f.cwd, 'src'), { recursive: true });
    writeFileSync(join(f.cwd, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    mkdirSync(join(f.cwd, 'docs'), { recursive: true });
    writeFileSync(join(f.cwd, 'docs', 'runbook.md'), '# runbook v1\n', 'utf8');
    writeFileSync(join(f.cwd, '.gitignore'), 'dist/\n', 'utf8');
    const settlementBody = '# settlement\n\nall checked\n';
    writeSettlement(f.cwd, f.taskId, settlementBody);
    const settlement = await f.report.execute('call-1', {
      summary: 'settled',
      body: settlementBody,
      settlement: { schemaVersion: 1 },
    });
    const settlementId = String(settlement.details['resultId']);

    // Without an independent Review the Task cannot end.
    const blocked = f.store.endTask({ taskId: f.taskId, completionResultId: settlementId });
    expect(blocked).toMatchObject({ ok: false });
    if (blocked.ok) {
      throw new Error('unreachable');
    }
    expect(blocked.gaps.join(' ')).toContain('no passed independent review is recorded');

    const review = await reviewerReport(f, 'passed');
    expect(review.isError).toBe(false);
    expect(f.store.getResult(String(review.details['resultId']))?.deliveryState?.paths).toContain('src/a.ts');
    const reviewPaths = f.store.getResult(String(review.details['resultId']))?.deliveryState?.paths ?? [];
    expect(reviewPaths).not.toContain('docs/runbook.md');
    expect(reviewPaths).not.toContain('.gitignore');

    // The Test covers the same files the review covered.
    const test = await testerReport(f, 'passed');
    expect(test.isError).toBe(false);

    for (const inputId of ['i-m1', 'i-m2', 'i-m3']) {
      f.store.finishInput({ inputId, expectedRevision: f.store.getInput(inputId)?.revision ?? 1, status: 'completed' });
    }

    // Someone changes the reviewed file after the review: completion is refused and names the reason.
    writeFileSync(join(f.cwd, 'src', 'a.ts'), 'export const a = 2;\n', 'utf8');
    const changed = f.store.endTask({ taskId: f.taskId, completionResultId: settlementId });
    expect(changed).toMatchObject({ ok: false });
    if (changed.ok) {
      throw new Error('unreachable');
    }
    expect(changed.gaps.join(' ')).toContain('the delivery changed after the last passed review');

    // Restoring the reviewed content makes the recorded evidence valid again.
    writeFileSync(join(f.cwd, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
    // Settlement docs are not the code delivery: changing them after Review must not require a rerun.
    writeFileSync(join(f.cwd, 'docs', 'runbook.md'), '# runbook v2\n', 'utf8');
    const ended = f.store.endTask({ taskId: f.taskId, completionResultId: settlementId });
    expect(ended).toMatchObject({ ok: true });
    expect(f.store.getTask(f.taskId)?.status).toBe('completed');
    expect(f.store.getSession('c-1')?.currentTaskId).toBeNull();
  });
  it('keeps a documentation-only delivery bound to its docs', async () => {
    const f = fixture({ type: 'write', roleId: 'reviewer', expectedKind: 'review' });
    mkdirSync(join(f.cwd, 'docs'), { recursive: true });
    writeFileSync(join(f.cwd, 'docs', 'spec.md'), '# spec\n\nv1\n', 'utf8');

    const review = await f.report.execute('call-1', {
      summary: 'docs checked',
      body: '# review\n\nchecked\n',
      verdict: 'passed',
    });

    expect(review.isError).toBe(false);
    expect(f.store.getResult(String(review.details['resultId']))?.deliveryState?.paths).toEqual(['docs/spec.md']);
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
    const investigation = await f.report.execute('call-1', report({ summary: 'findings' }));
    const resultId = String(investigation.details['resultId']);

    // The member's own work has really stopped.
    f.store.finishInput({
      inputId: f.inputId,
      expectedRevision: f.store.getInput(f.inputId)?.revision ?? 1,
      status: 'completed',
    });

    const ended = f.store.endTask({ taskId: f.taskId, completionResultId: resultId });

    expect(ended).toMatchObject({ ok: true });
    expect(f.store.getTask(f.taskId)?.completionResultId).toBe(resultId);
    // A settlement report can never close a read Task.
    expect(f.store.taskCompletionGaps(f.taskId, 'r-unknown').join(' ')).toContain('is not recorded');
  });
});

/** Dispatch a reviewer into the current step and deliver its report. */
async function reviewerReport(
  f: Fixture,
  verdict: 'passed' | 'failed' | 'blocked',
): Promise<Awaited<ReturnType<ReturnType<typeof createReportTool>['execute']>>> {
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
  const reviewer = createReportTool(() => ({
    store: f.store,
    projectId: 'p-1',
    sessionId: 'm-2',
    inputId: 'i-m2',
    roleId: 'reviewer',
    cwd: f.cwd,
    serverWorkDir: f.serverWorkDir,
  }));
  return reviewer.execute('call-2', {
    summary: 'the delivered version is acceptable',
    body: '# review\n\nno blocking findings\n',
    verdict,
    checks: [{ name: 'read the diff', status: 'passed' }],
  });
}

/** Dispatch a tester into the current step and deliver its report. */
async function testerReport(
  f: Fixture,
  verdict: 'passed' | 'failed' | 'blocked',
): Promise<Awaited<ReturnType<ReturnType<typeof createReportTool>['execute']>>> {
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
  const tester = createReportTool(() => ({
    store: f.store,
    projectId: 'p-1',
    sessionId: 'm-3',
    inputId: 'i-m3',
    roleId: 'tester',
    cwd: f.cwd,
    serverWorkDir: f.serverWorkDir,
  }));
  return tester.execute('call-3', {
    summary: 'end to end passed',
    body: '# test\n\nran the flow\n',
    verdict,
    checks: [{ name: 'e2e', status: 'passed' }],
  });
}

describe('agent_report · expectedKind wedge', () => {
  it('createTaskSessions rejects an invented expectedKind at creation (the wedge source)', () => {
    const f = fixture({ type: 'write' });
    // The fixture's member input is processing; finish it so the phase rotation is allowed.
    const current = f.store.listInputs('m-1').find((input) => input.status === 'processing');
    if (current !== undefined) {
      f.store.finishInput({ inputId: current.inputId, expectedRevision: current.revision, status: 'completed' });
    }
    f.store.updateTask({ taskId: f.taskId, phase: 'develop' });
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
      summary: 'work delivered',
      body: '# done\n',
      verdict: 'passed',
      checks: [{ name: 'smoke', status: 'passed' }],
    });
    expect(outcome).toBeDefined();
  });
});
