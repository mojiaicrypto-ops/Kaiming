import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { digestOfText } from '../src/runtime/project-store.ts';
import { createProjectTool, type ProjectToolContext } from '../src/tools/project-tools.ts';

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
  readonly tool: ReturnType<typeof createProjectTool>;
  setRole(roleId: string): void;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'devagent-project-'));
  dirs.push(root);
  const cwd = join(root, 'project');
  mkdirSync(cwd, { recursive: true });
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: cwd });
  store.createSession({ id: 'c-1', projectId: 'p-1', roleId: 'chief', cwd });
  // The user really asked for this project to be written to.
  store.acceptInput({
    inputId: 'i-dec',
    projectId: 'p-1',
    sessionId: 'c-1',
    sourceKey: 'c-1:i-dec',
    requestKey: 'i-dec',
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: 'yes, set this project up' }] },
  });
  const state = { roleId: 'chief' };
  return {
    store,
    cwd,
    tool: createProjectTool(
      (): ProjectToolContext => ({
        store,
        projectId: 'p-1',
        cwd,
        roleId: state.roleId,
        sessionId: 'c-1',
      }),
    ),
    setRole: (roleId) => {
      state.roleId = roleId;
    },
  };
}

const entries = (): Array<{ path: string; expectedVersion: null; content: string }> => [
  { path: 'AGENTS.md', expectedVersion: null, content: '# Agent rules\n\nRead .dev/INDEX.md first.\n' },
  { path: '.dev/INDEX.md', expectedVersion: null, content: '# 索引\n\n- PROJECT.md\n' },
];

const revision = (f: Fixture): number => f.store.getProject('p-1')?.revision ?? 1;

describe('project.initialize', () => {
  it('shows the real entry gaps without writing anything in preview mode', async () => {
    const f = fixture();

    const preview = await f.tool.execute('c1', {
      op: 'initialize',
      expectedProjectRevision: revision(f),
      files: entries(),
      reusedAuthorityRefs: [],
      requestWriteUse: false,
    });

    expect(preview.isError).toBe(false);
    expect(preview.details['wrote']).toBe(false);
    expect(preview.details['entryGaps']).toEqual(['AGENTS.md', '.dev/INDEX.md']);
    const files = preview.details['files'] as Array<{ path: string; action: string; content: string }>;
    expect(files.map((entry) => entry.action)).toEqual(['create', 'create']);
    // The full planned content is visible before the user is asked.
    expect(files[0]?.content).toBe('# Agent rules\n\nRead .dev/INDEX.md first.\n');
    expect(existsSync(join(f.cwd, 'AGENTS.md'))).toBe(false);
  });

  it('writes nothing without the user decision, and everything with it', async () => {
    const f = fixture();

    const refused = await f.tool.execute('c1', {
      op: 'initialize',
      expectedProjectRevision: revision(f),
      files: entries(),
      reusedAuthorityRefs: [],
      requestWriteUse: true,
    });

    expect(refused.isError).toBe(true);
    expect(refused.details['code']).toBe('FORBIDDEN');
    expect(refused.details['needsConsent']).toBe(true);
    expect(existsSync(join(f.cwd, 'AGENTS.md'))).toBe(false);

    const written = await f.tool.execute('c2', {
      op: 'initialize',
      expectedProjectRevision: revision(f),
      files: entries(),
      reusedAuthorityRefs: [],
      requestWriteUse: true,
      authorizationRef: { inputId: 'i-dec' },
    });

    expect(written.isError).toBe(false);
    expect(written.details['ready']).toBe(true);
    expect(readFileSync(join(f.cwd, 'AGENTS.md'), 'utf8')).toBe('# Agent rules\n\nRead .dev/INDEX.md first.\n');
    expect(readFileSync(join(f.cwd, '.dev', 'INDEX.md'), 'utf8')).toContain('PROJECT.md');
    // The project records what it was initialized with, and the private host receipt was written.
    const initializationRef = written.details['initializationRef'] as { files: Array<{ path: string }> };
    expect(initializationRef.files.map((entry) => entry.path).sort()).toEqual(['.dev/INDEX.md', 'AGENTS.md']);
    expect(f.store.getProject('p-1')?.initializationRef).toEqual(initializationRef);
    // The receipt is registered per entry under this session's key.
    expect(f.store.getFileSave('c-1:project-init:AGENTS.md')).toMatchObject({ state: 'saved' });

    // A second run reuses the entries instead of rewriting them.
    const again = await f.tool.execute('c3', {
      op: 'initialize',
      expectedProjectRevision: revision(f),
      files: entries(),
      reusedAuthorityRefs: [],
      requestWriteUse: true,
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(again.isError).toBe(false);
    expect((again.details['files'] as Array<{ outcome: string }>).map((entry) => entry.outcome)).toEqual([
      'reused',
      'reused',
    ]);
  });

  it('keeps existing content when the version does not match and refuses to guess', async () => {
    const f = fixture();
    mkdirSync(dirname(join(f.cwd, 'AGENTS.md')), { recursive: true });
    writeFileSync(join(f.cwd, 'AGENTS.md'), '# existing rules\n', 'utf8');

    const conflicted = await f.tool.execute('c1', {
      op: 'initialize',
      expectedProjectRevision: revision(f),
      files: [
        { path: 'AGENTS.md', expectedVersion: null, content: '# my rules\n' },
        { path: '.dev/INDEX.md', expectedVersion: null, content: '# 索引\n' },
      ],
      reusedAuthorityRefs: [],
      requestWriteUse: true,
      authorizationRef: { inputId: 'i-dec' },
    });

    expect(conflicted.isError).toBe(true);
    expect(conflicted.details['code']).toBe('VERSION_CONFLICT');
    // The existing file is untouched, and nothing else was written for this attempt.
    expect(readFileSync(join(f.cwd, 'AGENTS.md'), 'utf8')).toBe('# existing rules\n');
    expect(existsSync(join(f.cwd, '.dev', 'INDEX.md'))).toBe(false);

    // Reading the entry and passing its real version replaces it on purpose.
    const currentVersion = digestOfText(readFileSync(join(f.cwd, 'AGENTS.md'), 'utf8'));
    const updated = await f.tool.execute('c2', {
      op: 'initialize',
      expectedProjectRevision: revision(f),
      files: [{ path: 'AGENTS.md', expectedVersion: currentVersion, content: '# my rules\n' }],
      reusedAuthorityRefs: [],
      requestWriteUse: true,
      authorizationRef: { inputId: 'i-dec' },
    });

    expect(updated.isError).toBe(false);
    expect(readFileSync(join(f.cwd, 'AGENTS.md'), 'utf8')).toBe('# my rules\n');
    expect((updated.details['files'] as Array<{ outcome: string }>)[0]?.outcome).toBe('updated');
  });

  it('refuses a path outside the project and an unverifiable reused authority', async () => {
    const f = fixture();

    const escaped = await f.tool.execute('c1', {
      op: 'initialize',
      expectedProjectRevision: revision(f),
      files: [{ path: '../outside.md', expectedVersion: null, content: '# x\n' }],
      reusedAuthorityRefs: [],
      requestWriteUse: true,
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(escaped.isError).toBe(true);
    expect(escaped.details['code']).toBe('INVALID_ARGUMENT');
    expect(existsSync(join(f.cwd, '..', 'outside.md'))).toBe(false);

    const authority = await f.tool.execute('c2', {
      op: 'initialize',
      expectedProjectRevision: revision(f),
      files: entries(),
      reusedAuthorityRefs: ['.dev/PROJECT.md'],
      requestWriteUse: true,
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(authority.isError).toBe(true);
    expect(authority.details['code']).toBe('INVALID_ARGUMENT');
    expect((authority.details['issues'] as string[]).join(' ')).toContain('does not exist or cannot be read');
  });

  it('keeps an entry that is a directory from failing the whole batch, and refuses empty or duplicated entries', async () => {
    const f = fixture();
    // A directory already occupies the planned path: that entry fails, the others still land.
    mkdirSync(join(f.cwd, 'docs'), { recursive: true });

    const partial = await f.tool.execute('c1', {
      op: 'initialize',
      expectedProjectRevision: revision(f),
      files: [
        { path: 'AGENTS.md', expectedVersion: null, content: '# rules\n' },
        { path: 'docs', expectedVersion: null, content: '# docs\n' },
      ],
      reusedAuthorityRefs: [],
      requestWriteUse: true,
      authorizationRef: { inputId: 'i-dec' },
    });

    expect(partial.isError).toBe(true);
    expect(partial.details['missing']).toEqual(['docs']);
    const outcomes = (partial.details['files'] as Array<{ path: string; outcome: string }>).map((entry) => [
      entry.path,
      entry.outcome,
    ]);
    // The batch really ran per file: the good entry was created, the directory was reported.
    expect(outcomes).toContainEqual(['AGENTS.md', 'created']);
    expect(outcomes).toContainEqual(['docs', 'failed']);
    expect(readFileSync(join(f.cwd, 'AGENTS.md'), 'utf8')).toBe('# rules\n');

    // Empty content and one file planned twice are argument errors, refused before any plan.
    const empty = await f.tool.execute('c2', {
      op: 'initialize',
      expectedProjectRevision: revision(f),
      files: [{ path: '.dev/INDEX.md', expectedVersion: null, content: '   \n' }],
      reusedAuthorityRefs: [],
      requestWriteUse: true,
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(empty.details['code']).toBe('INVALID_ARGUMENT');

    const duplicated = await f.tool.execute('c3', {
      op: 'initialize',
      expectedProjectRevision: revision(f),
      files: [
        { path: '.dev/INDEX.md', expectedVersion: null, content: '# one\n' },
        { path: './.dev/INDEX.md', expectedVersion: null, content: '# two\n' },
      ],
      reusedAuthorityRefs: [],
      requestWriteUse: true,
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(duplicated.details['code']).toBe('INVALID_ARGUMENT');
    expect(existsSync(join(f.cwd, '.dev', 'INDEX.md'))).toBe(false);
  });

  it('refuses a stale project revision and only lets the chief initialize', async () => {
    const f = fixture();
    f.setRole('designer');

    const forbidden = await f.tool.execute('c1', {
      op: 'initialize',
      expectedProjectRevision: revision(f),
      files: entries(),
      reusedAuthorityRefs: [],
      requestWriteUse: true,
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(forbidden.details['code']).toBe('FORBIDDEN');
    expect(existsSync(join(f.cwd, 'AGENTS.md'))).toBe(false);

    f.setRole('chief');
    const stale = await f.tool.execute('c2', {
      op: 'initialize',
      expectedProjectRevision: revision(f) + 5,
      files: entries(),
      reusedAuthorityRefs: [],
      requestWriteUse: true,
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(stale.isError).toBe(true);
    expect(stale.details['code']).toBe('VERSION_CONFLICT');
    // The entries are on disk; only the project record could not be stamped.
    expect(stale.details['missing']).toEqual([]);
    expect(existsSync(join(f.cwd, 'AGENTS.md'))).toBe(true);
    expect(f.store.getProject('p-1')?.initializationRef).toBeNull();
  });
});
