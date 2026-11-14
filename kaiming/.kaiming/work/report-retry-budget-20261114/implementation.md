# Implementation Summary — report retry budget

```yaml
implementation:
  task: report-retry-budget-20261114
  commit: 8823dc6
  changed:
    - path: kaiming/src/runtime/model-output-guard.ts
      purpose: >
        Rewritten. Deleted the content-signature layer (degenerationReason, repeatedSuffix,
        closing-tag regexes, per-delta text buffering). Kept O(1) counters: 1MB streamed
        tool-argument cap (fault + abort), 16KB agent_report argument limit (block, no fault),
        non-object argument fault + block, message_end replacement of discarded assistant
        messages. Added the report failure ledger: consecutive isError results of agent_report,
        reset only by an agent_report success (resetOn policy injectable for the checker
        self-test), trip at 5 → fault REPORT_RETRY_EXHAUSTED with streak/last-error evidence.
        The extension is now a stateless bridge: handlers resolve the active input's guard via
        a runner-provided accessor, because the registry reuses Pi instances across inputs
        without reinstalling extensions.
    - path: kaiming/src/runtime/runner.ts
      purpose: >
        Per-input guard instance registered in activeOutputGuards (session-keyed) after acquire
        and removed in the run's finally; per-input session subscription feeds guard.observeEvent
        and aborts the run on trip (the ledger lives here, not in the extension, so counting is
        per input even on reused Pi instances); recoverModelOutput resets the streak after the
        corrective turn and parameterizes the corrective text by fault code; terminal
        classification uses fault.code (REPORT_RETRY_EXHAUSTED vs MODEL_OUTPUT_CORRUPTED).
    - path: kaiming/src/tools/guidance.ts
      purpose: REPORT_RETRY_EXHAUSTED routes to a fresh-session dispatch (never same-session
        continuation); REPORT_MISSING routing unchanged.
    - path: kaiming/webapp/src/i18n/catalog.ts
      purpose: error.REPORT_RETRY_EXHAUSTED label, EN and zh.
    - path: kaiming/checks/report-ledger-replay.ts
      purpose: historical negative replay — splits every transcript per input via
        kaiming.input-marker entries, feeds agent_report toolResults through a fresh guard per
        input mirroring the runner (trip → corrective → reset → terminal), asserts the expected
        trip set.
  behavior:
    - Member run: 5 consecutive failed agent_report attempts → one hidden corrective turn (the
      browser shows no bubble) and the streak restarts; 5 further consecutive failures end the
      input as failed/REPORT_RETRY_EXHAUSTED with structured evidence. Total budget: 10 failures
      + 1 corrective.
    - Successes of read/bash/other tools interleaved between report failures do not reset the
      streak; a successful agent_report does.
    - A streamed tool-argument buffer above 1MB aborts the stream; the discarded assistant
      message is replaced by a short host diagnostic before entering history (unchanged
      behavior, now O(1) per delta).
    - agent_report calls over 16KB arguments are blocked before execution; their error results
      feed the ledger like every other failure.
    - Text-only degenerate floods are no longer content-analysed: they end the turn at the
      provider output limit and settle as REPORT_MISSING (bounded; no loop).
    - Guidance for REPORT_RETRY_EXHAUSTED recommends dispatching a fresh member session.
  tests_changed:
    - kaiming/test/model-output-guard.test.ts (rewritten: 18 cases — ledger semantics, reset
      rule, stream cap, tool-call policy, checker self-test with the any-success mutation,
      adversarial generator 200 seeds + 100 healthy seeds, bridge reuse test)
    - kaiming/test/runtime.test.ts (two member integration tests through the real Pi loop:
      5+corrective+5 → REPORT_RETRY_EXHAUSTED; 5 failures → corrective → valid report →
      completed)
    - kaiming/test/server-interaction.test.ts (two tests that pinned the deleted content-
      signature behavior removed, with their now-unused import)
  plan_deviations:
    - Ledger counting point: the plan allowed either the extension API or the runner's event
      path. Chose the runner subscription, for a stronger reason than the plan anticipated:
      registry.acquire reuses a Pi instance without reinstalling extensions, so any
      closure-bound per-input state in the extension is stale from the second input onward.
      The same hazard previously silent for the old guard's fault/retry flags is fixed by the
      bridge design. Declared fallback in plan Scope; recorded here as the chosen option.
    - server-interaction.test.ts deletions: implied by retiring the signature layer (the old
      tests pinned exactly that behavior); not enumerated verbatim in plan Scope.
  document_impact:
    - docs/technicalnew/runtime-contract.md (R3 defense paragraph rewritten to the ledger model)
    - docs/technicalnew/gap-register.md (R6 updated; R7 residual boundary registered)
    - docs/technicalnew/validation.md (settlement entry 2026-11-14)
    - AGENTS.md (settlement lesson: content-signature defenses do not generalize;
      REPORT_MISSING lesson now carries the REPORT_RETRY_EXHAUSTED exception)
  risks_remaining:
    - Successful non-result-tool exploration loops are watchdog-bounded only (gap-register R7).
    - Real-model replay not executed (no live workbench/credentials at settlement time); the
      offline transcript replay stands in, per the plan's declared fallback.
    - Instruction-shaped REPORT_MISSING program fallback (fixed submission requirement at
      dispatch) remains an open product decision (R6).
    - Workbench restart required before the new code takes effect.
```
