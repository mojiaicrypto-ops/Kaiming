# Settlement Report — report retry budget

```yaml
settlement:
  task: report-retry-budget-20261114
  stable_facts:
    - >
      Member-run report retries are bounded by structural accounting, not content shape:
      agent_report 5 consecutive error results (schema validation, provider truncation
      refusals, host-blocked oversized calls, tool errors) trip one hidden corrective turn
      and reset the streak; 5 further consecutive failures end the input as
      failed/REPORT_RETRY_EXHAUSTED with structured evidence. Total budget: 10 failures +
      1 corrective turn. Only an agent_report success resets the streak (other tools'
      successes do not — the 11-13 incident interleaved them); counting is per input.
    - >
      Guidance routes REPORT_RETRY_EXHAUSTED to a fresh-session dispatch carrying
      expectedKind and the member's writeScope; same-session continuation is reserved for
      instruction-shaped REPORT_MISSING. Continuing a degenerated session replays poisoned
      history (observed: continuation re-degenerated on its first tool call; a fresh session
      delivered in 100 s).
    - >
      Content-signature degeneration detection is retired. The streaming path keeps only
      O(1) counters: 1MB streamed-argument hard cap (abort + message replacement) and the
      16KB agent_report argument block whose error result feeds the ledger. The 11-12
      signature guard intercepted zero real incidents; its per-delta analysis was itself a
      CPU hazard.
    - >
      Pi instances are reused across inputs without extension reinstall
      (registry.acquire); per-input state must therefore live runner-side and reach
      extensions through an accessor. The previous closure-bound guard was silently stale
      from a session's second input onward — fixed by the bridge design.
    - >
      Acceptance gates for defenses that classify garbage: an adversarial-generator
      property test (200 seeds, bounded terminal) plus a replay over real history (1003
      inputs, exactly the expected trips) — signature-shaped tests are decoration.
      Recorded as a settlement lesson in AGENTS.md.
    - >
      New registered gap U11: member-run terminal errorCodes have catalog labels but no
      webapp rendering path (pre-existing since 11-12 for MODEL_OUTPUT_CORRUPTED).
  updated:
    - docs/technicalnew/runtime-contract.md (R3 defense paragraphs rewritten to the ledger model)
    - docs/technicalnew/gap-register.md (R6 updated — degeneration half implemented; R7 added
      — non-result-tool exploration loops watchdog-bounded; U11 added — terminal error-code
      webapp surfacing)
    - docs/technicalnew/validation.md (settlement entry 2026-11-14 with calibrated evidence)
    - AGENTS.md (settlement lessons: content-signature defenses do not generalize;
      REPORT_MISSING continuation exception for REPORT_RETRY_EXHAUSTED)
  proposed_for_confirmation:
    - none — the ledger design, thresholds (N=5 + corrective valve), the withdrawal of the
      production-volume ledger, and the residual boundary were confirmed by the user during
      task discussion; U11's disposition is intentionally left 待处置 in the gap register
  indexes_updated:
    - docs/INDEX.md — checked, no change (validation.md and gap-register.md already linked;
      no new top-level document)
    - docs/technicalnew/implementation-checks.md — checked, no change (checks/ scripts are
      not indexed there; the replay is invoked directly per the validation record)
  archived:
    - kaiming/.kaiming/work/report-retry-budget-20261114/plan.md
    - kaiming/.kaiming/work/report-retry-budget-20261114/implementation.md
    - kaiming/.kaiming/work/report-retry-budget-20261114/review.md (result: passed; 4
      non-blocking findings fixed and re-verified by the same independent reviewer)
    - kaiming/.kaiming/work/report-retry-budget-20261114/test.md (result: passed)
    - kaiming/.kaiming/work/report-retry-budget-20261114/settlement.md (this file)
  no_change:
    - docs/productnew/acceptance.md (no AC governs member-run failure states; runtime
      contract R3 is the authoritative home)
    - kaiming/package.json (the replay is invoked directly as documented; no npm alias needed)
    - kaiming/src/server/main.ts (the hidden-correction filter already matched the unchanged
      customType contract)
  open_nonblocking:
    - reviewer question: webapp surfacing of member-run terminal codes — registered as U11,
      disposition 待处置
    - reviewer question: incident shapes are covered by the generator alphabets/periods and
      the 11-13 interleaving mutation self-test rather than incident-named literal seeds —
      intended per the plan's argument against signature-pinned tests
  completion_gate: passed
```

## Completion statement

Completed: Plan `kaiming/.kaiming/work/report-retry-budget-20261114/plan.md` (user-approved;
commit 8823dc6); independent Review `review.md` — passed, re-confirmed after four
non-blocking remediations (same independent reviewer, per-finding fixed/verified); Test
`test.md` — passed (independent execution: full suite 65 files/628 tests, historical replay
1003 inputs with exactly the expected trips, both tsc gates clean, webapp 133 tests,
check:prompts 15/15, two falsification checks hold); Settlement — runtime-contract R3,
gap-register R6/R7/U11, validation entry, AGENTS.md lessons, artifacts archived in the task
directory and committed. Remaining risk (explicit): real-model replay not executed (no live
workbench/credentials; plan-authorized fallback executed offline — disposition accepted);
successful non-result-tool exploration loops watchdog-bounded only (R7); U11 webapp
surfacing 待处置; workbench restart required before the behavior takes effect.
