/**
 * `@agentdev/workspace` — Git access, budgeted workspace scanning and the
 * project initialization state machine
 * (`docs/architecture/ARCHITECTURE.md` §4, `docs/product/knowledge.md` §4/§5,
 * `docs/architecture/context.md` §4).
 *
 * The package owns three Ports so its behaviour is testable and reusable without
 * a real repository or disk:
 *
 * - `GitPort` / `NodeGitPort` / `MemoryGitPort` (`git-port.ts`);
 * - the budgeted scanner, index and candidate-knowledge generator (`scan.ts`);
 * - `FileSystemPort` and `InitStateStore` with real and in-memory implementations
 *   behind the initialization state machine (`initialize.ts`).
 */
export * from './git-port.js';
export * from './scan.js';
export * from './initialize.js';
