/**
 * `@agentdev/knowledge` — Feature knowledge parsing, validation and link
 * diagnosis (`docs/architecture/context.md` §2, `docs/product/knowledge.md`).
 *
 * The public surface is intentionally small: the Feature model, the Markdown
 * parser/validator, relation/source-ref resolution with diagnostics, the
 * projection build with its cache/stale semantics, and the three query views.
 * Requirement-pool import builds on top of these.
 */
export * from './model.js';
export * from './feature-format.js';
export * from './relations.js';
export * from './projection.js';
export * from './views.js';
export * from './requirements-pool.js';
