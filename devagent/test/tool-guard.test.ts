/**
 * The private-path guard (P-05/R5): a tool call that names the server's own storage is refused before
 * it runs, because whatever a tool returns becomes part of the conversation.
 */
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { privatePathBlockReason } from '../src/runtime/tool-guard.ts';

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
