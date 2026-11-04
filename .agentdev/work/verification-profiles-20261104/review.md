# Review — verification profiles

Task: verification-profiles-20261104
Independent reviewer: `PresidentialMarmoset` (separate read-only context)

## Round 1: failed (1 P1, 2 P2, 1 P3)

1. Chief prompt made `requiresTest=true` for design/formal documents, contradicting D-04 and the completion gate. Fixed with an explicit design/document no-profile/no-Test exemption across delivery, chief, AGENTS and reviewer.
2. `focused` browser path was unconditional even for backend-only work. Qualified as page-interaction in all propagated definitions.
3. `visual` omitted the shared layout/design-token exclusion in agent-facing prompts; a global token edit could be mislabeled visual. Added to visual definitions and broad triggers.
4. No independent consumer of the declared profile; reviewer now checks profile/`requiresTest` and treats mismatch as blocking.

## Round 2: passed

Reviewer confirmed all four closed. Two residuals were then fixed: design/document Tasks were explicitly excluded from profile/default focused, and validation/U8 wording was aligned (shared token, page-only browser, reviewer landing, visual runs no tests).

## Round 3: passed

Reviewer confirmed both residuals closed; no blocking findings. An optional wording note about unqualified “unstated = focused” was judged harmless because design/document work never enters developer/Test and the I4 row is keyed to code/presentation changes.

## Boundary

Reviewer did not run tests; developer evidence is in `test.md`.
