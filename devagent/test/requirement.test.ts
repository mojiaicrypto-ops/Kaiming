import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { createRequirementTool, type RequirementToolContext } from '../src/tools/requirement-tools.ts';
import { createChiefTaskTools, type TaskToolContext } from '../src/tools/task-tools.ts';
import { IMPLEMENTATION_SECTIONS, parseRequirement, requirementPath } from '../src/runtime/requirement-store.ts';

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
  readonly tool: ReturnType<typeof createRequirementTool>;
  setRole(roleId: string): void;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'devagent-requirement-'));
  dirs.push(root);
  const cwd = join(root, 'project');
  const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
  stores.push(store);
  store.createProject({ id: 'p-1', realPath: cwd });
  store.createSession({ id: 'c-1', projectId: 'p-1', roleId: 'chief', cwd });
  // A real user decision input: save verifies the citation, not its wording.
  store.acceptInput({
    inputId: 'i-dec',
    projectId: 'p-1',
    sessionId: 'c-1',
    sourceKey: 'c-1:i-dec',
    requestKey: 'i-dec',
    method: 'session.input.submit',
    kind: 'user',
    payload: { content: [{ type: 'text', text: 'save this' }] },
  });
  const state = { roleId: 'chief' };
  return {
    store,
    cwd,
    tool: createRequirementTool(
      (): RequirementToolContext => ({
        store,
        projectId: 'p-1',
        cwd,
        roleId: state.roleId,
      }),
    ),
    setRole: (roleId) => {
      state.roleId = roleId;
    },
  };
}

const proposal = (overrides: Partial<Record<string, string>> = {}): string => `---
schemaVersion: 2
id: req-reset
kind: proposal
title: 密码重置
status: pending
createdAt: "2026-10-04T00:00:00Z"
updatedAt: "2026-10-04T00:00:00Z"
---

## 目标
允许用户重置密码。

## 来源与决定
用户 2026-10-04 提出。

## 处理记录
尚待规划。
${overrides['extra'] ?? ''}`;

const implementation = (id = 'req-reset-impl'): string => `---
schemaVersion: 2
id: ${id}
kind: implementation
title: 密码重置实施
status: pending
createdAt: "2026-10-04T00:00:00Z"
updatedAt: "2026-10-04T00:00:00Z"
---

${IMPLEMENTATION_SECTIONS.map((section) => `## ${section}\n内容。\n`).join('\n')}`;

const proposalFields = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'proposal',
  title: '密码重置',
  status: 'pending',
  body: '## 目标\n允许用户重置密码。\n\n## 来源与决定\n用户 2026-10-04 提出。\n\n## 处理记录\n尚待规划。',
  ...overrides,
});

const implementationFields = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'implementation',
  title: '密码重置实施',
  status: 'pending',
  sections: Object.fromEntries(IMPLEMENTATION_SECTIONS.map((section) => [section, '内容。'])),
  ...overrides,
});

describe('requirement save decisions', () => {
  const saveWith = (f: Fixture, authorizationRef: unknown) =>
    f.tool.execute('c1', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: null,
      ...proposalFields(),
      authorizationRef,
    });

  /** Ask a question and return its current revision, so a resolution can name the real version. */
  const ask = (f: Fixture, method: 'confirm' | 'select' | 'input', options?: readonly string[]): number => {
    const created = f.store.createInteraction({
      interactionId: 'q-1',
      projectId: 'p-1',
      sessionId: 'c-1',
      method,
      title: 'save?',
      requestKey: 'q-1',
      ...(options === undefined ? {} : { options }),
    });
    return created.revision;
  };

  it('accepts a confirmation the user answered in the browser', async () => {
    const f = fixture();
    const revision = ask(f, 'confirm');
    f.store.resolveInteraction({ interactionId: 'q-1', expectedRevision: revision, response: { confirmed: true }, answeredBy: 'user', requestKey: 'q-1' });

    const saved = await saveWith(f, { interactionId: 'q-1' });
    expect(saved.isError).toBe(false);
    // It really reached the file and reads back through the tool.
    const read = await f.tool.execute('c1', { op: 'get', requirementId: 'req-reset' });
    expect(read.isError).toBe(false);
    expect(existsSync(requirementPath(f.cwd, 'req-reset'))).toBe(true);
  });

  it('refuses a declined confirmation, a pending question, a foreign one and a bare id', async () => {
    const declined = fixture();
    const declinedRevision = ask(declined, 'confirm');
    declined.store.resolveInteraction({ interactionId: 'q-1', expectedRevision: declinedRevision, response: { confirmed: false }, answeredBy: 'user', requestKey: 'q-1' });
    expect(await saveWith(declined, { interactionId: 'q-1' })).toMatchObject({ isError: true });

    const pending = fixture();
    ask(pending, 'confirm');
    expect(await saveWith(pending, { interactionId: 'q-1' })).toMatchObject({ isError: true });

    const foreign = fixture();
    foreign.store.createProject({ id: 'p-2', realPath: join(foreign.cwd, 'other') });
    const foreignRevision = ask(foreign, 'confirm');
    foreign.store.resolveInteraction({ interactionId: 'q-1', expectedRevision: foreignRevision, response: true, answeredBy: 'user', requestKey: 'q-1' });
    const context = { store: foreign.store, projectId: 'p-2', cwd: foreign.cwd, roleId: 'chief' };
    const tool = createRequirementTool((): RequirementToolContext => context);
    const refused = await tool.execute('c1', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: null,
      ...proposalFields(),
      authorizationRef: { interactionId: 'q-1' },
    });
    expect(refused).toMatchObject({ isError: true });

    const unknown = fixture();
    expect(await saveWith(unknown, { interactionId: 'q-missing' })).toMatchObject({ isError: true });
  });

  it('accepts a chosen option and a typed answer, and still accepts a user input decision', async () => {
    const chosen = fixture();
    const chosenRevision = ask(chosen, 'select', ['save', 'later']);
    chosen.store.resolveInteraction({ interactionId: 'q-1', expectedRevision: chosenRevision, response: { value: 'save' }, answeredBy: 'user', requestKey: 'q-1' });
    expect(await saveWith(chosen, { interactionId: 'q-1' })).toMatchObject({ isError: false });

    const typed = fixture();
    const typedRevision = ask(typed, 'input');
    typed.store.resolveInteraction({ interactionId: 'q-1', expectedRevision: typedRevision, response: 'save it', answeredBy: 'user', requestKey: 'q-1' });
    expect(await saveWith(typed, { interactionId: 'q-1' })).toMatchObject({ isError: false });

    const byInput = fixture();
    expect(await saveWith(byInput, { inputId: 'i-dec' })).toMatchObject({ isError: false });
  });
});

describe('requirement records', () => {
  it('saves a new proposal, reports its version and reads it back', async () => {
    const f = fixture();

    const saved = await f.tool.execute('c1', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: null,
      ...proposalFields(),
      authorizationRef: { inputId: 'i-dec' },
    });

    expect(saved.isError).toBe(false);
    const path = requirementPath(f.cwd, 'req-reset');
    expect(saved.details['path']).toBe(path);
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, 'utf8');
    // The program wrote the file: identity, schema version and the real save time.
    expect(text.startsWith('---\nschemaVersion: 2\nid: req-reset\nkind: proposal\n')).toBe(true);
    expect(text).toContain('## 目标');
    expect(text).toContain('用户 2026-10-04 提出。');
    expect(text).toMatch(/updatedAt: "\d{4}-\d{2}-\d{2}T/);
    const got = await f.tool.execute('c2', { op: 'get', requirementId: 'req-reset' });
    expect(got.isError).toBe(false);
    expect(got.details['version']).toBe(saved.details['version']);
    expect(got.details['text']).toBe(text);
    expect((got.details['metadata'] as { kind: string }).kind).toBe('proposal');
  });

  it('refuses incomplete or contradictory fields instead of writing them', async () => {
    const f = fixture();

    const cases: Array<{ readonly id: string; readonly fields: Record<string, unknown>; readonly reason: string }> = [
      {
        id: 'req-a',
        fields: { kind: 'implementation', title: 'x', status: 'pending', body: 'free body' },
        reason: 'takes `sections`, not `body`',
      },
      { id: 'req-b', fields: proposalFields({ status: 'in_progress' }), reason: 'status in_progress is not valid' },
      {
        id: 'req-c',
        fields: implementationFields({
          sections: Object.fromEntries(IMPLEMENTATION_SECTIONS.filter((s) => s !== '验收').map((s) => [s, '内容。'])),
        }),
        reason: 'sections without content: 验收',
      },
      {
        id: 'req-d',
        fields: implementationFields({
          sections: { ...(implementationFields()['sections'] as object), 补充: '内容。' },
        }),
        reason: 'unknown section `补充`',
      },
    ];

    for (const entry of cases) {
      const result = await f.tool.execute(`call-${entry.id}`, {
        op: 'save',
        requirementId: entry.id,
        expectedVersion: null,
        ...entry.fields,
        authorizationRef: { inputId: 'i-dec' },
      });
      expect(result.isError).toBe(true);
      expect((result.details['issues'] as string[]).join(' ')).toContain(entry.reason);
      expect(existsSync(requirementPath(f.cwd, entry.id))).toBe(false);
    }
  });

  it('still reports a damaged file on disk (the parser stays the single format authority)', () => {
    // Nothing reaches the parser through save any more, but a file can still be damaged from
    // outside: list/get must report it, never guess it into a valid record.
    const cases: Array<{ readonly text: string; readonly reason: string }> = [
      { text: proposal().replace('title: 密码重置', 'title: 密码重置\ntitle: 另一个'), reason: 'duplicate field' },
      { text: proposal().replace('schemaVersion: 2', 'schemaVersion: 3'), reason: 'not supported' },
      { text: proposal().replace('id: req-reset', 'id: req-other'), reason: 'does not match the file name' },
      { text: '# no front matter\n', reason: 'front matter' },
    ];
    for (const entry of cases) {
      const parsed = parseRequirement(entry.text, 'req-reset', '/tmp');
      expect(parsed.ok).toBe(false);
      expect(parsed.ok ? [] : parsed.issues.join(' ')).toContain(entry.reason);
    }
  });

  it('accepts a complete implementation record and reports its sections', async () => {
    const f = fixture();

    const saved = await f.tool.execute('c1', {
      op: 'save',
      requirementId: 'req-reset-impl',
      expectedVersion: null,
      ...implementationFields(),
      authorizationRef: { inputId: 'i-dec' },
    });

    expect(saved.isError).toBe(false);
    expect(saved.details['sections']).toEqual([...IMPLEMENTATION_SECTIONS]);
    const parsed = parseRequirement(readFileSync(requirementPath(f.cwd, 'req-reset-impl'), 'utf8'), 'req-reset-impl', f.cwd);
    expect(parsed.ok).toBe(true);
  });

  it('checks the version on update, keeps id and kind, and never moves a record', async () => {
    const f = fixture();
    const first = await f.tool.execute('c1', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: null,
      ...proposalFields(),
      authorizationRef: { inputId: 'i-dec' },
    });
    const version = String(first.details['version']);
    const text = readFileSync(requirementPath(f.cwd, 'req-reset'), 'utf8');

    // A stale version is refused and the file is untouched.
    const stale = await f.tool.execute('c2', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: 'stale',
      ...proposalFields({ status: 'planning' }),
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(stale.isError).toBe(true);
    expect(stale.details['code']).toBe('VERSION_CONFLICT');
    expect(readFileSync(requirementPath(f.cwd, 'req-reset'), 'utf8')).toBe(text);

    // A record cannot change its kind in place (a proposal becomes a linked new record instead).
    const changedKind = await f.tool.execute('c3', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: version,
      ...implementationFields(),
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(changedKind.isError).toBe(true);
    expect(changedKind.details['code']).toBe('INVALID_ARGUMENT');

    // A real update goes through with the version get returned.
    const updated = await f.tool.execute('c4', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: version,
      ...proposalFields({ status: 'planning' }),
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(updated.isError).toBe(false);
    expect(String(updated.details['version'])).not.toBe(version);
    expect(readFileSync(requirementPath(f.cwd, 'req-reset'), 'utf8')).toContain('status: planning');
  });

  it('verifies the cited decision and the role before writing', async () => {
    const f = fixture();

    const unknownDecision = await f.tool.execute('c1', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: null,
      ...proposalFields(),
      authorizationRef: { inputId: 'nope' },
    });
    expect(unknownDecision.isError).toBe(true);
    expect(unknownDecision.details['code']).toBe('INVALID_ARGUMENT');
    expect(existsSync(requirementPath(f.cwd, 'req-reset'))).toBe(false);

    // A developer may read requirements but not save them (G1).
    f.setRole('developer');
    const forbidden = await f.tool.execute('c2', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: null,
      ...proposalFields(),
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(forbidden.isError).toBe(true);
    expect(forbidden.details['code']).toBe('FORBIDDEN');
  });

  it('refuses a decision that is not a user input', async () => {
    const f = fixture();
    // A delegated instruction is the chief's work order, not the user's decision about a requirement.
    f.store.acceptInput({
      inputId: 'i-delegated',
      projectId: 'p-1',
      sessionId: 'c-1',
      sourceKey: 'c-1:i-delegated',
      requestKey: 'i-delegated',
      method: 'task.session',
      kind: 'delegation',
      payload: { content: [{ type: 'text', text: 'implement it' }] },
    });

    const saved = await f.tool.execute('c1', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: null,
      ...proposalFields(),
      authorizationRef: { inputId: 'i-delegated' },
    });

    expect(saved.isError).toBe(true);
    expect(saved.details['code']).toBe('INVALID_ARGUMENT');
    expect(existsSync(requirementPath(f.cwd, 'req-reset'))).toBe(false);
  });

  it('lists valid records with filters and paging, and reports unreadable files', async () => {
    const f = fixture();
    for (const [id, status] of [
      ['req-a', 'pending'],
      ['req-b', 'planning'],
      ['req-c', 'pending'],
    ] as const) {
      const saved = await f.tool.execute(`save-${id}`, {
        op: 'save',
        requirementId: id,
        expectedVersion: null,
        ...proposalFields({ status }),
        authorizationRef: { inputId: 'i-dec' },
      });
      expect(saved.isError).toBe(false);
    }
    const broken = requirementPath(f.cwd, 'req-broken');
    mkdirSync(dirname(broken), { recursive: true });
    writeFileSync(broken, '# not a record\n', 'utf8');

    const listed = await f.tool.execute('c1', { op: 'list' });

    expect(listed.isError).toBe(false);
    const items = listed.details['items'] as Array<{ id: string }>;
    expect(items.map((item) => item.id).sort()).toEqual(['req-a', 'req-b', 'req-c']);
    // The unreadable file is reported, never hidden, and does not appear as a valid record.
    expect((listed.details['invalidFiles'] as Array<{ file: string }>).map((entry) => entry.file)).toEqual([
      'req-broken.md',
    ]);

    const filtered = await f.tool.execute('c2', { op: 'list', status: 'pending', limit: 1 });
    const page = filtered.details['items'] as Array<{ id: string }>;
    expect(page).toHaveLength(1);
    expect(filtered.details['nextCursor']).not.toBeNull();
    const next = await f.tool.execute('c3', {
      op: 'list',
      status: 'pending',
      limit: 1,
      cursor: String(filtered.details['nextCursor']),
    });
    const secondPage = next.details['items'] as Array<{ id: string }>;
    expect(secondPage).toHaveLength(1);
    expect(secondPage[0]?.id).not.toBe(page[0]?.id);
    expect(next.details['nextCursor']).toBeNull();
  });

  it('refuses an implementation record with an empty section', async () => {
    const f = fixture();
    const sections = { ...(implementationFields()['sections'] as Record<string, string>), 范围: '   ' };

    const saved = await f.tool.execute('c1', {
      op: 'save',
      requirementId: 'req-reset-impl',
      expectedVersion: null,
      ...implementationFields({ sections }),
      authorizationRef: { inputId: 'i-dec' },
    });

    expect(saved.isError).toBe(true);
    expect((saved.details['issues'] as string[]).join(' ')).toContain('sections without content: 范围');
    expect(existsSync(requirementPath(f.cwd, 'req-reset-impl'))).toBe(false);
  });

  it('refuses a module reference that is not a real project file', async () => {
    const f = fixture();
    const saved = await f.tool.execute('c1', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: null,
      ...proposalFields({ modules: ['.dev/PROJECT.md', '../outside.md', '.dev/missing.md'] }),
      authorizationRef: { inputId: 'i-dec' },
    });

    expect(saved.isError).toBe(true);
    const issues = (saved.details['issues'] as string[]).join(' ');
    expect(issues).toContain('../outside.md is not a project-relative path');
    expect(issues).toContain('.dev/missing.md does not exist');

    // A real file in the project is accepted.
    mkdirSync(dirname(join(f.cwd, '.dev/PROJECT.md')), { recursive: true });
    writeFileSync(join(f.cwd, '.dev/PROJECT.md'), '# project\n', 'utf8');
    const ok = await f.tool.execute('c2', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: null,
      ...proposalFields({ modules: ['.dev/PROJECT.md'] }),
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(ok.isError).toBe(false);
  });

  it('reports an unreadable file instead of failing the whole list', async () => {
    const f = fixture();
    const saved = await f.tool.execute('save-ok', {
      op: 'save',
      requirementId: 'req-ok',
      expectedVersion: null,
      ...proposalFields(),
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(saved.isError).toBe(false);
    // A dangling symlink cannot be read; the valid record must still be listed.
    symlinkSync(join(f.cwd, 'nowhere.md'), requirementPath(f.cwd, 'req-dangling'));

    const listed = await f.tool.execute('c1', { op: 'list' });

    expect(listed.isError).toBe(false);
    expect((listed.details['items'] as Array<{ id: string }>).map((item) => item.id)).toEqual(['req-ok']);
    const invalid = listed.details['invalidFiles'] as Array<{ file: string; issues: string[] }>;
    expect(invalid.map((entry) => entry.file)).toEqual(['req-dangling.md']);
    expect(invalid[0]?.issues.join(' ')).toContain('could not be read');
  });

  it('reports an unreadable record through get instead of throwing', async () => {
    const f = fixture();
    const path = requirementPath(f.cwd, 'req-unreadable');
    mkdirSync(path, { recursive: true });

    const got = await f.tool.execute('c1', { op: 'get', requirementId: 'req-unreadable' });

    expect(got.isError).toBe(false);
    expect((got.details['issues'] as string[]).join(' ')).toContain('could not be read');
    expect(got.details['metadata']).toBeUndefined();
  });

  it('reports a record that exists but cannot be read instead of guessing it', async () => {
    const f = fixture();
    mkdirSync(dirname(requirementPath(f.cwd, 'req-broken')), { recursive: true });
    writeFileSync(
      requirementPath(f.cwd, 'req-broken'),
      '---\nschemaVersion: 2\nid: req-broken\nkind: proposal\n---\n\nbody\n',
      'utf8',
    );

    const got = await f.tool.execute('c1', { op: 'get', requirementId: 'req-broken' });

    expect(got.isError).toBe(false);
    expect(got.details['metadata']).toBeUndefined();
    expect((got.details['issues'] as string[]).join(' ')).toContain('missing field');
    expect(got.details['text']).toContain('kind: proposal');
  });
});

describe('requirement · the program owns the file format', () => {
  it('the description names every section, so the author supplies content and not a syntax', () => {
    const tool = createRequirementTool(() => ({ store: undefined as never, projectId: 'p', cwd: '/tmp', roleId: 'chief' }));
    const description = String(tool.description ?? '');
    for (const section of IMPLEMENTATION_SECTIONS) {
      expect(description).toContain(section);
    }
    expect(description).toContain('the program writes schemaVersion, id, createdAt/updatedAt');
    expect(description).not.toContain('YAML front matter');
  });

  it('a save with a missing section names the section it needs instead of a syntax error', async () => {
    const f = fixture();
    const sections = { ...(implementationFields()['sections'] as Record<string, string>) };
    delete sections['行为与异常'];

    const outcome = await f.tool.execute('c1', {
      op: 'save',
      requirementId: 'req-x',
      expectedVersion: null,
      ...implementationFields({ sections }),
      authorizationRef: { inputId: 'i-dec' },
    });

    expect(outcome.isError).toBe(true);
    const text = JSON.stringify(outcome);
    expect(text).toContain('sections without content: 行为与异常');
    // The full heading list travels with the refusal: one retry can comply without guessing.
    expect(text).toContain('完成摘要');
  });

  it('get returns the sections, and resubmitting them reproduces the same body', async () => {
    const f = fixture();
    const saved = await f.tool.execute('c1', {
      op: 'save',
      requirementId: 'req-reset-impl',
      expectedVersion: null,
      ...implementationFields({ sections: { ...(implementationFields()['sections'] as object), 验收: '1. npm test 全过\n2. 注册表能列出这个 skill' } }),
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(saved.isError).toBe(false);

    const got = await f.tool.execute('c2', { op: 'get', requirementId: 'req-reset-impl' });
    const sections = got.details['sections'] as Record<string, string>;
    expect(Object.keys(sections).sort()).toEqual([...IMPLEMENTATION_SECTIONS].sort());
    expect(sections['验收']).toBe('1. npm test 全过\n2. 注册表能列出这个 skill');

    // Round-trip: the returned values are exactly what save accepts.
    const again = await f.tool.execute('c3', {
      op: 'save',
      requirementId: 'req-reset-impl',
      expectedVersion: String(got.details['version']),
      ...implementationFields({ sections, status: 'in_progress' }),
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(again.isError).toBe(false);
    const text = readFileSync(requirementPath(f.cwd, 'req-reset-impl'), 'utf8');
    expect(text).toContain('## 验收\n\n1. npm test 全过\n2. 注册表能列出这个 skill');
    expect(text).toContain('status: in_progress');
  });

  it('a damaged file on disk still gets the format hint (repair goes through save)', async () => {
    const f = fixture();
    const path = requirementPath(f.cwd, 'req-broken');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '---\nschemaVersion: 2\nid: req-broken\nkind: implementation\n---\n\nbody\n', 'utf8');

    const got = await f.tool.execute('c1', { op: 'get', requirementId: 'req-broken' });
    expect(got.isError).toBe(false);
    expect(String(got.details['format'])).toContain('schemaVersion: 2');
    expect(String(got.details['format'])).toContain('## 完成摘要');
    expect(String(got.details['rules'])).toContain('UTC RFC3339');
  });
});

describe('requirement · the model can see what it must act on', () => {
  it('save and get put version, sections and issues in the text, not only in details', async () => {
    const f = fixture();
    const saved = await f.tool.execute('c1', {
      op: 'save',
      requirementId: 'req-reset-impl',
      expectedVersion: null,
      ...implementationFields(),
      authorizationRef: { inputId: 'i-dec' },
    });
    // Pi hands the model `content` only: a version that lives in details is a version it never had.
    const saveText = saved.content.map((part) => part.text).join('\n');
    expect(saveText).toContain(String(saved.details['version']));

    const got = await f.tool.execute('c2', { op: 'get', requirementId: 'req-reset-impl' });
    const getText = got.content.map((part) => part.text).join('\n');
    expect(getText).toContain(String(got.details['version']));
    expect(getText).toContain('## 验收');

    // A refusal has to show its reasons, or the next attempt is a guess.
    const missing = { ...(implementationFields()['sections'] as Record<string, string>) };
    delete missing['未知'];
    const refused = await f.tool.execute('c3', {
      op: 'save',
      requirementId: 'req-reset-impl',
      expectedVersion: String(got.details['version']),
      ...implementationFields({ sections: missing }),
      authorizationRef: { inputId: 'i-dec' },
    });
    const refusedText = refused.content.map((part) => part.text).join('\n');
    expect(refusedText).toContain('sections without content: 未知');
  });
});

describe('requirement and Task: the implementation edge is checked, not assumed', () => {
  /** A single chief context with one accepted decision, so a Task can be created. */
  const taskContext = (f: Fixture) => {
    const state = { inputId: 'i-dec' };
    return {
      state,
      tools: createChiefTaskTools((): TaskToolContext => ({
        store: f.store,
        sessionId: 'c-1',
        projectId: 'p-1',
        cwd: f.cwd,
        roleId: 'chief',
        inputId: state.inputId,
        serverWorkDir: join(f.cwd, '..', 'work'),
      })),
    };
  };
  const createTask = (f: Fixture, extra: Record<string, unknown>) => {
    const tool = taskContext(f).tools.find((entry) => entry.name === 'createTask');
    if (tool === undefined) throw new Error('createTask missing');
    return tool.execute('c1', {
      type: 'write',
      goal: 'deliver it',
      scope: 'the account area',
      planMarkdown: '# plan\n',
      authorizationRef: { inputId: 'i-dec' },
      requiresTest: true,
      ...extra,
    });
  };

  it('a Task may stand alone (design, planning, investigation)', async () => {
    const f = fixture();
    const created = await createTask(f, {});
    expect(created.isError).toBe(false);
  });

  it('refuses a Task that cites a record the project cannot read', async () => {
    const f = fixture();
    const missing = await createTask(f, { requirementId: 'req-missing' });
    expect(missing.isError).toBe(true);
    expect(missing.details['code']).toBe('NOT_FOUND');
    expect(f.store.listTasks('p-1')).toHaveLength(0);
  });

  it('refuses a Task citing a proposal, an unusable status, or a read Task', async () => {
    const proposalCase = fixture();
    const savedProposal = await proposalCase.tool.execute('s1', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: null,
      ...proposalFields(),
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(savedProposal.isError).toBe(false);
    const fromProposal = await createTask(proposalCase, { requirementId: 'req-reset' });
    expect(fromProposal.isError).toBe(true);
    expect(String(fromProposal.details['message'] ?? fromProposal.content[0]?.text)).toContain('proposal');

    const archivedCase = fixture();
    await archivedCase.tool.execute('s1', {
      op: 'save',
      requirementId: 'req-done',
      expectedVersion: null,
      ...implementationFields({ status: 'completed' }),
      authorizationRef: { inputId: 'i-dec' },
    });
    const fromCompleted = await createTask(archivedCase, { requirementId: 'req-done' });
    expect(fromCompleted.isError).toBe(true);
    expect(fromCompleted.details['code']).toBe('INVALID_ARGUMENT');

    const readCase = fixture();
    const readTask = await createTask(readCase, { type: 'read', requiresTest: false, requirementId: 'req-missing' });
    expect(readTask.isError).toBe(true);
  });

  it('accepts a Task that cites a pending implementation requirement', async () => {
    const f = fixture();
    await f.tool.execute('s1', {
      op: 'save',
      requirementId: 'req-reset-impl',
      expectedVersion: null,
      ...implementationFields(),
      authorizationRef: { inputId: 'i-dec' },
    });
    const created = await createTask(f, { requirementId: 'req-reset-impl' });
    expect(created.isError).toBe(false);
    expect(f.store.listTasks('p-1')[0]?.requirementId).toBe('req-reset-impl');
  });

  it('reports a completion recorded while its implementation Task is still open', async () => {
    const f = fixture();
    const saved = await f.tool.execute('s1', {
      op: 'save',
      requirementId: 'req-reset-impl',
      expectedVersion: null,
      ...implementationFields({ status: 'in_progress' }),
      authorizationRef: { inputId: 'i-dec' },
    });
    await createTask(f, { requirementId: 'req-reset-impl' });

    const completed = await f.tool.execute('s2', {
      op: 'save',
      requirementId: 'req-reset-impl',
      expectedVersion: String(saved.details['version']),
      ...implementationFields({ status: 'completed' }),
      authorizationRef: { inputId: 'i-dec' },
    });
    // Saved, but the mismatch is reported: the program may not judge completion for the chief.
    expect(completed.isError).toBe(false);
    const pending = completed.details['pendingCheck'] as string[];
    expect(pending.join(' ')).toContain('still open');
    expect(completed.content[0]?.text).toContain('pending check');
  });

  it('notes in_progress without any implementing Task', async () => {
    const f = fixture();
    const saved = await f.tool.execute('s1', {
      op: 'save',
      requirementId: 'req-reset-impl',
      expectedVersion: null,
      ...implementationFields({ status: 'in_progress' }),
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(saved.isError).toBe(false);
    expect(saved.content[0]?.text).toContain('no Task implements this requirement yet');
  });

  it('reports archiving a proposal whose produced requirement is not recorded', async () => {
    const f = fixture();
    const saved = await f.tool.execute('s1', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: null,
      ...proposalFields({ status: 'archived' }),
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(saved.isError).toBe(false);
    expect((saved.details['pendingCheck'] as string[]).join(' ')).toContain('no implementation requirement cites');
  });

  it('get shows the real implementation Tasks, and list reports a Task whose record is gone', async () => {
    const f = fixture();
    await f.tool.execute('s1', {
      op: 'save',
      requirementId: 'req-reset-impl',
      expectedVersion: null,
      ...implementationFields({ status: 'in_progress' }),
      authorizationRef: { inputId: 'i-dec' },
    });
    await createTask(f, { requirementId: 'req-reset-impl' });
    const taskId = f.store.listTasks('p-1')[0]?.id ?? '';

    const got = await f.tool.execute('g1', { op: 'get', requirementId: 'req-reset-impl' });
    expect((got.details['implementationTasks'] as Array<{ taskId: string }>).map((t) => t.taskId)).toEqual([taskId]);

    // The record disappears while the Task remains: the list must surface the orphan.
    rmSync(requirementPath(f.cwd, 'req-reset-impl'));
    const listed = await f.tool.execute('l1', { op: 'list' });
    expect((listed.details['tasksWithoutRecord'] as Array<{ taskId: string }>).map((t) => t.taskId)).toEqual([taskId]);
  });
});

describe('requirement · recorded tasks that do not implement it', () => {
  it('get names a linked Task that does not cite this requirement', async () => {
    const f = fixture();
    const saved = await f.tool.execute('s1', {
      op: 'save',
      requirementId: 'req-reset-impl',
      expectedVersion: null,
      ...implementationFields(),
      linkedTaskIds: ['t-standalone'],
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(saved.isError).toBe(false);
    // A Task that really exists but does not carry requirementId (created before the edge was checked).
    f.store.createTask({
      id: 't-standalone',
      projectId: 'p-1',
      chiefSessionId: 'c-1',
      type: 'write',
      requiresTest: true,
      goal: 'unrelated',
      scope: 'unrelated',
      acceptanceRefs: [],
      basisRefs: [],
      ownerEpoch: f.store.epoch,
      planRef: { storage: 'project', path: '.dev/work/t-standalone/plan.md', sha256: '0'.repeat(64) },
      authorizationRefs: ['input:i-dec'],
      summary: '',
      sourceInputId: 'i-dec',
    });

    const got = await f.tool.execute('g1', { op: 'get', requirementId: 'req-reset-impl' });
    expect(got.details['recordedNotImplementing']).toEqual(['t-standalone']);
    expect((got.details['implementationTasks'] as unknown[]).length).toBe(0);
  });
});
