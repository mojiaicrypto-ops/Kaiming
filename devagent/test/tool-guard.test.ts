/**
 * The private-path guard (P-05/R5): a tool call that names the server's own storage is refused before
 * it runs, because whatever a tool returns becomes part of the conversation.
 */
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createBashTimeoutGuard, privatePathBlockReason } from '../src/runtime/tool-guard.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function layout(): { readonly project: string; readonly data: string; readonly models: string } {
  const root = mkdtempSync(join(tmpdir(), 'devagent-guard-'));
  dirs.push(root);
  const project = join(root, 'project');
  const data = join(root, 'data');
  mkdirSync(project, { recursive: true });
  mkdirSync(data, { recursive: true });
  const models = join(data, 'models.json');
  writeFileSync(models, JSON.stringify({ providers: { p: { apiKey: 'sk-secret' } } }));
  return { project, data, models };
}

describe('private path guard', () => {
  it('refuses a file tool that names the private storage, by absolute path or through the project', () => {
    const { project, data, models } = layout();
    const base = { cwd: project, privateDirs: [data] };

    expect(privatePathBlockReason({ ...base, toolName: 'read', args: { path: models } })).toMatch(/private storage/);
    expect(privatePathBlockReason({ ...base, toolName: 'read', args: { path: '../data/models.json' } })).toMatch(
      /private storage/,
    );
    expect(privatePathBlockReason({ ...base, toolName: 'ls', args: { path: data } })).toMatch(/private storage/);
    expect(privatePathBlockReason({ ...base, toolName: 'grep', args: { pattern: 'apiKey', path: data } })).toMatch(
      /private storage/,
    );
    expect(privatePathBlockReason({ ...base, toolName: 'edit', args: { path: models, edits: [] } })).toMatch(
      /private storage/,
    );
    // A relative path with no `path` argument resolves against the session cwd: still outside.
    expect(privatePathBlockReason({ ...base, toolName: 'ls', args: {} })).toBeUndefined();
  });

  it('allows the project itself', () => {
    const { project, data } = layout();
    const base = { cwd: project, privateDirs: [data] };
    expect(privatePathBlockReason({ ...base, toolName: 'read', args: { path: 'README.md' } })).toBeUndefined();
    expect(privatePathBlockReason({ ...base, toolName: 'read', args: { path: project } })).toBeUndefined();
    expect(privatePathBlockReason({ ...base, toolName: 'find', args: { pattern: '**/*.ts' } })).toBeUndefined();
  });

  it('lets the file tools read the session work root, but not the credential file beside it', () => {
    const { project, data, models } = layout();
    const work = join(data, 'work', 's-1', 'web');
    const saved = join(work, 'page.txt');
    const base = { cwd: project, privateDirs: [data], readableDirs: [join(data, 'work')] };

    // web_fetch tells the model to grep the file it saved; that path must be reachable.
    expect(privatePathBlockReason({ ...base, toolName: 'read', args: { path: saved } })).toBeUndefined();
    expect(privatePathBlockReason({ ...base, toolName: 'grep', args: { pattern: 'x', path: work } })).toBeUndefined();
    // The work root is not a hole in the rest of the private storage.
    expect(privatePathBlockReason({ ...base, toolName: 'read', args: { path: models } })).toMatch(/private storage/);
    expect(privatePathBlockReason({ ...base, toolName: 'ls', args: { path: join(data, 'sessions') } })).toMatch(
      /private storage/,
    );
    // A shell command still may not name private storage at all: the exemption is for reading files.
    expect(
      privatePathBlockReason({ ...base, toolName: 'bash', args: { command: `cat ${join(data, 'work', 'a.txt')}` } }),
    ).toMatch(/private storage/);
  });

  it('refuses a command that names the private storage', () => {
    const { project, data, models } = layout();
    const base = { cwd: project, privateDirs: [data] };
    expect(privatePathBlockReason({ ...base, toolName: 'bash', args: { command: `cat ${models}` } })).toMatch(
      /private storage/,
    );
    expect(privatePathBlockReason({ ...base, toolName: 'bash', args: { command: 'node --test' } })).toBeUndefined();
  });

  it('sees through the path forms Pi itself accepts', () => {
    const { project, data, models } = layout();
    const base = { cwd: project, privateDirs: [data] };
    // The same shapes the built-in tools normalize before resolving: a leading @, a file:// URL.
    expect(privatePathBlockReason({ ...base, toolName: 'read', args: { path: `@${models}` } })).toMatch(/private storage/);
    expect(privatePathBlockReason({ ...base, toolName: 'read', args: { path: `file://${models}` } })).toMatch(
      /private storage/,
    );
    expect(privatePathBlockReason({ ...base, toolName: 'read', args: { path: `@../data/models.json` } })).toMatch(
      /private storage/,
    );
    // The order matters: Pi strips `@` before converting the URL, so this combination reaches the file.
    expect(privatePathBlockReason({ ...base, toolName: 'read', args: { path: `@file://${models}` } })).toMatch(
      /private storage/,
    );
    expect(
      privatePathBlockReason({ ...base, toolName: 'read', args: { path: `@file://localhost${models}` } }),
    ).toMatch(/private storage/);
    expect(privatePathBlockReason({ ...base, toolName: 'read', args: { path: `\u00A0${models}` } })).toMatch(
      /private storage/,
    );
  });

  it('sees through a symlinked directory for a path that does not exist yet', () => {
    const { project, data } = layout();
    // A project-visible link into the private storage: writing a new file below it must still be caught.
    symlinkSync(data, join(project, 'linked'));
    const base = { cwd: project, privateDirs: [data] };
    expect(
      privatePathBlockReason({ ...base, toolName: 'write', args: { path: 'linked/new/credential.json', content: 'x' } }),
    ).toMatch(/private storage/);
    expect(privatePathBlockReason({ ...base, toolName: 'write', args: { path: 'new/credential.json' } })).toBeUndefined();
  });

  it('does not follow a symlink from the project into the private storage', () => {
    const { project, data, models } = layout();
    symlinkSync(models, join(project, 'shortcut.json'));
    const base = { cwd: project, privateDirs: [data] };
    expect(privatePathBlockReason({ ...base, toolName: 'read', args: { path: 'shortcut.json' } })).toMatch(
      /private storage/,
    );
  });

  it('guards nothing when there is no private directory to guard', () => {
    expect(privatePathBlockReason({ toolName: 'read', args: { path: '/etc/hosts' }, cwd: '/tmp', privateDirs: [] })).toBeUndefined();
  });
});

describe('bash timeout guard', () => {
  type TestCall = { type: string; toolCallId: string; toolName: string; input: Record<string, unknown> };
  function install(seconds: number): (event: { toolName: string; input: Record<string, unknown> }) => unknown {
    const handlers: Array<(event: unknown) => unknown> = [];
    const api = {
      on(event: string, handler: (event: unknown) => unknown) {
        if (event === 'tool_call') handlers.push(handler);
        return () => undefined;
      },
    } as unknown as ExtensionAPI;
    createBashTimeoutGuard({ seconds })(api);
    const handler = handlers[0];
    if (handler === undefined) throw new Error('the guard did not register a tool_call handler');
    return (event) => handler(event);
  }

  it('adds the host deadline only when the model omitted one', () => {
    const call = install(600);
    const bash = { type: 'tool_call', toolCallId: '1', toolName: 'bash', input: { command: 'sleep 1' } } as TestCall;
    call(bash);
    expect(bash.input.timeout).toBe(600);

    const explicit = {
      type: 'tool_call',
      toolCallId: '2',
      toolName: 'bash',
      input: { command: 'sleep 1', timeout: 30 },
    } as TestCall;
    call(explicit);
    expect(explicit.input.timeout).toBe(30);

    const read = { type: 'tool_call', toolCallId: '3', toolName: 'read', input: { path: 'README.md' } } as TestCall;
    call(read);
    expect(read.input.timeout).toBeUndefined();
  });

  it('refuses a non-positive default', () => {
    expect(() => createBashTimeoutGuard({ seconds: 0 })).toThrow();
    expect(() => createBashTimeoutGuard({ seconds: -1 })).toThrow();
  });
});
