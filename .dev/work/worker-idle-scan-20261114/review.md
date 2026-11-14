# Review report — worker-idle-scan-20261114

Reviewer: independent session (ReviewerIdleScan), read-only, no developer chat. Diff: /tmp/kaiming-review/diff.patch. Evidence: /tmp/kaiming-review/evidence.md.

## Verdict: **passed** (zero blocking findings; one P3 finding fixed and re-confirmed)

## Acceptance verification

1. **Idle-skip semantics — verified.** `worker.ts:68-80` iterates `store.listRunnableSessionIds()` only; runs-map guard, notify-on-progress and the 250 ms safety-net tick unchanged. Status-set completeness: `InputStatus` is exactly `queued|processing|completed|failed|stopped|interrupted` (store.ts:12-18); `stopping` is derived display state, never stored — the three-status filter covers precisely the non-terminal set. No starvation: every enqueue path notifies (write-methods.ts:152/248/378 → main.ts:351); worst-case pickup latency unchanged. No lost behavior: `handleOutcome` (main.ts:210) acts only on terminal outcomes. Negative controls sound (work-less/terminal-only sessions never probed after ≥3 full passes; busy/blocked/claimed surfaces observed via real `claimNextInput`; late-queued pickup; exact `listRunnableSessionIds` pinning).
2. **Availability snapshot + stamp invalidation incl. R5 — verified.** SDK source checked: the stamped file set (models.json, auth.json, dirname(modelsPath)/models-store.json) is exactly what `refresh({allowNetwork:false})` re-reads; snapshot-after-refresh equals what the old full `getAvailable()` returned. Negative controls: monkey-patched full path must not be hit (kills "no real cache"); hand-edit flips the answer both directions (kills "stale cache" and "refreshes but serves old snapshot"). The one semantic change (provider-config.test.ts:540 → expect `true` before any explicit reload) is traceable to the recorded user decision "auto" and aligns with runtime-contract.md:159.
3. **Statement reuse — verified.** Exactly one direct `db.prepare` remains (store.ts:830 bootstrap, no recursion). Dynamic sites (IN-lists, usage where/group, pragma_table_info) keyed by final SQL text; shapes bounded. `close()` clears before `db.close()`. **S3 untouched**: `claimNextInput` diffed HEAD vs worktree ignoring whitespace — only `prepare`→`stmt` and re-wrapping; R3 chief-hold logic byte-identical.
4. **Bench A/B supported.** A 148% avg CPU vs B ≈0% (same copy, 347 sessions, 0 runnable); mechanism explains magnitude (old: ~1388 probes/s × several prepares + full 42-provider credential pass each).

## Findings

1. **pi-runtime.ts reload stamp ordering (P3, non-blocking) — FIXED, closed.** `reload()` originally stamped after the refresh; a file change during the refresh window could record a fresh stamp over stale snapshot content. Fix (pi-runtime.ts:127-135): capture `stampOf()` before the awaited refresh, assign after — mirrors `isAvailable`'s safe order; verified in the worktree by the reviewer, delta confined to the reload body; tsc clean, availability/provider/runtime-factory suites green (27 tests).
2. **Stamp-change refresh not single-flighted (P3, note) — accepted as known boundary.** Bounded duplicate work at rare moments; SDK seq guard keeps the final snapshot correct.

Also reviewed, not defects (deliberate trade-offs): `refresh()` swallows availability-pass errors and serves the previous snapshot; a corrupt models.json makes `isAvailable` throw → input stays queued and retries (self-heals on repair).
