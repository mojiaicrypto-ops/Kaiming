# AgentDev development entry

Read the [documentation index](docs/INDEX.md) first, then load the product, architecture, rules and acceptance documents for the work package at hand. The formal documents listed in the index are the complete implementation basis; the current implementation state is recorded there too.

Follow the [delivery process](docs/productnew/modules/delivery.md) and the [role and tool contract](docs/technicalnew/agents-and-tools.md). Code changes require an applicable Plan first; professional roles use separate contexts and Review never reads the development chat; report completion based on actual evidence.

The product design documents describe behaviour to be implemented; they are not proof that a feature already exists. webui/index.html is a mock reference only. Never replace this repository's formal contracts with an external skill of the same name or with a historical plan.

Confirmed scope and basis: `docs/productnew/` (product requirements) and `docs/technicalnew/` (technical design) are the only implementation basis, implemented as a whole. `oldcode/` and `docs/old/` are not read, not processed and need no understanding; `docs/architecturenew/` is a previous-round plan and is not an implementation basis.

Simple first: do not over-engineer and do not over-think. Solve the current problem within the confirmed requirements and prefer Pi's native capabilities and the existing mechanisms; without a clear need, do not add objects, states, protocols or abstraction layers, and do not pre-build complex mechanisms for hypothetical future needs.
