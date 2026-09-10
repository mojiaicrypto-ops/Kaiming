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
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import type { PiToolSpec } from '@agentdev/pi-runtime';
import { AttemptRunner, type AttemptRunnerOptions } from './attempt.js';
import type { RunnerOutput } from './ipc.js';

interface CliOptions extends AttemptRunnerOptions {
  readonly selfCheck: boolean;
}

function usage(): string {
  return [
    'usage: agentdev-runner --attempt-id <id> --epoch <n> --provider <p> --model <m> \\',
    '                        --cwd <dir> --agent-dir <dir> [--tools a,b] [--skill <path>]... \\',
    '                        [--extension <id>]... [--trusted] [--models-path <file>] [--self-check]',
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
    selfCheck: values['self-check'] === true,
  };
}

export class UsageError extends Error {}

/** No custom tools yet: role tool bridging lands with the role work packages. */
export const BUILTIN_TOOLS: readonly PiToolSpec[] = [];

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

  const runner = new AttemptRunner(
    { ...options, customTools: BUILTIN_TOOLS },
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
