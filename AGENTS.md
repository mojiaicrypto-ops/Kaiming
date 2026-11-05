# Kaiming development entry

Read the [documentation index](docs/INDEX.md) first, then load the product, architecture, rules and acceptance documents for the work package at hand. The formal documents listed in the index are the complete implementation basis; the current implementation state is recorded there too.

Follow the [delivery process](docs/productnew/modules/delivery.md) and the [role and tool contract](docs/technicalnew/agents-and-tools.md). Code changes require an applicable Plan first; professional roles use separate contexts and Review never reads the development chat; report completion based on actual evidence.

The product design documents describe behaviour to be implemented; they are not proof that a feature already exists. webui/index.html is a mock reference only. Never replace this repository's formal contracts with an external skill of the same name or with a historical plan.

Confirmed scope and basis: `docs/productnew/` (product requirements) and `docs/technicalnew/` (technical design) are the only implementation basis, implemented as a whole. `oldcode/` and `docs/old/` are not read, not processed and need no understanding; `docs/architecturenew/` is a previous-round plan and is not an implementation basis.

Simple first: do not over-engineer and do not over-think. Solve the current problem within the confirmed requirements and prefer Pi's native capabilities and the existing mechanisms; without a clear need, do not add objects, states, protocols or abstraction layers, and do not pre-build complex mechanisms for hypothetical future needs.

## Discuss before sensitive changes

A change is sensitive when it touches completion checks, delivery or commit judgement, cleanup or deletion, environment and process ownership, permissions, persistence, or a cross-module contract. For these, present the observed facts, the viable options and their consequences, and the recommendation first; wait for the user's decision, then write the applicable Plan and change code. Do not turn a proposal made during discussion into an implementation on your own.

Never delete files, installed dependencies, build outputs or user data just to make a check pass. When a check rejects ordinary work, treat the check and the work as two separate questions: report the false positive, preserve the environment, and discuss the fix. A passing completion gate is not a reason to destroy the workspace.

The end-of-Task delivery check is sensitive. The confirmed rule: for a code delivery, Review/Test bind code paths and treat `docs/**` plus root Markdown as settlement output; a docs-only delivery still binds its docs. Any change to this rule needs discussion first.

## Quality and settlement

Standard code Review/Test treats checks as falsification. A Test must include a known-bad input, wrong expectation, mutation, or checker self-test that really fails for the intended reason; an all-green suite with no negative control is incomplete. Review checks that expected values come from acceptance, independent facts or invariants, not from current output, a single fixture or the author's assumption. Tests may use relationships (inclusion/range/uniqueness/references) instead of one sample's literal values.

Every code or presentation Task Plan names a verification profile. `visual` is copy/pure styling with no event, state, request or data change and no shared layout/design-token edit: independent Review and settlement, no Test, no full suite. `focused` is one local behavior/function/interface/interaction change: developer runs focused TDD/unit checks and, for a page interaction, one browser path; independent Test covers this acceptance and related regression; do not run the full suite or full E2E. `broad` is a shared contract, migration, permission/state machine, common layer, shared layout/design token or known high-risk change: a full suite/cross-module pass is allowed with the reason recorded. Design and formal-document Tasks declare no profile and use independent Review and settlement. An unstated code/presentation profile defaults to focused. Full-suite/release gates are not per-Task defaults.

Every code or material product/design change settles into the nearest authoritative product/technical documents, validation record and this file when project rules change. No change work is complete until its settlement report exists, affected documents are current, and the reviewed delivery paths are committed relative to HEAD. Read-only Tasks close per D-04 without settlement. Unrelated dirty files are preserved and do not block completion; never commit or delete them merely to clean the worktree. Settlement not committed = not happened.
