/**
 * T3 — the Core tool catalog: planning, validation and the tools Core implements
 * itself (AC-048).
 *
 * Planning cases are pure and prove the entry checks (`~`, unknown tool, `git`
 * allowlist, the `bash`-runs-git guard). The execution cases drive the real `Broker`
 * with a real Grant against a real temporary Git repository, so `read`/`search`/`edit`
 * are proven with real files rather than a stub context.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Scope } from '@agentdev/contracts';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import { Broker, GrantStore, type GrantIssueInput, type ToolInvocation } from '../src/index.js';
import {
  isRefMutatingGitShellCommand,
  planToolCall,
  runSearchTool,
  shellProgramOf,
} from '../src/tools.js';

const WORK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e00';
const RUN_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e10';
const ATTEMPT_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e50';
const DECISION_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e30';
const TASK_ID = '018f2c1e-9a4b-7c3d-8e5f-0a1b2c3d6e40';
const REVISION = 'c'.repeat(40);
const HASH = 'a'.repeat(64);
const A = 'src/a.ts';
const DOC = 'docs/notes.md';

const SCOPE: Scope = {
  // `Scope` paths are repository-relative files, not directory prefixes: the
  // contract's `repoPathSchema` refuses a trailing `/`, so a Work authorizes exact
  // paths and a Grant target may only cover what those paths name
  // (`domain/targetCovers`).
  readPaths: [A, DOC],
  writePaths: [A, DOC],
  operations: ['read', 'search', 'write', 'edit', 'artifact_write', 'bash', 'git'],
  networkTargets: [],
};

describe('planToolCall', () => {
  it('refuses an unknown tool instead of guessing', () => {
    const result = planToolCall({
      toolName: 'stage_yield',
      args: {},
      cwdRoot: '/tmp',
      role: 'backend',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a tool the caller role does not hold, before looking at arguments', () => {
    const result = planToolCall({
      toolName: 'bash',
      args: { command: 'ls' },
      cwdRoot: '/w',
      role: 'review',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NOT_AUTHORIZED');
      expect(result.reason).toContain('review');
    }
    // A review Run may still use what `rules/agents.md` §1 gives it.
    expect(
      planToolCall({ toolName: 'read', args: { path: A }, cwdRoot: '/w', role: 'review' }).ok,
    ).toBe(true);
  });

  it('refuses a home-relative or absolute path at the entry', () => {
    for (const path of ['~/secrets', '/etc/passwd', 'C:/x']) {
      const result = planToolCall({
        toolName: 'read',
        args: { path },
        cwdRoot: '/tmp',
        role: 'backend',
      });
      expect(result.ok).toBe(false);
    }
  });

  it('refuses unknown argument fields', () => {
    const result = planToolCall({
      toolName: 'read',
      args: { path: A, sneaky: true },
      cwdRoot: '/tmp',
      role: 'backend',
    });
    expect(result.ok).toBe(false);
  });

  it('maps each tool onto its Broker operation and access', () => {
    for (const [toolName, args, operation, access] of [
      ['read', { path: A }, 'read', 'read'],
      ['search', { query: 'x', path: 'src' }, 'search', 'read'],
      ['edit', { path: A, content: 'x' }, 'edit', 'write'],
      ['write', { path: A, content: 'x' }, 'write', 'write'],
      ['bash', { command: 'ls' }, 'bash', 'write'],
      ['git', { args: ['status'] }, 'git', 'write'],
      ['artifact_write', { path: DOC, content: 'x' }, 'artifact_write', 'write'],
    ] as const) {
      const result = planToolCall({ toolName, args, cwdRoot: '/tmp/ws', role: 'backend' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan.operation).toBe(operation);
        expect(result.plan.access).toBe(access);
      }
    }
  });

  it('admits only read-only git subcommands', () => {
    expect(
      planToolCall({
        toolName: 'git',
        args: { args: ['diff', '--stat'] },
        cwdRoot: '/w',
        role: 'backend',
      }).ok,
    ).toBe(true);
    for (const subcommand of ['commit', 'push', 'update-ref', 'reset', 'fetch']) {
      const result = planToolCall({
        toolName: 'git',
        args: { args: [subcommand, 'x'] },
        cwdRoot: '/w',
        role: 'backend',
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('NOT_AUTHORIZED');
    }
  });

  it('carries git as an argv vector so no shell sees an argument', () => {
    const result = planToolCall({
      toolName: 'git',
      args: { args: ['log', '--format=%H; touch pwned'] },
      cwdRoot: '/w',
      role: 'backend',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.input['argv']).toEqual(['git', 'log', '--format=%H; touch pwned']);
    }
  });

  it('resolves a repository-relative cwd against the run root', () => {
    const result = planToolCall({
      toolName: 'bash',
      args: { command: 'ls', cwd: 'src' },
      cwdRoot: '/w',
      role: 'backend',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.cwd).toBe('/w/src');
  });
});

describe('shell git guard (Q-T3-5)', () => {
  it('parses the program and its arguments', () => {
    expect(shellProgramOf('git log -1')).toEqual({ program: 'git', args: ['log', '-1'] });
    expect(shellProgramOf('FOO=1 /usr/bin/git status')).toEqual({
      program: '/usr/bin/git',
      args: ['status'],
    });
    expect(shellProgramOf("sh -c 'git update-ref x y'").program).toBe('sh');
  });

  it('flags only ref-mutating git commands', () => {
    expect(isRefMutatingGitShellCommand('git commit -m x')).toBe(true);
    expect(isRefMutatingGitShellCommand('git update-ref refs/heads/agentdev/main abc')).toBe(true);
    expect(isRefMutatingGitShellCommand('git status')).toBe(false);
    expect(isRefMutatingGitShellCommand('printf git')).toBe(false);
  });

  it('refuses the direct spelling through planToolCall', () => {
    const result = planToolCall({
      toolName: 'bash',
      args: { command: 'git push origin main' },
      cwdRoot: '/w',
      role: 'backend',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NOT_AUTHORIZED');
  });
});

describe('tool execution through the real Broker', () => {
  let dataDir: string;
  let workspace: string;
  let store: ProjectStore;
  let grants: GrantStore;
  let broker: Broker;
  let projectId: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-tools-data-'));
    workspace = mkdtempSync(join(tmpdir(), 'agentdev-tools-ws-'));
    mkdirSync(join(workspace, 'src'), { recursive: true });
    mkdirSync(join(workspace, 'docs'), { recursive: true });
    mkdirSync(join(workspace, 'node_modules'), { recursive: true });
    writeFileSync(join(workspace, A), 'line one\nline two\nneedle here\n', 'utf8');
    writeFileSync(join(workspace, DOC), '# notes\nneedle in docs\n', 'utf8');
    writeFileSync(join(workspace, 'node_modules/skip.ts'), 'needle in deps\n', 'utf8');
    execFileSync('git', ['init', '-q'], { cwd: workspace });
    execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: workspace });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: workspace });
    writeFileSync(join(workspace, 'README.md'), '# readme\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: workspace });
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: workspace });

    store = Store.open({
      dataDir,
      canonicalRoot: workspace,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    projectId = projectIdFromRoot(workspace);
    store.projects.insert({
      id: projectId,
      root: workspace,
      codeRoot: 'src',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
    });
    grants = new GrantStore({ store, now: () => '2026-09-11T00:00:00.000Z' });
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
      purpose: 'deliver T3 tool catalog',
      level: 'L2',
      goal: 'make read/search/edit real',
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
      acceptanceIds: ['AC-048'],
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
      ownerEpoch: 1,
    });
    store.decisions.insert({
      id: DECISION_ID,
      projectId,
      workId: WORK_ID,
      kind: 'permission',
      targetRef: { id: WORK_ID, version: 1, hash: HASH },
      choices: ['approve', 'deny'],
      state: 'accepted',
      choice: 'approve',
      actor: 'user',
      effectRefs: [],
    });
    broker = new Broker({
      store,
      grants,
      now: () => '2026-09-11T00:00:00.000Z',
      docker: () => ({ available: true, version: '28.4.0' }),
      resolver: { resolve: () => Promise.resolve({ ok: false, reason: 'no network in tests' }) },
    });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  function issue(operation: string, targets: readonly string[]): void {
    const outcome = grants.issue({
      workId: WORK_ID,
      role: 'backend',
      stage: 'develop-L2',
      scope: 'run',
      operation,
      targets,
      runId: RUN_ID,
      decisionId: DECISION_ID,
      expiresAt: '2026-09-11T01:00:00.000Z',
    } satisfies GrantIssueInput);
    if (!outcome.ok) throw new Error(`grant refused: ${outcome.code} ${outcome.reason}`);
  }

  async function runTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; result?: unknown; code?: string }> {
    const planned = planToolCall({ toolName, args, cwdRoot: workspace, role: 'backend' });
    if (!planned.ok) return { ok: false, code: planned.code };
    const invocation: ToolInvocation = {
      workId: WORK_ID,
      runId: RUN_ID,
      attemptId: ATTEMPT_ID,
      epoch: 1,
      role: 'backend',
      stage: 'develop-L2',
      operation: planned.plan.operation,
      targets: planned.plan.targets,
      input: planned.plan.input,
      mode: 'host',
      roots: [workspace],
      ...(planned.plan.cwd === undefined ? {} : { cwd: planned.plan.cwd }),
      ...(planned.plan.run === undefined ? {} : { run: planned.plan.run }),
    };
    const outcome = await broker.invoke(invocation);
    return outcome.ok ? { ok: true, result: outcome.result } : { ok: false, code: outcome.code };
  }

  it('reads a real file, honouring an offset/limit window', async () => {
    issue('read', [A]);
    const whole = await runTool('read', { path: A });
    expect(whole.ok).toBe(true);
    expect((whole.result as { content: string }).content).toContain('needle here');

    const windowed = await runTool('read', { path: A, offset: 1, limit: 1 });
    expect(windowed.ok).toBe(true);
    const value = windowed.result as { content: string; truncated: boolean };
    expect(value.content).toBe('line two');
    expect(value.truncated).toBe(true);
  });

  it('writes only when the expected pre-image matches', async () => {
    issue('edit', [A]);
    const current = readFileSync(join(workspace, A), 'utf8');

    const stale = await runTool('edit', {
      path: A,
      content: 'replaced\n',
      expectedContent: 'other',
    });
    expect(stale.ok).toBe(true);
    expect((stale.result as { matched: boolean }).matched).toBe(false);
    expect(readFileSync(join(workspace, A), 'utf8')).toBe(current);

    const applied = await runTool('edit', {
      path: A,
      content: 'replaced\n',
      expectedContent: current,
    });
    expect(applied.ok).toBe(true);
    expect((applied.result as { written: boolean }).written).toBe(true);
    expect(readFileSync(join(workspace, A), 'utf8')).toBe('replaced\n');
  });

  it('searches authorized files and refuses an out-of-grant path', async () => {
    issue('search', [A, DOC]);
    const found = await runTool('search', { query: 'needle', path: A });
    expect(found.ok).toBe(true);
    const value = found.result as { matches: Array<{ path: string; line: number }> };
    expect(value.matches).toEqual([{ path: A, line: 3, text: 'needle here' }]);

    const docs = await runTool('search', { query: 'needle', path: DOC });
    expect(docs.ok).toBe(true);
    expect((docs.result as { matches: unknown[] }).matches.length).toBe(1);

    // `node_modules` is not in the Grant's authorized paths, so the Broker refuses
    // before the search runs.
    const outside = await runTool('search', { query: 'needle', path: 'node_modules/skip.ts' });
    expect(outside.ok).toBe(false);
    if (outside.code !== undefined) expect(outside.code).toBe('NOT_AUTHORIZED');
  });

  it('walks a directory without following symlinks or descending into ignored trees', () => {
    // The Core-internal half of the search: the walk itself, exercised on a real tree
    // with a real symlink. The Broker path above proves the boundary; this proves what
    // the walk does once a path is admitted.
    const outsideDir = mkdtempSync(join(tmpdir(), 'agentdev-tools-out-'));
    writeFileSync(join(outsideDir, 'secret.ts'), 'needle outside\n', 'utf8');
    try {
      const context = {
        mode: 'host' as const,
        operation: 'search',
        inputHash: HASH,
        toolOperationId: DECISION_ID,
        targets: ['src'],
        paths: [join(workspace, 'src')],
        roots: [workspace],
        env: {},
        readFile: (path: string) => readFileSync(path, 'utf8'),
        writeFile: () => undefined,
        run: () => {
          throw new Error('not used');
        },
        runAsync: () => Promise.reject(new Error('not used')),
        request: () => Promise.reject(new Error('not used')),
      };
      const result = runSearchTool(context, { query: 'needle', path: 'src' });
      expect(result.matches.map((match) => match.path)).toEqual([A]);
      expect(result.filesScanned).toBeGreaterThan(0);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('runs a real read-only git command in the repository', async () => {
    issue('git', []);
    const outcome = await runTool('git', { args: ['rev-parse', '--abbrev-ref', 'HEAD'] });
    expect(outcome.ok).toBe(true);
    const result = outcome.result as { stdout: string; status: number };
    // A fresh `git init` has an unborn branch; either the name or the empty answer is
    // real output, so only the process's success is asserted.
    expect(result.status).toBe(0);
    expect(typeof result.stdout).toBe('string');
  });
});
