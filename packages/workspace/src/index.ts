/**
 * `@agentdev/workspace` — Git access, budgeted workspace scanning, the project
 * initialization state machine, Task worktrees and CAS integration
 * (`docs/architecture/ARCHITECTURE.md` §4, `docs/product/knowledge.md` §4/§5,
 * `docs/architecture/context.md` §4, `docs/architecture/reliability.md` §4/§5).
 *
 * The package owns these Ports so its behaviour is testable and reusable without
 * a real repository or disk:
 *
 * - `GitPort` / `NodeGitPort` / `MemoryGitPort` (`git-port.ts`);
 * - the budgeted scanner, index and candidate-knowledge generator (`scan.ts`);
 * - `FileSystemPort` and `InitStateStore` with real and in-memory implementations
 *   behind the initialization state machine (`initialize.ts`);
 * - `WorktreeGitPort` / `NodeWorktreeGitPort` / `WorktreeLeaseStore` behind
 *   `WorktreeManager` (`worktree.ts`);
 * - `CasJournal` / `CasEventPort` behind the compare-and-swap integration service
 *   (`cas.ts`).
 */
export * from './git-port.js';
export * from './scan.js';
export * from './initialize.js';
export * from './worktree.js';
export * from './cas.js';
