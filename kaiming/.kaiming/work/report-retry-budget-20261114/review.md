# Independent review — report-retry-budget-20261114 (commit 8823dc6; remediation re-verified 2026-11-14)

```yaml
review:
  task: report-retry-budget-20261114
  reviewer_session: independent-reviewer (omp subagent; no host session id issued)
  reviewer_model: group-volc-plan/group/auto-glm-5-3-flash
  context_snapshot: commit 8823dc6 + plan.md + runtime-contract.md R3 + repo AGENTS.md quality rules
  findings:
    - severity: non-blocking
      location: kaiming/src/runtime/runner.ts:744-824
      evidence: activeOutputGuards.set(sessionId, modelGuard) happens right after registry.acquire
        returns; the cleanup (delete) lives only in the finally of the prompt try-block at line 824.
        A throw in the ~80 lines between them (bindExtensions at 755, the input-marker append at
        782, recordEffectiveConfig at 784 — the HOST_SAVE_FAILED/interrupted paths) leaves the stale
        map entry in place.
      impact: memory-only in every reachable window. An entry set before the try is provably
        pristine (no Pi events flow before prompt(), which is inside the try, so fault/streak are
        unset); between runs the Pi instance is idle so the guard bridge resolves a guard that sees
        no events; the next run for the same sessionId overwrites the entry before prompting.
        Termination and classification are unaffected.
      remediation: wrap the segment from the set through the try in its own try/finally with the
        same identity-checked delete, or perform the delete in the outer catch as well.
      status: fixed — verified (see follow-up round below)
    - severity: non-blocking
      location: kaiming/src/tools/guidance.ts:148
      evidence: the fresh-session dispatch advice for REPORT_RETRY_EXHAUSTED is
        "sessions=[{roleId: <role>, instructions: '<deliver ... >'}]" with no writeScope (and no
        explicit expectedKind). For a writer role (developer/tester) in a write Task, delegation-tools
        checkMember refuses a verbatim call with INVALID_ARGUMENT ("role X must declare writeScope
        in a write Task"); expectedKind would default to the role table instead of the failed
        member's expectedKind.
      impact: soft guidance consumed by the chief model, not machine-executed; a refused verbatim
        dispatch returns a hint and the chief can add writeScope. The pre-existing roleId-form
        action strings (dispatchAdvice, guidance.ts:219/238) share the same omission, so this
        follows the established convention rather than breaking it.
      remediation: include writeScope from the failed member's facts (if available) and
        expectedKind: <entry.member.expectedKind> in the action string.
      status: fixed — verified (see follow-up round below)
    - severity: non-blocking
      location: kaiming/test/task-tools.test.ts:234 (absence)
      evidence: acceptance item 4 has two halves. Terminal classification is covered by the two new
        runtime integration tests; the guidance half ("guidance for that code never suggests
        same-session continuation") has no automated test — task-tools.test.ts's guidance sections
        predate the new branch and were not extended.
      impact: a regression back to same-session routing for REPORT_RETRY_EXHAUSTED would not fail
        any test, yet the poison-history consequence is the one this task exists to prevent.
        Behavior verified correct by direct execution (see evidence below), so the delivery is
        correct; only the falsifier is missing.
      remediation: one test in the 'task guidance · honest advice' section: finish a member input
        failed/REPORT_RETRY_EXHAUSTED, assert the dispatch action contains 'roleId:' and does not
        contain 'sessionId: <that member>'.
      status: fixed — verified (see follow-up round below)
    - severity: non-blocking
      location: kaiming/checks/report-ledger-replay.ts:9-11 (header comment); plan.md
      evidence: the comment and plan say the settler incident input i-f485624c shows "48 consecutive
        failures". The transcript (2026-11-13T16-37-00…jsonl) holds 44 failed agent_report results
        for that input; 44 + 4 (the session's second input i-d56784a0) = 48 at session level.
      impact: cosmetic; the replay asserts trip counts, not the comment's number, and its
        assertions are sound. validation.md's "settler 会话 48 连败" is accurate at session level.
      remediation: reword the comment to "44 consecutive failures in the incident input (48 across
        the session's two inputs)".
      status: fixed — verified (see follow-up round below)
  questions:
    - Where is a member-run terminal errorCode meant to surface in the webapp? The only
      'error.<CODE>' consumers are Banner.tsx:99-100 (blocked.code — server-side blockedOf only ever
      carries blocked_config/blocked_role/blocked_project, main.ts:253-269) and lib/errors.ts:15
      (RpcError codes — no method raises one with an input errorCode). So the new catalog key
      error.REPORT_RETRY_EXHAUSTED is registered and typed but unreachable from any current
      rendering path — exactly like the pre-existing error.MODEL_OUTPUT_CORRUPTED key since 11-12.
      Not introduced by this patch; flagged as a question because the plan lists the label as scope.
    - Acceptance 1 speaks of the 11-12/11-13 incidents as "two seeds of this generator replayed as
      regressions". The delivery covers the shapes differently: the generator's tag alphabets
      (invoke/function/v8/body/summary/non-ASCII) and repeat periods span both incident shapes, and
      the 11-13 interleaving pattern is pinned verbatim by the mutation self-test sequence. No test
      is named after an incident seed. Given the plan's own argument against signature-pinned tests
      this reads as deliberate; confirming it was intended.
    - Should the replay and the records standardize on input-level (44) or session-level (48)
      failure counts for the incident? ANSWERED by the remediation round (2026-11-14): the check
      that asserts the trips now states both levels ("44 consecutive failures in that input; 48
      across the session's two inputs"), plan.md stays as the frozen historical record, and
      validation.md's session-level "48 连败" stays — consistent. (Questions 1 and 2 remain open
      for the author; neither gates this result.)
  acceptance:
    - item: "1. Adversarial generator property (terminal within ≤10 failed attempts + 1 corrective)"
      verdict: pass
      evidence: "npx vitest run test/model-output-guard.test.ts → 18/18 pass, including the
        200-seed property test (every seed terminal, failures ≤ REPORT_FAILURE_LIMIT*2, corrective
        used) and the 100-seed healthy-traffic control (zero trips). Incident shapes covered via
        generator alphabets/periods + the 11-13 interleaving sequence; not pinned as literal seeds
        (see questions)."
    - item: "2. Negative controls (history must not trip except the known inputs)"
      verdict: pass
      evidence: "node checks/report-ledger-replay.ts → PASS: 1003 inputs replayed, exactly 1
        terminal trip (settler incident i-f485624c), exactly 1 corrective-only trip (17:32
        calibration i-4b5c33f6), every other input no trip. Transcript facts verified directly:
        i-4b5c33f6 has exactly 5 failed + 1 successful agent_report; the incident input
        interleaves successful bash/read results between report failures, and the same-tool reset
        rule is what makes it trip (interleaving asserted by the mutation self-test)."
    - item: "3. Checker self-test / mutation (D-05)"
      verdict: pass
      evidence: "reset-rule mutation: unit test 'the any-success mutation fails to trip on the
        2026-11-13 incident sequence' asserts the mutated guard stays silent while the shipped rule
        trips. Ledger-removal mutation: covered by the replay's trip assertion (terminals.length !==
        1 → exit 1); removing the ledger would leave the 44-failure input unbounded and fail the
        check."
    - item: "4. Terminal classification and routing"
      verdict: pass
      evidence: "npx vitest run test/runtime.test.ts → 56/56 pass including 'terminates a member run
        after five failed report attempts…' (input failed/REPORT_RETRY_EXHAUSTED in the store,
        exactly 1 kaiming.model-output-correction entry and exactly 10 agent_report toolResults in
        the persisted history) and 'completes when the report lands after the corrective turn'
        (5 + 1 attempt). Classification order read at runner.ts:865-899: stoppedOnRequest → fault →
        stopReason error → aborted → boundary → REPORT_MISSING; a ledger-trip abort cannot mask the
        fault branch and a user stop still wins; RunWatchdogError is caught before classification.
        Routing verified by direct runtime probe (guidanceFor on a real Store with a member input
        failed/REPORT_RETRY_EXHAUSTED): action 'task(op=dispatch, sessions=[{roleId: developer,
        instructions: <… do not reuse m-x …>}])', no same-session continuation. No automated test
        for this branch (finding 3)."
    - item: "5. Hot-path cost (message_update O(1), no regex/suffix analysis on the stream)"
      verdict: pass
      evidence: "code read of model-output-guard.ts: the message_update branch keeps only a
        per-content-index length counter (Map get/set + compare) and ignores text deltas entirely;
        the only regex (firstErrorSnippet whitespace flatten) runs once at trip time on toolResult
        content, not on the streaming path. degenerationReason/repeatedSuffix/buffers are deleted."
    - item: "6. Real-model replay of the poisoned-session continuation"
      verdict: not_run
      evidence: "recorded honestly in validation.md (workbench process dead, no credentials on
        this workstation); the plan explicitly allows not_run with the offline transcript replay
        standing in, which was executed (acceptance 2)."
  result: passed
  result_reconfirmed: passed (2026-11-14, after the remediation round; see follow-up section)
```

## Probe evidence beyond the diff

**The ledger's counting point really sees all three blocked/failed call modes (blocking probe from
the plan, focus item 3).** Verified in the installed SDK
(`node_modules/@earendil-works/pi-coding-agent`, agent core `pi-agent-core/dist/agent-loop.js`):

- Schema-validation failure: `prepareToolCall` → `validateToolArguments` throws → caught →
  immediate result `createErrorToolResult(error.message)`, `isError: true` (agent-loop.js ~478-486).
- Provider truncation refusal: `stopReason === "length"` → `failToolCallsFromTruncatedMessage`
  emits an error toolResult per call with the "Re-issue the tool call with complete arguments"
  text, `isError: true` (agent-loop.js ~336-360).
- Extension block: `beforeResult?.block` → immediate error result carrying the block reason,
  `isError: true` (agent-loop.js ~505-520).

Every finalized call — immediate or executed — becomes a message via `createToolResultMessage`
(`role: "toolResult"`, `toolName`, `isError`) emitted with `message_start` **and** `message_end`
(agent-loop.js ~651-667). The guard counts at `message_end`, so all three modes are counted. The
two runtime integration tests prove the schema-validation mode end-to-end against a real Pi
instance with a stub model.

**Extension-bridge lifecycle (focus item 1).** The registry reuses one Pi instance when the
binding hash and history file match (registry.ts:44-67) and never reinstalls extensions, so the
bridge (`createModelOutputGuardExtension(() => this.activeOutputGuards.get(sessionId))`) resolves
the active per-input guard on every event. The map entry is set after acquire and before any event
can flow (no prompt happens before the try block), deleted in the finally with an identity check,
and the bridge no-ops (`active() === undefined → return undefined`) whenever no run is active —
so there is no stale-guard window during a run. Nested member dispatch inside a chief run is safe:
the closure keys on the member's own sessionId and the map entry, subscription, and abort belong
to that session's run only. The `acquire`-throws case sets no entry (set happens after acquire
returns); the only leak window and its impact are recorded as finding 1.

**Ledger semantics and overshoot (focus item 2).** Reset only on an `agent_report` result with
`isError !== true`; other tools' successes never reset (shipped rule `same-tool`; `any-success`
exists only for the checker self-test). Overshoot: once the fault is set, further error results in
the same batch still increment the streak but cannot re-trip (the `fault === undefined` gate
protects the code), and `session.prompt()` resolves only after the whole batch's toolResults were
emitted — so `recoverModelOutput` resets the streak strictly after the tripping batch finished
counting. Total failures can exceed 10 by one batch's overshoot, but no sequence can exceed the
budget without the terminal fault being set: the fault persists, the abort unwinds the turn, and
classification reads it. A second trip during the corrective turn terminates: the ledger
subscription is created before the prompt try and removed only in the finally that also encloses
`recoverModelOutput`, and the 5+5 integration test exercises exactly that path (the second trip
happens inside the corrective turn).

**Hidden corrective turn (focus item 4).** `recoverModelOutput` still sends the private custom
message with `customType: MODEL_OUTPUT_CORRECTION_CUSTOM_TYPE` and `display: false`
(runner.ts:294-306); `isHiddenModelOutputCorrectionEvent` (unchanged matching: role `custom` +
that customType) is still applied in the broadcast path (server/main.ts:303), so the browser never
sees the nudge. The streak and fault are cleared before the corrective turn, and the turn's own
failures feed the same per-input subscription.

**Terminal classification (focus item 5).** Order at runner.ts:865-899: `stoppedOnRequest`
(user stop request or host abort note) → `modelGuard.fault` (new: `fault.code` drives
`errorCode`, so `REPORT_RETRY_EXHAUSTED` and `MODEL_OUTPUT_CORRUPTED` classify distinctly) →
`stopReason === 'error'` → `stopReason === 'aborted'` → boundary check → `REPORT_MISSING` /
completed. A ledger trip calls `handle.session.abort()` without `noteAbort`, so it can never be
misread as a user stop, and the fault branch precedes the generic `aborted` branch, so the
subscription abort cannot mask the cause. A watchdog abort throws `RunWatchdogError`, caught
before classification → interrupted, preserving the watchdog's precedence (the delivered boundary
cannot be trusted).

**Guidance routing (focus item 6).** The dispatch schema requires exactly one of `roleId` /
`sessionId` per entry (delegation-tools.ts:131-134) — the new advice's `roleId:` form is
well-formed and matches the pre-existing fresh-dispatch convention (guidance.ts:219/238).
Verified end-to-end with a throwaway probe (temp-dir Store, no repo modification): a member input
finished `failed`/`REPORT_RETRY_EXHAUSTED` in the current phase produces the fresh-session action
and never the same-session continuation. The writeScope/expectedKind omission is finding 2.

**Replay honesty (focus item 7).** The check splits each session file by `kaiming.input-marker`
entries, feeds only that input's `agent_report` toolResults to a fresh guard, and mirrors the
runner's corrective bookkeeping (first trip → reset, second trip → terminal). It cannot pass
vacuously: if the ledger never tripped, `terminals.length` is 0 and the check exits 1; if the
trip fired on non-incident inputs, the "exactly one" assertions fail; the reset-rule mutation is
falsified by the unit self-test (the replay feeds only report results, so the unit test is the
right place for the interleaving mutation). Limitation noted: a marker reusing an already-seen
inputId would keep the earlier run's bucket (none exists in this data dir — the check's PASS is
not affected).

**Docs (focus item 8).** runtime-contract.md R3's two rewritten paragraphs match the code point
for point (5-fail → corrective → 5-fail → `failed`/`REPORT_RETRY_EXHAUSTED`; same-tool reset;
per-input counting; fresh-session guidance; 1MB stream abort with message replacement; 16KB
report block feeding the ledger; no content-shape detection; non-result-tool loops left to the
watchdog per R7). gap-register R6's "退化形态的程序层兜底已实现" matches reality (program-layer
budget exists; instruction-shape auto-retry remains open, as stated) and R7 matches the residual
boundary. validation.md's claims re-verified: unit 18/18, integration 2 (inside runtime.test.ts
56/56), replay 1003 inputs with exactly the two expected trips, full server suite **65 files /
627 tests** (re-run, matches the claim), check:prompts **15/15** (re-run), root + webapp
`tsc --noEmit` clean. AGENTS.md's new lesson matches the implementation.

**Style (focus item 9).** The new/changed code uses `in`/`typeof` narrowing throughout
(`observeEvent`, `assistantMessageOf`, `toolResultOf`, `isHiddenModelOutputCorrectionEvent`);
no inline-cast member access was added. The one shape the SDK's message union cannot express
(the assistant-message replacement) is assigned to a typed constant with an explanatory comment —
a documented boundary, not a cast. The `as never` at runner.ts:758 predates this commit.

**i18n (focus item 10).** `error.<CODE>` is resolved at exactly two places:
webapp/src/chat/Banner.tsx:99-100 (blocked.code, with a graceful raw-code fallback) and
webapp/src/lib/errors.ts:15-17 (RpcError). Both en and zh entries were added and typecheck
(`Record<MessageKey, string>` parity enforced; webapp `tsc --noEmit` clean). The key is currently
unreachable for member-run terminal codes (see questions) — pre-existing situation, identical to
`error.MODEL_OUTPUT_CORRUPTED`.

## Follow-up verification round (2026-11-14, remediation of the four non-blocking findings)

Delta reviewed directly against the working tree (`git diff 8823dc6 -- kaiming/src/runtime/runner.ts
kaiming/src/tools/guidance.ts kaiming/checks/report-ledger-replay.ts kaiming/test/task-tools.test.ts`;
4 files, +66/−5), not against the summary.

**Finding 1 (activeOutputGuards leak window) — fixed, verified.**
`let modelGuard: ModelOutputGuard | undefined` is hoisted above the big try (runner.ts:559-562),
assigned before `registry.acquire` (runner.ts:701), and the big finally now performs the same
identity-checked delete as the small finally (runner.ts:931-936: delete only when
`activeOutputGuards.get(sessionId) === modelGuard`). A throw anywhere between the map registration
and the prompt try (bindExtensions, marker append, recordEffectiveConfig) now reaches the big
finally and clears the entry; when `acquire` itself throws there is still no entry (the set happens
after acquire returns). Both deletes are identity-checked, so the small finally cannot evict a
newer run's entry, and no double-delete hazard exists. The ledger subscription captures the
narrowed `const ledgerGuard = modelGuard` (runner.ts:825-828) because `let | undefined` narrowing
does not flow into closures — the bridge closure is untouched and still resolves through the map.
The post-run map-delete ordering vs. `flushUsage`/classification is unchanged.

**Finding 2 (fresh-dispatch advice incomplete) — fixed, verified.**
guidance.ts:147-155 builds the advice with `expectedKind: '<member.expectedKind>'` always, plus
`writeScope: ['<path>', …]` when `entry.member.writeScope.length > 0`. Both fields exist in the
dispatch schema (`readString(request, 'expectedKind')` delegation-tools.ts:159,
`readStringArray(request, 'writeScope')` :160/343), so a verbatim call for a writer role in a
write Task now passes `checkMember`'s writer checks.

**Finding 3 (missing falsifier) — fixed, verified.**
task-tools.test.ts:291-336 adds 'routes a retry-exhausted member to a fresh session, never the
poisoned one': the member input is finished `failed`/`REPORT_RETRY_EXHAUSTED`, and the test asserts
`dispatches.length > 0` (so the rest cannot pass vacuously), that some dispatch action contains
`roleId: developer`, `expectedKind: 'implementation'` and `writeScope: ['src/feature.ts']`, and
that no dispatch action contains `sessionId: m-degenerate`. This closes acceptance item 4's
guidance half with an automated check.

**Finding 4 (48 vs 44) — fixed, verified.**
checks/report-ledger-replay.ts header comment now reads "44 consecutive failures in that input;
48 across the session's two inputs" and the PASS log line matches; plan.md left as the frozen
historical record; validation.md's session-level "48 连败" is accurate and stays.

**Re-verification commands (run by the reviewer, all green):**
- `npx vitest run test/task-tools.test.ts` → 23/23, including the new routing test
- `npx vitest run test/task-tools.test.ts test/runtime.test.ts test/model-output-guard.test.ts`
  → 97/97 (the runner remediation does not disturb the ledger integration paths: still exactly 1
  correction entry and 10 report attempts in the terminal test's persisted history)
- `node checks/report-ledger-replay.ts` → PASS: 1003 inputs, exactly the two expected trips,
  corrected wording in the log
- `npx tsc --noEmit` → clean (validates the hoisted `let` + closure narrowing)

Questions 1 (webapp surfacing of member-run terminal codes) and 2 (incident-seed coverage intent)
remain open for the author; neither gates the result.
