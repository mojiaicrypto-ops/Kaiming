# Next-Round Roadmap (P0/P1/P2) and Documentation Consolidation

## Goal

Record the confirmed first-principles next-round development roadmap (P0 runtime friction reduction, P1 baseline delivery isolation, P2 subscription OAuth & session fork) into the authoritative documentation entry points, and consolidate bloated historical records (`docs/technicalnew/gap-register.md`, `docs/technicalnew/validation.md`) plus stale "unimplemented / NOT_RUN" headers across `docs/technicalnew/` and `docs/INDEX.md`.

## Acceptance

- `docs/technicalnew/gap-register.md` places the confirmed **Next-Round Roadmap (P0 → P1 → P2)** at the top with concrete code locations, root causes, and target behaviors:
  - **P0-1**: Dispatch context envelope & same-run hidden `REPORT_MISSING` recovery (`delegation-tools.ts`, `runner.ts`; supersedes R6).
  - **P0-2**: Settler report single-write alignment (`report-tools.ts`, `prompts/settler.md`).
  - **P0-3**: `settleStep` wait window tuning & non-outcome step-wake closure (`delegation-tools.ts`, `runner.ts`, `write-methods.ts`; closes C8).
  - **P1-1**: Task-level baseline dirty isolation for `scopeDrift` and Review/End delivery binding (`deliverable.ts`, `completion-git.ts`, `plan-contract.ts`).
  - **P2-1**: Subscription account OAuth login & catalog model selection (`pi-runtime.ts`, `provider-store.ts`, `methods.ts`, `ProvidersPage.tsx`; S8).
  - **P2-2**: Chief session fork (`pi-runtime.ts`, `store.ts`, `SessionsList.tsx`; F1).
- `docs/technicalnew/gap-register.md` preserves all active risk/deferred anchors (`#m-移动端方向已定尚未实施`, `#q-待改已决定方向尚未实施`, `#r-风险未记通过`) and compacts closed historical items (D/S/C/U/Q) into a concise reference table without losing IDs or commit/test pointers.
- `docs/technicalnew/validation.md` is consolidated from 936 lines to a concise, structured verification baseline and milestone evidence table while preserving referenced section anchors (`#2026-10-23-provider-命名协议与会话命名`, `#2026-10-24-任务在对话里的渲染`, `#2026-11-06--评审-report_missing-根因suangua-现场`, `#2026-11-14--报告重试预算结构账本替代内容签名防线`).
- Stale statements ("未实施", "全部 NOT_RUN", "服务端当前没有项目/会话列表方法、不存标题") in `docs/INDEX.md`, `docs/technicalnew/README.md`, `docs/technicalnew/architecture.md` (A7), `docs/technicalnew/runtime-contract.md`, and `docs/technicalnew/implementation-checks.md` are updated to match current implementation facts.
- All markdown links across `docs/` and `AGENTS.md` resolve cleanly, and `npm --prefix kaiming run check:prompts` passes 15/15.

## Scope

- `docs/INDEX.md`
- `docs/technicalnew/README.md`
- `docs/technicalnew/architecture.md`
- `docs/technicalnew/runtime-contract.md`
- `docs/technicalnew/implementation-checks.md`
- `docs/technicalnew/gap-register.md`
- `docs/technicalnew/validation.md`
- `.dev/work/roadmap-and-docs-consolidation-20261118/*`

## Out of scope

- No changes to runtime source code (`kaiming/src/**`) or injected English role prompt bodies (`docs/technicalnew/prompts/**`).
- No changes to product requirement definitions (`docs/productnew/**`).

## Verification

- Formal document task (no verification profile / no code Test stage per D-04):
  1. Run `npm --prefix kaiming run check:prompts` (15/15).
  2. Run a markdown link & anchor integrity check across all `docs/**/*.md` and `AGENTS.md`.
  3. Independent read-only Review (`self` subagent in clean context) checking contract accuracy, anchor preservation, and roadmap completeness.
  4. Settlement record and git commit of the reviewed paths.
