# AgentDev development entry

Read the [documentation index](docs/INDEX.md) first, then load the product, architecture, rules and acceptance documents for the work package at hand. The formal documents listed in the index are the complete implementation basis; the current implementation state is recorded there too.

Follow the [delivery process](docs/productnew/modules/delivery.md) and the [role and tool contract](docs/technicalnew/agents-and-tools.md). Code changes require an applicable Plan first; professional roles use separate contexts and Review never reads the development chat; report completion based on actual evidence.

The product design documents describe behaviour to be implemented; they are not proof that a feature already exists. webui/index.html is a mock reference only. Never replace this repository's formal contracts with an external skill of the same name or with a historical plan.

Confirmed scope and basis: `docs/productnew/` (product requirements) and `docs/technicalnew/` (technical design) are the only implementation basis, implemented as a whole. `oldcode/` and `docs/old/` are not read, not processed and need no understanding; `docs/architecturenew/` is a previous-round plan and is not an implementation basis.

Simple first: do not over-engineer and do not over-think. Solve the current problem within the confirmed requirements and prefer Pi's native capabilities and the existing mechanisms; without a clear need, do not add objects, states, protocols or abstraction layers, and do not pre-build complex mechanisms for hypothetical future needs.

## Discuss before sensitive changes

A change is sensitive when it touches completion checks, delivery or commit judgement, cleanup or deletion, environment and process ownership, permissions, persistence, or a cross-module contract. For these, present the observed facts, the viable options and their consequences, and the recommendation first; wait for the user's decision, then write the applicable Plan and change code. Do not turn a proposal made during discussion into an implementation on your own.

Never delete files, installed dependencies, build outputs or user data just to make a check pass. When a check rejects ordinary work, treat the check and the work as two separate questions: report the false positive, preserve the environment, and discuss the fix. A passing completion gate is not a reason to destroy the workspace.

The end-of-Task delivery check is one such sensitive area: which files count as the reviewed delivery, and whether ignored build outputs or user-excluded files should be filtered, is an open decision to discuss. Do not change that check ad hoc.
