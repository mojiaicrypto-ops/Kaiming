/**
 * The Context layer's public surface (`docs/architecture/context.md`).
 *
 * WP-05 splits the layer into one module per responsibility so each can be
 * reviewed and tested on its own:
 *
 * - `types.ts` — the shared vocabulary (§1/§5): roles, stages, source classes,
 *   read scopes, snapshots, gaps and errors;
 * - `acl.ts` — the role/stage access matrix and read scope (`AC-033`, `AC-034`);
 * - `requirements.ts` — the per-stage required-input table (`AC-079`);
 * - `builder.ts` — `buildContext()`: authorise, resolve, check required inputs,
 *   freeze the immutable `ContextSnapshot` and account tokens
 *   (`AC-030`, `AC-031`, `AC-036`, `AC-093`);
 * - `ledger.ts` — `createReadLedger()`: the append-only reads inside `readScope`,
 *   token accounting, the reasoned expansion request, `seal()`/`verifySeal()`
 *   (`AC-032`, `AC-036`, `AC-085`);
 * - `checkpoint.ts` — `createCheckpointStore()`/`compactCheckpoint()`: the
 *   per-Run checkpoint fields, Run/role/Project ownership on read and write,
 *   session rotation, and the approval state a compaction may not change
 *   (`AC-033`, `AC-034`, `AC-035`);
 * - `cold-start.ts` — `assembleColdStart()`/`coldStartAnswer()`: the seed of a new
 *   Conversation, the documented selection order with a reason per entry, the
 *   delivered behaviour/constraints/entry paths/gaps, and the transcript guard
 *   (`AC-033`, `AC-037`, `AC-039`).
 */
export * from './types.js';
export * from './acl.js';
export * from './requirements.js';
export * from './builder.js';
export * from './ledger.js';
export * from './checkpoint.js';
export * from './cold-start.js';
