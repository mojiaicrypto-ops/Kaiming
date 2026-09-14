/**
 *
 * `docs/architecture/ARCHITECTURE.md` §2 puts these shapes in `packages/contracts`
 * ("共享Schema一次定义，服务端与客户端共用") because two processes speak them: the
 * daemon's `RunnerSupervisor` writes commands and reads messages, and `apps/runner`
 * writes messages and reads commands. `docs/architecture/reliability.md` §2 adds the
 * heartbeat ("心跳每5秒，20秒无心跳标interrupted"), which is why this contract has an
 * `attempt.heartbeat` message: a long model call must not look like a dead process.
 *
 * The Runner is one Attempt in one process; the daemon speaks to it over stdio with
 * newline-delimited JSON. Every command carries the attempt id and epoch so a late or
 * duplicated message cannot steer a newer Attempt (§2 "Late事件检查attempt/epoch").
 */
import { z } from 'zod';

export const RUNNER_PROTOCOL_VERSION = 1;

const envelope = {
  v: z.literal(RUNNER_PROTOCOL_VERSION),
  attemptId: z.string().min(1),
  epoch: z.number().int().positive(),
};

/** Commands the Core sends to a Runner. */
export const runnerCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('attempt.prompt'), text: z.string() }).strict(),
  z.object({ ...envelope, type: z.literal('attempt.steer'), text: z.string() }).strict(),
  z.object({ ...envelope, type: z.literal('attempt.abort') }).strict(),
  z.object({ ...envelope, type: z.literal('attempt.shutdown') }).strict(),
]);
export type RunnerCommand = z.infer<typeof runnerCommandSchema>;

/** Messages the Runner sends to the Core. */
export const runnerMessageSchema = z.discriminatedUnion('type', [
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
      type: z.literal('attempt.heartbeat'),
      /** Milliseconds since the Runner's epoch start; diagnostics only. */
      uptimeMs: z.number().int().nonnegative(),
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
export type RunnerMessage = z.infer<typeof runnerMessageSchema>;

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
  const result = runnerCommandSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
}
