# Independent Review — P0-5

Three rounds, separate read-only agent context.

## Round 1: NEEDS_FIX

Verified correct: parser standalone-only behavior (prose/bullet/blockquote/fence/unknown rejected, CRLF, both colons); envelope gating by implement + developer/tester, undefined/null semantics, focused wording forbidding the full suite; backlog description truthful (`resolveRef` accepts any project-relative path, storage/op untouched); mutations the assertions catch; tests/typecheck/prompts pass.

Blocking findings:

1. `kaiming/src/tools/guidance.ts:196,198` — the settle `nextActions` still said "record leftovers with backlog(op=add)" and "records what remains". This is the host channel merged into every `task(get|dispatch|update|end)` result; it contradicted the narrowed prose and reproduced the incident path. No test pinned it.
2. Four normative documents still said settlement turns leftovers into new backlog items unconditionally: `docs/productnew/acceptance.md:35` (AC-23), `docs/technicalnew/storage-and-recovery.md:148` (S6), `docs/productnew/README.md:86`, `docs/productnew/journeys.md:95`.

## Round 2: PASS

Fixes:

- `guidance.ts` now: "…for each delivered item; put side findings in the settlement report, not the backlog", reason "…keeps side findings in the report". New `test/guidance.test.ts` builds a real settle Task and asserts the close action carries no `backlog(op=add)`/`record leftovers` and both new phrases; reverting either turns it red (reviewer and author both observed).
- AC-23, S6, README and journeys say "本次范围内需要继续的遗留问题成为新的待办（顺手发现写进结算报告）"; re-grep found no unconditional leftover→backlog statement left.
- Parser now accepts a trailing annotation (`broad (reason)`); the repo's own plan reads `broad` and the incident plan reads `focused`; test extended. G4 documents "值后可带说明".
- Envelope tail names the Plan section too; tester's duplicate paragraph removed and the conflict rule merged into its existing profile paragraph; developer bumped to v6; backlog description says "confirmed scope split or in-scope leftover".

Reviewer re-ran: focused 39/39, typecheck 0, prompts 15/15. Full suite in the reviewer's tree hit the known `git-commit-gate` timeout flake (file alone 30/30); the author's quiet run was 68 files 689/689. Prompts take effect after a restart; model compliance itself is not verified.

## Round 3: PASS (parser fence pairing)

The independent Test found residual code-block false positives: a shorter inner fence, a cross-character fence, a ` ``` note` closer, and a 4-space indent could each be read as a declaration. Fix: `FENCE` captures `{char, length}` and only a same-character run at least as long, followed by whitespace, closes; opening fences accept an info string; 4-space/tab lines are code; HTML comments are documented as outside the Plan format.

- New tests: 4-backtick opener with a 3-backtick inner fence, tilde/backtick cross-character blocks, an unclosed fence whose ` ``` note` line must not close it, 4-space indent, and a declaration after a properly closed fence. Each fails under the targeted mutation (reviewer confirmed by reading and probes).
- Independent Test re-ran a 37-case matrix: all fence lengths/chars/info strings/CRLF/indent cases and both real plans correct; focused 40/40.
- Final counts: focused 40/40, full 68 files 690/690, typecheck 0, prompts 15/15.
