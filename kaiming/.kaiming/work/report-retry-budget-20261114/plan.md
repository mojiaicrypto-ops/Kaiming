# Report retry budget — structural termination for degenerate member runs

## Problem

Two production incidents of one class (11-12, 11-13/14), plus a third variant recorded on 11-06:

- The member model degenerates while trying to deliver `agent_report`: repeated closing-tag soup
  (11-12: `</invoke>/</function>/</v8>`; 11-13: `</body>/</summary>`, 19-char period), empty `{}`
  args (31×), summary-only args missing `body` (10×), and arguments truncated at the provider output
  limit.
- Every layer converts failure into "try again" and nothing counts attempts: the SDK answers a
  truncated call with "Re-issue the tool call"; schema validation returns errors; the guard's
  size branch blocks without recording a fault. Result: 33–68 min burn, host CPU pinned at ~156%
  for hours, termination only by user stop / 90-min watchdog / `REPORT_MISSING`.
- The first-phase guard (`model-output-guard-20261112`) intercepted **zero** real incidents: its
  content signatures (tag alphabet `invoke|function|parameter|v8`, repeat units ≤16 chars) matched
  only the 11-12 shape; the 11-13 variant used other tag names and an 18–19 char unit. Its per-delta
  signature analysis is itself a CPU hazard (regex + 13×4096 slice allocations per delta on a 16 KB
  buffer).
- Terminal states carry no cause, so recovery misdiagnoses: `REPORT_MISSING` routes to same-session
  continuation, which replays the poisoned history — the 01:16 continuation's first tool call was
  already 113 KB junk. A fresh session delivered the same settlement in 100 seconds.

Essence: an unbounded retry loop needs (a) a failure generator (the model — external, unfixable),
(b) failure amplifiers that never count, (c) no cause-specific terminal state. The fix must remove
(b) and (c); it cannot and should not try to enumerate (a).

## Decision

Termination moves from content signatures to **structural progress accounting**. Content-shape
detection is retired from the hot path entirely.

1. **Attempt ledger** (the only new mechanism): per input run, count consecutive `isError`
   toolResults for the result tool `agent_report`. Reset **only** on an `agent_report` success —
   successes of other tools (read/bash/…) do not reset; today's incident interleaved successful
   read/bash between report failures. Threshold N = 5. Counting is per input (a new input is a new
   instruction with a fresh budget), not per session.
2. **Reuse the existing corrective-turn machinery**: streak 5 → fault #1 → one hidden corrective
   turn → streak resets to 0 → another 5 consecutive failures → fault #2 → terminal. Total budget:
   **10 failed attempts + 1 corrective turn**, bounded regardless of the garbage's shape.
3. **New terminal errorCode `REPORT_RETRY_EXHAUSTED`** (structured evidence: streak, last error
   snippet, corrective-used flag), distinct from `MODEL_OUTPUT_CORRUPTED` and `REPORT_MISSING`.
   Guidance routes it to a fresh member session / asking the user — never automatic same-session
   continuation.
4. **Kept** from the old guard (O(1), content-agnostic): 1 MB streamed-argument cap (fault + abort),
   `agent_report` 16 KB argument limit (block), non-object arguments (block + fault). The block
   paths now feed the ledger through their `isError` results like every other failure — one
   mechanism, no special cases.
5. **Deleted**: `degenerationReason`, `repeatedSuffix`, closing-tag regexes — the whole per-delta
   content-signature layer. The `message_update` handler keeps only the O(1) length counter.

Why this generalizes: the decision keys only on structural observables (tool name, isError bit,
input scope, counts). It is invariant to output text, tag alphabet, repetition period, task, role,
and model. Any loop that keeps a run alive must keep issuing tool calls (a single response is
bounded by the provider output limit; a text-only flood ends the turn), and every `agent_report`
failure is counted. The SDK's "re-issue" amplifier is neutralized by counting its refusals.

**Calibration for N=5** (read-only scan of all sessions in `.kaiming-data`, 2026-11-14; per-input
replay during acceptance): healthy ceiling is streak 3 (3 sessions), 4 (11-06, recovered and
delivered) and 5 (11-13 17:32 fresh session: 3× missing body, 2× missing summary, delivered on the
6th attempt within 100 s — under this design it trips fault #1, receives the corrective nudge, and
still completes). The incident ran to 48. N=5 sits on the healthy boundary; the corrective valve is
what makes a trip non-destructive (a trip costs one hidden nudge, not the run). A kill requires
5 + corrective + 5.

**Residual boundary, registered**: a loop of *successful* non-result-tool calls (e.g. `read` ×∞,
never touching `agent_report`) does not trip the ledger; the 90-min watchdog remains the bound. Not
observed in 300+ historical sessions. If it ever materializes, extend the same ledger structurally
(same tool + same args digest, consecutive) — never back to content signatures. Rejected by user
decision (2026-11-14): a production-volume ledger (cumulative assistant output per input) — its
legitimate range varies by task and model, so a false kill of a healthy long run outweighs the
missed detection, and the watchdog already bounds the miss.

## Scope

- `kaiming/src/runtime/model-output-guard.ts`: delete the signature layer; add the attempt ledger.
  Implementation decision point: count toolResult messages via the extension API if Pi surfaces
  them (`message_start`/`message_end` with role `toolResult`, `toolName`, `isError`); otherwise
  count in the runner's event path and expose the streak to the guard. Prefer whichever keeps the
  fault channel in one place. Streak state resets when the corrective turn starts.
- `kaiming/src/runtime/runner.ts`: wire ledger faults into `recoverModelOutput` (existing one
  corrective turn; reset streak after it) and the terminal classifier (`REPORT_RETRY_EXHAUSTED`).
- `kaiming/src/tools/guidance.ts`: route `REPORT_RETRY_EXHAUSTED` to a fresh-session nextAction;
  `REPORT_MISSING` routing unchanged.
- `kaiming/webapp/src/i18n/catalog.ts`: label for the new code.
- Docs: `docs/technicalnew/runtime-contract.md` (the degeneration-defense paragraph is rewritten
  from the signature list to the ledger model); `docs/technicalnew/gap-register.md` (R6 wording;
  residual boundary entry); `docs/technicalnew/validation.md` (settlement entry);
  `AGENTS.md` (settlement lesson: content-signature defenses do not generalize — budgets do).
- Tests: rewrite `kaiming/test/model-output-guard.test.ts` around ledger semantics (same-tool reset,
  other-tool non-reset, per-input scope, 5 + corrective + 5, terminal code/evidence); new
  adversarial-generator property test; historical negative-replay check (per input).

## Verification profile

`broad` — this changes the member-run failure state machine for every professional role, one
runtime-contract line, and recovery routing. Allowed and planned: full kaiming server suite
(`npm test`), webapp suite (`npm test`, `tsc --noEmit`), root typecheck, `npm run check:prompts`
as an untouched-area sanity check. Not run: real-provider network tests beyond the replay below
(recorded as such).

## Acceptance

Property-based, not shape-based. A signature-specific test would repeat the 11-12 mistake (its
acceptance literally pinned "the 108 KB repeated-tag pattern").

1. **Adversarial generator property**: a stub model emitting randomly generated degeneration —
   random tag alphabets (including non-ASCII), random repeat periods (4–64), placement in
   text/args/thinking, interleaved valid calls, empty/partial args, truncation-refusal echoes.
   For every seed: the run reaches a terminal state within ≤10 failed `agent_report` attempts plus
   one corrective turn. The 11-12 and 11-13 incidents are expressible as two seeds of this
   generator and are replayed as regressions.
2. **Negative controls (must not fire)**: all historical sessions replayed per input through the
   ledger trip nothing except the known incident inputs; explicitly asserted: the 11-13 17:32
   session (streak 5 → corrective → completes, not terminated) and the 11-06 streak-4 session.
   Interleaved successful read/bash between report failures does not reset the streak (asserted on
   the 11-13 incident transcript). Healthy long outputs and large-but-valid tool calls still run.
3. **Checker self-test / mutation (D-05)**: resetting the streak on *any* tool success (instead of
   same-tool success) makes the adversarial property fail on the 11-13 seed; removing the ledger
   leaves the 48-streak incident unbounded (property fails). Both mutations must fail as intended
   before the suite counts as passing.
4. **Terminal classification and routing**: fault #2 ends the input as `failed` /
   `REPORT_RETRY_EXHAUSTED` with evidence; guidance for that code never suggests same-session
   continuation.
5. **Hot-path cost**: the `message_update` handler performs only O(1) work (length counters); no
   regex or suffix analysis remains on the streaming path.
6. **Real-model replay** of the poisoned-session continuation if a provider is configured —
   closing the "未用真实模型重放本事故" debt carried since `model-output-guard-20261112`;
   otherwise recorded honestly as not_run with the offline transcript replay standing in.
