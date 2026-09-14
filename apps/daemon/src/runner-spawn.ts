/**
 * Starting real Runner processes (WP-11 A2-T6).
 *
 * `docs/architecture/ARCHITECTURE.md` §1: `agentdevd → RunnerSupervisor → 独立Runner →
 * Pi Session`. This module is the supervisor's `RunnerSpawnPort`: it starts
 * `apps/runner` as a child process, speaks the newline-delimited IPC contract over its
 * stdio, and hands the Attempt a per-Attempt `models.json` whose Provider entry points at
 * the Core's model gateway with the Attempt's capability as its API key — so the Provider
 * secret never reaches the Runner (`execution.md` §2).
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { type RunnerCommand, type RunnerMessage, runnerMessageSchema } from '@agentdev/contracts';
import type { RunnerProcessPort, RunnerSpawnInput, RunnerSpawnPort } from '@agentdev/core';

/** Env var a development/test run uses to point at a source entry for the Runner. */
export const RUNNER_ENTRY_ENV = 'AGENTDEV_RUNNER_ENTRY';

/** Provider id the per-Attempt catalog uses for the Core gateway. */
export const GATEWAY_PROVIDER_ID = 'agentdev-gateway';

export interface AttemptCatalogInput {
  /** Directory the catalog file is written into (per Attempt). */
  readonly dir: string;
  /** Base URL of the Core's model gateway, e.g. `http://127.0.0.1:51234`. */
  readonly gatewayUrl: string;
  /** The Attempt capability, used as the Provider API key. */
  readonly capability: string;
  readonly modelId: string;
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly reasoning: boolean;
}

/**
 * Writes the per-Attempt `models.json` the Pi SDK reads.
 *
 * The Provider entry is deliberately the *only* model catalog the Runner sees: the
 * gateway refuses any other model id anyway, so the catalog and the frozen configuration
 * cannot disagree without a loud failure.
 *
 * @returns the catalog path to pass as `--models-path`.
 */
export function writeAttemptCatalog(input: AttemptCatalogInput): string {
  const path = join(input.dir, 'models.json');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const document = {
    providers: {
      [GATEWAY_PROVIDER_ID]: {
        name: 'AgentDev Core gateway',
        baseUrl: input.gatewayUrl,
        api: 'openai-completions',
        apiKey: input.capability,
        models: [
          {
            id: input.modelId,
            name: input.modelId,
            api: 'openai-completions',
            reasoning: input.reasoning,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: input.contextWindow,
            maxTokens: input.maxOutputTokens,
          },
        ],
      },
    },
  };
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
  return path;
}

export interface ChildRunnerSpawnOptions {
  readonly repoRoot: string;
  readonly nodePath?: string;
  readonly log?: (line: string) => void;
  readonly env?: NodeJS.ProcessEnv;
}

/** One live child process, adapted to the supervisor's port. */
class ChildRunnerProcess implements RunnerProcessPort {
  readonly pid: number;
  private readonly child: ChildProcessWithoutNullStreams;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    this.pid = child.pid ?? 0;
  }

  send(command: RunnerCommand): void {
    this.child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  onMessage(listener: (message: RunnerMessage) => void): void {
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }
      const result = runnerMessageSchema.safeParse(parsed);
      if (result.success) listener(result.data);
    });
  }

  onExit(
    listener: (exit: { readonly code: number | null; readonly signal: string | null }) => void,
  ): void {
    this.child.on('exit', (code, signal) => listener({ code, signal }));
    this.child.on('error', () => listener({ code: null, signal: null }));
  }

  terminate(signal: 'SIGTERM' | 'SIGKILL'): void {
    this.child.kill(signal);
  }
}

/**
 * The real spawn port.
 *
 * The Runner entry defaults to the built `apps/runner/dist/cli.js` (the shipped path) and
 * can be redirected through `AGENTDEV_RUNNER_ENTRY` for a source-mode development run, the
 * same way the daemon host itself is started.
 */
export function createChildRunnerSpawnPort(options: ChildRunnerSpawnOptions): RunnerSpawnPort {
  const env = options.env ?? process.env;
  const log = options.log ?? (() => undefined);
  return {
    spawn(input: RunnerSpawnInput): RunnerProcessPort {
      const entry = env[RUNNER_ENTRY_ENV];
      const script =
        typeof entry === 'string' && entry.length > 0
          ? entry
          : join(options.repoRoot, 'apps', 'runner', 'dist', 'cli.js');
      const args = [
        script,
        '--attempt-id',
        input.attempt.id,
        '--epoch',
        String(input.epoch),
        '--provider',
        GATEWAY_PROVIDER_ID,
        '--model',
        input.invocation.modelId,
        '--cwd',
        input.invocation.cwd,
        '--agent-dir',
        input.invocation.agentDir,
        '--tools',
        input.invocation.tools.join(','),
      ];
      if (input.invocation.systemPrompt !== undefined) {
        args.push('--system-prompt', input.invocation.systemPrompt);
      }
      if (input.invocation.catalogPath !== undefined) {
        args.push('--models-path', input.invocation.catalogPath);
      }
      const child = spawn(options.nodePath ?? process.execPath, args, {
        cwd: input.invocation.cwd,
        env: { ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8').trim();
        if (text.length > 0) log(`runner[${input.attempt.id}]: ${text}`);
      });
      return new ChildRunnerProcess(child);
    },
  };
}
