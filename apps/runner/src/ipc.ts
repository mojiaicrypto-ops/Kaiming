/**
 * Runner ⇄ Core IPC — re-exported from `@agentdev/contracts`.
 *
 * The shapes moved to the contracts package (WP-11 A2-T4) because the daemon's
 * `RunnerSupervisor` speaks the same protocol; keeping this module as the Runner's
 * import site means `attempt.ts`/`cli.ts` and their tests did not have to change.
 */
export {
  RUNNER_PROTOCOL_VERSION,
  parseCommand,
  // The contract names them `runnerCommandSchema`/`runnerMessageSchema` because
  // `message`/`command` are also persisted entity tables; the Runner keeps its own
  // shorter names for the two shapes it speaks.
  runnerCommandSchema as commandSchema,
  runnerMessageSchema as messageSchema,
  writeMessage,
} from '@agentdev/contracts';
export type {
  DistributiveOmit,
  RunnerCommand,
  RunnerMessage,
  RunnerOutput,
} from '@agentdev/contracts';
