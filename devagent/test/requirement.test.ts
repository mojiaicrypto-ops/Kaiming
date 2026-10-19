import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store/store.ts';
import { createRequirementTool, type RequirementToolContext } from '../src/tools/requirement-tools.ts';
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

describe('requirement save decisions', () => {
  const saveWith = (f: Fixture, authorizationRef: unknown) =>
    f.tool.execute('c1', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: null,
      markdown: proposal(),
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
      markdown: proposal(),
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
      markdown: proposal(),
      authorizationRef: { inputId: 'i-dec' },
    });

    expect(saved.isError).toBe(false);
    const path = requirementPath(f.cwd, 'req-reset');
    expect(saved.details['path']).toBe(path);
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, 'utf8');
    // The save keeps the caller's content and stamps the real save time.
    expect(text).toContain('## 目标');
    expect(text).toContain('用户 2026-10-04 提出。');
    expect(text).toMatch(/updatedAt: "\d{4}-\d{2}-\d{2}T/);
    const got = await f.tool.execute('c2', { op: 'get', requirementId: 'req-reset' });
    expect(got.isError).toBe(false);
    expect(got.details['version']).toBe(saved.details['version']);
    expect(got.details['text']).toBe(text);
    expect((got.details['metadata'] as { kind: string }).kind).toBe('proposal');
  });

  it('refuses an invalid record instead of writing it', async () => {
    const f = fixture();

    // Missing implementation sections, a wrong status for the kind, a duplicate field.
    const cases: Array<{ readonly markdown: string; readonly id: string; readonly reason: string }> = [
      { id: 'req-a', markdown: proposal().replace('kind: proposal', 'kind: implementation'), reason: 'missing section' },
      { id: 'req-b', markdown: proposal().replace('status: pending', 'status: in_progress'), reason: 'status in_progress is not valid' },
      { id: 'req-c', markdown: proposal().replace('title: 密码重置', 'title: 密码重置\ntitle: 另一个'), reason: 'duplicate field' },
      { id: 'req-d', markdown: proposal().replace('schemaVersion: 2', 'schemaVersion: 3'), reason: 'not supported' },
      { id: 'req-e', markdown: proposal().replace('id: req-reset', 'id: req-other'), reason: 'does not match the file name' },
    ];

    for (const entry of cases) {
      const result = await f.tool.execute(`call-${entry.id}`, {
        op: 'save',
        requirementId: entry.id,
        expectedVersion: null,
        markdown: entry.markdown,
        authorizationRef: { inputId: 'i-dec' },
      });
      expect(result.isError).toBe(true);
      expect((result.details['issues'] as string[]).join(' ')).toContain(entry.reason);
      expect(existsSync(requirementPath(f.cwd, entry.id))).toBe(false);
    }
  });

  it('accepts a complete implementation record and reports its sections', async () => {
    const f = fixture();

    const saved = await f.tool.execute('c1', {
      op: 'save',
      requirementId: 'req-reset-impl',
      expectedVersion: null,
      markdown: implementation(),
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
      markdown: proposal(),
      authorizationRef: { inputId: 'i-dec' },
    });
    const version = String(first.details['version']);
    const text = readFileSync(requirementPath(f.cwd, 'req-reset'), 'utf8');

    // A stale version is refused and the file is untouched.
    const stale = await f.tool.execute('c2', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: 'stale',
      markdown: proposal().replace('pending', 'planning'),
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
      markdown: implementation('req-reset'),
      authorizationRef: { inputId: 'i-dec' },
    });
    expect(changedKind.isError).toBe(true);
    expect(changedKind.details['code']).toBe('INVALID_ARGUMENT');

    // A real update goes through with the version get returned.
    const updated = await f.tool.execute('c4', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: version,
      markdown: proposal().replace('status: pending', 'status: planning'),
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
      markdown: proposal(),
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
      markdown: proposal(),
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
      markdown: proposal(),
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
      const markdown = proposal().replace('id: req-reset', `id: ${id}`).replace('status: pending', `status: ${status}`);
      const saved = await f.tool.execute(`save-${id}`, {
        op: 'save',
        requirementId: id,
        expectedVersion: null,
        markdown,
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

  it('refuses an implementation record with an empty inner section', async () => {
    const f = fixture();
    const broken = implementation().replace(
      '## 范围\n内容。\n',
      '## 范围\n\n',
    );

    const saved = await f.tool.execute('c1', {
      op: 'save',
      requirementId: 'req-reset-impl',
      expectedVersion: null,
      markdown: broken,
      authorizationRef: { inputId: 'i-dec' },
    });

    expect(saved.isError).toBe(true);
    expect((saved.details['issues'] as string[]).join(' ')).toContain('has no content');
    expect(existsSync(requirementPath(f.cwd, 'req-reset-impl'))).toBe(false);
  });

  it('refuses a module reference that is not a real project file', async () => {
    const f = fixture();
    const cited = proposal().replace(
      'title: 密码重置',
      'title: 密码重置\nmodules: [.dev/PROJECT.md, ../outside.md, .dev/missing.md]',
    );

    const saved = await f.tool.execute('c1', {
      op: 'save',
      requirementId: 'req-reset',
      expectedVersion: null,
      markdown: cited,
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
      markdown: proposal().replace('title: 密码重置', 'title: 密码重置\nmodules: [.dev/PROJECT.md]'),
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
      markdown: proposal().replace('id: req-reset', 'id: req-ok'),
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

describe('requirement · the format travels with the tool', () => {
  it('the tool description carries the exact record template the parser enforces', async () => {
    const { createRequirementTool } = await import('../src/tools/requirement-tools.ts');
    const { requirementTemplate, parseRequirement } = await import('../src/runtime/requirement-store.ts');
    const tool = createRequirementTool(() => ({ store: undefined as never, projectId: 'p', cwd: '/tmp', roleId: 'chief' }));
    const description = String(tool.description ?? '');
    expect(description).toContain('schemaVersion: 2');
    expect(description).toContain('## 目标');
    expect(description).toContain('## 完成摘要');
    // The template the description shows is one the parser actually accepts (same source).
    const template = requirementTemplate('implementation', 'req-x');
    const parsed = parseRequirement(template.replace(/<[^>]*>/g, 'x'), 'req-x', '/tmp');
    expect(parsed.ok).toBe(true);
  });

  it('a rejected save reports the issues AND the format so one retry can comply', async () => {
    const { createRequirementTool } = await import('../src/tools/requirement-tools.ts');
    const { Store } = await import('../src/store/store.ts');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const root = mkdtempSync(join(tmpdir(), 'devagent-req-format-'));
    const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
    store.createProject({ id: 'p-1', realPath: root });
    const tool = createRequirementTool(() => ({ store, projectId: 'p-1', cwd: root, roleId: 'chief' }));
    // A real user decision: the save checks authorization before it looks at the format.
    store.createSession({ id: 's-fmt', projectId: 'p-1', roleId: 'chief', cwd: root });
    const interaction = store.createInteraction({
      interactionId: 'q-fmt', projectId: 'p-1', sessionId: 's-fmt', method: 'confirm',
      title: 'save?', requestKey: 'q-fmt',
    });
    store.resolveInteraction({
      interactionId: 'q-fmt', expectedRevision: interaction.revision,
      response: { confirmed: true }, answeredBy: 'user', requestKey: 'q-fmt',
    });
    const outcome = await tool.execute('t1', {
      op: 'save',
      requirementId: 'req-x',
      authorizationRef: { interactionId: 'q-fmt' },
      markdown: '# 需求 · 没有 front matter\n\n## 用户能看到的\n内容\n',
    });
    const text = JSON.stringify(outcome);
    expect(text).toContain('front matter');
    expect(text).toContain('schemaVersion: 2');
    store.close();
  });
});
