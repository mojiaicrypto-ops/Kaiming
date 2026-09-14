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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { type RunnerCommand, type RunnerMessage, runnerMessageSchema } from '@agentdev/contracts';
import type { RunnerProcessPort, RunnerSpawnInput, RunnerSpawnPort } from '@agentdev/core';

/** Env var a development/test run uses to point at a source entry for the Runner. */
export const RUNNER_ENTRY_ENV = 'AGENTDEV_RUNNER_ENTRY';

/**
 * Environment variables a Runner child may see.
 *
 * `execution.md` §2 keeps the Provider Secret in the Core: the Runner holds only its
 * Attempt capability (inside `models.json`). Inheriting the daemon's whole environment
 * leaked every `AGENTDEV_*` value, including the credential the operator started the
 * daemon with (WP11R1-11), so the child gets an explicit allowlist instead.
 */
export const RUNNER_ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'SHELL',
  'USER',
  'LOGNAME',
  'TERM',
  // `NODE_OPTIONS` is deliberately absent: it is a code-injection channel into the Runner
  // (`--require` runs before any product code) and nothing here needs it (WP11R2-05).
  'NODE_EXTRA_CA_CERTS',
  'SYSTEMROOT',
  RUNNER_ENTRY_ENV,
];

/** Builds the child environment from the allowlist, never the provider variables. */
export function runnerChildEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of RUNNER_ENV_ALLOWLIST) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

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
 * cannot disagree without a loud failure. Its API key is the Attempt capability
 * (`execution.md` §2), which is also why the Runner may read the capability from this file
 * instead of taking it as an argument (`apps/runner/src/cli.ts`).
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

/**
 * Flags whose value is safe to print in a diagnostic line.
 *
 * `execution.md` §2 puts exactly one credential on a Runner's command line — none: the
 * Attempt capability travels inside the 0600 per-Attempt catalog, not through `argv`
 * (visible to every local process through `ps`). The allowlist keeps that property true
 * even if a future flag is added: an unknown flag's value is redacted rather than logged.
 */
const OBSERVABLE_ARG_FLAGS: ReadonlySet<string> = new Set([
  '--attempt-id',
  '--epoch',
  '--provider',
  '--model',
  '--cwd',
  '--agent-dir',
  '--models-path',
  '--role',
  '--work-id',
  '--control-url',
  '--tools',
]);

/** Longest value a diagnostic line prints before it is truncated. */
const LOG_VALUE_LIMIT = 160;

/** Truncates one diagnostic value; lengths stay visible so a blank value is obvious. */
function truncateForLog(value: string): string {
  return value.length <= LOG_VALUE_LIMIT
    ? value
    : `${value.slice(0, LOG_VALUE_LIMIT)}…(${value.length})`;
}

/**
 * Renders one spawn's `argv` for a diagnostic line, redacting every non-allowlisted value.
 *
 * The system prompt is the reason this exists: it is long, it is model-visible content
 * rather than configuration, and printing it verbatim would bury the flags that matter.
 * It is summarised by length instead.
 */
export function redactRunnerArgv(args: readonly string[]): string[] {
  const rendered: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (!arg.startsWith('--')) {
      // A bare positional is the entry script: a path, never a credential.
      rendered.push(index === 0 ? arg : '<value>');
      continue;
    }
    rendered.push(arg);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) continue;
    index += 1;
    rendered.push(
      OBSERVABLE_ARG_FLAGS.has(arg) ? truncateForLog(value) : `<redacted:${String(value.length)}>`,
    );
  }
  return rendered;
}

/**
 * Summarises one `attempt.event` for a diagnostic line.
 *
 * The session's stream is dominated by per-token `raw` events (`text_delta`,
 * `toolcall_delta`), so those are counted rather than printed; the structural events
 * (which tool ran, whether a turn ended) are what a stuck Attempt needs to show.
 */
function eventDetail(event: Record<string, unknown>): string {
  const kind = typeof event['type'] === 'string' ? event['type'] : 'unknown';
  if (kind === 'raw' || kind === 'text_delta') {
    const raw = typeof event['eventType'] === 'string' ? event['eventType'] : '';
    return raw === '' || raw.endsWith('_delta') ? '' : ` event=raw(${raw})`;
  }
  const tool = typeof event['toolName'] === 'string' ? ` tool=${event['toolName']}` : '';
  const failed = event['isError'] === true ? ' isError=true' : '';
  return ` event=${kind}${tool}${failed}`;
}

/** One live child process, adapted to the supervisor's port. */
class ChildRunnerProcess implements RunnerProcessPort {
  readonly pid: number;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly log: (line: string) => void;
  private readonly label: string;
  private readonly startedAt: number;
  private messages = 0;

  constructor(
    child: ChildProcessWithoutNullStreams,
    diagnostics: {
      readonly log: (line: string) => void;
      readonly label: string;
      readonly startedAt: number;
    },
  ) {
    this.child = child;
    this.pid = child.pid ?? 0;
    this.log = diagnostics.log;
    this.label = diagnostics.label;
    this.startedAt = diagnostics.startedAt;
    this.guardStream('stdin', child.stdin);
    this.guardStream('stdout', child.stdout);
    this.guardStream('stderr', child.stderr);
  }

  /**
   * Records a stream error instead of letting it become an uncaught exception.
   *
   * A dead child reports `EPIPE` **asynchronously**, so the `try`/`catch` around `write` in
   * `send()` cannot see it: during the shutdown sweep the supervisor writes to a Runner that
   * has already exited, and without a listener the stream's `error` event crashes the daemon
   * (WP-12 R5). Every write here is best-effort by contract — the shutdown path escalates to
   * signals — so the code is logged and the error swallowed.
   */
  private guardStream(
    name: 'stdin' | 'stdout' | 'stderr',
    stream: NodeJS.ReadableStream | NodeJS.WritableStream,
  ): void {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      this.log(
        `${this.label} ${name} error: ${error.code ?? error.message} (+${String(this.elapsed())}ms)`,
      );
    });
  }

  /** Milliseconds since spawn, the unit every diagnostic line carries. */
  private elapsed(): number {
    return Date.now() - this.startedAt;
  }

  send(command: RunnerCommand): void {
    // A Runner that already exited (or was SIGKILLed) leaves its pipe closed: `write` then
    // emits EPIPE, which would otherwise be an unhandled stream error during a shutdown
    // sweep (WP-12 fix round 2). The supervisor already treats an unreachable child as
    // "did not stop in time" and escalates to signals, so the write is simply dropped.
    if (this.child.stdin.destroyed || this.child.stdin.writableEnded) {
      this.log(
        `${this.label} → ${command.type} dropped (+${String(this.elapsed())}ms): stdin closed`,
      );
      return;
    }
    try {
      this.child.stdin.write(`${JSON.stringify(command)}\n`);
      this.log(`${this.label} → ${command.type} (+${String(this.elapsed())}ms)`);
    } catch {
      // The pipe is gone; the shutdown path below still signals the process.
      this.log(
        `${this.label} → ${command.type} failed (+${String(this.elapsed())}ms): write threw`,
      );
    }
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
        // A Runner that prints a non-JSON line (a stray `console.log`, a crash banner) is
        // otherwise invisible: the supervisor only ever sees "no message arrived".
        this.log(`${this.label} ← non-JSON stdout: ${truncateForLog(trimmed)}`);
        return;
      }
      const result = runnerMessageSchema.safeParse(parsed);
      if (!result.success) {
        this.log(`${this.label} ← invalid message: ${truncateForLog(trimmed)}`);
        return;
      }
      this.messages += 1;
      const type = result.data.type;
      const detail =
        type === 'attempt.ready'
          ? ` session=${result.data.sessionId} provider=${result.data.provider}/${result.data.modelId} tools=[${result.data.tools.join(',')}] dropped=[${result.data.droppedTools.join(',')}]`
          : type === 'attempt.error'
            ? ` code=${result.data.code} message=${truncateForLog(result.data.message)}`
            : type === 'attempt.result'
              ? ` status=${result.data.status} message=${truncateForLog(result.data.message)}`
              : type === 'attempt.event'
                ? eventDetail(result.data.event)
                : '';
      this.log(`${this.label} ← ${type} (+${String(this.elapsed())}ms)${detail}`);
      listener(result.data);
    });
    lines.on('close', () => {
      // EOF before a terminal message is the "silent child" signature: the process closed
      // its stdout without ever answering.
      this.log(
        `${this.label} stdout EOF (+${String(this.elapsed())}ms) after ${String(this.messages)} message(s)`,
      );
    });
  }

  onExit(
    listener: (exit: { readonly code: number | null; readonly signal: string | null }) => void,
  ): void {
    this.child.on('exit', (code, signal) => {
      this.log(
        `${this.label} exit code=${String(code)} signal=${String(signal)} (+${String(this.elapsed())}ms) after ${String(this.messages)} message(s)`,
      );
      listener({ code, signal });
    });
    this.child.on('error', (error: Error) => {
      // A spawn/host failure (ENOENT for the entry, a kill during startup). The supervisor
      // treats it as "no exit", so the reason has to be logged here or it is lost.
      this.log(`${this.label} process error: ${error.message}`);
      listener({ code: null, signal: null });
    });
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
      args.push('--role', input.run.role);
      args.push('--work-id', input.run.workId);
      if (input.invocation.controlUrl !== undefined) {
        // The capability is *not* passed as an argument: it would be visible in `ps` to
        // every local process. The Runner reads it from the per-Attempt catalog's API key,
        // which is already 0600 (`execution.md` §2).
        args.push('--control-url', input.invocation.controlUrl);
      }
      const label = `runner[${input.attempt.id}]`;
      const startedAt = Date.now();
      if (!existsSync(script)) {
        // The shipped entry is a build artifact. Naming the missing path here turns the
        // otherwise mute "child never became ready" into a one-line diagnosis.
        log(`${label} spawn refused: entry not found at ${script} (run pnpm build)`);
      }
      log(
        `${label} spawn node=${options.nodePath ?? process.execPath} cwd=${truncateForLog(input.invocation.cwd)} argv=${redactRunnerArgv(args).join(' ')}`,
      );
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(options.nodePath ?? process.execPath, args, {
          cwd: input.invocation.cwd,
          env: runnerChildEnv(env),
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (error) {
        log(`${label} spawn threw: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
      log(`${label} spawn pid=${String(child.pid ?? 0)} (+${String(Date.now() - startedAt)}ms)`);
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8').trim();
        if (text.length > 0) log(`${label} stderr: ${truncateForLog(text)}`);
      });
      return new ChildRunnerProcess(child, { log, label, startedAt });
    },
  };
}
