/**
 * Entity schemas: the complete row set of `docs/architecture/data.md` §2 and
 * the structured artifacts of §3.
 *
 * The three layers keep their documented ownership:
 * `packages/contracts` validates shapes, `packages/domain` owns legal state
 * transitions and gates, and `packages/storage` owns migrations and transactions.
 */
export * from './common.js';
export * from './project.js';
export * from './work.js';
export * from './run.js';
export * from './system.js';
export * from './structures.js';
