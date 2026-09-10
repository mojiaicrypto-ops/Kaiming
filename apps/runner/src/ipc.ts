/**
 * Runner ⇄ Core IPC.
 *
 * The Runner is one Attempt in one process; the daemon speaks to it over stdio
 * with newline-delimited JSON. Every command carries the attempt id and epoch so
 * a late or duplicated message cannot steer a newer Attempt
 * (`docs/architecture/reliability.md` §2 "Late事件检查attempt/epoch").
 */
import { z } from 'zod';

export const RUNNER_PROTOCOL_VERSION = 1;

const envelope = {
  v: z.literal(RUNNER_PROTOCOL_VERSION),
  attemptId: z.string().min(1),
  epoch: z.number().int().positive(),
};

/** Commands the Core sends to a Runner. */
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('attempt.prompt'), text: z.string() }).strict(),
  z.object({ ...envelope, type: z.literal('attempt.steer'), text: z.string() }).strict(),
  z.object({ ...envelope, type: z.literal('attempt.abort') }).strict(),
  z.object({ ...envelope, type: z.literal('attempt.shutdown') }).strict(),
]);
export type RunnerCommand = z.infer<typeof commandSchema>;

/** Messages the Runner sends to the Core. */
export const messageSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...envelope,
      type: z.literal('attempt.ready'),
      sessionId: z.string().min(1),
      provider: z.string().min(1),
      modelId: z.string().min(1),
      tools: z.array(z.string()),
      /** Requested tools the session did not activate; non-empty is a config error. */
      droppedTools: z.array(z.string()),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('attempt.event'),
      seq: z.number().int().nonnegative(),
      event: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('attempt.result'),
      status: z.enum(['completed', 'failed', 'cancelled']),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      ...envelope,
      type: z.literal('attempt.error'),
      code: z.string().min(1),
      message: z.string(),
    })
    .strict(),
]);
export type RunnerMessage = z.infer<typeof messageSchema>;

/** Minimal sink the Runner writes to; stdio in production, a spy in tests. */
export interface RunnerOutput {
  write(line: string): void;
}

/** `Omit` that distributes over the message union instead of collapsing it. */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** Writes one framed message. */
export function writeMessage(output: RunnerOutput, message: RunnerMessage): void {
  output.write(`${JSON.stringify(message)}\n`);
}

/** Parses one framed command; `undefined` means the line is not a command. */
export function parseCommand(line: string): RunnerCommand | undefined {
  const trimmed = line.trim();
  if (trimmed === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const result = commandSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}
