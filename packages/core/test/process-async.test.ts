/**
 * Real-process tests for the async process port (`reliability.md` §5/§6).
 *
 * Every case spawns a real child; the process-group cases spawn a real grandchild and
 * prove that cancelling the group reaps it, which is the behaviour `spawnSync` could
 * not offer.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultAsyncProcessRunner } from '../src/process-async.js';
import { ToolProcessRegistry } from '../src/tool-processes.js';

const temporary: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentdev-process-async-'));
  temporary.push(dir);
  return dir;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return check();
}

afterEach(() => {
  while (temporary.length > 0) {
    const dir = temporary.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('defaultAsyncProcessRunner', () => {
  it('runs a real child and captures its streams', async () => {
    const result = await defaultAsyncProcessRunner.run('/bin/sh', [
      '-c',
      'printf out; printf err >&2; exit 3',
    ]);
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
    expect(result.status).toBe(3);
    expect(result.timedOut).toBeUndefined();
    expect(typeof result.pid).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('passes stdin without letting content become shell syntax', async () => {
    const result = await defaultAsyncProcessRunner.run('/bin/sh', ['-c', 'base64 -d'], {
      stdin: Buffer.from("'); rm -rf / #", 'utf8').toString('base64'),
    });
    expect(result.stdout).toBe("'); rm -rf / #");
  });

  it('kills the process tree on timeout', async () => {
    const result = await defaultAsyncProcessRunner.run('/bin/sh', ['-c', 'sleep 30'], {
      timeoutMs: 200,
      cancelGraceMs: 200,
    });
    expect(result.timedOut).toBe(true);
    expect(result.signal === 'SIGTERM' || result.signal === 'SIGKILL').toBe(true);
  });

  it('kills the whole group, not only the direct child', async () => {
    const dir = scratch();
    const pidFile = join(dir, 'grandchild.pid');
    const handle = defaultAsyncProcessRunner.start('/bin/sh', [
      '-c',
      `sleep 30 & echo $! > ${pidFile}; wait`,
    ]);
    expect(
      await waitFor(() => {
        try {
          return readFileSync(pidFile, 'utf8').trim() !== '';
        } catch {
          return false;
        }
      }),
    ).toBe(true);
    const grandchild = Number(readFileSync(pidFile, 'utf8').trim());
    expect(alive(grandchild)).toBe(true);
    handle.cancel();
    await handle.done;
    expect(await waitFor(() => !alive(grandchild))).toBe(true);
  });

  it('cancels on an AbortSignal', async () => {
    const controller = new AbortController();
    const handle = defaultAsyncProcessRunner.start('/bin/sh', ['-c', 'sleep 30'], {
      signal: controller.signal,
      cancelGraceMs: 200,
    });
    expect(handle.settled).toBe(false);
    controller.abort();
    const result = await handle.done;
    expect(result.cancelled).toBe(true);
    expect(handle.settled).toBe(true);
    // Cancelling a settled handle is a no-op, not an error.
    handle.cancel();
  });

  it('reports a missing binary as a typed error instead of throwing', async () => {
    const result = await defaultAsyncProcessRunner.run('/definitely/not/a/binary', []);
    expect(result.error).toBeDefined();
    expect(result.status).toBeNull();
  });

  it('kills a process that floods stdout past the buffer cap', async () => {
    const result = await defaultAsyncProcessRunner.run(
      '/bin/sh',
      ['-c', 'yes agentdev | head -c 4000000'],
      { maxBufferBytes: 64 * 1024, cancelGraceMs: 200 },
    );
    expect(result.error).toContain('tool output exceeded');
    expect(result.stdout.length).toBeLessThan(200_000);
  });
});

describe('ToolProcessRegistry', () => {
  it('tracks live handles per Attempt and forgets settled ones', async () => {
    const registry = new ToolProcessRegistry();
    const quick = defaultAsyncProcessRunner.start('/bin/sh', ['-c', 'exit 0']);
    registry.register('attempt-a', quick);
    await quick.done;
    expect(await waitFor(() => registry.activeCount('attempt-a') === 0)).toBe(true);

    const long = defaultAsyncProcessRunner.start('/bin/sh', ['-c', 'sleep 30'], {
      cancelGraceMs: 200,
    });
    registry.register('attempt-a', long);
    expect(registry.activeAttempts()).toEqual(['attempt-a']);
    expect(registry.activeCount()).toBe(1);
    expect(registry.kill('attempt-a')).toBe(1);
    await long.done;
    expect(registry.kill('attempt-b')).toBe(0);
  });

  it('kills every live process on shutdown', async () => {
    const registry = new ToolProcessRegistry();
    const first = defaultAsyncProcessRunner.start('/bin/sh', ['-c', 'sleep 30'], {
      cancelGraceMs: 200,
    });
    const second = defaultAsyncProcessRunner.start('/bin/sh', ['-c', 'sleep 30'], {
      cancelGraceMs: 200,
    });
    registry.register('attempt-a', first);
    registry.register('attempt-b', second);
    const reports = registry.killAll();
    expect(reports.map((report) => report.killed)).toEqual([1, 1]);
    await Promise.all([first.done, second.done]);
  });

  it('drops an already-settled handle instead of storing it', async () => {
    const registry = new ToolProcessRegistry();
    const handle = defaultAsyncProcessRunner.start('/bin/sh', ['-c', 'exit 0']);
    await handle.done;
    registry.register('attempt-a', handle);
    expect(registry.activeCount()).toBe(0);
  });
});
