#!/usr/bin/env node
/**
 * Runner process entry point.
 *
 * One process serves exactly one Attempt; it reads framed commands from stdin
 * and writes framed messages to stdout. `--self-check` performs the full startup
 * path (extension gate, explicit resources, Pi session) and exits, which is how
 * `agentdev doctor` and the acceptance matrix prove the runtime without a model
 * call.
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ROLES, type Role } from '@agentdev/contracts';
import type { PiToolSpec } from '@agentdev/pi-runtime';
import { AttemptRunner, type AttemptRunnerOptions } from './attempt.js';
import type { RunnerOutput } from './ipc.js';
import { createToolClient } from './tool-client.js';
import { roleTools } from './tools.js';

interface CliOptions extends Omit<AttemptRunnerOptions, 'capability'> {
  readonly selfCheck: boolean;
}

function usage(): string {
  return [
    'usage: agentdev-runner --attempt-id <id> --epoch <n> --provider <p> --model <m> \\',
    '                        --cwd <dir> --agent-dir <dir> [--tools a,b] [--skill <path>]... \\',
    '                        [--role <role>] [--work-id <id>] [--control-url <url>] \\',
    '                        [--extension <id>]... [--trusted] \\',
    '                        [--models-path <file>] [--self-check]',
  ].join('\n');
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      'attempt-id': { type: 'string' },
      epoch: { type: 'string' },
      provider: { type: 'string' },
      model: { type: 'string' },
      cwd: { type: 'string' },
      'agent-dir': { type: 'string' },
      tools: { type: 'string' },
      skill: { type: 'string', multiple: true },
      extension: { type: 'string', multiple: true },
      'models-path': { type: 'string' },
      'system-prompt': { type: 'string' },
      role: { type: 'string' },
      'work-id': { type: 'string' },
      'control-url': { type: 'string' },
      'submission-grace-ms': { type: 'string' },
      trusted: { type: 'boolean' },
      'self-check': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });

  if (values.help === true) throw new UsageError(usage());

  const required = (name: string, value: string | undefined): string => {
    if (value === undefined || value === '') throw new UsageError(`missing --${name}\n${usage()}`);
    return value;
  };

  const epoch = Number(required('epoch', values.epoch));
  if (!Number.isInteger(epoch) || epoch < 1)
    throw new UsageError('--epoch must be a positive integer');

  const role = values.role;
  if (role !== undefined && !(ROLES as readonly string[]).includes(role)) {
    throw new UsageError(`--role must be one of ${ROLES.join(', ')}`);
  }
  const grace = values['submission-grace-ms'];
  const submissionGraceMs = grace === undefined ? undefined : Number(grace);
  if (submissionGraceMs !== undefined && !Number.isFinite(submissionGraceMs)) {
    throw new UsageError('--submission-grace-ms must be a number');
  }

  return {
    attemptId: required('attempt-id', values['attempt-id']),
    epoch,
    provider: required('provider', values.provider),
    modelId: required('model', values.model),
    cwd: required('cwd', values.cwd),
    agentDir: required('agent-dir', values['agent-dir']),
    toolNames: (values.tools ?? '').split(',').filter((name) => name !== ''),
    skillPaths: values.skill ?? [],
    // The shipped extension whitelist is empty, so naming one is rejected at
    // startup (`execution.md` §7 "配置未知ID拒绝").
    extensionRequests: (values.extension ?? []).map((id) => ({ id, enabled: true })),
    trusted: values.trusted === true,
    modelsPath: values['models-path'] ?? null,
    ...(values['system-prompt'] === undefined ? {} : { systemPrompt: values['system-prompt'] }),
    ...(role === undefined ? {} : { role: role as Role }),
    ...(values['work-id'] === undefined ? {} : { workId: values['work-id'] }),
    ...(values['control-url'] === undefined ? {} : { controlUrl: values['control-url'] }),
    ...(submissionGraceMs === undefined ? {} : { submissionGraceMs }),
    selfCheck: values['self-check'] === true,
  };
}

export class UsageError extends Error {}

/**
 * Tools the Runner adds on top of the role's control tools.
 *
 * The authority is the registry in `./tools.ts` (`execution.md` §7 "角色工具完全由注册表
 * 构造"); this constant is kept only for callers that asked for a static list, and is empty
 * because every tool now needs the Attempt's own transport. `buildRoleTools` is what the
 * entry point uses.
 */
export const BUILTIN_TOOLS: readonly PiToolSpec[] = [];

/**
 * Builds the Broker-backed tools for one Attempt (`execution.md` §7, T3.1).
 *
 * The tools are bound to the attempt's own `tool.execute` client, so every call carries the
 * Attempt capability, the frozen role and the derived idempotency key. Without a control
 * URL there is no bridge to call, and the role registers nothing rather than exposing dead
 * tools.
 */
export function buildRoleTools(options: {
  readonly controlUrl?: string | undefined;
  readonly capability: string;
  readonly attemptId: string;
  readonly epoch: number;
  readonly role: Role;
  /** The profile's narrowing list (`--tools`); empty means the role's whole registry. */
  readonly subset?: readonly string[] | undefined;
}): {
  readonly tools: readonly PiToolSpec[];
  readonly readLedgerBinding?: () => { seq: number; hash: string };
} {
  if (options.controlUrl === undefined || options.capability === '') return { tools: [] };
  const client = createToolClient({
    url: options.controlUrl,
    capability: options.capability,
    attemptId: options.attemptId,
    epoch: options.epoch,
    role: options.role,
  });
  return {
    // The profile only narrows (plan D-T3-1); `selectRoleTools` reports a name the role does
    // not hold, and `AttemptRunner` fails loudly when a requested tool did not activate.
    tools: roleTools(options.role, client, options.subset),
    readLedgerBinding: () => client.readLedgerBinding(),
  };
}

/**
 * The Attempt capability, read from the per-Attempt catalog the Core wrote.
 *
 * `execution.md` §2 lets the Runner hold only a short-lived capability, and the catalog's
 * Provider API key *is* that capability (`runner-spawn.ts`). Reading it from the 0600 file
 * keeps the token out of the process arguments, where `ps` would expose it to every local
 * user.
 */
export function capabilityFromCatalog(path: string | null | undefined): string {
  if (path === null || path === undefined) return '';
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return '';
    const providers = (parsed as { providers?: unknown }).providers;
    if (typeof providers !== 'object' || providers === null) return '';
    for (const entry of Object.values(providers as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null) continue;
      const apiKey = (entry as { apiKey?: unknown }).apiKey;
      if (typeof apiKey === 'string' && apiKey.length > 0) return apiKey;
    }
    return '';
  } catch {
    return '';
  }
}

export async function main(
  argv: readonly string[],
  io: { readonly output: RunnerOutput; readonly exit: (code: number) => void },
): Promise<void> {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    io.exit(2);
    return;
  }

  // The capability comes from the 0600 catalog, never from argv (see above).
  const capability = capabilityFromCatalog(options.modelsPath);
  const role = options.role ?? 'backend';
  const bridge = buildRoleTools({
    controlUrl: options.controlUrl,
    capability,
    attemptId: options.attemptId,
    epoch: options.epoch,
    role,
    subset: options.toolNames,
  });
  const runner = new AttemptRunner(
    {
      ...options,
      role,
      capability,
      customTools: bridge.tools,
      ...(bridge.readLedgerBinding === undefined
        ? {}
        : { readLedgerBinding: bridge.readLedgerBinding }),
    },
    { output: io.output, exit: io.exit },
  );

  const started = await runner.start();
  if (started !== 0) {
    io.exit(started);
    return;
  }

  if (options.selfCheck) {
    runner.dispose();
    io.exit(0);
    return;
  }

  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    const keepRunning = await runner.handleLine(line);
    if (!keepRunning) break;
  }
  runner.dispose();
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main(process.argv.slice(2), {
    output: { write: (line) => process.stdout.write(line) },
    exit: (code) => process.exit(code),
  });
}
