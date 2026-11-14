# Independent test report — u11-error-label-20261114

Executed 2026-11-14 on the workbench checkout at HEAD `df5c473` (settle commit for
report-retry-budget-20261114) with the U11 diff UNCOMMITTED (`browser/harness.ts`,
`webapp/src/chat/{Banner,ChatPage,TaskTodo,task-labels}`, `webapp/test/member-row-state.test.ts`,
new `browser/u11-roster-label.spec.ts`). This run covers the U11 webapp change only. Every result
below is from commands I ran myself.

```yaml
test:
  task: u11-error-label-20261114
  environment: Node v24.8.0, macOS darwin 25.5.0 arm64; vitest 3.2.7 (kaiming server 65 files, webapp 20 files); Playwright chromium; vite build 7.3.7
  runs:
    - command: npx vitest run
      result: passed
      exit_code: 0
      evidence: >
        Test Files 65 passed (65), Tests 628 passed (628), 0 failures (raw output artifact://271).
        Note on the expected count: the settled baseline is 628, not 627 — commit df5c473 committed
        the review-remediation guidance routing test (+47 lines in test/task-tools.test.ts) that my
        previous independent run already measured as 65 files / 628 tests. The U11 diff touches no
        server file; the count matching the settled baseline confirms exactly that.
    - command: cd webapp && npx tsc --noEmit && npm test
      result: passed
      exit_code: 0
      evidence: >
        webapp typecheck clean (tsc_exit=0); vitest Test Files 20 passed (20), Tests 137 passed
        (137) = the 133 settled + 4 new reportReasonOf cases in member-row-state.test.ts
        (artifact://275).
    - command: cd kaiming && npm run build
      result: passed
      exit_code: 0
      evidence: >
        Rebuilt AFTER the U11 source changes and BEFORE the browser spec: vite build, 210 modules,
        web-static/assets/index-CtTeZmXX.js (687.69 kB) emitted, 1.11s. Only warning is the
        pre-existing chunk-size advisory.
    - command: npx playwright test browser/u11-roster-label.spec.ts
      result: passed
      exit_code: 0
      evidence: >
        1 passed (chromium, 673ms). The spec's own roster log shows the three seeded rows render
        exactly as required: "implement — The report failed repeatedly; the retry budget was
        exhausted and the run was stopped" (catalog sentence for REPORT_RETRY_EXHAUSTED);
        "implement-3 — SOMETHING_NEW" (raw code on a plain failure that delivered a report);
        "implement-2 — Report missing" (unknown code + missing report). Screenshot written to
        kaiming/test-results/u11-roster.png by the spec itself.
  not_covered:
    - area: Real-model replay
      reason: >
        Settled in the previous task (report-retry-budget-20261114); not part of the U11 surface.
      disposition: accepted
    - area: Failed-member roster against live production data
      reason: >
        No live-data failed member exists on this workstation; the browser path seeds its own
        throwaway workbench (spec writes the three failed rows through a second Store WAL
        connection and binds the chief session the way dispatch does).
      disposition: accepted
  result: passed
```

## Falsification check (a) — the spec cannot pass vacuously

Read `browser/u11-roster-label.spec.ts` in full:

- Row count is guarded twice: `toHaveCount(3)` (line 139) and `expect(texts).toHaveLength(3)`
  (line 143); rows are matched by label (`implement`, `implement-3`, `implement-2`), not index
  (comment at line 140), so a reordering cannot satisfy a wrong pairing.
- The seed makes each expectation exclusive: only `s-u11-exhausted` finishes failed with
  REPORT_RETRY_EXHAUSTED (line 93); `s-u11-plain` gets SOMETHING_NEW **plus** a recorded result
  (lines 95, 112-124) so it is a plain failure, not missing-report; `s-u11-unknown` gets
  SOMETHING_NEW with **no** result, i.e. missing-report. Given `TaskTodo`'s label logic, a
  SOMETHING_NEW row can never show a catalog sentence (no catalog key), and "Report missing"
  renders only through the missingReport branch — so line 145 failing means the raw-code fallback
  broke, line 146 failing means branch precedence broke, line 144 failing means the sentence path
  broke.
- The no-raw-leak assertion (line 148, `!texts.some(t => t.includes('REPORT_RETRY_EXHAUSTED'))`)
  is the tight one: per `TaskTodo.tsx:199-206`, if `reportReasonOf` returned null for
  implement-1, the label falls back to `row.errorCode` and the raw code WOULD appear in `texts`,
  failing line 148. Together, lines 144 + 148 prove the catalog sentence rendered through
  `reportReasonOf` — the observed roster log confirms all four expectations simultaneously.

## Falsification check (b) — errorCode reaches the webapp only via the ChatPage task.get mapping

- Data flow verified end to end: server `task.get` → `useSession.ts:117-135` stores
  `read.members` → `ChatPage.tsx` members `useMemo` (272-316) is the **only** construction site of
  `TaskMemberRow` objects in the webapp (grep: the type is imported by ChatPage/TaskTodo/
  MessageItem/Transcript, but only ChatPage:272 maps rows), with the added line
  `errorCode: member.errorCode ?? null` (ChatPage.tsx:307) → `members` passed to TaskTodo
  (552/562) → `TodoMemberRow` consumes `reportReasonOf(row, t)` (TaskTodo.tsx:198) and the raw-code
  fallback (204-205). The other `errorCode` occurrences in webapp/src feed the interruption banner
  (session.recovery.inspect → ChatPage:414 → Banner), a different surface that never touches the
  roster.
- Revert-reasoning: without ChatPage.tsx:307, every row's `errorCode` is undefined →
  `reportReasonOf` returns null (task-labels.ts:65) and the TaskTodo:204 guard skips the raw-code
  fallback → implement-1 shows the generic `task.state.failed` note (spec line 144 fails) and
  implement-3 never shows SOMETHING_NEW (line 145 fails). implement-2 would still show
  "Report missing" (mapped separately at line 308), but the spec as a whole fails at 144+145.
  The transcript claim holds by construction, and the passing run confirms the mapping is live.

## Unit coverage of the same logic

`webapp/test/member-row-state.test.ts:56-75` adds exactly the 4 new `reportReasonOf` cases:
catalog sentence for a known code on a plain failure (zh sentence asserted verbatim); the
missing-report case (same sentence, and REPORT_MISSING stays null); null for an unknown code
(SOMETHING_NEW); null for no code / non-failed input. All pass in run 2.

## Verdict

All four runs passed (root suite matches the settled 65/628 baseline; webapp 137 = 133 + 4; dist
rebuilt fresh; focused browser spec 1 passed with the exact expected row texts). Both falsification
checks hold. The only uncovered areas are out of scope for this change (real-model replay settled
previously) or inherent to the test design (throwaway harness, no live failed member). **Result:
passed** — Settlement may proceed.
