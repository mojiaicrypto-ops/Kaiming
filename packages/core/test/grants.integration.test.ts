/**
 * WP-07 integration — the durable deferred-result store under **real concurrent
 * writers** (W7R2-04).
 *
 * The review's round-2 probe showed the manifest layout losing entries: two
 * processes each wrote 25 results and only 26 of 50 survived, because every `put`
 * rewrote a shared index with a read-modify-write and no lock. The per-reference
 * file layout has no shared state, and this suite proves it with two real
 * `node` processes writing concurrently into the same project state directory —
 * then resolves every reference the two processes reported.
 *
 * The child processes use `BlobStore` directly (which is all the store needs) so
 * the test is about filesystem concurrency rather than SQLite contention, and it
 * stays offline.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectStore as Store, projectIdFromRoot, type ProjectStore } from '@agentdev/storage';
import { ProjectStoreDeferredResultStore } from '../src/index.js';

const WRITERS = 2;
const PER_WRITER = 25;

/** The built entry point for a workspace package, rebuilding it when stale. */
function builtEntry(name: 'core' | 'storage'): string {
  const root = process.cwd();
  const entry = join(root, 'packages', name, 'dist', 'index.js');
  const sourceRoot = join(root, 'packages', name, 'src');
  const sources: string[] = [];
  const walk = (dir: string): void => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name);
      if (item.isDirectory()) walk(path);
      else if (item.name.endsWith('.ts')) sources.push(path);
    }
  };
  walk(sourceRoot);
  const newestSource = Math.max(...sources.map((file) => statSync(file).mtimeMs));
  if (!existsSync(entry) || statSync(entry).mtimeMs < newestSource) {
    const built = spawnSync('pnpm', ['build'], { cwd: root, encoding: 'utf8', timeout: 300_000 });
    if (built.status !== 0 || !existsSync(entry)) {
      throw new Error(`pnpm build is required for the cross-process case: ${built.stderr}`);
    }
  }
  return pathToFileURL(entry).href;
}

/** Runs one writer process and resolves with the references it reported. */
function runWriter(
  dataDir: string,
  workspace: string,
  writer: number,
  count: number,
): Promise<string[]> {
  const script = `
    import { BlobStore } from '${builtEntry('storage')}';
    import { ProjectStoreDeferredResultStore } from '${builtEntry('core')}';
    const { DATA_DIR, WORKSPACE, WRITER, COUNT } = process.env;
    const blobs = new BlobStore({ root: DATA_DIR });
    const sink = new ProjectStoreDeferredResultStore({ store: { blobs } });
    const refs = [];
    for (let index = 0; index < Number(COUNT); index += 1) {
      refs.push(sink.put({ writer: Number(WRITER), index, workspace: WORKSPACE }));
    }
    process.stdout.write(JSON.stringify(refs));
  `;
  return new Promise((settle, fail) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        WORKSPACE: workspace,
        WRITER: String(writer),
        COUNT: String(count),
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (code !== 0) {
        fail(new Error(`writer ${String(writer)} exited with ${String(code)}: ${stderr}`));
        return;
      }
      settle(JSON.parse(stdout.trim()) as string[]);
    });
  });
}

describe('durable deferred results under concurrent writers (W7R2-04)', () => {
  let dataDir: string;
  let workspace: string;
  let store: ProjectStore;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'agentdev-grants-int-data-'));
    workspace = mkdtempSync(join(tmpdir(), 'agentdev-grants-int-ws-'));
    store = Store.open({
      dataDir,
      canonicalRoot: workspace,
      migrations: { backup: () => undefined, backupPath: join(dataDir, 'pre.sqlite') },
    });
    store.projects.insert({
      id: projectIdFromRoot(workspace),
      root: workspace,
      codeRoot: 'src',
      documentRoot: 'docs',
      deliveryBranch: 'agentdev/main',
      trust: 'trusted',
      state: 'open',
    });
  });

  afterEach(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  });

  it('loses no entry when two processes write results concurrently', async () => {
    const writers = await Promise.all(
      Array.from({ length: WRITERS }, (_unused, writer) =>
        runWriter(dataDir, workspace, writer, PER_WRITER),
      ),
    );
    const refs = writers.flat();
    expect(refs).toHaveLength(WRITERS * PER_WRITER);
    expect(new Set(refs).size).toBe(WRITERS * PER_WRITER);

    // Every result written by *any* process is immediately resolvable here, from
    // the already-open store (no stale cache) and from a fresh one.
    const sink = new ProjectStoreDeferredResultStore({ store });
    for (const ref of refs) {
      expect(sink.has(ref), `missing result ${ref}`).toBe(true);
      expect((sink.get(ref) as { index?: unknown } | undefined)?.index).toBeTypeOf('number');
    }
    expect(store.blobs.has('deferred-results/index.json')).toBe(false);
  });
});
