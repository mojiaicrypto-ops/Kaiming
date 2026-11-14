# Independent review — u11-error-label-20261114 (uncommitted webapp diff, reviewed 2026-11-14)

```yaml
review:
  task: u11-error-label-20261114
  reviewer_session: independent-reviewer (omp subagent; no host session id issued)
  reviewer_model: group-volc-plan/group/auto-glm-5-3-flash
  context_snapshot: plan.md (focused profile) + uncommitted worktree diff on top of commit 8823dc6 + gap-register U11 row + AGENTS.md quality rules
  findings:
    - severity: non-blocking
      location: kaiming/webapp/src/chat/TaskTodo.tsx:201-204
      evidence: the raw-code fallback guards `errorCode !== null && errorCode !== undefined` but
        not `!== ''`; catalogErrorKey and reportReasonOf both guard the empty string, so the three
        guards are asymmetric. An empty-string code on a plain-failure row would render an empty
        label (the note disappears) instead of falling back to the generic one.
      impact: unreachable with today's producers — finishInput writes `errorCode ?? null` and every
        caller passes a real code or omits it, and the store column is TEXT (no '' writer exists in
        src/). Purely defensive tightening; nothing observable today.
      remediation: add `row.errorCode !== ''` to the fallback condition so all three guards agree.
      status: fixed — verified (see follow-up round below)
    - severity: non-blocking
      location: /browser-u11-verify-15cd95f49cd2a546.har (repo root, untracked, 26 KB)
      evidence: a browser-capture scratch file from the U11 verification sits at the repository
        root, outside the reviewed paths; it is not part of the diff but is clearly U11-related
        debris from an earlier verification run.
      impact: none on behavior; a commit that sweeps untracked files would persist 26 KB of
        binary-ish capture into history, against the repo's settlement hygiene.
      remediation: delete it (or move it out of the repo) before/at the settlement commit; never
        git-add it. Per AGENTS.md it does not block completion as an unrelated dirty file, but it
        is not unrelated — it belongs to this task's cleanup.
      status: fixed — verified (see follow-up round below)
  questions:
    - The plan's document_impact (gap-register U11 → closed) is not part of this uncommitted diff:
      the U11 row still reads 待处置. Correct for a pre-commit review; the closure edit must ride
      with the settlement commit (AGENTS.md: no change work is complete until affected documents
      are current). Not a code finding.
    - The browser spec seeds rows through a second Store connection plus one raw-SQL UPDATE on
      sessions.currentTaskId (spec lines 108-111). Workable for a focused spec and honest about
      what it bypasses, but a future harness helper that binds a Task through the store API would
      keep other specs from copying the raw-SQL pattern.
  acceptance:
    - item: "AC-1: known code renders the catalog sentence; unknown code renders the raw code"
      verdict: pass
      evidence: "browser spec re-run by reviewer (1 passed): rendered roster rows are — failed +
        REPORT_RETRY_EXHAUSTED (report missing) → 'The report failed repeatedly; the retry budget
        was exhausted and the run was stopped'; failed + SOMETHING_NEW (report delivered, plain
        failure) → 'SOMETHING_NEW'; and `REPORT_RETRY_EXHAUSTED` never appears raw
        (expect toBe(false)). zh sentence asserted in the unit test through the typed t stub;
        catalog en/zh keys verified typed in the 8823dc6 review (Record<MessageKey, string>
        parity, webapp tsc clean)."
    - item: "AC-2: failed member without errorCode keeps the generic failed label"
      verdict: pass
      evidence: "unit case 'returns null when the input carries no code or did not fail' passes;
        in TaskTodo the null reason falls through to t('task.state.failed') — the pre-existing
        branch."
    - item: "AC-3: completed/queued rows and the blocked banner render exactly as before"
      verdict: pass
      evidence: "memberRowState (TaskTodo.tsx:164-178) is untouched: reason is computed only for
        notes 'failed'/'missingReport'; done/queued/running/idle/asking fall through to the
        original t(`task.state.${note}`) branch. Banner refactor is logic-equivalent: the old
        inline MESSAGE_KEYS ternary became catalogErrorKey(code) with the same null → raw-code
        fallback, and every code blockedOf can serve (blocked_config/role/project) has a catalog
        key. Webapp suite 137/137 green."
  result: passed
  result_reconfirmed: passed (2026-11-14, after the remediation of both P3 findings; see follow-up section)
```

## Review-focus verdicts

**(a) Never leak an untranslated key.** `catalogErrorKey` gates on `MESSAGE_KEYS.includes`
and returns null otherwise; `reportReasonOf` maps null → null; the TaskTodo raw-code fallback
shows the *code*, never a `error.<CODE>` key. The browser spec asserts the raw `REPORT_RETRY_EXHAUSTED`
string never appears on any row. The only leak-shaped edge is the empty-string asymmetry (finding 1,
unreachable today).

**(b) Completed/queued rows and blocked banner unchanged.** Verified structurally (memberRowState
untouched; label ternary falls through to the original branch for every other note) and by the
suite. The Banner refactor preserves the exact user-visible contract — same key resolution, same
raw-code fallback, same ` · ` separator — and the suite's existing Banner tests pass.

**(c) "No server change needed" — claim verified, not assumed.** `task.get`'s members mapping
already serves the terminal code: read-methods.ts:571 `errorCode: lastInput?.errorCode ?? null`,
where `lastInput` is the session's latest delegation/continuation input (read-methods.ts:543-546).
The rest of the path pre-exists too: `slot.ts:61` `TaskMember.errorCode?: string | null`;
the new ChatPage line (`errorCode: member.errorCode ?? null`) is the only new mapping, straight
into `TaskMemberRow.errorCode`. Nothing in the chain drops it; the diff contains zero server-file
changes (confirmed by `git status --porcelain`: only the four webapp files + browser harness/spec
+ unit test).

## Design refinement: missing-report row with an unresolvable code keeps 'Report missing'

**Judged sound and consistent with the plan's intent.** Rationale, grounded in the code: the
roster's job is to state the step's blocker. When the formal report is missing, "Report missing"
*is* the accurate, actionable fact — it is the fact guidance routes on (same-session vs
fresh-session advice keys on the input, not the code), and it is what the chief must act on.
Substituting an unresolvable raw code for it would destroy information. On a plain-failure row
(report delivered, the input still failed) the generic label adds nothing the row's kind doesn't
already say, so the raw code is the only incremental diagnostic — and showing it matches the
Banner's established convention ("a code we have no sentence for keeps its own name"). AC-1's
"unknown code renders the raw code" is not contradicted: the refinement applies it where a raw
code adds information and preserves the more accurate fact where it does not. The spec documents
the distinction in-code (comment at the seeding block) and pins all three behaviors; the unit
test pins the helper-level rule (known code resolves for both failed and missingReport; unknown
→ null). One consequence worth keeping in mind: a missing-report row with an unknown code gives
the user no code at all — acceptable, since the code surfaces verbatim in the store/input detail
and the transcript; the roster is not the diagnostic surface of record.

## Re-verification run by the reviewer (all green)

- `npx playwright test browser/u11-roster-label.spec.ts` → 1 passed; rendered row texts captured
  in the run log match all three expected behaviors; screenshot written to
  kaiming/test-results/u11-roster.png (125 KB, re-written by this run)
- `cd webapp && npx tsc --noEmit` → clean; `npx vitest run` → 137/137 (includes the 4 new
  resolution cases)
- root `npx tsc --noEmit` → clean (covers kaiming/browser/harness.ts's dataDir addition)

## Follow-up verification round (2026-11-14, remediation of the two P3 findings)

**Finding 1 ('' code guard) — fixed, verified.** TaskTodo.tsx:204 now reads
`state.note === 'failed' && row.errorCode !== null && row.errorCode !== undefined &&
row.errorCode !== ''` — the raw-code fallback is now symmetric with catalogErrorKey and
reportReasonOf (both already guard ''). Re-verified green: webapp `tsc --noEmit` clean,
webapp suite 20 files / 137 tests pass, browser spec re-run 1 passed with the same three
rendered row behaviors (catalog sentence / SOMETHING_NEW raw on the plain-failure row /
"Report missing" on the missing-report row).

**Finding 2 (stray HAR) — fixed, verified.** `browser-u11-verify-15cd95f49cd2a546.har` no longer
exists at the repo root (checked with ls) and `git status --porcelain` shows it was never tracked:
the remaining worktree changes are exactly the U11 diff (four webapp files, harness.ts, the new
spec, and the two work-dir reports).

`result` re-confirmed: **passed** — zero blocking findings; both P3s closed with evidence.
