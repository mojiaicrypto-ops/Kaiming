# WP-10 发布验收证据汇总（自动生成）

本文件由 `node scripts/acceptance.mjs` 生成，请勿手工编辑。

## 0. 运行元数据

- 生成时间：2026-09-15T12:07:25.353Z
- 命令：`pnpm test:acceptance`（实际执行 `node scripts/acceptance.mjs`）
- 仓库：`/Users/huyaohua/huyh/work/aigrouptool`
- Git HEAD：`f2a1d50b94a8e225793a2f96cf886fd2ed8863c2`（工作区有未提交改动）
- 证据绑定：`codeDigest sha256:29db434749e9590a111b7cd171be05990cf5b0426e45b46c13fa210d8a9ba7d5`（gitTree `990a8ba2b7874a9e8d3c7779cc1e3da3bd9bace2`，350 个代码文件的内容哈希）；演练报告必须携带同一绑定才会被采用
- Node：`v24.8.0`；Docker：可用
- 真实 Provider 环境变量：已配置；Review/Test 独立模型：已配置
- 发布演练：本次运行内执行了 `scripts/e2e.mjs` 与 `scripts/live.mjs`（非读取仓库文件）
- 退出码：0

- AC 统计：**共 94**（期望 94） → **PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0**
- ACCEPTED = 该 AC 的完整 Given/When/Then 未全部执行，但缺口已在 `scripts/lib/drill-acs.mjs` 登记，且豁免条件在本次运行中依然成立（逐条见 §3）。PASS 只表示该 AC 的全部已映射证据通过且没有未验证的登记缺口。
- 已执行提交用例：1954 个，覆盖 133/133 个测试文件

## 1. 自动检查原始结果

| 命令 | 退出码 | 结果摘要 | 原始输出尾部 |
|---|---|---|---|
| `vitest run --project unit` | 0 | 1432 tests / 1432 passed / 0 failed | JSON report written to /var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-acceptance-unit-82827.json |
| `vitest run --project integration` | 0 | 522 tests / 522 passed / 0 failed | done. Cloning into '/var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-t5-nopool-K7p9qM/clone'... done. runner: attempt-1 delivered nothing; waiting for the correction or a shutdown; model said: (no text) runner: attempt-1 delivered nothing; waiting for the correction or a shutdown; model said: (no text) runner: attempt-1 delivered nothing; waiting for the correction or a shutdown; model said: (no text) |
| `pnpm test:e2e`（本次运行内执行） | 0 | 真实演练（见 §6.6） | ops: relocate (fail-closed + alias) ops: doctor ops: launchd unit PASS       ops.backup-restore                             [AC-064] credentialed Provider provider:01a0a4f4-c4fe-7128-ba98-fc9e4565f1b8 -> Chief Run 01a0a4f4-c565-763b-a11a-1bfaaf4507b0 reached attempt.ready (Attempt 01a0a4f4-c829-7bc9-ad5b-dd81db8d7126 running) and … UNVERIFIED provider.fact-and-unknown                      [AC-001] AC-001 的“区分事实/未知”需要真实 Provider 纵向演练（pnpm test:live 与 AGENTDEV_PROVIDER_*）；本演练离线运行，Provider 桩被断言零调用 e2e: wrote drill report to /var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-acceptance-drills-S5G5Z6/e2e.mjs.json e2e: 26 checks — PASS 25 / FAIL 0 / UNVERIFIED 1 e2e: 31 ACs accounted for by the drill; exit 0 |
| `pnpm test:live`（本次运行内执行） | 0 | 真实演练（见 §6.6） | PASS       drill.html-explanation                         [AC-001] message 01a0a4f5-34cd-71a7-b0ff-a89912b9704b -> Work 01a0a4f5-34cd-70a3-9b7b-8967842503fb (intent=assist level=none, no Requirement); completion through run 01a0a4f5-3593-77f6-ae7c-f0e0518c1dc4 (conf… PASS       drill.l1-typo                                  [AC-007] Work 01a0a4f5-b944-7050-87c7-e8815767f3a3 (level=L1, base e3e0c9a3cb80) one-task Plan 01a0a4f5-be5 approved by the real gate; write admitted for src/orders/messages.ts; real exec Run 01a0a4f5-be78-75… PASS       drill.l2-delivery                              [AC-010,AC-037,AC-041,AC-043] Work 01a0a4f5-cdc6-7160-9034-a0740eb9beed (L2, base 4e9a2dcff24c) + Requirement 01a0a4f5-cdf5-7598-9e0a-2b77169d7cf4; model Plan 01a0a4f5-d83 approved, Task 01a0a4f5-d825-77eb-b5c3-e1174447b816; inde… PASS       drill.runtime-attempt                          [AC-057] the runtime executed Run 01a0a4f5-f822-798c-b6e9-018804f56977 through a real apps/runner child process (Attempt 01a0a4f5-f8f1-7fd8-96a4-88b7ceaf3de8, runnerId pid:73818) against the real Provider; 88… PASS       drill.message-to-stage                         [AC-003,AC-005,AC-069] real Provider no-seed chain: message 01a0a4f6-162a-7215-9c0b-a6e658f29107 → Chief Run 01a0a4f6-164f-78a2-950e-ae5e303148e4 (completed) → Requirement 01a0a4f6-2bfc-76dc-bce2-1cfba24bf0d0 (active/plan)… PASS       drill.session-streaming                        [AC-066] real Pi session over the Core gateway (provider deepseek-flash): streaming text_delta=1 thinking_delta=0 first="PONG-AC066" last="PONG-AC066"; session file 5 → 7 record(s); resumed with a new factory… live: wrote drill report to /var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-acceptance-drills-S5G5Z6/live.mjs.json live: 7 passed / 0 failed / 0 unverified; 13 call(s), HTTP 200/200/200/200/200/200/200/200/200/200/200/200/200, 50787ms total, 0 failed |
| 演练报告 `pnpm test:e2e（本次运行，nonce 115e30f0…，绑定 sha256:29db434749e9…）` | - | 已并入聚合（绑定已校验） | - |
| 演练报告 `pnpm test:live（本次运行，nonce 115e30f0…，绑定 sha256:29db434749e9…）` | - | 已并入聚合（绑定已校验） | - |

## 2. 每 AC 结果

| AC | 标题 | 状态 | 映射 | 已执行证据（文件 :: 用例） | 备注 / 未验证原因 |
|---|---|---|---|---|---|
| AC-001 | 自由问答 | **PASS** | none | — | 演练 pnpm test:e2e：UNVERIFIED；演练 pnpm test:live：PASS |
| AC-002 | HTML说明 | **PASS** | test-name | packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) versions agent artifacts and keeps the old bytes readable (AC-002), packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) invalidates an artifact once and keeps the reason (AC-002), packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) truncates oversized previews and keeps the download path (AC-002) …(+4) | 演练 pnpm test:e2e：PASS |
| AC-003 | 按需委派 | **PASS** | test-name | packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) produces an agent explanation artifact for a delegated analysis Run (AC-003), apps/daemon/test/assessment-dispatch.integration.test.ts :: message → Chief → DispatchSpec → Requirement → Run → stage result (WP-12 T2) runs the whole path from one message with no seeded row (AC-003/AC-005/AC-069), apps/daemon/test/attempt.integration.test.ts :: a real Attempt through the daemon-side execution path forwards a Provider tool call to a real Pi session and round-trips its result (AC-003) | 演练 pnpm test:e2e：PASS；演练 pnpm test:live：PASS |
| AC-004 | 执行授权边界 | **PASS** | curated | packages/domain/test/domain.test.ts :: level routing (workflow.md §2) routes assist and artifact to none, apps/daemon/test/server.test.ts :: daemon HTTP surface (WP-03) keeps questions, advice and statements read-only end to end | — |
| AC-005 | 明确启动 | **PASS** | test-name | packages/domain/test/domain.test.ts :: level routing (workflow.md §2) routes a message into independent work items (AC-005/AC-006), packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) records the authority an explicit message grants (AC-005), apps/daemon/test/assessment-dispatch.integration.test.ts :: message → Chief → DispatchSpec → Requirement → Run → stage result (WP-12 T2) runs the whole path from one message with no seeded row (AC-003/AC-005/AC-069) …(+1) | 演练 pnpm test:e2e：PASS；演练 pnpm test:live：PASS |
| AC-006 | 混合意图 | **PASS** | test-name | packages/domain/test/domain.test.ts :: level routing (workflow.md §2) routes a message into independent work items (AC-005/AC-006), packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) splits one mixed message into the work items it names (AC-006) | — |
| AC-007 | L1错字 | **PASS** | test-name | packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) accepts an explicit typo change inside the L1 bounds (AC-007), packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) never downgrades a one-character permission change by its line count (AC-008), packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) is L2 when the diff exceeds the L1 bounds or changes logic (AC-009) …(+18) | 演练 pnpm test:live：PASS |
| AC-008 | 一字语义 | **PASS** | test-name | packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) accepts an explicit typo change inside the L1 bounds (AC-007), packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) never downgrades a one-character permission change by its line count (AC-008), packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) is L2 when the diff exceeds the L1 bounds or changes logic (AC-009) …(+6) | — |
| AC-009 | L1升级 | **PASS** | test-name | packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) accepts an explicit typo change inside the L1 bounds (AC-007), packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) never downgrades a one-character permission change by its line count (AC-008), packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) is L2 when the diff exceeds the L1 bounds or changes logic (AC-009) …(+21) | — |
| AC-010 | 标准交付 | **PASS** | test-name | packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) fixes the stage order per route and level (AC-010/AC-012), packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) accepts a complete L2 chain and rejects a missing stage (AC-010), packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) requires each stage to depend on the previous one (AC-010) …(+9) | 演练 pnpm test:e2e：PASS；演练 pnpm test:live：PASS |
| AC-011 | 高风险交付 | **PASS** | test-name | packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) fixes the stage order per route and level (AC-010/AC-012), packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) accepts a complete L2 chain and rejects a missing stage (AC-010), packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) requires each stage to depend on the previous one (AC-010) …(+6) | — |
| AC-012 | 正式结论 | **PASS** | test-name | packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) fixes the stage order per route and level (AC-010/AC-012), packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) accepts a complete L2 chain and rejects a missing stage (AC-010), packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) requires each stage to depend on the previous one (AC-010) …(+11) | — |
| AC-013 | 无效Plan | **PASS** | test-name | packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses a write without an approved Plan and leaves the source hash unchanged (AC-013), packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses a Plan for another revision and a changed Plan hash (AC-013 required failure test), packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) admits the write when the Plan is approved for the current revision (AC-014) …(+26) | — |
| AC-014 | 范围内自动Plan | **PASS** | test-name | packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses a write without an approved Plan and leaves the source hash unchanged (AC-013), packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses a Plan for another revision and a changed Plan hash (AC-013 required failure test), packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) admits the write when the Plan is approved for the current revision (AC-014) …(+20) | — |
| AC-015 | 产品变化 | **PASS** | test-name | packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) handling now needs a new Product/Plan and invalidates affected evidence (AC-015), packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) queues a Requirement for later and leaves the acceptance alone (AC-016), packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) declining records a reason and changes nothing (AC-016) …(+7) | — |
| AC-016 | 以后或拒绝 | **PASS** | test-name | packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) handling now needs a new Product/Plan and invalidates affected evidence (AC-015), packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) queues a Requirement for later and leaves the acceptance alone (AC-016), packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) declining records a reason and changes nothing (AC-016) …(+7) | — |
| AC-017 | 自动返工 | **PASS** | test-name | packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) returns work to development without a human forwarding step (AC-017), packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) invalidates the old Review/Test after a fix and refuses self-verification (AC-017/AC-018), packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) binds the verification to the fixing revision and the real Test conclusion (AC-018, W6R1-01/W6R1-08) …(+48) | — |
| AC-018 | Finding关闭 | **PASS** | test-name | packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) returns work to development without a human forwarding step (AC-017), packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) invalidates the old Review/Test after a fix and refuses self-verification (AC-017/AC-018), packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) binds the verification to the fixing revision and the real Test conclusion (AC-018, W6R1-01/W6R1-08) …(+11) | — |
| AC-019 | 未覆盖验证 | **PASS** | test-name | packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) returns work to development without a human forwarding step (AC-017), packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) invalidates the old Review/Test after a fix and refuses self-verification (AC-017/AC-018), packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) binds the verification to the fixing revision and the real Test conclusion (AC-018, W6R1-01/W6R1-08) …(+23) | — |
| AC-020 | 暂停恢复 | **PASS** | test-name | packages/domain/test/delivery.test.ts :: the shared write barrier (AC-020/AC-021, W6R2-07/W6R3-02) admits writes only while the Work is running, packages/domain/test/delivery.test.ts :: the shared write barrier (AC-020/AC-021, W6R2-07/W6R3-02) never lets a caller expectation replace the approved source hash (W6R2-02), packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) pauses at a safe point, admits no write, and resumes into a new Attempt after the version check (AC-020) …(+11) | — |
| AC-021 | 取消需求 | **PASS** | test-name | packages/domain/test/delivery.test.ts :: the shared write barrier (AC-020/AC-021, W6R2-07/W6R3-02) admits writes only while the Work is running, packages/domain/test/delivery.test.ts :: the shared write barrier (AC-020/AC-021, W6R2-07/W6R3-02) never lets a caller expectation replace the approved source hash (W6R2-02), packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) binds a task-less integration Finding and sends it straight back to development (AC-083, AC-017) …(+47) | — |
| AC-022 | 预算止损 | **PASS** | test-name | packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses an over-used budget instead of assuming a zero usage (AC-022, W6R1-03), packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) closes through evaluateFindingClosure and stops at the rework allowance (AC-017/AC-022), packages/domain/test/delivery.test.ts :: budget reservation (AC-022) refuses an over-limit reservation atomically with no partial charge (AC-022) …(+6) | — |
| AC-023 | 无注册多项目 | **PASS** | test-name | apps/daemon/test/project-lifecycle.integration.test.ts :: installation project directory (WP-12 T5.1/T5.2) opens two real roots with independent ids, databases and registries (AC-023), apps/web/test/multi-project.integration.test.ts :: single-entry multi-project BFF (WP-12 T5.5) renders each project page from its own daemon and never from the other (AC-023/AC-034), packages/core/test/identity.integration.test.ts :: independent projects (AC-023) gives two real roots distinct ids and independent databases | — |
| AC-024 | 路径识别 | **PASS** | test-name | packages/core/test/identity.integration.test.ts :: canonical roots (AC-024) normalizes a subdirectory to the repository root, packages/core/test/identity.integration.test.ts :: canonical roots (AC-024) normalizes a trailing separator and a symlinked path, packages/core/test/identity.integration.test.ts :: canonical roots (AC-024) finds the git root from a deep directory and reports no git root outside one …(+5) | — |
| AC-025 | 空项目 | **PASS** | test-name | packages/workspace/test/initialize.test.ts :: empty project (AC-025) creates the initial Git and delivery branch, then confirms an unimplemented project, apps/daemon/test/project-lifecycle.integration.test.ts :: installation project directory (WP-12 T5.1/T5.2) creates a project in an empty directory with Git, the delivery branch and the events (AC-025) | — |
| AC-026 | 旧项目初始化 | **PASS** | test-name | apps/daemon/test/project-initialization.integration.test.ts :: project.initialize over the real state machine (WP-12 T5.3) investigates a legacy project and reaches Ready without moving the code (AC-026), packages/workspace/test/scan.test.ts :: scanProject budgets stops at 40 body files and reports a partial map with explicit unknowns, packages/workspace/test/scan.test.ts :: scanProject budgets stops before exceeding 512 KiB of body content …(+4) | — |
| AC-027 | 目录项目 | **PASS** | test-name | apps/daemon/test/project-initialization.integration.test.ts :: project.initialize over the real state machine (WP-12 T5.3) never silently re-initializes an existing repository from a bare new-mode request (AC-027), apps/daemon/test/project-initialization.integration.test.ts :: initialize driver blockers (WP-12 T5.3) refuses to run git init without the explicit mode and reports the request (AC-027), packages/workspace/test/initialize.test.ts :: no-Git directory returns Blocked with the Git-initialization authorization request …(+1) | — |
| AC-028 | 脏工作区 | **PASS** | test-name | apps/daemon/test/project-initialization.integration.test.ts :: project.initialize over the real state machine (WP-12 T5.3) blocks a dirty workspace with a per-path hash report and keeps investigation working (AC-028), packages/workspace/test/initialize.test.ts :: dirty workspace blocks delivery start with a hash report while read-only investigation still works | — |
| AC-029 | 初始化冲突中断 | **PASS** | test-name | apps/daemon/test/project-initialization.integration.test.ts :: project.initialize over the real state machine (WP-12 T5.3) stops on a workspace it must not overwrite and reports the real per-path hashes (AC-029), packages/core/test/wp08.integration.test.ts :: WP-08 T4 end-to-end integration drill runs the initialization route: interrupted writing resumes by hash and a conflict is never overwritten (AC-029) | — |
| AC-030 | Chief选上下文 | **PASS** | test-name | packages/core/test/context-builder.test.ts :: buildContext — happy path (AC-030) freezes the documented fields and copies the content into the snapshot directory, packages/core/test/context-builder.test.ts :: buildContext — happy path (AC-030) accounts tokens with the documented character/4 estimator by default, packages/core/test/context-builder.test.ts :: buildContext — happy path (AC-030) resolves an artifact id@version through the fetch port …(+8) | — |
| AC-031 | 缺上下文 | **PASS** | test-name | packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) returns MISSING_CONTEXT with the precise gap and no frozen snapshot, packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) does not expand a module to satisfy a gap, packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) does not let an asserted artifact-backed input satisfy the table (W5R2-04) …(+5) | — |
| AC-032 | 追加读取 | **PASS** | test-name | packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) appends a reasoned read with its full identity and accounts its tokens, packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) allocates seq 1..n in append order and never reuses a number, packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) inherits the Run revision and lets one read override it …(+22) | 演练 pnpm test:e2e：PASS |
| AC-033 | 独立审核 | **PASS** | test-name | packages/core/test/context-acl.test.ts :: context ACL — transcript isolation (AC-033) denies the transcript kind to every role and stage, packages/core/test/context-acl.test.ts :: context ACL — transcript isolation (AC-033) denies Review and Test every message body, packages/core/test/context-acl.test.ts :: context ACL — transcript isolation (AC-033) denies a chat/transcript path marker to every role by path …(+20) | — |
| AC-034 | 跨项目隔离 | **PASS** | test-name | packages/core/test/context-acl.test.ts :: context ACL — cross-project isolation (AC-034) denies a source that belongs to another Project, packages/core/test/context-acl.test.ts :: context ACL — cross-project isolation (AC-034) denies another Project source whatever the source class, packages/core/test/context-acl.test.ts :: context ACL — cross-project isolation (AC-034) accepts a source of the same Project …(+14) | — |
| AC-035 | 会话轮换 | **PASS** | test-name | packages/core/test/context-checkpoint.test.ts :: checkpoint: session rotation (AC-035) recovers role/task/permissions/sources and keeps the approval state, packages/core/test/context-checkpoint.test.ts :: checkpoint: session rotation (AC-035) leaves the stored session unchanged when there is no checkpoint to rotate (W5R1-08), packages/core/test/context-checkpoint.test.ts :: checkpoint: session rotation (AC-035) does not let a staleness/rotation of the message list touch the approval …(+2) | — |
| AC-036 | 预算不足 | **PASS** | test-name | packages/core/test/context-builder.test.ts :: buildContext — selection validation (AC-030) refuses a budget outside the documented 4096–2000000 range (AC-036), packages/core/test/context-builder.test.ts :: buildContext — budget (AC-036) reports BUDGET_EXCEEDED with the dropped ref and the missing tokens, packages/core/test/context-builder.test.ts :: buildContext — budget (AC-036) drops an optional source instead of the whole package and names it …(+16) | — |
| AC-037 | 当前功能 | **PASS** | test-name | packages/knowledge/test/projection.test.ts :: projection build renders a feature body that parses back to the same facts (AC-037), packages/knowledge/test/projection.test.ts :: projection build never injects an unrelated document into the feature body or index (AC-037), packages/knowledge/test/views.test.ts :: knowledge views separates confirmed intent from delivered reality (AC-038, AC-037) …(+11) | 演练 pnpm test:e2e：PASS；演练 pnpm test:live：PASS |
| AC-038 | 状态分离 | **PASS** | test-name | packages/knowledge/test/views.test.ts :: knowledge views separates confirmed intent from delivered reality (AC-038, AC-037), packages/knowledge/test/views.test.ts :: knowledge views keeps a Work overlay out of the delivered answer and out of another Work (AC-038) | 演练 pnpm test:e2e：PASS |
| AC-039 | 语义关系 | **PASS** | test-name | packages/core/test/context-cold-start.test.ts :: cold start: selection order and reasons (AC-039) follows overview → current work → navigation → constraints → bodies, with a reason each, packages/core/test/context-cold-start.test.ts :: cold start: selection order and reasons (AC-039) is deterministic: the same query selects the same entries in the same order | — |
| AC-040 | 非法知识 | **PASS** | test-name | packages/knowledge/test/projection.test.ts :: projection build keeps the last valid projection, marks it stale and reports KNOWLEDGE_INVALID (AC-040), packages/knowledge/test/projection.test.ts :: projection build republishes and clears stale after a valid document follows an invalid one (AC-040), packages/knowledge/test/projection.test.ts :: broken-link diagnostics in a projection (AC-040) gates delivery for the current requirement only when the requirement touches the feature …(+1) | — |
| AC-041 | 知识结算 | **PASS** | test-name | packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) integrates B-on-A without re-applying the ancestor and settles the Requirement, packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) refuses a Task without a frozen manifest and writes nothing, packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) refuses a real merge conflict and leaves the delivery ref and the manifest untouched …(+9) | 演练 pnpm test:e2e：PASS；演练 pnpm test:live：PASS |
| AC-042 | 观察与意图 | **PASS** | test-name | packages/knowledge/test/views.test.ts :: knowledge views lists observed-versus-confirmed gaps without accepting observed behaviour (AC-042), packages/workspace/test/initialize.test.ts :: design/code conflict (AC-042) blocks Confirming, never confirms the existing document and keeps candidates observed, packages/workspace/test/scan.test.ts :: candidate knowledge reports an existing document that disagrees with the observed tree (AC-042) | — |
| AC-043 | 独立模型 | **PASS** | test-name | packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) inherits run → project → global role → global default in order, packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) blocks a role whose model is missing or unsupported instead of downgrading, packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) freezes a profile into an immutable snapshot and keeps it stable …(+15) | 演练 pnpm test:live：PASS |
| AC-044 | 配置冻结 | **PASS** | test-name | packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) inherits run → project → global role → global default in order, packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) blocks a role whose model is missing or unsupported instead of downgrading, packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) freezes a profile into an immutable snapshot and keeps it stable …(+74) | — |
| AC-045 | 主控分派 | **PASS** | test-name | packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) runs through the frozen profile of the Run, packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) runs against a Provider that needs no secret (T-01), packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) refuses to admit a Run whose secret cannot be resolved (R18-05) …(+68) | 演练 pnpm test:e2e：PASS |
| AC-046 | Join和失败 | **PASS** | test-name | packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) holds the parent in waiting_children and keeps every sibling result, packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) refuses a new child once the parent Chief Run has ended (N-04, N-05), packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) does not hold the parent for joinPolicy=none, but still pages the Chief …(+12) | — |
| AC-047 | 结构化交付 | **PASS** | test-name | packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) holds the parent in waiting_children and keeps every sibling result, packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) refuses a new child once the parent Chief Run has ended (N-04, N-05), packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) does not hold the parent for joinPolicy=none, but still pages the Chief …(+12) | — |
| AC-048 | Workspace边界 | **PASS** | test-name | packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) admits a read and records the tool operation and the audit event (AC-048), packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses an out-of-scope target with no execution and records the refusal (AC-048), packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses an operation the Grant does not cover (AC-048) …(+71) | 演练 pnpm test:e2e：PASS |
| AC-049 | Autonomous范围 | **PASS** | test-name | packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) admits the exact once binding and reports no replay for a first use, packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) replays a consumed once grant for the same operation and input (AC-080), packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) binds a replay to the full operation/role/stage triple, not just the run (W7R1-06) …(+72) | — |
| AC-050 | Full Access门禁 | **PASS** | test-name | packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) admits a read and records the tool operation and the audit event (AC-048), packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses an out-of-scope target with no execution and records the refusal (AC-048), packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses an operation the Grant does not cover (AC-048) …(+70) | 演练 pnpm test:e2e：PASS |
| AC-051 | Secret隔离 | **PASS** | test-name | packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) resolves a registered ref for the authorized Grantholder (AC-051), packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) refuses an unknown ref with NOT_FOUND for an authorized ref shape (AC-051), packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) refuses an unauthorized caller without disclosing whether the ref exists (AC-051) …(+39) | — |
| AC-052 | HTML安全 | **PASS** | test-name | packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) carries the isolation policy on every preview (AC-052), apps/daemon/test/server.test.ts :: daemon HTTP surface (WP-03) serves a preview of a hostile document under the same isolation (AC-052) | 演练 pnpm test:e2e：PASS |
| AC-053 | 信任与资源 | **PASS** | test-name | packages/pi-runtime/test/trust.test.ts :: untrusted repository (AC-053) never imports, reads or activates a repository resource and reports every skip, packages/pi-runtime/test/trust.test.ts :: untrusted repository (AC-053) still activates the shipped release whitelist, which is not repository content, packages/pi-runtime/test/trust.test.ts :: trusted repository (AC-053) imports a selected, whitelisted repository extension only after trust …(+22) | — |
| AC-054 | UI断开 | **PASS** | test-name | packages/client/test/commands.test.ts :: AC-054 reconnect and bounded backoff reconnects on the documented schedule and replays the hello, packages/client/test/commands.test.ts :: AC-054 reconnect and bounded backoff applies bounded exponential backoff while every reconnect fails, packages/client/test/commands.test.ts :: AC-054 reconnect and bounded backoff reports the attempt number while reconnecting and ends at the limit …(+2) | 演练 pnpm test:e2e：PASS |
| AC-055 | 幂等接受 | **PASS** | test-name | packages/client/test/commands.test.ts :: AC-055 write retry with the same idempotency key replays a write whose answer was lost and reports the replay, packages/client/test/commands.test.ts :: AC-055 write retry with the same idempotency key queues a write that never reached the wire and replays it after reconnect, packages/client/test/commands.test.ts :: AC-055 write retry with the same idempotency key retries a BUSY write with backoff and the same key …(+10) | — |
| AC-056 | Mailbox非阻塞 | **PASS** | test-name | packages/core/test/mailbox.test.ts :: ProjectMailbox answers a new command while a long effect is still running (AC-056), packages/core/test/dispatcher.integration.test.ts :: long operations do not block commands (AC-056) answers a command within a second while a model call is in flight | — |
| AC-057 | Runner失联 | **PASS** | test-name | packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) withholds a new Attempt while the old execution is unconfirmed (W8R1-04), packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) binds a resume decision to its own Run, not to the whole Work (W8R2-03), packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) keeps a Run-bound resume decision past a window of unrelated decisions (W8R3-04) …(+18) | 演练 pnpm test:e2e：PASS；演练 pnpm test:live：PASS |
| AC-058 | 过期结果 | **PASS** | test-name | packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) withholds a new Attempt while the old execution is unconfirmed (W8R1-04), packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) binds a resume decision to its own Run, not to the whole Work (W8R2-03), packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) keeps a Run-bound resume decision past a window of unrelated decisions (W8R3-04) …(+18) | — |
| AC-059 | 背压 | **PASS** | test-name | packages/core/test/events-hub.integration.test.ts :: connection back-pressure (AC-059) coalesces transient frames once the soft limit is crossed, packages/core/test/events-hub.integration.test.ts :: connection back-pressure (AC-059) closes the connection at the hard limit without dropping durable events, packages/core/test/events-hub.integration.test.ts :: connection back-pressure (AC-059) keeps default limits at the documented 2 MiB / 8 MiB | — |
| AC-060 | 范围订阅 | **PASS** | test-name | apps/web/test/multi-project.integration.test.ts :: single-entry multi-project BFF (WP-12 T5.5) binds the event socket to one project and never replays another project cursor (AC-034/AC-060), packages/core/test/events-hub.integration.test.ts :: scope change (AC-060) answers a fresh snapshot at a new watermark and covers later events, packages/core/test/events-hub.integration.test.ts :: scope change (AC-060) reports an empty batch with its scan watermark …(+5) | 演练 pnpm test:e2e：PASS |
| AC-061 | 启动恢复 | **PASS** | test-name | packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) withholds a new Attempt while the old execution is unconfirmed (W8R1-04), packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) binds a resume decision to its own Run, not to the whole Work (W8R2-03), packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) keeps a Run-bound resume decision past a window of unrelated decisions (W8R3-04) …(+18) | — |
| AC-062 | 集成冲突 | **PASS** | test-name | packages/core/test/wp08-failures.test.ts :: required WP-08 failure tests Task 合并冲突: two passed Tasks conflict, the repair Task is independent and CAS protects HEAD (AC-062), packages/core/test/wp08-failures.test.ts :: required WP-08 failure tests T-01: the repair revision converges and is what the final manifest records (AC-062), packages/workspace/test/cas.integration.test.ts :: dependency lineage with real revisions (AC-081) produces an independent repair task when two passed Tasks conflict (AC-062) …(+3) | — |
| AC-063 | 部分结算 | **PASS** | test-name | packages/core/test/wp08-failures.test.ts :: required WP-08 failure tests ref 后崩溃: the restart reuses the commit, completes the state and emits one event (AC-063), packages/core/test/settlement.integration.test.ts :: Crash after the ref update: reuse the commit, complete once (AC-063) runs the whole settlement path: freeze, CAS and complete once, packages/core/test/settlement.integration.test.ts :: Crash after the ref update: reuse the commit, complete once (AC-063) takes the shared integration lock and refuses while a requirement save holds it (W8R2-02) …(+3) | — |
| AC-064 | 备份恢复 | **PASS** | test-name | packages/core/test/wp08-failures.test.ts :: required WP-08 failure tests 备份演练: backup → restore keeps hashes/knowledge/evidence and blocks a missing Secret (AC-064), apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) backs up and restores the real database through the protocol (AC-064 surface), packages/core/test/backup.integration.test.ts :: Backup, restore and relocate (AC-064) restores a backup into a new directory with consistent hashes, knowledge and evidence …(+5) | 演练 pnpm test:e2e：PASS |
| AC-065 | Migration | **PASS** | curated | packages/storage/test/migrations.integration.test.ts :: migrations backs up before pending work and writes a usable copy, packages/storage/test/migrations.integration.test.ts :: migrations rolls a failed migration back and reports its version, packages/storage/test/migrations.integration.test.ts :: migrations stops on a checksum mismatch instead of starting …(+3) | — |
| AC-066 | SDK契约 | **PASS** | curated | packages/pi-runtime/test/session.integration.test.ts :: Pi session lifecycle creates a session with the configured model and no network, packages/pi-runtime/test/events.test.ts :: SDK event mapping maps assistant text and thinking deltas, packages/pi-runtime/test/events.test.ts :: SDK event mapping maps tool execution boundaries …(+4) | 演练 pnpm test:live：PASS |
| AC-067 | 扩展故障 | **PASS** | curated | packages/pi-runtime/test/extensions.test.ts :: extension activation rejects an id the release does not ship, packages/pi-runtime/test/extensions.test.ts :: extension activation blocks startup when a critical capability fails, packages/pi-runtime/test/extensions.test.ts :: extension activation disables only the failing optional extension …(+2) | — |
| AC-068 | 看板身份 | **PASS** | test-name | apps/web/test/pages.test.ts :: board page offers a direct cancel and a refused pause for Queued without Work (AC-068), apps/web/test/views.test.ts :: board projection (AC-068) keeps one identity per requirement, in the documented four columns, apps/web/test/views.test.ts :: board projection (AC-068) reports the pause refusal for a Queued requirement without local Work …(+15) | 演练 pnpm test:e2e：PASS |
| AC-069 | 持续对话 | **PASS** | test-name | apps/web/test/views.test.ts :: run status honesty (AC-069/AC-070) treats only a completed Run as a success, apps/web/test/views.test.ts :: run status honesty (AC-069/AC-070) separates direct/L1 work from board work in the Runs page, apps/daemon/test/assessment-dispatch.integration.test.ts :: message → Chief → DispatchSpec → Requirement → Run → stage result (WP-12 T2) runs the whole path from one message with no seeded row (AC-003/AC-005/AC-069) …(+6) | 演练 pnpm test:e2e：PASS；演练 pnpm test:live：PASS |
| AC-070 | 产物版本 | **PASS** | test-name | apps/web/test/views.test.ts :: requirement detail (AC-070) marks the plan card expired when the shown version is not the current one, apps/web/test/views.test.ts :: requirement detail (AC-070) keeps a current plan card approvable, apps/web/test/views.test.ts :: requirement detail (AC-070) carries artifact version and validity without presenting history as current …(+14) | 演练 pnpm test:e2e：PASS |
| AC-071 | Live布局 | **PASS** | test-name | apps/web/test/client-script.test.ts :: interface language switching (WP-12 T4) returns focus to the Live restore control when the overlay closes (AC-071), apps/web/test/pages.test.ts :: shared shell carries the panel mode on the shell so the top bar restores it (AC-071), apps/web/test/pages.test.ts :: shared shell keeps the restore control before the panel contents in the tab order (AC-071) …(+2) | 演练 pnpm test:e2e：PASS |
| AC-072 | Conversation归属 | **PASS** | test-name | apps/web/test/pages.test.ts :: shared shell offers no conversation create/switch control outside Chief (AC-072), apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) shares the panel mode across pages and keeps Chief-only controls off other pages (AC-071/AC-072), apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) walks login → board → detail → approve → event in one headless flow (AC-068–AC-072) …(+1) | 演练 pnpm test:e2e：PASS |
| AC-073 | 语言可访问 | **PASS** | test-name | apps/web/test/pages.test.ts :: shared shell exposes a language switch that only touches the interface dictionary (AC-073), apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) translates only the interface strings and leaves project content untouched (AC-073), apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) answers a page request with the language the browser asked for (AC-073) …(+1) | 演练 pnpm test:e2e：PASS |
| AC-074 | Inbox去重 | **PASS** | test-name | apps/web/test/client-script.test.ts :: inbox actions (WP-12 T4c, AC-074) routes a saved decision choice through decision.resolve, apps/web/test/client-script.test.ts :: inbox actions (WP-12 T4c, AC-074) routes approve and deny through permission.respond, apps/web/test/client-script.test.ts :: inbox actions (WP-12 T4c, AC-074) refuses a denial with no recorded reason before any request …(+30) | 演练 pnpm test:e2e：PASS |
| AC-075 | 配置错误 | **PASS** | test-name | apps/web/test/pages.test.ts :: settings page (AC-075) renders the active revision, the editor and the test control, apps/web/test/pages.test.ts :: settings page (AC-075) gives every provider row a real editor with a never-pre-filled password field (WP-12 T1.2B), apps/web/test/pages.test.ts :: settings page (AC-075) never renders a provider secret value, even for post-save state (WP-12 T1.2B) …(+7) | 演练 pnpm test:e2e：PASS |
| AC-076 | 附件限制 | **PASS** | test-name | apps/web/test/views.test.ts :: attachment limits (AC-076) accepts a documented set, apps/web/test/views.test.ts :: attachment limits (AC-076) refuses more than five attachments, apps/web/test/views.test.ts :: attachment limits (AC-076) refuses one file over 20 MiB and a total over 50 MiB …(+6) | 演练 pnpm test:e2e：PASS |
| AC-077 | 文件只读 | **PASS** | test-name | apps/web/test/pages.test.ts :: files page (AC-077) shows the branch, the target revision and the read-only boundary, apps/web/test/pages.test.ts :: files page (AC-077) renders a refused path as an error with its code, not an empty tree, apps/web/test/views.test.ts :: file boundary (AC-077) resolves a nested relative path inside the root …(+6) | 演练 pnpm test:e2e：PASS |
| AC-078 | 认证生命周期 | **PASS** | test-name | apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) accepts a read through the BFF cookie and forwards the daemon session, apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) refuses an unauthenticated write with UNAUTHENTICATED and does not forward it, apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) refuses a wrong-Origin write with NOT_AUTHORIZED while reads stay allowed …(+29) | 演练 pnpm test:e2e：PASS |
| AC-079 | 初始阶段上下文 | **PASS** | test-name | packages/core/test/context-acl.test.ts :: context ACL — future artifacts (AC-079) denies a future artifact class to an earlier stage, packages/core/test/context-acl.test.ts :: context ACL — future artifacts (AC-079) denies review/test artifacts to a Developer, packages/core/test/context-acl.test.ts :: context ACL — future artifacts (AC-079) keeps a plan readable to Review and Test but not a settlement report …(+28) | — |
| AC-080 | 授权精确绑定 | **PASS** | test-name | packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) admits the exact once binding and reports no replay for a first use, packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) replays a consumed once grant for the same operation and input (AC-080), packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) binds a replay to the full operation/role/stage triple, not just the run (W7R1-06) …(+71) | — |
| AC-081 | Task依赖输入 | **PASS** | test-name | packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) integrates B-on-A without re-applying the ancestor and settles the Requirement, packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) refuses a Task without a frozen manifest and writes nothing, packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) refuses a real merge conflict and leaves the delivery ref and the manifest untouched …(+9) | — |
| AC-082 | 重启保留窄范围 | **PASS** | test-name | packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) records an immutable assessment with the routing evidence, packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) applies the documented routing floor from the payload alone (R9-01, DC-62), packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) fails closed on unknown risk flags and on authorization provenance (R10-01/R10-02) …(+78) | — |
| AC-083 | 组合及文档Finding | **PASS** | test-name | packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) returns work to development without a human forwarding step (AC-017), packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) invalidates the old Review/Test after a fix and refuses self-verification (AC-017/AC-018), packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) binds the verification to the fixing revision and the real Test conclusion (AC-018, W6R1-01/W6R1-08) …(+50) | — |
| AC-084 | 首条消息附件 | **PASS** | test-name | packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) stages an upload with a 24h TTL and binds it once (AC-084), packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) sends a message, creates its assist Work and binds uploads atomically (AC-084), apps/daemon/test/server.test.ts :: daemon HTTP surface (WP-03) refuses unauthenticated requests (AC-084) …(+6) | 演练 pnpm test:e2e：PASS |
| AC-085 | 证据读取封口 | **PASS** | test-name | packages/core/test/context-ledger.test.ts :: read ledger — seal and stale binding (AC-085) seals the ordered entries and refuses every later append, packages/core/test/context-ledger.test.ts :: read ledger — seal and stale binding (AC-085) re-sealing is idempotent, packages/core/test/context-ledger.test.ts :: read ledger — seal and stale binding (AC-085) verifies the correct binding and rejects an older seq or a different hash …(+19) | — |
| AC-086 | 功能状态证据 | **PASS** | curated | packages/knowledge/test/feature-format.test.ts :: parseFeatureDocument parses a complete document with real-valued fields, packages/knowledge/test/feature-format.test.ts :: parseFeatureDocument rejects design=confirmed without one resolvable decision reference, packages/knowledge/test/feature-format.test.ts :: parseFeatureDocument rejects verification=passed without evidence references …(+4) | — |
| AC-087 | 需求池随Git迁移 | **PASS** | test-name | apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) keeps an imported requirement identity and its evidence availability honest (AC-087/AC-088/AC-089), apps/daemon/test/requirement-import.integration.test.ts :: first-open requirement import from the delivery revision (WP-12 T5.4) restores every lifecycle from a real clone with an empty database (AC-087/AC-088/AC-089), apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack reads all nine surfaces from real state in one drill (AC-068–AC-078, AC-084, AC-087–AC-090, AC-093) …(+1) | — |
| AC-088 | 历史需求展示 | **PASS** | test-name | packages/knowledge/test/requirements-pool.test.ts :: imported history (AC-088) keeps completion, cancellation and pre-archive state without migrating evidence, apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) keeps an imported requirement identity and its evidence availability honest (AC-087/AC-088/AC-089), apps/daemon/test/requirement-import.integration.test.ts :: first-open requirement import from the delivery revision (WP-12 T5.4) restores every lifecycle from a real clone with an empty database (AC-087/AC-088/AC-089) | — |
| AC-089 | 进行中需求继续 | **PASS** | test-name | apps/web/test/pages.test.ts :: board page offers Continue only for a record that waits to continue (AC-089), packages/core/test/requirement-continue.test.ts :: Requirement continuation (AC-089) lists an imported active Requirement as waiting to continue without starting a Run (AC-089), packages/core/test/requirement-continue.test.ts :: Requirement continuation (AC-089) continues into a new local Work with a recorded authorization and the unmet Gates (AC-089) …(+14) | — |
| AC-090 | 需求保存时机 | **PASS** | test-name | apps/web/test/pages.test.ts :: board page renders the branch, commit and push state and offers the lifecycle actions (AC-090), apps/web/test/pages.test.ts :: requirement detail page renders the delivery branch, commit, push state and the card actions (AC-090), apps/web/test/pages.test.ts :: requirement detail page says the push state is unreported when the read payload carries none (AC-090) …(+15) | 演练 pnpm test:e2e：PASS |
| AC-091 | 需求保存崩溃与交付竞争 | **PASS** | test-name | packages/core/test/requirement-save.test.ts :: completion/settlement consistency (AC-091) accepts a completion record that binds the Settlement revision, tree and manifests, packages/core/test/requirement-save.test.ts :: completion/settlement consistency (AC-091) refuses a completion record whose code revision is not the final revision, packages/core/test/requirement-save.test.ts :: completion/settlement consistency (AC-091) refuses a Settlement that verified a different code tree …(+12) | — |
| AC-092 | 需求导入冲突与幂等 | **PASS** | test-name | apps/daemon/test/requirement-import.integration.test.ts :: first-open requirement import from the delivery revision (WP-12 T5.4) keeps valid records visible next to a broken one and reports the conflict (AC-092 surface), packages/knowledge/test/requirements-pool.test.ts :: importRequirementPool imports a pool, is idempotent, and keeps local and record versions apart, packages/knowledge/test/requirements-pool.test.ts :: parseRequirementPool keeps valid records visible next to a broken one and never rewrites the files …(+5) | — |
| AC-093 | 需求目录与正文一致性 | **PASS** | test-name | packages/core/test/context-builder.test.ts :: buildContext — excluded and unknown refs (AC-093) records a reference that does not exist and never expands it, packages/core/test/context-builder.test.ts :: buildContext — excluded and unknown refs (AC-093) keeps the selection’s own excluded and unknowns verbatim, packages/core/test/requirement-save.test.ts :: prepareRequirementSave (AC-093) builds both files with one version and the documented combined record hash …(+18) | 演练 pnpm test:e2e：PASS |
| AC-094 | 需求正文保存与并发 | **PASS** | test-name | packages/workspace/test/cas.integration.test.ts :: CAS integration against a real Git repository (AC-094) creates the commit with the requirement pool files and moves the branch once, packages/workspace/test/cas.integration.test.ts :: CAS integration against a real Git repository (AC-094) refuses a stale writer with VERSION_CONFLICT and leaves the branch untouched, packages/workspace/test/cas.integration.test.ts :: CAS integration against a real Git repository (AC-094) re-uses the commit after a crash between the commit and the status write …(+12) | — |

## 3. 已登记豁免（ACCEPTED）明细

无：本次没有任何 AC 依赖已登记豁免。

## 4. 未登记的未验证项（fail-closed）

无：每个 UNVERIFIED/MISSING 都在登记表中且条件成立。

## 5. FAIL 明细

无。

## 6. 映射与证据审计

### 6.1 映射来源统计

| 映射来源 | AC 数 | 含义 |
|---|---|---|
| test-name | 88 | 用例名（含 describe 链）直接含 AC 编号，逐用例绑定 |
| curated | 5 | 人工登记到具体用例（文件 :: 用例名），逐条解析，缺一条即 FAIL |
| none | 1 | 无提交测试证据，依赖演练或已登记豁免 |

### 6.2 人工映射解析结果（必须全部 resolved，且无 stale）

| AC | 条目数 | 采用映射 | 全部条目已解析 | 过期条目 |
|---|---|---|---|---|
| AC-004 | 2 | curated | 是 | 0 |
| AC-011 | 3 | test-name | 是 | 0 |
| AC-026 | 6 | test-name | 是 | 0 |
| AC-027 | 2 | test-name | 是 | 0 |
| AC-028 | 1 | test-name | 是 | 0 |
| AC-065 | 6 | curated | 是 | 0 |
| AC-066 | 7 | curated | 是 | 0 |
| AC-067 | 5 | curated | 是 | 0 |
| AC-086 | 7 | curated | 是 | 0 |
| AC-094 | 5 | test-name | 是 | 0 |
| AC-092 | 7 | test-name | 是 | 0 |

人工条目对**每个**登记 AC 都校验（即使该 AC 由用例名映射命中）：任一条目解析不到已执行用例即为 FAIL，不存在「未被采用所以不校验」的死条目。

### 6.3 未执行但含 AC 证据的测试文件（fail-closed）

无：全部含 AC 证据的测试文件都出现在 Vitest 报告中。

### 6.4 失败但未映射到任何 AC 的用例（fail-closed）

无：每个失败用例都至少映射到一个 AC。

### 6.5 测试中的未注册 AC 编号（负例夹具，不进入聚合）

- `AC-999`（packages/core/test/delivery-failures.test.ts, packages/core/test/findings.test.ts）

### 6.6 每个 AC 的全部演练来源（不做覆盖式合并）

| AC | 演练来源 | 状态 | 证据 |
|---|---|---|---|
| AC-001 | `pnpm test:e2e` | UNVERIFIED | provider.fact-and-unknown: AC-001 的“区分事实/未知”需要真实 Provider 纵向演练（pnpm test:live 与 AGENTDEV_PROVIDER_*）；本演练离线运行，Provider 桩被断言零调用 |
| AC-001 | `pnpm test:live` | PASS | drill.html-explanation: message 01a0a4f5-34cd-71a7-b0ff-a89912b9704b -> Work 01a0a4f5-34cd-70a3-9b7b-8967842503fb (intent=assist level=none, no Requirement); completion through run 01a0a4f5-3593-77f6-ae7c-f0e0518c1dc4 (config snapshot 857b9c667ce2, 12318 chars) citing src/orders/cancel.ts and separating UNKNOWN; artifact 01a0a4f5-b8ff-7e05-b8ac-83510c7b70f9 v1 sha256 f2819fc3e833 origin=agent kind=explanation; preview 200 CSP "default-src 'none'" sandbox allow-scripts credentials omit mode=inline; download token -6aJ24Re… matched the artifact bytes; the second GET answered 403; delivery branch unchanged at e3e0c9a3cb80; 2 call(s), HTTP 200/200, 35029ms total, 0 failed |
| AC-002 | `pnpm test:e2e` | PASS | browser.html-preview-and-download: artifact 01a0a4f4-56a9-7c9a-84e8-7a4e367a8312 在 /projects/1697be83accba7f3827e97431384180c/requirements/01a0a4f4-56ad-7656-aefc-9f3ed41fa85a 渲染于 sandbox="allow-scripts" 的 iframe；预览响应 200 CSP[default-src 'none'; connect-src 'none'] x-agentdev-preview-sandbox=allow-scripts x-agentdev-preview-credentials=omit content-type=text/html；下载字节含 AGENTDEV-PREVIEW-MARKER，URL /artifacts/1697be83accba7f3827e97431384180c/download/<token>（项目范围显式），重放同 token 被拒绝 403；临时项目 HEAD=442ce75bb83d（未变）且 git status 为空 \| 匿名上下文请求 /artifacts/1697be83accba7f3827e97431384180c/01a0a4f4-56a9-7c9a-84e8-7a4e367a8312/preview → 401 {"ok":false,"error":{"code":"UNAUTHENTICATED","message":"sign in to use the work（Playwright 1.63.0，17 个 spec，用时 28651ms，exit 0） |
| AC-003 | `pnpm test:e2e` | PASS | chief.message-to-stage: no-seed chain: message 01a0a4f3-d812-7550-a4ee-400eb51f56ab → Chief Run 01a0a4f3-d848-7d7d-baa2-2531262348f9 → Requirement 01a0a4f3-df55-7f64-85b5-356abe98b736 (active/plan) → professional Run 01a0a4f3-e775-7f25-8e28-503eb2d6bf4e (parent 01a0a4f3-d848-7d7d-baa2-2531262348f9) → stage result 01a0a4f3-ed57-775b-93da-c9003f37ff78 + stage.completed, message state processed, board shows the Requirement |
| AC-003 | `pnpm test:live` | PASS | drill.message-to-stage: real Provider no-seed chain: message 01a0a4f6-162a-7215-9c0b-a6e658f29107 → Chief Run 01a0a4f6-164f-78a2-950e-ae5e303148e4 (completed) → Requirement 01a0a4f6-2bfc-76dc-bce2-1cfba24bf0d0 (active/plan) → professional Run 01a0a4f6-3f0e-7c16-bfe8-5fe01cce1044 (parent 01a0a4f6-164f-78a2-950e-ae5e303148e4) → stage result 01a0a4f6-ee61-765e-8924-026c66de7947 + stage.failed(needs_input) (a NON-successful stage (needs_input) was delivered — this proves the chain, not a passing stage); provider calls=11 call(s), HTTP 200/200/200/200/200/200/200/200/200/200/200, 49542ms total, 0 failed |
| AC-005 | `pnpm test:e2e` | PASS | chief.message-to-stage: no-seed chain: message 01a0a4f3-d812-7550-a4ee-400eb51f56ab → Chief Run 01a0a4f3-d848-7d7d-baa2-2531262348f9 → Requirement 01a0a4f3-df55-7f64-85b5-356abe98b736 (active/plan) → professional Run 01a0a4f3-e775-7f25-8e28-503eb2d6bf4e (parent 01a0a4f3-d848-7d7d-baa2-2531262348f9) → stage result 01a0a4f3-ed57-775b-93da-c9003f37ff78 + stage.completed, message state processed, board shows the Requirement |
| AC-005 | `pnpm test:live` | PASS | drill.message-to-stage: real Provider no-seed chain: message 01a0a4f6-162a-7215-9c0b-a6e658f29107 → Chief Run 01a0a4f6-164f-78a2-950e-ae5e303148e4 (completed) → Requirement 01a0a4f6-2bfc-76dc-bce2-1cfba24bf0d0 (active/plan) → professional Run 01a0a4f6-3f0e-7c16-bfe8-5fe01cce1044 (parent 01a0a4f6-164f-78a2-950e-ae5e303148e4) → stage result 01a0a4f6-ee61-765e-8924-026c66de7947 + stage.failed(needs_input) (a NON-successful stage (needs_input) was delivered — this proves the chain, not a passing stage); provider calls=11 call(s), HTTP 200/200/200/200/200/200/200/200/200/200/200, 49542ms total, 0 failed |
| AC-007 | `pnpm test:live` | PASS | drill.l1-typo: Work 01a0a4f5-b944-7050-87c7-e8815767f3a3 (level=L1, base e3e0c9a3cb80) one-task Plan 01a0a4f5-be5 approved by the real gate; write admitted for src/orders/messages.ts; real exec Run 01a0a4f5-be78-7556-a8fb-69e7e20a1c4d produced candidate 4e9a2dcff24c tree ae0358dc0c97 (numstat: 1 1 src/orders/messages.ts); independent Review Run 01a0a4f5-c337-7929-bda7-482e9df0d367 -> stage 01a0a4f5-c768-75fc-b7f9-f3d7f8a24de5; Settlement Run 01a0a4f5-c769-7950-a6ef-640cc80ae55b; L1 chain ["Develop","Review","Settlement"]; runs planning:L1-Plan, backend:L1-Develop, review:L1-Review, settlement:L1-Settlement (no Planning/Test Run); CompletionManifest edfcb6081cb1 frozen; CAS moved agentdev/main e3e0c9a3cb80 -> 4e9a2dcff24c; Work completed with no Requirement; artifacts on the Work: 1 (the Plan) |
| AC-010 | `pnpm test:e2e` | PASS | delivery.l2-chain: Work 01a0a4f3-c997-71c5-b51c-c16935c0e9d6 + Requirement 01a0a4f3-adb0-7193-aea8-eac5b753975d bound; Task 01a0a4f3-d1be-77dd-9228-3d6c1a42a8c5; candidate 93a9319f13e2 tree 2c8cf9487989 codeTree 3ef6a80ec1c1; 5 real stage results (Plan/Develop/Review/Test/Settlement) accepted by StageGate; evaluateStageChain(route=code, level=L2) ok with the documented order and refuses a missing Test |
| AC-010 | `pnpm test:live` | PASS | drill.l2-delivery: Work 01a0a4f5-cdc6-7160-9034-a0740eb9beed (L2, base 4e9a2dcff24c) + Requirement 01a0a4f5-cdf5-7598-9e0a-2b77169d7cf4; model Plan 01a0a4f5-d83 approved, Task 01a0a4f5-d825-77eb-b5c3-e1174447b816; independent Runs planning:01a0a4f5-cdf8-7fb2-8a19-5961047bcbc4, backend:01a0a4f5-d851-76a4-a6dc-996aa0ac59fd, review:01a0a4f5-e818-736f-b6c3-a86d9117076a, test:01a0a4f5-eb9b-7a53-a011-c477642d838b with distinct config snapshots (b328a033, f61532a1, 6e2070a4, d15c69c4); frozen models planning=deepseek-flash, backend=deepseek-flash, review=deepseek-chat, test=deepseek-chat; candidate 31b4181f9ea5 codeTree 98dee129f27b; Develop 01a0a4f5-e817-73bd-8359-bfbef5eaeae2, Review 01a0a4f5-eb42-7998-9278-8e45b7b427b5, Test 01a0a4f5-eee5-72eb-9b30-c9919a359587 accepted (executed probe exit 0); L2 chain ["Plan","Develop","Review","Test","Settlement"]; a chain without Test is refused; Comple… |
| AC-032 | `pnpm test:e2e` | PASS | tool.broker-admission: G8 on the real path: message 01a0a4f4-08f7-7aac-810a-5df7a2a1a4d3 → Chief assessment → professional Run 01a0a4f4-1a05-799a-a3ce-177bc52957d9 (2 Runs, 0 grandchildren, settled contract_violation) through the real Broker: refused NOT_AUTHORIZED/CONTEXT_FORBIDDEN/GATE_NOT_READY (readScope, unapproved Plan, no Grant), no tool_operation for the refused path, source hash unchanged, pending permission Decisions 0 after the typed refusal; role faces chief=[read,search,artifact_write,assessment_submit,agent_dispatch,decision_request,context_request] worker=[read,search,edit,write,bash,git,artifact_write,stage_yield,request_dispatch,context_request]; Grants revoked when the Attempt ended |
| AC-037 | `pnpm test:e2e` | PASS | knowledge.patch-cold-start: knowledge commit 95636762d18a: document,implementation,verification,verificationEvidenceRefs,verificationCoverage,revision,currentBehaviour,entries,relations,invalidationNotes; projection 95636762d18a state=valid (durable SQLite row valid); cold start selected ["F-0f0f0f0f","F-0a1b2c3d"] with "未付款订单可取消；已付款订单返回已确认的拒绝结果。", code+test entries, the constrained_by constraint and the invalidation gap; knowledge.list state=valid |
| AC-037 | `pnpm test:live` | PASS | drill.l2-delivery: Work 01a0a4f5-cdc6-7160-9034-a0740eb9beed (L2, base 4e9a2dcff24c) + Requirement 01a0a4f5-cdf5-7598-9e0a-2b77169d7cf4; model Plan 01a0a4f5-d83 approved, Task 01a0a4f5-d825-77eb-b5c3-e1174447b816; independent Runs planning:01a0a4f5-cdf8-7fb2-8a19-5961047bcbc4, backend:01a0a4f5-d851-76a4-a6dc-996aa0ac59fd, review:01a0a4f5-e818-736f-b6c3-a86d9117076a, test:01a0a4f5-eb9b-7a53-a011-c477642d838b with distinct config snapshots (b328a033, f61532a1, 6e2070a4, d15c69c4); frozen models planning=deepseek-flash, backend=deepseek-flash, review=deepseek-chat, test=deepseek-chat; candidate 31b4181f9ea5 codeTree 98dee129f27b; Develop 01a0a4f5-e817-73bd-8359-bfbef5eaeae2, Review 01a0a4f5-eb42-7998-9278-8e45b7b427b5, Test 01a0a4f5-eee5-72eb-9b30-c9919a359587 accepted (executed probe exit 0); L2 chain ["Plan","Develop","Review","Test","Settlement"]; a chain without Test is refused; Comple… |
| AC-038 | `pnpm test:e2e` | PASS | surfaces.nine-real-state: 10 surfaces read real state (/projects ok; /projects/3ef4fa569e013839068ebf553ccd33ed/chief ok; /projects/3ef4fa569e013839068ebf553ccd33ed/requirements ok; /projects/3ef4fa569e013839068ebf553ccd33ed/requirements/01a0a4f3-adb0-7193-aea8-eac5b753975d ok; /projects/3ef4fa569e013839068ebf553ccd33ed/docs ok; /projects/3ef4fa569e013839068ebf553ccd33ed/files ok; /projects/3ef4fa569e013839068ebf553ccd33ed/agents ok; /projects/3ef4fa569e013839068ebf553ccd33ed/runs ok; /projects/3ef4fa569e013839068ebf553ccd33ed/inbox ok; /settings ok); Live panel modes open/compact/hidden; create/switch control only on the Chief page with the deep link elsewhere; docs delivered/design/work views all real answers |
| AC-041 | `pnpm test:e2e` | PASS | knowledge.patch-cold-start: knowledge commit 95636762d18a: document,implementation,verification,verificationEvidenceRefs,verificationCoverage,revision,currentBehaviour,entries,relations,invalidationNotes; projection 95636762d18a state=valid (durable SQLite row valid); cold start selected ["F-0f0f0f0f","F-0a1b2c3d"] with "未付款订单可取消；已付款订单返回已确认的拒绝结果。", code+test entries, the constrained_by constraint and the invalidation gap; knowledge.list state=valid |
| AC-041 | `pnpm test:live` | PASS | drill.l2-delivery: Work 01a0a4f5-cdc6-7160-9034-a0740eb9beed (L2, base 4e9a2dcff24c) + Requirement 01a0a4f5-cdf5-7598-9e0a-2b77169d7cf4; model Plan 01a0a4f5-d83 approved, Task 01a0a4f5-d825-77eb-b5c3-e1174447b816; independent Runs planning:01a0a4f5-cdf8-7fb2-8a19-5961047bcbc4, backend:01a0a4f5-d851-76a4-a6dc-996aa0ac59fd, review:01a0a4f5-e818-736f-b6c3-a86d9117076a, test:01a0a4f5-eb9b-7a53-a011-c477642d838b with distinct config snapshots (b328a033, f61532a1, 6e2070a4, d15c69c4); frozen models planning=deepseek-flash, backend=deepseek-flash, review=deepseek-chat, test=deepseek-chat; candidate 31b4181f9ea5 codeTree 98dee129f27b; Develop 01a0a4f5-e817-73bd-8359-bfbef5eaeae2, Review 01a0a4f5-eb42-7998-9278-8e45b7b427b5, Test 01a0a4f5-eee5-72eb-9b30-c9919a359587 accepted (executed probe exit 0); L2 chain ["Plan","Develop","Review","Test","Settlement"]; a chain without Test is refused; Comple… |
| AC-043 | `pnpm test:live` | PASS | drill.l2-delivery: Work 01a0a4f5-cdc6-7160-9034-a0740eb9beed (L2, base 4e9a2dcff24c) + Requirement 01a0a4f5-cdf5-7598-9e0a-2b77169d7cf4; model Plan 01a0a4f5-d83 approved, Task 01a0a4f5-d825-77eb-b5c3-e1174447b816; independent Runs planning:01a0a4f5-cdf8-7fb2-8a19-5961047bcbc4, backend:01a0a4f5-d851-76a4-a6dc-996aa0ac59fd, review:01a0a4f5-e818-736f-b6c3-a86d9117076a, test:01a0a4f5-eb9b-7a53-a011-c477642d838b with distinct config snapshots (b328a033, f61532a1, 6e2070a4, d15c69c4); frozen models planning=deepseek-flash, backend=deepseek-flash, review=deepseek-chat, test=deepseek-chat; candidate 31b4181f9ea5 codeTree 98dee129f27b; Develop 01a0a4f5-e817-73bd-8359-bfbef5eaeae2, Review 01a0a4f5-eb42-7998-9278-8e45b7b427b5, Test 01a0a4f5-eee5-72eb-9b30-c9919a359587 accepted (executed probe exit 0); L2 chain ["Plan","Develop","Review","Test","Settlement"]; a chain without Test is refused; Comple… |
| AC-045 | `pnpm test:e2e` | PASS | tool.broker-admission: G8 on the real path: message 01a0a4f4-08f7-7aac-810a-5df7a2a1a4d3 → Chief assessment → professional Run 01a0a4f4-1a05-799a-a3ce-177bc52957d9 (2 Runs, 0 grandchildren, settled contract_violation) through the real Broker: refused NOT_AUTHORIZED/CONTEXT_FORBIDDEN/GATE_NOT_READY (readScope, unapproved Plan, no Grant), no tool_operation for the refused path, source hash unchanged, pending permission Decisions 0 after the typed refusal; role faces chief=[read,search,artifact_write,assessment_submit,agent_dispatch,decision_request,context_request] worker=[read,search,edit,write,bash,git,artifact_write,stage_yield,request_dispatch,context_request]; Grants revoked when the Attempt ended |
| AC-048 | `pnpm test:e2e` | PASS | tool.broker-admission: G8 on the real path: message 01a0a4f4-08f7-7aac-810a-5df7a2a1a4d3 → Chief assessment → professional Run 01a0a4f4-1a05-799a-a3ce-177bc52957d9 (2 Runs, 0 grandchildren, settled contract_violation) through the real Broker: refused NOT_AUTHORIZED/CONTEXT_FORBIDDEN/GATE_NOT_READY (readScope, unapproved Plan, no Grant), no tool_operation for the refused path, source hash unchanged, pending permission Decisions 0 after the typed refusal; role faces chief=[read,search,artifact_write,assessment_submit,agent_dispatch,decision_request,context_request] worker=[read,search,edit,write,bash,git,artifact_write,stage_yield,request_dispatch,context_request]; Grants revoked when the Attempt ended |
| AC-050 | `pnpm test:e2e` | PASS | tool.broker-admission: G8 on the real path: message 01a0a4f4-08f7-7aac-810a-5df7a2a1a4d3 → Chief assessment → professional Run 01a0a4f4-1a05-799a-a3ce-177bc52957d9 (2 Runs, 0 grandchildren, settled contract_violation) through the real Broker: refused NOT_AUTHORIZED/CONTEXT_FORBIDDEN/GATE_NOT_READY (readScope, unapproved Plan, no Grant), no tool_operation for the refused path, source hash unchanged, pending permission Decisions 0 after the typed refusal; role faces chief=[read,search,artifact_write,assessment_submit,agent_dispatch,decision_request,context_request] worker=[read,search,edit,write,bash,git,artifact_write,stage_yield,request_dispatch,context_request]; Grants revoked when the Attempt ended |
| AC-052 | `pnpm test:e2e` | PASS | browser.html-attack-samples: frame origin=null cookie=null cookieError=SecurityError（会话 cookie agentdev_web 确实存在）；parent.document=SecurityError top.title=SecurityError topNavigation=null（父页 URL 未变）；fetch(probe)=rejected:TypeError fetch(/api/session)=rejected:TypeError xhr=error img=error；探针自计数 attacks=0；探针 URL 的浏览器响应数=0；被 CSP 拒绝的探针请求=2（errorText=csp）；localStorage=SecurityError（Playwright 1.63.0，17 个 spec，用时 28651ms，exit 0） |
| AC-054 | `pnpm test:e2e` | PASS | events.watermark-reconnect: hello/subscribe over the BFF /ws; first cursor 16 acked; daemon dropped -> bridge.reconnecting -> bridge.open; the during-break event replayed above the watermark with no duplicate; a fresh socket resumed in mode=replay with nothing at or below 16; Work stayed running |
| AC-057 | `pnpm test:e2e` | PASS | runtime.executes-attempt: runtime executed a real Attempt: Run 01a0a4f3-ee29-7652-890c-e3eeac31a674 completed with Attempt 01a0a4f3-eef2-7345-8d89-82c92baade4e through the supervisor, a real apps/runner child process and the loopback model (1 Provider call(s), 13 tokens booked); killing the live Runner of Run 01a0a4f4-0810-7041-b320-77fe5566624c (pid 66850) parked it as interrupted with Attempt 01a0a4f4-081b-7ed8-af61-e285392ff631 lost (new Attempt allowed=true) |
| AC-057 | `pnpm test:live` | PASS | drill.runtime-attempt: the runtime executed Run 01a0a4f5-f822-798c-b6e9-018804f56977 through a real apps/runner child process (Attempt 01a0a4f5-f8f1-7fd8-96a4-88b7ceaf3de8, runnerId pid:73818) against the real Provider; 885 tokens booked from the Provider usage; killing the live Runner (pid 73820) of Run 01a0a4f6-1483-749f-b5fd-cb6456cbb5f7 parked it as interrupted with Attempt 01a0a4f6-1532-7b3f-93f7-071ca2965393 lost (new Attempt allowed=true) |
| AC-060 | `pnpm test:e2e` | PASS | events.watermark-reconnect: hello/subscribe over the BFF /ws; first cursor 16 acked; daemon dropped -> bridge.reconnecting -> bridge.open; the during-break event replayed above the watermark with no duplicate; a fresh socket resumed in mode=replay with nothing at or below 16; Work stayed running |
| AC-064 | `pnpm test:e2e` | PASS | ops.backup-restore: credentialed Provider provider:01a0a4f4-c4fe-7128-ba98-fc9e4565f1b8 -> Chief Run 01a0a4f4-c565-763b-a11a-1bfaaf4507b0 reached attempt.ready (Attempt 01a0a4f4-c829-7bc9-ad5b-dd81db8d7126 running) and the loopback model received 1 credentialed call(s); agentdev backup exit 0: revision d09125ff75e9, complete, secretRefs ["provider:01a0a4f4-c4fe-7128-ba98-fc9e4565f1b8"], installation config copied, no credential value in the backup directory; deleted /private/var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-e2e-ops-home-fm49Y5/projects/4a44f34ca03a9a5d0a6f750a64248a71 and the project; agentdev restore exit 0 (status ready, tree 1ed076140947, evidence 1/1, doctor ok, Run 01a0a4f4-c565-763b-a11a-1bfaaf4507b0 interrupted); restarted daemon reported it interrupted through its own protocol; fresh installation restore: status blocked + first stdout line WARNING [PROVID… |
| AC-066 | `pnpm test:live` | PASS | drill.session-streaming: real Pi session over the Core gateway (provider deepseek-flash): streaming text_delta=1 thinking_delta=0 first="PONG-AC066" last="PONG-AC066"; session file 5 → 7 record(s); resumed with a new factory: same sessionId + same file, 1 fresh delta(s), turn messageCount 2 |
| AC-068 | `pnpm test:e2e` | PASS | board.rules: board identity shared (01a0a4f3-b9d9-7657-b841-bc0b1f4707ba); L1 Work 01a0a4f3-c077-7a55-a754-bc65e62a1d58 excluded and never a card; Queued pause -> 409 INVALID_STATE; Queued cancel -> cancelled at 137c988d341d7a044d9e2c22c1bb084780dbe134; branch tip moved |
| AC-069 | `pnpm test:e2e` | PASS | chief.routes-message: message 01a0a4f3-c997-7d01-873a-ea9bdee9a1bf routed to Work 01a0a4f3-c997-71c5-b51c-c16935c0e9d6 (intent=delivery level=L2 authorization=01a0a4f3-c9dd-7830-aae8-f7bb96311314); Work.sourceRef is the message; message.received emitted |
| AC-069 | `pnpm test:live` | PASS | drill.message-to-stage: real Provider no-seed chain: message 01a0a4f6-162a-7215-9c0b-a6e658f29107 → Chief Run 01a0a4f6-164f-78a2-950e-ae5e303148e4 (completed) → Requirement 01a0a4f6-2bfc-76dc-bce2-1cfba24bf0d0 (active/plan) → professional Run 01a0a4f6-3f0e-7c16-bfe8-5fe01cce1044 (parent 01a0a4f6-164f-78a2-950e-ae5e303148e4) → stage result 01a0a4f6-ee61-765e-8924-026c66de7947 + stage.failed(needs_input) (a NON-successful stage (needs_input) was delivered — this proves the chain, not a passing stage); provider calls=11 call(s), HTTP 200/200/200/200/200/200/200/200/200/200/200, 49542ms total, 0 failed |
| AC-070 | `pnpm test:e2e` | PASS | plan.approval-expired-card: no-plan refusal (enabled=false reasonCode=no_plan); plan.approve v1 planRef=01a0a4f3-c9ff-7d96-be18-f0103b0916ed; plan.current enabled=true with 1 task(s), authorization=01a0a4f3-c9dd-7830-aae8-f7bb96311314; superseded v0 -> VERSION_CONFLICT currentVersion=1 |
| AC-071 | `pnpm test:e2e` | PASS | browser.live-layout: open: grid=220.0px 573.6px 486.4px, --dock=clamp(360px, 38%, 560px) ⇒ dock 486.4px (38% of 1280px), main 右缘=793.6 dock 左缘=793.6；compact: 第三轨=44px, dock display=none, aria-expanded=false；hidden: 第三轨=0px, main=1060.0px > compact=1016.0px；三态由真实键盘操作（focus + Enter）驱动 \| { "viewport": { "width": 1280, "height": 720 }, "header": { "x": 0, "y": 0, "width": 1280, "height": 54, "right": 1280, "bottom": 54 }, "headerDisplay": "flex", "brand": { "x": 0, "y": 0, "width": 220, "height": 54, "right": 220, "bottom": 54 }, "projectArea": { "x": 220, "y": 0, "width": 696.375, "height": 54, "right": 916.375, "bottom": 54 }, "tools": { "x": 916.375, "y": 0, "width": 363.625, "height": 54, "right": 1280, "bottom": 54 }, "toggle": { "x": 998.25, "y": 3.5, "width": 44.125, "height": 46, "right": 1042.375, "bottom": 49.5 } } \| 面板状态写入 localStorage(agentdev.panel=compact) 并在导航到 /requirements … |
| AC-072 | `pnpm test:e2e` | PASS | surfaces.nine-real-state: 10 surfaces read real state (/projects ok; /projects/3ef4fa569e013839068ebf553ccd33ed/chief ok; /projects/3ef4fa569e013839068ebf553ccd33ed/requirements ok; /projects/3ef4fa569e013839068ebf553ccd33ed/requirements/01a0a4f3-adb0-7193-aea8-eac5b753975d ok; /projects/3ef4fa569e013839068ebf553ccd33ed/docs ok; /projects/3ef4fa569e013839068ebf553ccd33ed/files ok; /projects/3ef4fa569e013839068ebf553ccd33ed/agents ok; /projects/3ef4fa569e013839068ebf553ccd33ed/runs ok; /projects/3ef4fa569e013839068ebf553ccd33ed/inbox ok; /settings ok); Live panel modes open/compact/hidden; create/switch control only on the Chief page with the deep link elsewhere; docs delivered/design/work views all real answers |
| AC-073 | `pnpm test:e2e` | PASS | browser.keyboard-aria-i18n: Tab #1 → a#(skip-link) name="Skip to main content"；Enter → 焦点 #main；遍历 22 个可聚焦控件（含 #languageSelect=true），无未命名控件，无不可聚焦元素进入顺序；ARIA: #liveDock="Live panel" #liveDockToggle="Live panel, open" #languageSelect="Interface language" #composerBody="Message the Chief"；aria-live 区域 #connectionState/#messages/#liveEvents/#stagedAttachments \| 切换到 zh：html[lang]=zh-CN，nav Chief→主管，cookie agentdev_language=zh，localStorage(agentdev.language)=zh；客户端自有字符串随切换生效：#liveDock aria-label=实时面板、#liveDockToggle=实时面板，已展开、下载按钮=下载完整产物；项目内容未翻译：#requirementTitle="HTML 说明产物隔离预览" 保持不变且 data-translatable="false"；project-name="/private/var/folders/zs/p0l9stg552j3vgvzwmf0gnp80000gn/T/agentdev-e2e-repo-NsWtkQ" 不变；ui.translate 调用 63 次，未包含任何项目内容（标题/项目名泄漏=0）；reload 后整页仍为 zh；未在客户端打开过的 /settings 也由服务端按 cookie 渲染为「保存配置」（Playwright 1.63.0，17 个 spec，用时 28651ms，exit 0） |
| AC-074 | `pnpm test:e2e` | PASS | inbox.decision-dedup: two same-target decisions collapsed to 1 Inbox row (ids 01a0a4f3-ca0e-7765-b461-8978b20b0e02/01a0a4f3-ca10-751d-8884-d3e17471daf4); expired row actionable=false; resolve -> accepted + idempotent replay; duplicate row untouched |
| AC-075 | `pnpm test:e2e` | PASS | config.validation-preserves-input: unknownKey -> 422 VALIDATION_ERROR with preservedInput, revision unchanged at 2; reasoning=high saved (rev 3) then config.test -> PROVIDER_UNAVAILABLE with preservedInput; restored to off (rev 4), Settings revision matches |
| AC-076 | `pnpm test:e2e` | PASS | browser.attachment-client-hints: 选择 6 个 text/markdown → #composerError="VALIDATION_ERROR: At most 5 attachments per message."；#stagedAttachments 为空；/artifacts/upload 请求数=0 \| 选择 21 MiB 的 text/plain → #composerError="VALIDATION_ERROR: The attachment exceeds 20 MiB."；#stagedAttachments 为空；/artifacts/upload 请求数=0 \| 选择 application/zip → #composerError="VALIDATION_ERROR: That file type is not a supported attachment type."；#stagedAttachments 为空；/artifacts/upload 请求数=0 \| 选择 3 个 17 MiB 文件（合计 51 MiB，逐个 <20 MiB）→ #composerError="VALIDATION_ERROR: Attachments exceed 50 MiB in total."；#stagedAttachments 为空；/artifacts/upload 请求数=0 \| 语言切到 zh 并等待客户端字典生效后选择 6 个附件 → #composerError="VALIDATION_ERROR: 每条消息最多 5 个附件。"（本地化文案而非原始 key）；/artifacts/upload 请求数=0 \| 选择 1 个 text/markdown → 上传请求 1 次，暂存项 attachmentId=01a0a4f4-b593-747d-a585-a0602412fa17，#composerError 隐藏（证明上一条拒绝针对具体限制而非一律拒绝）（Playwright 1.63.0，17 个 spec… |
| AC-077 | `pnpm test:e2e` | PASS | files.branch-preview-boundaries: revision=43a0a562d245 branch=agentdev/main, real file content; search found src/orders/cancel.ts; absolute+traversal -> data-code=NOT_FOUND with no leak; snapshots unchanged (1); head advanced to 5d91d00d5c46 and the page followed |
| AC-078 | `pnpm test:e2e` | PASS | stack.boot: daemon 200/BFF 200 healthz; anonymous page 401; /rpc without cookie 401 UNAUTHENTICATED; wrong Origin login 403 NOT_AUTHORIZED; wrong token 401; login 200 with agentdev_web cookie (HttpOnly) + csrfToken; snapshot projectId=3ef4fa569e013839068ebf553ccd33ed |
| AC-084 | `pnpm test:e2e` | PASS | attachment.upload-first-message: upload 201 attachmentId=01a0a4f3-ca4b-7946-ac81-a25c4c60aa36 (staged, installation owner); first message 01a0a4f3-ca56-7421-897e-0dfa080ae8dd bound it to Work 01a0a4f3-ca56-7a9d-9f20-6823ad6e7164 atomically with 1 user artifact; unsupported mime refused (400) with no residue; duplicate bind -> ATTACHMENT_ALREADY_BOUND |
| AC-090 | `pnpm test:e2e` | PASS | requirement.save-git: requirement 01a0a4f3-adb0-7193-aea8-eac5b753975d created at f726cd58d28378a37ee2b3121c6c3e1088bf77ac (branch agentdev/main, unpushed, refUpdated) then updated to recordVersion 2 at 0e0218b6a52d with a changed recordHash; requirement.json+content.md committed atomically; board identity == requirement id; observation: partial update preserved every body line (true) and re-emitted the record-version marker, contentHash changed |
| AC-093 | `pnpm test:e2e` | PASS | requirement.save-git: requirement 01a0a4f3-adb0-7193-aea8-eac5b753975d created at f726cd58d28378a37ee2b3121c6c3e1088bf77ac (branch agentdev/main, unpushed, refUpdated) then updated to recordVersion 2 at 0e0218b6a52d with a changed recordHash; requirement.json+content.md committed atomically; board identity == requirement id; observation: partial update preserved every body line (true) and re-emitted the record-version marker, contentHash changed |

合并规则：**最弱一环胜出**（FAIL > UNVERIFIED > PASS）。演练 UNVERIFIED 会把同一 AC 的套件 PASS 降级，因为该 AC 的完整 Given/When/Then 并未全部执行。

## 7. 机器可读结果

```json
{
  "generatedAt": "2026-09-15T12:07:25.353Z",
  "gitHead": "f2a1d50b94a8e225793a2f96cf886fd2ed8863c2",
  "codeDigest": "sha256:29db434749e9590a111b7cd171be05990cf5b0426e45b46c13fa210d8a9ba7d5",
  "drillsExecuted": true,
  "exitCode": 0,
  "counts": {
    "PASS": 94,
    "ACCEPTED": 0,
    "FAIL": 0,
    "MISSING": 0
  },
  "problems": [],
  "results": [
    {
      "id": "AC-001",
      "status": "PASS",
      "accepted": false,
      "mapping": "none",
      "evidence": [],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "UNVERIFIED"
        },
        {
          "tool": "pnpm test:live",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-002",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) versions agent artifacts and keeps the old bytes readable (AC-002)",
        "packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) invalidates an artifact once and keeps the reason (AC-002)",
        "packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) truncates oversized previews and keeps the download path (AC-002)",
        "packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) consumes a download token exactly once and expires it (AC-002)",
        "apps/daemon/test/server.test.ts :: daemon HTTP surface (WP-03) uploads, binds and previews an HTML explanation end to end (AC-002/AC-084)",
        "apps/daemon/test/server.test.ts :: daemon HTTP surface (WP-03) consumes a download token once and then refuses it (AC-002)",
        "apps/daemon/test/server.test.ts :: daemon HTTP surface (WP-03) truncates a preview past the inline limit and keeps it downloadable (AC-002)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-003",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) produces an agent explanation artifact for a delegated analysis Run (AC-003)",
        "apps/daemon/test/assessment-dispatch.integration.test.ts :: message → Chief → DispatchSpec → Requirement → Run → stage result (WP-12 T2) runs the whole path from one message with no seeded row (AC-003/AC-005/AC-069)",
        "apps/daemon/test/attempt.integration.test.ts :: a real Attempt through the daemon-side execution path forwards a Provider tool call to a real Pi session and round-trips its result (AC-003)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        },
        {
          "tool": "pnpm test:live",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-004",
      "status": "PASS",
      "accepted": false,
      "mapping": "curated",
      "evidence": [
        "packages/domain/test/domain.test.ts :: level routing (workflow.md §2) routes assist and artifact to none",
        "apps/daemon/test/server.test.ts :: daemon HTTP surface (WP-03) keeps questions, advice and statements read-only end to end"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-005",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/domain.test.ts :: level routing (workflow.md §2) routes a message into independent work items (AC-005/AC-006)",
        "packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) records the authority an explicit message grants (AC-005)",
        "apps/daemon/test/assessment-dispatch.integration.test.ts :: message → Chief → DispatchSpec → Requirement → Run → stage result (WP-12 T2) runs the whole path from one message with no seeded row (AC-003/AC-005/AC-069)",
        "apps/daemon/test/assessment-dispatch.integration.test.ts :: message → Chief → DispatchSpec → Requirement → Run → stage result (WP-12 T2) resolves the frozen provider credential through the real resolver (AC-005, G1)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        },
        {
          "tool": "pnpm test:live",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-006",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/domain.test.ts :: level routing (workflow.md §2) routes a message into independent work items (AC-005/AC-006)",
        "packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) splits one mixed message into the work items it names (AC-006)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-007",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) accepts an explicit typo change inside the L1 bounds (AC-007)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) never downgrades a one-character permission change by its line count (AC-008)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) is L2 when the diff exceeds the L1 bounds or changes logic (AC-009)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) upgrades an over-L1 diff to the same Work with a stale Plan (AC-009)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) upgrades a logic change that the line count hides (AC-009 required failure test)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) never downgrades automatically (AC-008/AC-009)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) treats an unknown risk flag as inclusive, never as \"no risk\" (fail-closed)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) reports the measured reasons behind a classification (AC-009)",
        "packages/domain/test/delivery.test.ts :: route-aware completion evidence (AC-007/AC-012/AC-019, W6R2-09) selects a Test for code L2/L3 and the route Review otherwise",
        "packages/domain/test/delivery.test.ts :: route-aware completion evidence (AC-007/AC-012/AC-019, W6R2-09) requires an independent Review in addition to the Test for code L2/L3 (W6R4-01)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) completes an L1 Work without a Test Run, through its Review and a frozen CompletionManifest (AC-007/AC-019, W6R2-09)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) reports review evidence under review fields and no test status on an L1 completion (AC-007, W6R4-02)",
        "apps/daemon/test/assessment-dispatch.integration.test.ts :: message → Chief → DispatchSpec → Requirement → Run → stage result (WP-12 T2) never puts an L1 assessment on the board (AC-007/AC-068)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) runs the L1 typo chain to a CompletionManifest and CAS with no Planning/Test Run and no board entry (AC-007)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) drives a validated ProductDefinition through Plan/Develop/Review/Test/Settlement in order (AC-010)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) saves a confirmed design as Product/Planning candidate diffs with an independent Review and Settlement only (AC-012)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) requires explicit authorization, rollback, per-item audit and a recovery drill before an L3 migration is implemented (AC-011)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) closes a task-less Review Finding through a fix and a new independent Review/Test, refusing self-verification (AC-017, AC-018, AC-083)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) pauses at a safe point, resumes into a new Attempt, and cancels the Run tree while keeping the artifacts (AC-020, AC-021)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) shows an imported active Requirement as waiting to continue and re-plans it in a new Work without reusing old verification (AC-089)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) refuses the superseded Plan after an upgrade and leaves the source hash unchanged (AC-009, AC-013)"
      ],
      "drills": [
        {
          "tool": "pnpm test:live",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-008",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) accepts an explicit typo change inside the L1 bounds (AC-007)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) never downgrades a one-character permission change by its line count (AC-008)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) is L2 when the diff exceeds the L1 bounds or changes logic (AC-009)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) upgrades an over-L1 diff to the same Work with a stale Plan (AC-009)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) upgrades a logic change that the line count hides (AC-009 required failure test)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) never downgrades automatically (AC-008/AC-009)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) treats an unknown risk flag as inclusive, never as \"no risk\" (fail-closed)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) reports the measured reasons behind a classification (AC-009)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses a downgrade without invalidating the still-valid Plan (AC-008/AC-009, W6R1-06)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-009",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) accepts an explicit typo change inside the L1 bounds (AC-007)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) never downgrades a one-character permission change by its line count (AC-008)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) is L2 when the diff exceeds the L1 bounds or changes logic (AC-009)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) upgrades an over-L1 diff to the same Work with a stale Plan (AC-009)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) upgrades a logic change that the line count hides (AC-009 required failure test)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) never downgrades automatically (AC-008/AC-009)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) treats an unknown risk flag as inclusive, never as \"no risk\" (fail-closed)",
        "packages/domain/test/delivery.test.ts :: L1 eligibility and bounds (AC-007/AC-008/AC-009) reports the measured reasons behind a classification (AC-009)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses a code write with no approved Plan and leaves the source hash unchanged (AC-013)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) auto-approves a compliant Plan, stores the evidence and admits the write (AC-014)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) rejects a non-compliant Plan without writing any gate state (AC-014 negative)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses a stale Plan after a level upgrade and marks it stale (AC-009)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses an upgrade whose replacement Plan was never approved (AC-009 negative)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) keeps Plan versions monotonic across submissions (AC-014)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses a Plan whose reservation exceeds the budget once real usage counts (AC-022, W6R1-03)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) re-reads the authorization at write time and refuses a revoked envelope (AC-013, W6R1-05)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) compares the approval source hash with the live measurement (AC-013, W6R1-07)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) distinguishes a no-op from a real upgrade and touches nothing on a no-op (AC-009, W6R1-06)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses a downgrade without invalidating the still-valid Plan (AC-008/AC-009, W6R1-06)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) never lets a caller expectation replace the approved source hash (AC-013, W6R2-02)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) reserves the approved tokens so a second Plan cannot exceed the limit (AC-022, W6R2-06)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) admits a code write only while the Work is running (AC-020/AC-021, W6R2-07/W6R3-02)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) fails closed on an unbound Work and supersedes its previous Plan on an upgrade (W6R3-04)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) refuses the superseded Plan after an upgrade and leaves the source hash unchanged (AC-009, AC-013)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-010",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) fixes the stage order per route and level (AC-010/AC-012)",
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) accepts a complete L2 chain and rejects a missing stage (AC-010)",
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) requires each stage to depend on the previous one (AC-010)",
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) needs a Requirement for L2/L3 code and for L3 evidence (AC-011)",
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) accepts a document chain that binds no code revision or environment (AC-012, W6R1-04/W6R2-10)",
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) rejects an unknown route/level combination instead of guessing",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) never completes a code L2 Work on a Test Run alone (AC-010/AC-019, W6R4-01)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) drives a validated ProductDefinition through Plan/Develop/Review/Test/Settlement in order (AC-010)",
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) integrates B-on-A without re-applying the ancestor and settles the Requirement",
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) refuses a Task without a frozen manifest and writes nothing",
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) refuses a real merge conflict and leaves the delivery ref and the manifest untouched",
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) settlement refuses a Task whose manifest vanished before any write"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        },
        {
          "tool": "pnpm test:live",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-011",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) fixes the stage order per route and level (AC-010/AC-012)",
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) accepts a complete L2 chain and rejects a missing stage (AC-010)",
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) requires each stage to depend on the previous one (AC-010)",
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) needs a Requirement for L2/L3 code and for L3 evidence (AC-011)",
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) accepts a document chain that binds no code revision or environment (AC-012, W6R1-04/W6R2-10)",
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) rejects an unknown route/level combination instead of guessing",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) requires explicit authorization, rollback, per-item audit and a recovery drill before an L3 migration is implemented (AC-011)",
        "packages/storage/test/migrations.integration.test.ts :: migrations rolls a failed migration back and reports its version",
        "packages/core/test/backup.integration.test.ts :: Backup, restore and relocate (AC-064) restores a backup into a new directory with consistent hashes, knowledge and evidence"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-012",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) fixes the stage order per route and level (AC-010/AC-012)",
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) accepts a complete L2 chain and rejects a missing stage (AC-010)",
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) requires each stage to depend on the previous one (AC-010)",
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) needs a Requirement for L2/L3 code and for L3 evidence (AC-011)",
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) accepts a document chain that binds no code revision or environment (AC-012, W6R1-04/W6R2-10)",
        "packages/domain/test/delivery.test.ts :: stage manifests and routes (AC-010/AC-011/AC-012) rejects an unknown route/level combination instead of guessing",
        "packages/domain/test/delivery.test.ts :: route-aware completion evidence (AC-007/AC-012/AC-019, W6R2-09) selects a Test for code L2/L3 and the route Review otherwise",
        "packages/domain/test/delivery.test.ts :: route-aware completion evidence (AC-007/AC-012/AC-019, W6R2-09) requires an independent Review in addition to the Test for code L2/L3 (W6R4-01)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) keeps the document route on its own rule: Review evidence, no code Test Run (AC-012, W6R2-09)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) saves a confirmed design as Product/Planning candidate diffs with an independent Review and Settlement only (AC-012)",
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) integrates B-on-A without re-applying the ancestor and settles the Requirement",
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) refuses a Task without a frozen manifest and writes nothing",
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) refuses a real merge conflict and leaves the delivery ref and the manifest untouched",
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) settlement refuses a Task whose manifest vanished before any write"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-013",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses a write without an approved Plan and leaves the source hash unchanged (AC-013)",
        "packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses a Plan for another revision and a changed Plan hash (AC-013 required failure test)",
        "packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) admits the write when the Plan is approved for the current revision (AC-014)",
        "packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) auto-approves a compliant Plan with recorded evidence (AC-014)",
        "packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) never auto-approves a product choice or an out-of-scope Plan (AC-014 negative)",
        "packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) covers targets only by equality or a directory prefix",
        "packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses an over-used budget instead of assuming a zero usage (AC-022, W6R1-03)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses every write once the Work is completed or failed, with zero write events (AC-013/AC-020, W6R3-02)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses a code write with no approved Plan and leaves the source hash unchanged (AC-013)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) auto-approves a compliant Plan, stores the evidence and admits the write (AC-014)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) rejects a non-compliant Plan without writing any gate state (AC-014 negative)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses a stale Plan after a level upgrade and marks it stale (AC-009)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses an upgrade whose replacement Plan was never approved (AC-009 negative)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) keeps Plan versions monotonic across submissions (AC-014)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses a Plan whose reservation exceeds the budget once real usage counts (AC-022, W6R1-03)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) re-reads the authorization at write time and refuses a revoked envelope (AC-013, W6R1-05)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) compares the approval source hash with the live measurement (AC-013, W6R1-07)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) distinguishes a no-op from a real upgrade and touches nothing on a no-op (AC-009, W6R1-06)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses a downgrade without invalidating the still-valid Plan (AC-008/AC-009, W6R1-06)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) never lets a caller expectation replace the approved source hash (AC-013, W6R2-02)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) reserves the approved tokens so a second Plan cannot exceed the limit (AC-022, W6R2-06)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) admits a code write only while the Work is running (AC-020/AC-021, W6R2-07/W6R3-02)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) fails closed on an unbound Work and supersedes its previous Plan on an upgrade (W6R3-04)",
        "apps/daemon/test/tool-handler.integration.test.ts :: daemon tool handler refuses a source write when no Plan gate is wired (AC-013, fail-closed)",
        "apps/daemon/test/tool-handler.integration.test.ts :: daemon tool handler refuses a source write with no approved Plan for the Work revision (AC-013)",
        "packages/core/test/base-revision.integration.test.ts :: work.baseRevision writer (Q-T3-4, AC-013) reads the delivery ref the project really points at",
        "packages/core/test/base-revision.integration.test.ts :: work.baseRevision writer (Q-T3-4, AC-013) binds a new Work to that revision and lets requestCodeWrite pass",
        "packages/core/test/base-revision.integration.test.ts :: work.baseRevision writer (Q-T3-4, AC-013) binds nothing when the project has no delivery ref yet",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) refuses the superseded Plan after an upgrade and leaves the source hash unchanged (AC-009, AC-013)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-014",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses a write without an approved Plan and leaves the source hash unchanged (AC-013)",
        "packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses a Plan for another revision and a changed Plan hash (AC-013 required failure test)",
        "packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) admits the write when the Plan is approved for the current revision (AC-014)",
        "packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) auto-approves a compliant Plan with recorded evidence (AC-014)",
        "packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) never auto-approves a product choice or an out-of-scope Plan (AC-014 negative)",
        "packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) covers targets only by equality or a directory prefix",
        "packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses an over-used budget instead of assuming a zero usage (AC-022, W6R1-03)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses a code write with no approved Plan and leaves the source hash unchanged (AC-013)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) auto-approves a compliant Plan, stores the evidence and admits the write (AC-014)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) rejects a non-compliant Plan without writing any gate state (AC-014 negative)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses a stale Plan after a level upgrade and marks it stale (AC-009)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses an upgrade whose replacement Plan was never approved (AC-009 negative)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) keeps Plan versions monotonic across submissions (AC-014)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses a Plan whose reservation exceeds the budget once real usage counts (AC-022, W6R1-03)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) re-reads the authorization at write time and refuses a revoked envelope (AC-013, W6R1-05)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) compares the approval source hash with the live measurement (AC-013, W6R1-07)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) distinguishes a no-op from a real upgrade and touches nothing on a no-op (AC-009, W6R1-06)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses a downgrade without invalidating the still-valid Plan (AC-008/AC-009, W6R1-06)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) never lets a caller expectation replace the approved source hash (AC-013, W6R2-02)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) reserves the approved tokens so a second Plan cannot exceed the limit (AC-022, W6R2-06)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) admits a code write only while the Work is running (AC-020/AC-021, W6R2-07/W6R3-02)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) fails closed on an unbound Work and supersedes its previous Plan on an upgrade (W6R3-04)",
        "apps/daemon/test/provider-config.integration.test.ts :: plan.approve queues the next Run (WP-12 T2.6, Q3=A) creates a real queued professional Run as a direct child of the Chief Run (AC-014)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-015",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) handling now needs a new Product/Plan and invalidates affected evidence (AC-015)",
        "packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) queues a Requirement for later and leaves the acceptance alone (AC-016)",
        "packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) declining records a reason and changes nothing (AC-016)",
        "packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) resolves the Requirement state for each branch (AC-016)",
        "packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) invalidates by path and falls back to invalidating everything",
        "packages/core/test/decisions.test.ts :: behaviour Decisions (AC-015, AC-016) handles a product change now: new Product/Plan versions and invalidated evidence (AC-015)",
        "packages/core/test/decisions.test.ts :: behaviour Decisions (AC-015, AC-016) queues a Requirement for later without moving the current acceptance (AC-016)",
        "packages/core/test/decisions.test.ts :: behaviour Decisions (AC-015, AC-016) records a reason when the suggestion is declined and leaves acceptance unchanged (AC-016)",
        "packages/core/test/decisions.test.ts :: behaviour Decisions (AC-015, AC-016) keeps Product and Plan versions monotonic across several decisions (AC-015)",
        "packages/core/test/decisions.test.ts :: behaviour Decisions (AC-015, AC-016) refuses a decision for an unknown Work without writing anything"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-016",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) handling now needs a new Product/Plan and invalidates affected evidence (AC-015)",
        "packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) queues a Requirement for later and leaves the acceptance alone (AC-016)",
        "packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) declining records a reason and changes nothing (AC-016)",
        "packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) resolves the Requirement state for each branch (AC-016)",
        "packages/domain/test/delivery.test.ts :: behaviour choices (AC-015/AC-016) invalidates by path and falls back to invalidating everything",
        "packages/core/test/decisions.test.ts :: behaviour Decisions (AC-015, AC-016) handles a product change now: new Product/Plan versions and invalidated evidence (AC-015)",
        "packages/core/test/decisions.test.ts :: behaviour Decisions (AC-015, AC-016) queues a Requirement for later without moving the current acceptance (AC-016)",
        "packages/core/test/decisions.test.ts :: behaviour Decisions (AC-015, AC-016) records a reason when the suggestion is declined and leaves acceptance unchanged (AC-016)",
        "packages/core/test/decisions.test.ts :: behaviour Decisions (AC-015, AC-016) keeps Product and Plan versions monotonic across several decisions (AC-015)",
        "packages/core/test/decisions.test.ts :: behaviour Decisions (AC-015, AC-016) refuses a decision for an unknown Work without writing anything"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-017",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) returns work to development without a human forwarding step (AC-017)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) invalidates the old Review/Test after a fix and refuses self-verification (AC-017/AC-018)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) binds the verification to the fixing revision and the real Test conclusion (AC-018, W6R1-01/W6R1-08)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) closes through evaluateFindingClosure and stops at the rework allowance (AC-017/AC-022)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) blocks completion for blocked and undisposed not_covered results (AC-019)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) binds a document/integration Finding without a taskId (AC-083)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) routes a document Finding through the same closure rules (AC-083)",
        "packages/domain/test/delivery.test.ts :: evidence validity and revision lineage (AC-017/AC-019, W6R2-01…W6R2-05) accepts only valid evidence frozen on the Work revision",
        "packages/domain/test/delivery.test.ts :: evidence validity and revision lineage (AC-017/AC-019, W6R2-01…W6R2-05) refuses invalidated evidence whatever revision it names (AC-017)",
        "packages/domain/test/delivery.test.ts :: evidence validity and revision lineage (AC-017/AC-019, W6R2-01…W6R2-05) fails closed on evidence without a revision and on a Work without one (W6R2-04)",
        "packages/domain/test/delivery.test.ts :: evidence validity and revision lineage (AC-017/AC-019, W6R2-01…W6R2-05) refuses an explicitly invalidated revision even when the evidence claims valid",
        "packages/domain/test/delivery.test.ts :: evidence validity and revision lineage (AC-017/AC-019, W6R2-01…W6R2-05) refuses pre-fix evidence and evidence produced at or before the fix (W6R2-01/03)",
        "packages/domain/test/delivery.test.ts :: evidence validity and revision lineage (AC-017/AC-019, W6R2-01…W6R2-05) refuses evidence bound to a different revision than the Work (binding, not order)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) binds a task-less integration Finding and sends it straight back to development (AC-083, AC-017)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a task target without a taskId, a foreign task and a developer Run, writing nothing (AC-083)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) closes a fixed Finding only after a new independent Review and Test, and refuses a developer self-verify (AC-018)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a pre-fix revision and a non-passed Test conclusion even when the Runs are new (AC-018, W6R1-01/W6R1-08)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses an old Review, the raising Review and a wrong-role Run as the fix verifier (AC-017, AC-018)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) records a user-accepted residual risk only from a real accepted risk Decision (AC-018)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) never completes on a blocked Test result and never on a caller-asserted one (AC-019, W6R1-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a Test evidence bound to another revision or without an environment (AC-019, W6R1-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) requires an explicit risk disposition for every not_covered acceptance id (AC-019)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) completes a passed Test result with no uncovered acceptance ids (AC-019)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) never completes a code L2 Work on a Test Run alone (AC-010/AC-019, W6R4-01)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) blocks completion while a blocking Finding is open or addressed (AC-017, AC-019)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) pauses at a safe point, admits no write, and resumes into a new Attempt after the version check (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to resume a Work that changed while it was paused (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to pause while a Run still needs recovery (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to resume while a Run still needs recovery (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to resume a recovery_required Run that has no persisted verdict (WP11R4-04)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to pause a blocked Work, which recovers through its own path (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) walks a queued Work to the pause safe point (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) cancels the Run tree through cancelling to cancelled, keeping the artifacts un-integrated (AC-021)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) stops at blocked(recovery) when side effects are unknown and only then reaches cancelled (AC-021)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) lets a recovery decision resume the Work instead of cancelling it (AC-021)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to cancel a finished Work",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) never completes on Test evidence a Finding invalidated and advances the revision on the fix (AC-017/AC-019, W6R2-01)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a fix whose Run self-reports the invalidated pre-fix revision (AC-018, W6R2-03)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to complete a Work that froze no base revision (AC-019, W6R2-04)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) binds a Test to its frozen VerificationManifest when the Run produced no artifact (AC-019, W6R2-05)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) fails closed when a stage result names a manifest that is not frozen (W6R2-05)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) admits a write only when the newest Attempt is ready (AC-020, W6R2-08)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) completes an L1 Work without a Test Run, through its Review and a frozen CompletionManifest (AC-007/AC-019, W6R2-09)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) reports review evidence under review fields and no test status on an L1 completion (AC-007, W6R4-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) keeps the document route on its own rule: Review evidence, no code Test Run (AC-012, W6R2-09)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) derives the completion route from the Work intent and refuses a conflicting one (AC-019, W6R3-01)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses every write once the Work is completed or failed, with zero write events (AC-013/AC-020, W6R3-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses writes after a cancel stops at blocked(recovery) (AC-021, W6R3-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a fix that re-anchors to a revision a Finding invalidated (AC-017/AC-018, W6R3-03)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) keeps the frozen-manifest lookup on the real manifestId key space (W6R3-05)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) closes a task-less Review Finding through a fix and a new independent Review/Test, refusing self-verification (AC-017, AC-018, AC-083)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-018",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) returns work to development without a human forwarding step (AC-017)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) invalidates the old Review/Test after a fix and refuses self-verification (AC-017/AC-018)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) binds the verification to the fixing revision and the real Test conclusion (AC-018, W6R1-01/W6R1-08)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) closes through evaluateFindingClosure and stops at the rework allowance (AC-017/AC-022)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) blocks completion for blocked and undisposed not_covered results (AC-019)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) binds a document/integration Finding without a taskId (AC-083)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) routes a document Finding through the same closure rules (AC-083)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) closes a fixed Finding only after a new independent Review and Test, and refuses a developer self-verify (AC-018)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a pre-fix revision and a non-passed Test conclusion even when the Runs are new (AC-018, W6R1-01/W6R1-08)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses an old Review, the raising Review and a wrong-role Run as the fix verifier (AC-017, AC-018)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) records a user-accepted residual risk only from a real accepted risk Decision (AC-018)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a fix whose Run self-reports the invalidated pre-fix revision (AC-018, W6R2-03)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a fix that re-anchors to a revision a Finding invalidated (AC-017/AC-018, W6R3-03)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) closes a task-less Review Finding through a fix and a new independent Review/Test, refusing self-verification (AC-017, AC-018, AC-083)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-019",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) returns work to development without a human forwarding step (AC-017)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) invalidates the old Review/Test after a fix and refuses self-verification (AC-017/AC-018)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) binds the verification to the fixing revision and the real Test conclusion (AC-018, W6R1-01/W6R1-08)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) closes through evaluateFindingClosure and stops at the rework allowance (AC-017/AC-022)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) blocks completion for blocked and undisposed not_covered results (AC-019)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) binds a document/integration Finding without a taskId (AC-083)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) routes a document Finding through the same closure rules (AC-083)",
        "packages/domain/test/delivery.test.ts :: evidence validity and revision lineage (AC-017/AC-019, W6R2-01…W6R2-05) accepts only valid evidence frozen on the Work revision",
        "packages/domain/test/delivery.test.ts :: evidence validity and revision lineage (AC-017/AC-019, W6R2-01…W6R2-05) refuses invalidated evidence whatever revision it names (AC-017)",
        "packages/domain/test/delivery.test.ts :: evidence validity and revision lineage (AC-017/AC-019, W6R2-01…W6R2-05) fails closed on evidence without a revision and on a Work without one (W6R2-04)",
        "packages/domain/test/delivery.test.ts :: evidence validity and revision lineage (AC-017/AC-019, W6R2-01…W6R2-05) refuses an explicitly invalidated revision even when the evidence claims valid",
        "packages/domain/test/delivery.test.ts :: evidence validity and revision lineage (AC-017/AC-019, W6R2-01…W6R2-05) refuses pre-fix evidence and evidence produced at or before the fix (W6R2-01/03)",
        "packages/domain/test/delivery.test.ts :: evidence validity and revision lineage (AC-017/AC-019, W6R2-01…W6R2-05) refuses evidence bound to a different revision than the Work (binding, not order)",
        "packages/domain/test/delivery.test.ts :: route-aware completion evidence (AC-007/AC-012/AC-019, W6R2-09) selects a Test for code L2/L3 and the route Review otherwise",
        "packages/domain/test/delivery.test.ts :: route-aware completion evidence (AC-007/AC-012/AC-019, W6R2-09) requires an independent Review in addition to the Test for code L2/L3 (W6R4-01)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) never completes on a blocked Test result and never on a caller-asserted one (AC-019, W6R1-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a Test evidence bound to another revision or without an environment (AC-019, W6R1-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) requires an explicit risk disposition for every not_covered acceptance id (AC-019)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) completes a passed Test result with no uncovered acceptance ids (AC-019)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) never completes a code L2 Work on a Test Run alone (AC-010/AC-019, W6R4-01)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) blocks completion while a blocking Finding is open or addressed (AC-017, AC-019)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) never completes on Test evidence a Finding invalidated and advances the revision on the fix (AC-017/AC-019, W6R2-01)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to complete a Work that froze no base revision (AC-019, W6R2-04)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) binds a Test to its frozen VerificationManifest when the Run produced no artifact (AC-019, W6R2-05)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) completes an L1 Work without a Test Run, through its Review and a frozen CompletionManifest (AC-007/AC-019, W6R2-09)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) derives the completion route from the Work intent and refuses a conflicting one (AC-019, W6R3-01)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-020",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: the shared write barrier (AC-020/AC-021, W6R2-07/W6R3-02) admits writes only while the Work is running",
        "packages/domain/test/delivery.test.ts :: the shared write barrier (AC-020/AC-021, W6R2-07/W6R3-02) never lets a caller expectation replace the approved source hash (W6R2-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) pauses at a safe point, admits no write, and resumes into a new Attempt after the version check (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to resume a Work that changed while it was paused (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to pause while a Run still needs recovery (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to resume while a Run still needs recovery (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to pause a blocked Work, which recovers through its own path (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) walks a queued Work to the pause safe point (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) admits a write only when the newest Attempt is ready (AC-020, W6R2-08)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses every write once the Work is completed or failed, with zero write events (AC-013/AC-020, W6R3-02)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) admits a code write only while the Work is running (AC-020/AC-021, W6R2-07/W6R3-02)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) pauses and resumes a real Work through the finding service (AC-020 surface)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) pauses at a safe point, resumes into a new Attempt, and cancels the Run tree while keeping the artifacts (AC-020, AC-021)",
        "packages/core/test/wp08.integration.test.ts :: WP-08 T4 end-to-end integration drill still holds pause/resume and unknown-side-effect cancel after an integrated delivery (AC-020, AC-021)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-021",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: the shared write barrier (AC-020/AC-021, W6R2-07/W6R3-02) admits writes only while the Work is running",
        "packages/domain/test/delivery.test.ts :: the shared write barrier (AC-020/AC-021, W6R2-07/W6R3-02) never lets a caller expectation replace the approved source hash (W6R2-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) binds a task-less integration Finding and sends it straight back to development (AC-083, AC-017)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a task target without a taskId, a foreign task and a developer Run, writing nothing (AC-083)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) closes a fixed Finding only after a new independent Review and Test, and refuses a developer self-verify (AC-018)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a pre-fix revision and a non-passed Test conclusion even when the Runs are new (AC-018, W6R1-01/W6R1-08)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses an old Review, the raising Review and a wrong-role Run as the fix verifier (AC-017, AC-018)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) records a user-accepted residual risk only from a real accepted risk Decision (AC-018)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) never completes on a blocked Test result and never on a caller-asserted one (AC-019, W6R1-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a Test evidence bound to another revision or without an environment (AC-019, W6R1-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) requires an explicit risk disposition for every not_covered acceptance id (AC-019)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) completes a passed Test result with no uncovered acceptance ids (AC-019)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) never completes a code L2 Work on a Test Run alone (AC-010/AC-019, W6R4-01)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) blocks completion while a blocking Finding is open or addressed (AC-017, AC-019)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) pauses at a safe point, admits no write, and resumes into a new Attempt after the version check (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to resume a Work that changed while it was paused (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to pause while a Run still needs recovery (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to resume while a Run still needs recovery (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to resume a recovery_required Run that has no persisted verdict (WP11R4-04)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to pause a blocked Work, which recovers through its own path (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) walks a queued Work to the pause safe point (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) cancels the Run tree through cancelling to cancelled, keeping the artifacts un-integrated (AC-021)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) stops at blocked(recovery) when side effects are unknown and only then reaches cancelled (AC-021)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) lets a recovery decision resume the Work instead of cancelling it (AC-021)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to cancel a finished Work",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) never completes on Test evidence a Finding invalidated and advances the revision on the fix (AC-017/AC-019, W6R2-01)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a fix whose Run self-reports the invalidated pre-fix revision (AC-018, W6R2-03)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to complete a Work that froze no base revision (AC-019, W6R2-04)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) binds a Test to its frozen VerificationManifest when the Run produced no artifact (AC-019, W6R2-05)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) fails closed when a stage result names a manifest that is not frozen (W6R2-05)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) admits a write only when the newest Attempt is ready (AC-020, W6R2-08)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) completes an L1 Work without a Test Run, through its Review and a frozen CompletionManifest (AC-007/AC-019, W6R2-09)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) reports review evidence under review fields and no test status on an L1 completion (AC-007, W6R4-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) keeps the document route on its own rule: Review evidence, no code Test Run (AC-012, W6R2-09)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) derives the completion route from the Work intent and refuses a conflicting one (AC-019, W6R3-01)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses every write once the Work is completed or failed, with zero write events (AC-013/AC-020, W6R3-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses writes after a cancel stops at blocked(recovery) (AC-021, W6R3-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a fix that re-anchors to a revision a Finding invalidated (AC-017/AC-018, W6R3-03)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) keeps the frozen-manifest lookup on the real manifestId key space (W6R3-05)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) admits a code write only while the Work is running (AC-020/AC-021, W6R2-07/W6R3-02)",
        "packages/core/test/wp08-failures.test.ts :: required WP-08 failure tests 取消未知副作用: cancel stops at blocked(recovery), keeps the Requirement active and integrates nothing (AC-021)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) runs the L1 typo chain to a CompletionManifest and CAS with no Planning/Test Run and no board entry (AC-007)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) drives a validated ProductDefinition through Plan/Develop/Review/Test/Settlement in order (AC-010)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) saves a confirmed design as Product/Planning candidate diffs with an independent Review and Settlement only (AC-012)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) requires explicit authorization, rollback, per-item audit and a recovery drill before an L3 migration is implemented (AC-011)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) closes a task-less Review Finding through a fix and a new independent Review/Test, refusing self-verification (AC-017, AC-018, AC-083)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) pauses at a safe point, resumes into a new Attempt, and cancels the Run tree while keeping the artifacts (AC-020, AC-021)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) shows an imported active Requirement as waiting to continue and re-plans it in a new Work without reusing old verification (AC-089)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) refuses the superseded Plan after an upgrade and leaves the source hash unchanged (AC-009, AC-013)",
        "packages/core/test/wp08.integration.test.ts :: WP-08 T4 end-to-end integration drill still holds pause/resume and unknown-side-effect cancel after an integrated delivery (AC-020, AC-021)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-022",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: gate readiness (AC-013/AC-014) refuses an over-used budget instead of assuming a zero usage (AC-022, W6R1-03)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) closes through evaluateFindingClosure and stops at the rework allowance (AC-017/AC-022)",
        "packages/domain/test/delivery.test.ts :: budget reservation (AC-022) refuses an over-limit reservation atomically with no partial charge (AC-022)",
        "packages/domain/test/delivery.test.ts :: budget reservation (AC-022) admits a reservation that fits, even just under the limit (AC-022)",
        "packages/domain/test/delivery.test.ts :: budget reservation (AC-022) reports that a top-up must be explicit and user sourced (AC-022)",
        "packages/domain/test/delivery.test.ts :: budget reservation (AC-022) refuses the next rework round once the repair allowance is spent (AC-022)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) refuses a Plan whose reservation exceeds the budget once real usage counts (AC-022, W6R1-03)",
        "packages/core/test/gates.test.ts :: Plan gate persistence (AC-009, AC-013, AC-014) reserves the approved tokens so a second Plan cannot exceed the limit (AC-022, W6R2-06)",
        "packages/core/test/wp08.integration.test.ts :: WP-08 T4 end-to-end integration drill refuses an over-limit budget reservation atomically and keeps the refusal after integration (AC-022)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-023",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/daemon/test/project-lifecycle.integration.test.ts :: installation project directory (WP-12 T5.1/T5.2) opens two real roots with independent ids, databases and registries (AC-023)",
        "apps/web/test/multi-project.integration.test.ts :: single-entry multi-project BFF (WP-12 T5.5) renders each project page from its own daemon and never from the other (AC-023/AC-034)",
        "packages/core/test/identity.integration.test.ts :: independent projects (AC-023) gives two real roots distinct ids and independent databases"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-024",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/identity.integration.test.ts :: canonical roots (AC-024) normalizes a subdirectory to the repository root",
        "packages/core/test/identity.integration.test.ts :: canonical roots (AC-024) normalizes a trailing separator and a symlinked path",
        "packages/core/test/identity.integration.test.ts :: canonical roots (AC-024) finds the git root from a deep directory and reports no git root outside one",
        "packages/core/test/identity.integration.test.ts :: canonical roots (AC-024) derives the project id from the canonical root hash",
        "packages/core/test/identity.integration.test.ts :: nested repositories (AC-024) finds nested repositories and excludes their paths from the parent",
        "packages/core/test/identity.integration.test.ts :: nested repositories (AC-024) does not treat an unrelated directory as nested",
        "packages/core/test/identity.integration.test.ts :: nested repositories (AC-024) bounds the nested scan by depth",
        "packages/core/test/identity.integration.test.ts :: nested repositories (AC-024) can skip the nested scan entirely"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-025",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/workspace/test/initialize.test.ts :: empty project (AC-025) creates the initial Git and delivery branch, then confirms an unimplemented project",
        "apps/daemon/test/project-lifecycle.integration.test.ts :: installation project directory (WP-12 T5.1/T5.2) creates a project in an empty directory with Git, the delivery branch and the events (AC-025)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-026",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/daemon/test/project-initialization.integration.test.ts :: project.initialize over the real state machine (WP-12 T5.3) investigates a legacy project and reaches Ready without moving the code (AC-026)",
        "packages/workspace/test/scan.test.ts :: scanProject budgets stops at 40 body files and reports a partial map with explicit unknowns",
        "packages/workspace/test/scan.test.ts :: scanProject budgets stops before exceeding 512 KiB of body content",
        "packages/workspace/test/scan.test.ts :: scanProject exclusions does not follow symlinks and reports escapes and broken links as unknowns",
        "packages/workspace/test/scan.test.ts :: candidate knowledge generates observed candidate features and documents without touching a delivery ref",
        "packages/workspace/test/scan.test.ts :: candidate knowledge records git-unavailable as an unknown instead of claiming a revision",
        "packages/workspace/test/scan.test.ts :: file fixtures stay untouched by scanning does not create files while scanning"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-027",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/daemon/test/project-initialization.integration.test.ts :: project.initialize over the real state machine (WP-12 T5.3) never silently re-initializes an existing repository from a bare new-mode request (AC-027)",
        "apps/daemon/test/project-initialization.integration.test.ts :: initialize driver blockers (WP-12 T5.3) refuses to run git init without the explicit mode and reports the request (AC-027)",
        "packages/workspace/test/initialize.test.ts :: no-Git directory returns Blocked with the Git-initialization authorization request",
        "packages/workspace/test/initialize.test.ts :: dirty workspace blocks delivery start with a hash report while read-only investigation still works"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-028",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/daemon/test/project-initialization.integration.test.ts :: project.initialize over the real state machine (WP-12 T5.3) blocks a dirty workspace with a per-path hash report and keeps investigation working (AC-028)",
        "packages/workspace/test/initialize.test.ts :: dirty workspace blocks delivery start with a hash report while read-only investigation still works"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-029",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/daemon/test/project-initialization.integration.test.ts :: project.initialize over the real state machine (WP-12 T5.3) stops on a workspace it must not overwrite and reports the real per-path hashes (AC-029)",
        "packages/core/test/wp08.integration.test.ts :: WP-08 T4 end-to-end integration drill runs the initialization route: interrupted writing resumes by hash and a conflict is never overwritten (AC-029)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-030",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/context-builder.test.ts :: buildContext — happy path (AC-030) freezes the documented fields and copies the content into the snapshot directory",
        "packages/core/test/context-builder.test.ts :: buildContext — happy path (AC-030) accounts tokens with the documented character/4 estimator by default",
        "packages/core/test/context-builder.test.ts :: buildContext — happy path (AC-030) resolves an artifact id@version through the fetch port",
        "packages/core/test/context-builder.test.ts :: buildContext — selection validation (AC-030) rejects a selection entry without a reason and lists the offender",
        "packages/core/test/context-builder.test.ts :: buildContext — selection validation (AC-030) rejects a blank goal",
        "packages/core/test/context-builder.test.ts :: buildContext — selection validation (AC-030) rejects a budget ceiling that is not a non-negative integer",
        "packages/core/test/context-builder.test.ts :: buildContext — selection validation (AC-030) refuses a budget outside the documented 4096–2000000 range (AC-036)",
        "packages/core/test/context-builder.test.ts :: buildContext — selection validation (AC-030) rejects an artifactRef without its own reason",
        "packages/core/test/context-builder.test.ts :: buildContext — the selection is the authority over its overlay (AC-030) refuses an overlay that rewrites the declared path/version and freezes nothing",
        "packages/core/test/context-builder.test.ts :: buildContext — the selection is the authority over its overlay (AC-030) keeps the declared revision and path when the overlay only adds metadata",
        "packages/core/test/context-builder.test.ts :: buildContext — the selection is the authority over its overlay (AC-030) refuses an artifact overlay that names another version"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-031",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) returns MISSING_CONTEXT with the precise gap and no frozen snapshot",
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) does not expand a module to satisfy a gap",
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) does not let an asserted artifact-backed input satisfy the table (W5R2-04)",
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) starts initialize in an empty Project with a BootstrapObservation (AC-079 #1)",
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) starts initialize with a Project overview instead (AC-079 #1 alt)",
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) starts a Product stage with an overview and a confirmed source (AC-079 #2)",
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) starts Planning with only a ProductDefinition and acceptance (AC-079 #3)",
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) starts L1 Develop with only a CompactPlan (AC-079 #4)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-032",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) appends a reasoned read with its full identity and accounts its tokens",
        "packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) allocates seq 1..n in append order and never reuses a number",
        "packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) inherits the Run revision and lets one read override it",
        "packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) admits Feature navigation as shared knowledge",
        "packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) refuses a path outside readScope with CONTEXT_FORBIDDEN and appends nothing",
        "packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) refuses a Transcript path even when it sits inside a readable prefix (AC-033)",
        "packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) refuses the developer-chat/dev-transcript path markers (W5R1-05)",
        "packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) closes a throwing counter or clock instead of escaping (W5R1-10)",
        "packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) refuses another Work process directory",
        "packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) refuses an artifact class the stage may not read yet",
        "packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) refuses a read without a written reason with VALIDATION_ERROR",
        "packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) refuses a malformed path before it can reach the ACL",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) keeps reads beyond the scope impossible until a grant widens it",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) makes granted extra tokens usable and still enforces the ceiling without them",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) refuses an expansion grant outside the documented token range (W5R2-05)",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) records a denied request without changing the ledger",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) refuses a denial that smuggles scope or tokens",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) refuses a decision for a request that was never made with NOT_FOUND",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) refuses an expansion that would narrow the scope or change Project",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) refuses a grant that drops the permanent denials (W5R1-04)",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) refuses a Transcript, an escaping path or a reasonless expansion request",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) refuses a duplicate pending request for the same source",
        "apps/daemon/test/tool-handler.integration.test.ts :: daemon tool handler refuses a read outside the Attempt readScope at admission, leaking nothing (AC-032/AC-048)",
        "packages/core/test/read-ledger-seal.integration.test.ts :: read ledger seal (AC-085) records an out-of-scope read request in the same ledger (AC-032)",
        "packages/core/test/read-ledger-seal.integration.test.ts :: read ledger seal (AC-085) admits only paths inside the readScope, before anything is read (AC-032)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-033",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/context-acl.test.ts :: context ACL — transcript isolation (AC-033) denies the transcript kind to every role and stage",
        "packages/core/test/context-acl.test.ts :: context ACL — transcript isolation (AC-033) denies Review and Test every message body",
        "packages/core/test/context-acl.test.ts :: context ACL — transcript isolation (AC-033) denies a chat/transcript path marker to every role by path",
        "packages/core/test/context-acl.test.ts :: context ACL — transcript isolation (AC-033) rejects the documented path markers and accepts ordinary documents",
        "packages/core/test/context-acl.test.ts :: context ACL — transcript isolation (AC-033) refuses the dev-chat markers for a role whose prefixes would admit them (W5R1-05)",
        "packages/core/test/context-acl.test.ts :: context ACL — transcript isolation (AC-033) lets a Developer read the user request but never the transcript",
        "packages/core/test/context-builder.test.ts :: buildContext — ACL before resolution (AC-033, AC-034) refuses a transcript for a review Run without resolving or leaking its content",
        "packages/core/test/context-builder.test.ts :: buildContext — ACL before resolution (AC-033, AC-034) refuses a chat log by its path marker even when it is selected as a git source",
        "packages/core/test/context-builder.test.ts :: buildContext — ACL before resolution (AC-033, AC-034) refuses a handle that belongs to another Project (AC-034)",
        "packages/core/test/context-builder.test.ts :: buildContext — ACL before resolution (AC-033, AC-034) keeps a foreign Artifact out of the frozen result",
        "packages/core/test/context-builder.test.ts :: buildContext — ACL before resolution (AC-033, AC-034) refuses an artifact class that contradicts its blob path (W5R2-02)",
        "packages/core/test/context-checkpoint.test.ts :: checkpoint: only the current Run may write or read it (AC-033, AC-034) refuses a checkpoint that carries facts of another Run (no content in the answer)",
        "packages/core/test/context-checkpoint.test.ts :: checkpoint: only the current Run may write or read it (AC-033, AC-034) gives another Run/role no checkpoint content (AC-033/AC-034)",
        "packages/core/test/context-checkpoint.test.ts :: checkpoint: only the current Run may write or read it (AC-033, AC-034) refuses a Reviewer/Test Run registration from reading a development Run",
        "packages/core/test/context-checkpoint.test.ts :: checkpoint: only the current Run may write or read it (AC-033, AC-034) refuses a checkpoint that claims another Work (W5R1-09)",
        "packages/core/test/context-cold-start.test.ts :: cold start: the transcript is unreadable and cannot change the answer (AC-033) excludes a development-chat transcript with a reason instead of selecting it",
        "packages/core/test/context-cold-start.test.ts :: cold start: the transcript is unreadable and cannot change the answer (AC-033) refuses to read the transcript from a real directory, contents included",
        "packages/core/test/context-cold-start.test.ts :: cold start: the transcript is unreadable and cannot change the answer (AC-033) has the same answer with and without the transcript in the corpus",
        "packages/core/test/context-cold-start.test.ts :: cold start: the transcript is unreadable and cannot change the answer (AC-033) rejects a corpus registered through a transcript path pattern at the guard",
        "packages/core/test/context-cold-start.test.ts :: cold start: the transcript is unreadable and cannot change the answer (AC-033) refuses the dev-chat and developer-transcript path markers (W5R1-05)",
        "packages/core/test/context-cold-start.test.ts :: cold start: the transcript is unreadable and cannot change the answer (AC-033) refuses a corpus symlink that escapes the project root (W5R1-02)",
        "packages/core/test/context-cold-start.test.ts :: cold start: the transcript is unreadable and cannot change the answer (AC-033) rejects an empty query and a non-projection input",
        "packages/core/test/context-ledger.test.ts :: read ledger — append inside readScope (AC-032) refuses a Transcript path even when it sits inside a readable prefix (AC-033)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-034",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/context-acl.test.ts :: context ACL — cross-project isolation (AC-034) denies a source that belongs to another Project",
        "packages/core/test/context-acl.test.ts :: context ACL — cross-project isolation (AC-034) denies another Project source whatever the source class",
        "packages/core/test/context-acl.test.ts :: context ACL — cross-project isolation (AC-034) accepts a source of the same Project",
        "packages/core/test/context-builder.test.ts :: buildContext — ACL before resolution (AC-033, AC-034) refuses a transcript for a review Run without resolving or leaking its content",
        "packages/core/test/context-builder.test.ts :: buildContext — ACL before resolution (AC-033, AC-034) refuses a chat log by its path marker even when it is selected as a git source",
        "packages/core/test/context-builder.test.ts :: buildContext — ACL before resolution (AC-033, AC-034) refuses a handle that belongs to another Project (AC-034)",
        "packages/core/test/context-builder.test.ts :: buildContext — ACL before resolution (AC-033, AC-034) keeps a foreign Artifact out of the frozen result",
        "packages/core/test/context-builder.test.ts :: buildContext — ACL before resolution (AC-033, AC-034) refuses an artifact class that contradicts its blob path (W5R2-02)",
        "packages/core/test/context-checkpoint.test.ts :: checkpoint: only the current Run may write or read it (AC-033, AC-034) refuses a checkpoint that carries facts of another Run (no content in the answer)",
        "packages/core/test/context-checkpoint.test.ts :: checkpoint: only the current Run may write or read it (AC-033, AC-034) gives another Run/role no checkpoint content (AC-033/AC-034)",
        "packages/core/test/context-checkpoint.test.ts :: checkpoint: only the current Run may write or read it (AC-033, AC-034) refuses a Reviewer/Test Run registration from reading a development Run",
        "packages/core/test/context-checkpoint.test.ts :: checkpoint: only the current Run may write or read it (AC-033, AC-034) refuses a checkpoint that claims another Work (W5R1-09)",
        "apps/daemon/test/project-lifecycle.integration.test.ts :: project.* protocol surface (WP-12 T5.2) refuses a cross-project read at the daemon wall (AC-034)",
        "apps/web/test/multi-project.integration.test.ts :: single-entry multi-project BFF (WP-12 T5.5) renders each project page from its own daemon and never from the other (AC-023/AC-034)",
        "apps/web/test/multi-project.integration.test.ts :: single-entry multi-project BFF (WP-12 T5.5) routes /rpc by envelope projectId and fails closed for an unserved project (AC-034)",
        "apps/web/test/multi-project.integration.test.ts :: single-entry multi-project BFF (WP-12 T5.5) serves an artifact only through its own project route and rejects the token elsewhere (AC-034)",
        "apps/web/test/multi-project.integration.test.ts :: single-entry multi-project BFF (WP-12 T5.5) binds the event socket to one project and never replays another project cursor (AC-034/AC-060)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-035",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/context-checkpoint.test.ts :: checkpoint: session rotation (AC-035) recovers role/task/permissions/sources and keeps the approval state",
        "packages/core/test/context-checkpoint.test.ts :: checkpoint: session rotation (AC-035) leaves the stored session unchanged when there is no checkpoint to rotate (W5R1-08)",
        "packages/core/test/context-checkpoint.test.ts :: checkpoint: session rotation (AC-035) does not let a staleness/rotation of the message list touch the approval",
        "packages/core/test/context-checkpoint.test.ts :: checkpoint: compaction (AC-035) reduces recent message refs but leaves manifest/decisions/approval unchanged",
        "packages/core/test/context-checkpoint.test.ts :: checkpoint: compaction (AC-035) is a pure helper whose result carries the input approval and manifest"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-036",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/context-builder.test.ts :: buildContext — selection validation (AC-030) refuses a budget outside the documented 4096–2000000 range (AC-036)",
        "packages/core/test/context-builder.test.ts :: buildContext — budget (AC-036) reports BUDGET_EXCEEDED with the dropped ref and the missing tokens",
        "packages/core/test/context-builder.test.ts :: buildContext — budget (AC-036) drops an optional source instead of the whole package and names it",
        "packages/core/test/context-builder.test.ts :: buildContext — budget (AC-036) reports an artifact whose version moved on as STALE_ARTIFACT",
        "packages/core/test/context-cold-start.test.ts :: cold start: the answer recalls the fixed sample (AC-037) reports a precise budget gap instead of injecting more (AC-036)",
        "packages/core/test/context-ledger.test.ts :: read ledger — budget accounting (AC-036) charges the startup package and refuses the read that would exceed the ceiling",
        "packages/core/test/context-ledger.test.ts :: read ledger — budget accounting (AC-036) accounts tokens the frozen startup package already spent",
        "packages/core/test/context-ledger.test.ts :: read ledger — budget accounting (AC-036) refuses invalid budget input when the ledger is created",
        "packages/core/test/context-ledger.test.ts :: read ledger — budget accounting (AC-036) accepts the documented budget boundaries and the explicit empty budget",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) keeps reads beyond the scope impossible until a grant widens it",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) makes granted extra tokens usable and still enforces the ceiling without them",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) refuses an expansion grant outside the documented token range (W5R2-05)",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) records a denied request without changing the ledger",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) refuses a denial that smuggles scope or tokens",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) refuses a decision for a request that was never made with NOT_FOUND",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) refuses an expansion that would narrow the scope or change Project",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) refuses a grant that drops the permanent denials (W5R1-04)",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) refuses a Transcript, an escaping path or a reasonless expansion request",
        "packages/core/test/context-ledger.test.ts :: read ledger — reasoned expansion (AC-032, AC-036) refuses a duplicate pending request for the same source"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-037",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/knowledge/test/projection.test.ts :: projection build renders a feature body that parses back to the same facts (AC-037)",
        "packages/knowledge/test/projection.test.ts :: projection build never injects an unrelated document into the feature body or index (AC-037)",
        "packages/knowledge/test/views.test.ts :: knowledge views separates confirmed intent from delivered reality (AC-038, AC-037)",
        "packages/knowledge/test/views.test.ts :: knowledge views answers AC-037 from the feature body without injecting unrelated documents",
        "packages/core/test/context-cold-start.test.ts :: cold start: the answer recalls the fixed sample (AC-037) finds the current cancellation behaviour, the payment constraint, the test path and the gap",
        "packages/core/test/context-cold-start.test.ts :: cold start: the answer recalls the fixed sample (AC-037) does not inject the 20 unrelated documents (selected set and token usage)",
        "packages/core/test/context-cold-start.test.ts :: cold start: the answer recalls the fixed sample (AC-037) reports a precise budget gap instead of injecting more (AC-036)",
        "packages/core/test/context-cold-start.test.ts :: cold start: the answer recalls the fixed sample (AC-037) answers only from budget-admitted Features (W5R2-06)",
        "packages/core/test/context-cold-start.test.ts :: cold start: the answer recalls the fixed sample (AC-037) records each budget-refused source exactly once (W5R2-13)",
        "packages/core/test/context-cold-start.test.ts :: cold start: the answer recalls the fixed sample (AC-037) records a shared budget-refused ref once and merges its reasons (W5R3-03)",
        "packages/core/test/context-cold-start.test.ts :: cold start: the answer recalls the fixed sample (AC-037) charges the fixed seed against the startup budget and fails closed at zero (W5R1-07)",
        "packages/core/test/context-cold-start.test.ts :: cold start: the answer recalls the fixed sample (AC-037) refuses cold-start limits outside the documented range (W5R1-06)",
        "packages/core/test/context-cold-start.test.ts :: cold start: the answer recalls the fixed sample (AC-037) closes a throwing cold-start clock instead of escaping (W5R1-10)",
        "packages/core/test/context-cold-start.test.ts :: cold start: the answer recalls the fixed sample (AC-037) marks a stale projection as an unknown rather than presenting it as current"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        },
        {
          "tool": "pnpm test:live",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-038",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/knowledge/test/views.test.ts :: knowledge views separates confirmed intent from delivered reality (AC-038, AC-037)",
        "packages/knowledge/test/views.test.ts :: knowledge views keeps a Work overlay out of the delivered answer and out of another Work (AC-038)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-039",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/context-cold-start.test.ts :: cold start: selection order and reasons (AC-039) follows overview → current work → navigation → constraints → bodies, with a reason each",
        "packages/core/test/context-cold-start.test.ts :: cold start: selection order and reasons (AC-039) is deterministic: the same query selects the same entries in the same order"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-040",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/knowledge/test/projection.test.ts :: projection build keeps the last valid projection, marks it stale and reports KNOWLEDGE_INVALID (AC-040)",
        "packages/knowledge/test/projection.test.ts :: projection build republishes and clears stale after a valid document follows an invalid one (AC-040)",
        "packages/knowledge/test/projection.test.ts :: broken-link diagnostics in a projection (AC-040) gates delivery for the current requirement only when the requirement touches the feature",
        "packages/knowledge/test/views.test.ts :: knowledge views never presents a stale projection as current (AC-040)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-041",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) integrates B-on-A without re-applying the ancestor and settles the Requirement",
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) refuses a Task without a frozen manifest and writes nothing",
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) refuses a real merge conflict and leaves the delivery ref and the manifest untouched",
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) settlement refuses a Task whose manifest vanished before any write",
        "packages/core/test/settlement.integration.test.ts :: Final manifest and settlement consistency (AC-041) builds a manifest that binds the verified revision, tree, knowledge and evidence",
        "packages/core/test/settlement.integration.test.ts :: Final manifest and settlement consistency (AC-041) refuses an empty, foreign or stale verification set",
        "packages/core/test/settlement.integration.test.ts :: Final manifest and settlement consistency (AC-041) freezes and reads a CompletionManifest through the real snapshot table",
        "packages/core/test/settlement.integration.test.ts :: Knowledge patch through the projection rules (AC-041) emits knowledge.updated once on the real projection write and never without a change",
        "packages/core/test/settlement.integration.test.ts :: Knowledge patch through the projection rules (AC-041) updates the body, relations and entries and is found by a cold-start query",
        "packages/core/test/settlement.integration.test.ts :: Knowledge patch through the projection rules (AC-041) refuses invalid knowledge, publishes nothing and keeps the last valid projection stale",
        "packages/core/test/settlement.integration.test.ts :: Knowledge patch through the projection rules (AC-041) refuses to patch a document that is not valid knowledge",
        "packages/core/test/wp08.integration.test.ts :: WP-08 T4 end-to-end integration drill applies the settlement knowledge patch and a cold-start query finds the updated fact (AC-041)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        },
        {
          "tool": "pnpm test:live",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-042",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/knowledge/test/views.test.ts :: knowledge views lists observed-versus-confirmed gaps without accepting observed behaviour (AC-042)",
        "packages/workspace/test/initialize.test.ts :: design/code conflict (AC-042) blocks Confirming, never confirms the existing document and keeps candidates observed",
        "packages/workspace/test/scan.test.ts :: candidate knowledge reports an existing document that disagrees with the observed tree (AC-042)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-043",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) inherits run → project → global role → global default in order",
        "packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) blocks a role whose model is missing or unsupported instead of downgrading",
        "packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) freezes a profile into an immutable snapshot and keeps it stable",
        "packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) validates patch values and never widens fixed limits",
        "packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) refuses an unreadable file instead of starting with defaults",
        "packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) persists across reopen with the same versions",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) runs through the frozen profile of the Run",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) runs against a Provider that needs no secret (T-01)",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) refuses to admit a Run whose secret cannot be resolved (R18-05)",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) normalizes a legacy frozen provider that stored a null secretRef (R18-02)",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) forwards the configured output budget instead of a hard-coded 4096 cap",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) gives the connectivity probe a budget a reasoning model can answer within",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) tests an anonymous Provider connection without a secret (R18-03)",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) never switches model for an active Run when configuration changes",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) blocks a role with no usable model instead of falling back",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) refuses to run when the frozen snapshot is gone or the secret is missing",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) reports a provider failure without hiding it",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) tests a configured provider against the live document"
      ],
      "drills": [
        {
          "tool": "pnpm test:live",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-044",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) inherits run → project → global role → global default in order",
        "packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) blocks a role whose model is missing or unsupported instead of downgrading",
        "packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) freezes a profile into an immutable snapshot and keeps it stable",
        "packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) validates patch values and never widens fixed limits",
        "packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) refuses an unreadable file instead of starting with defaults",
        "packages/core/test/config.test.ts :: role configuration (AC-043, AC-044) persists across reopen with the same versions",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) runs through the frozen profile of the Run",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) runs against a Provider that needs no secret (T-01)",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) refuses to admit a Run whose secret cannot be resolved (R18-05)",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) normalizes a legacy frozen provider that stored a null secretRef (R18-02)",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) forwards the configured output budget instead of a hard-coded 4096 cap",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) gives the connectivity probe a budget a reasoning model can answer within",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) tests an anonymous Provider connection without a secret (R18-03)",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) never switches model for an active Run when configuration changes",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) blocks a role with no usable model instead of falling back",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) refuses to run when the frozen snapshot is gone or the secret is missing",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) reports a provider failure without hiding it",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) tests a configured provider against the live document",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) records an immutable assessment with the routing evidence",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) applies the documented routing floor from the payload alone (R9-01, DC-62)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) fails closed on unknown risk flags and on authorization provenance (R10-01/R10-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) never lets an intent label open the L3 gates (R11-01/R11-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) requires a verified authorization to create a Run for an L3 Work (R11-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) applies the L3 floor from the spec scope, not only the Work level (R12-01/R12-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) treats the authorization envelope as the scope boundary (R13-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) treats git as a workspace write and network targets as network writes (R14-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) requires a matching capability for every declared dimension (R15-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) lets a none-level Work produce its own artifact but not act on the world (R16-01/M-1)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) counts a local write operation as modification authority (R13-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) cleans absent optional fields instead of failing on the snapshot (R13-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) never freezes write authority for a none-level Work (R12-01, DC-66)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) freezes the authorization the Core actually verified (R12-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) routes environment operations to L3 whatever the intent label says (R10-07)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) rejects a malformed runParams and dispatch authorization before writing (R10-05)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) requires explicit authorization for L3 and refuses an unknown Work",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) freezes config, context and dispatch before queueing the Run",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) creates a professional Run only as a direct child of the Chief Run",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) binds a professional Run to a task of the same Work",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) refuses a stale profileRevision instead of running an unexpected model",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) refuses a dispatch that the role may not carry or that the budget cannot fund",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) blocks the dispatch when the role has no usable model",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) restores the narrow frozen scope after a restart (AC-082)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) reserves the Work budget on dispatch and releases it when the Run ends",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) applies the authorized Run parameter layer when freezing a profile",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) refuses an assessment below the level the routing rules require",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) frees a settled child's share of the parent allocation (M-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) charges measured usage and records an unmeasured release honestly (M-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) keeps budget accounting honest across cancel, over-usage and replay (R5-02/03/04/09)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) caps a usage report that exceeds the reservation and records the excess (R5-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) reconciles usage once and only consumes its own hold (R5-04)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) reports a malformed spec as VALIDATION_ERROR and writes no snapshot (R7-01/R7-07)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) rejects malformed protocol requests before persisting anything (R8-01/R8-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) leaves no snapshot behind when the frozen inputs are invalid (R8-04/R8-09)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) treats a different cost for the same Run as a conflict (R7-02/R7-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) releases the reservation of a never-started child when a parent is cancelled (R7-09)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) never re-books an already measured Run (R6-01/R6-04/R6-05)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) books measured usage on cancellation and refuses a contradictory report (R6-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) derives an idempotency key and reports bad input as VALIDATION_ERROR (R6-09/R6-10)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) answers an operationId replay even after the Chief Run has ended (R5-09)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) refuses to end a parent while join=all children are live, and cancel propagates (Q-04)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) rejects a reused operationId with a different payload (Q-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) refuses a dispatch request when the Chief Run itself cannot act (H-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) turns an agent dispatch request into a chief todo, never a grandchild Run",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) persists the assessed level on the Work so the next dispatch is authorized",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) derives the authorization from the assessment and freezes a real Run (Q1=B)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) injects the profile revision instead of trusting the draft (data.md §3)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) caps the allocation at what the parent Chief Run can still fund (N-10)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) fails closed on an empty scope: nothing is derived and the dispatch is refused",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) refuses a path that would leave the project root before writing authority",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) fails closed on an environment operation",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) keeps an existing authorization instead of deriving a second one",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) assessWithDerivation writes the authority the assessment path will reuse",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) refuses an out-of-envelope agent.dispatch with zero residue (WP-12 T2.5)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) refuses to queue a child Run the Chief Run cannot fund (review P3)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) refuses an agent.dispatch write scope with no authorization (review P2-1)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) refuses agent.dispatch from a Run that is not the Work’s Chief",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) leaves no Run or snapshot behind when the draft spec is invalid"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-045",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) runs through the frozen profile of the Run",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) runs against a Provider that needs no secret (T-01)",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) refuses to admit a Run whose secret cannot be resolved (R18-05)",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) normalizes a legacy frozen provider that stored a null secretRef (R18-02)",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) forwards the configured output budget instead of a hard-coded 4096 cap",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) gives the connectivity probe a budget a reasoning model can answer within",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) tests an anonymous Provider connection without a secret (R18-03)",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) never switches model for an active Run when configuration changes",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) blocks a role with no usable model instead of falling back",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) refuses to run when the frozen snapshot is gone or the secret is missing",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) reports a provider failure without hiding it",
        "packages/core/test/model-gateway.test.ts :: model gateway (AC-043, AC-044, AC-045) tests a configured provider against the live document",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) records an immutable assessment with the routing evidence",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) applies the documented routing floor from the payload alone (R9-01, DC-62)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) fails closed on unknown risk flags and on authorization provenance (R10-01/R10-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) never lets an intent label open the L3 gates (R11-01/R11-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) requires a verified authorization to create a Run for an L3 Work (R11-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) applies the L3 floor from the spec scope, not only the Work level (R12-01/R12-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) treats the authorization envelope as the scope boundary (R13-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) treats git as a workspace write and network targets as network writes (R14-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) requires a matching capability for every declared dimension (R15-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) lets a none-level Work produce its own artifact but not act on the world (R16-01/M-1)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) counts a local write operation as modification authority (R13-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) cleans absent optional fields instead of failing on the snapshot (R13-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) never freezes write authority for a none-level Work (R12-01, DC-66)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) freezes the authorization the Core actually verified (R12-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) routes environment operations to L3 whatever the intent label says (R10-07)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) rejects a malformed runParams and dispatch authorization before writing (R10-05)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) requires explicit authorization for L3 and refuses an unknown Work",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) freezes config, context and dispatch before queueing the Run",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) creates a professional Run only as a direct child of the Chief Run",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) binds a professional Run to a task of the same Work",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) refuses a stale profileRevision instead of running an unexpected model",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) refuses a dispatch that the role may not carry or that the budget cannot fund",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) blocks the dispatch when the role has no usable model",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) restores the narrow frozen scope after a restart (AC-082)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) reserves the Work budget on dispatch and releases it when the Run ends",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) applies the authorized Run parameter layer when freezing a profile",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) refuses an assessment below the level the routing rules require",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) frees a settled child's share of the parent allocation (M-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) charges measured usage and records an unmeasured release honestly (M-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) keeps budget accounting honest across cancel, over-usage and replay (R5-02/03/04/09)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) caps a usage report that exceeds the reservation and records the excess (R5-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) reconciles usage once and only consumes its own hold (R5-04)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) reports a malformed spec as VALIDATION_ERROR and writes no snapshot (R7-01/R7-07)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) rejects malformed protocol requests before persisting anything (R8-01/R8-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) leaves no snapshot behind when the frozen inputs are invalid (R8-04/R8-09)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) treats a different cost for the same Run as a conflict (R7-02/R7-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) releases the reservation of a never-started child when a parent is cancelled (R7-09)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) never re-books an already measured Run (R6-01/R6-04/R6-05)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) books measured usage on cancellation and refuses a contradictory report (R6-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) derives an idempotency key and reports bad input as VALIDATION_ERROR (R6-09/R6-10)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) answers an operationId replay even after the Chief Run has ended (R5-09)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) refuses to end a parent while join=all children are live, and cancel propagates (Q-04)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) rejects a reused operationId with a different payload (Q-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) refuses a dispatch request when the Chief Run itself cannot act (H-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) turns an agent dispatch request into a chief todo, never a grandchild Run",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) persists the assessed level on the Work so the next dispatch is authorized",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) derives the authorization from the assessment and freezes a real Run (Q1=B)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) injects the profile revision instead of trusting the draft (data.md §3)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) caps the allocation at what the parent Chief Run can still fund (N-10)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) fails closed on an empty scope: nothing is derived and the dispatch is refused",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) refuses a path that would leave the project root before writing authority",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) fails closed on an environment operation",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) keeps an existing authorization instead of deriving a second one",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) assessWithDerivation writes the authority the assessment path will reuse",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) refuses an out-of-envelope agent.dispatch with zero residue (WP-12 T2.5)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) refuses to queue a child Run the Chief Run cannot fund (review P3)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) refuses an agent.dispatch write scope with no authorization (review P2-1)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) refuses agent.dispatch from a Run that is not the Work’s Chief",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) leaves no Run or snapshot behind when the draft spec is invalid"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-046",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) holds the parent in waiting_children and keeps every sibling result",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) refuses a new child once the parent Chief Run has ended (N-04, N-05)",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) does not hold the parent for joinPolicy=none, but still pages the Chief",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) refuses delivery for a terminal Run, a stale epoch or a superseded attempt",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) blocks the gate and pages the Chief when a required child fails",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) does not block on an optional child failure or before every child settles",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) accepts one correction and then records a contract violation (AC-047)",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) refuses delivery while the Run is not executing (N-02)",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) counts rejections and dedupes todos across more than one event page (D3)",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) stops the parent on the second strike even with a live child, taking it down (M-1)",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) reports the filed todo in the blocked state and never pages an ended Chief (R5-05/R5-07)",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) files the todo for a paused parent so it survives the resume (R9-06)",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) pages the Chief once for one failure set (N-06) and carries every result",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) records a valid stage result without letting a client claim another Run",
        "packages/core/test/join.integration.test.ts :: join: parallel sibling failure on the real stack (AC-046) keeps the sibling result, blocks the gate and still processes a new Chief instruction (AC-046)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-047",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) holds the parent in waiting_children and keeps every sibling result",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) refuses a new child once the parent Chief Run has ended (N-04, N-05)",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) does not hold the parent for joinPolicy=none, but still pages the Chief",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) refuses delivery for a terminal Run, a stale epoch or a superseded attempt",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) blocks the gate and pages the Chief when a required child fails",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) does not block on an optional child failure or before every child settles",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) accepts one correction and then records a contract violation (AC-047)",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) refuses delivery while the Run is not executing (N-02)",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) counts rejections and dedupes todos across more than one event page (D3)",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) stops the parent on the second strike even with a live child, taking it down (M-1)",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) reports the filed todo in the blocked state and never pages an ended Chief (R5-05/R5-07)",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) files the todo for a paused parent so it survives the resume (R9-06)",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) pages the Chief once for one failure set (N-06) and carries every result",
        "packages/core/test/join.test.ts :: join and structured delivery (AC-046, AC-047) records a valid stage result without letting a client claim another Run",
        "apps/daemon/test/stage-contract-runner.integration.test.ts :: structured delivery with a real Runner child (AC-047) refuses a spoken completion, then records the second non-compliance as a contract violation (AC-047)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-048",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) admits a read and records the tool operation and the audit event (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses an out-of-scope target with no execution and records the refusal (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses an operation the Grant does not cover (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses an expired Grant at use time and does not execute (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses a role the Grant does not belong to (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses the sibling Run of the same role with no side effect (AC-080)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) replays the recorded result for the same once operation (AC-080)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) file boundary (AC-048) refuses a symlink pointing outside the workspace in both modes with no read (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) file boundary (AC-048) refuses a symlink escape for a write in both modes with no write (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) file boundary (AC-048) refuses a .. escape and an absolute escape (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) file boundary (AC-048) resolves a legitimate path inside the root (positive control)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) container mode without a Docker daemon (AC-048) refuses with the observed reason and never falls back to host execution (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) host-mode domain gates (AC-050) refuses a Review Run write access to source even in host mode (AC-050)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) host-mode domain gates (AC-050) keeps the run database unreadable to a Review Run in both modes (AC-050)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) network boundary (AC-048) classifies loopback, private, link-local and metadata hosts as internal",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) network boundary (AC-048) refuses a private target by default and passes an exact authorized target",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) network boundary (AC-048) refuses a private network target before any tool runs (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) network boundary (AC-048) refuses a container network call when no Core proxy exists, even if the Grant covers it (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) network boundary (AC-048) refuses an operation with no built-in executor instead of faking a result (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) network boundary (AC-048) plans the hardened container invocation with no network by default (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 1 regressions (W7R1) refuses a hostname that DNS resolves into loopback, with no transport call (W7R1-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 1 regressions (W7R1) refuses an authorized private literal over plain http unless plaintext was enabled (W7R1-07)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 1 regressions (W7R1) classifies the hexadecimal IPv4-mapped IPv6 forms the URL parser produces (W7R1-02)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 1 regressions (W7R1) protects the run database without any caller-declared protected path (W7R1-04)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 1 regressions (W7R1) allows a Review report write root while refusing source (W7R1-13)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 1 regressions (W7R1) passes container content over stdin, so a delimiter line cannot become a command (W7R1-09)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) test environment creates its own database file and port, never the reserved dev values",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) test environment refuses to allocate when the only port is the reserved development port",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) test environment reports a temp-directory cleanup failure as RECOVERY_REQUIRED (required failure test)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) test environment skips a port the OS has already taken and one a sibling manager holds (W7R1-05)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) test environment reports a child that dies before readiness as failed, never running (W7R1-05)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) test environment reports a process-group cleanup failure as RECOVERY_REQUIRED (required failure test)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) refuses a read-only role a host bash write to source, leaving the file intact (W7R2-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) refuses a read-only role a host git write to source (W7R2-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) strips caller writableRoots for a read-only role in container mode (W7R2-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) refuses a read-only role a non-path mutating tool even with a report root (W7R2-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) still admits a report write for a read-only role (W7R2-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) still runs an arbitrary-command tool for a write-capable role (W7R2-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) refuses a target whose DNS answer is private before consuming the Grant (W7R2-02)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) still admits a public address literal at admission (W7R2-02)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) pins the transport to the address the policy validated (W7R2-03)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) never lets a rebinding answer reach the second address (W7R2-03)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) connects to the pinned address through the built-in transport (W7R2-03)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) turns a throwing resolver into a refusal instead of an exception (W7R2-05)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) decodes local-use NAT64 prefixes and treats undecodable ones as private (W7R2-06)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) refuses readiness when the port is owned by an external listener (W7R2-07)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) releases a claimed port when create fails, so a later create succeeds (W7R2-08)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) refuses a read-only role writeFile to source from a read body, leaving the file intact (W7R3-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) refuses a read-only role ctx.run from a read body, leaving the file intact (W7R3-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) still admits a report-root body write for a read-only role (W7R3-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) refuses ctx.run inside an admitted report write body for a read-only role (W7R3-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) still gives a write-capable role both writeFile and run (W7R3-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) turns a transport error into a structured refusal (W7R3-03)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) returns a PROVIDER_UNAVAILABLE result when the port probe throws (W7R3-04)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) carries a literal target its own address, pinning the transport (W7R3-05)",
        "apps/daemon/test/tool-handler.integration.test.ts :: daemon tool handler refuses a tool the role does not hold before consulting the Grant (AC-048)",
        "apps/daemon/test/tool-handler.integration.test.ts :: daemon tool handler refuses a read outside the Attempt readScope at admission, leaking nothing (AC-032/AC-048)",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) runs a real host child process through an admitted Grant (AC-048)",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) refuses a redirect to a link-local address without following it (required failure test)",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) refuses a private network target before any request (required failure test)",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) runs a command inside a real isolated test environment and cleans it up",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) never hands the same port to a second manager, and skips an occupied one (W7R1-05)",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) runs a container read through Docker and reports the real non-root account",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) replays a once result in a separate OS process through the durable store (W7R1-10)",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) keeps the once result replayable across a real execution (AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) executes an in-scope granted call and audits it, and refuses out-of-scope/expired/sibling calls with no side effect (AC-049, AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) replays the original once result for the same input and refuses a different input (AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) refuses an out-of-scope read by the same role with no executor call and no row (AC-049)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) reads the frozen verification input but not the source, and gains no write, in host and container mode (AC-048, AC-050)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) writes a Review report inside its declared report root and never the source (W7R1-13)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) refuses the run database to a verifier without any caller-declared protected path (W7R1-04)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) keeps the frozen source read-only inside the real container (AC-048, AC-050)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) injects the decoy into the authorised child and never into a log, Artifact, UI payload, audit row or the host environment (AC-051)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) gives the unauthorised sibling Run no credential at all, on every channel (AC-051)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-049",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) admits the exact once binding and reports no replay for a first use",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) replays a consumed once grant for the same operation and input (AC-080)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) binds a replay to the full operation/role/stage triple, not just the run (W7R1-06)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) refuses a different input hash with IDEMPOTENCY_CONFLICT and names the field (AC-080)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) refuses a different tool operation on a consumed grant with IDEMPOTENCY_CONFLICT (AC-080)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) refuses a different operation on a live grant without consuming anything (AC-049)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) refuses the wrong role or stage with NOT_AUTHORIZED (AC-049)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) isolates sibling runs on a run-scoped grant and keeps work-scoped grants shared (AC-080)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) refuses every later use of an expired or revoked grant (AC-049)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) keeps replaying a completed once transaction after its expiry (AC-080)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) refuses a sibling run reaching for a consumed once grant (AC-080)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) refuses a malformed target and an out-of-grant target with the documented codes",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) keeps the target rules the rest of the codebase relies on",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) derives scope bindings from the request identity fields",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) issuance validation (AC-049) accepts an in-scope request",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) issuance validation (AC-049) refuses an operation outside the Work envelope",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) issuance validation (AC-049) refuses a foreign work id and a role at a stage it does not operate",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) issuance validation (AC-049) refuses a missing once binding and a malformed input hash with VALIDATION_ERROR",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) issuance validation (AC-049) refuses a target outside the Work paths and a malformed target",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) issuance validation (AC-049) does not apply the path envelope to non-path operations",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) issuing mints a grant that carries every documented binding and audits it (AC-049)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) issuing refuses an unknown Work without writing a row (AC-049)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) issuing refuses an operation and a target outside the Work scope (AC-049)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) issuing refuses a Run from another Work and a role that was never dispatched (AC-049)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) issuing refuses a once request without its operation/input binding (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) issuing refuses to mint for a Work that is not running (AC-049)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) executes once and replays the original result for the same input (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) leaves the grant unconsumed and rolls the tool operation back when the tool fails (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) replays after the grant has expired, because the result is the recorded fact (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) refuses a different input hash with IDEMPOTENCY_CONFLICT and consumes nothing (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) refuses a different tool operation with IDEMPOTENCY_CONFLICT (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) refuses a different operation than the grant was issued for (AC-049)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) refuses a replayed reference whose result cannot be resolved as RECOVERY_REQUIRED (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) reports RECOVERY_REQUIRED when a started tool operation has no recorded result (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) refuses a recorded tool operation id reused with a different input hash (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) asynchronous tool bodies (W7R3-02) awaits an async body, records its resolved value and replays it (W7R3-02)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) asynchronous tool bodies (W7R3-02) consumes nothing and leaves nothing finished when an async body rejects (W7R3-02)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) asynchronous tool bodies (W7R3-02) refuses a thenable from the synchronous path instead of recording it (W7R3-02)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) sibling run isolation (AC-080) refuses the sibling Run on a run-scoped grant with no side effect (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) sibling run isolation (AC-080) refuses the sibling Run reaching for a consumed once grant (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) sibling run isolation (AC-080) keeps a work-scoped grant usable by both Runs (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) sibling run isolation (AC-080) refuses a request claiming another Work, with no row written (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) expiry and revocation (AC-049) refuses an expired grant at use time and does not execute (AC-049)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) expiry and revocation (AC-049) refuses every later use after revoke, while a completed once still replays (AC-049, AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) expiry and revocation (AC-049) refuses to revoke a grant that is already closed",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) query helpers (AC-049) reports the current grants of a run and a work, and removes a consumed one",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) query helpers (AC-049) keeps a consumed once grant visible to coverage, because it still replays (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) query helpers (AC-049) answers coverage with the same rules consumption would apply",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) query helpers (AC-049) never mutates the rows it reads",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) query helpers (AC-049) does not let a consumed once grant cover a different operation/role/stage (W7R1-06)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) query helpers (AC-049) surfaces the tool operation a grant was consumed by",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) concurrent double-consume (AC-080) lets exactly one of two connections claim the grant, and executes once (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) durable deferred results (W7R1-10) replays the recorded result from a second store, rather than RECOVERY_REQUIRED",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) durable deferred results (W7R1-10) reports RECOVERY_REQUIRED only for a sink that cannot resolve the reference",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) multi-writer deferred results (W7R2-04/09/10) sees another sink's result immediately, with no stale manifest cache (W7R2-04)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) multi-writer deferred results (W7R2-04/09/10) replays a recorded null result instead of reporting it missing (W7R2-09)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) multi-writer deferred results (W7R2-04/09/10) replays a recorded undefined result as present (W7R2-09)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) multi-writer deferred results (W7R2-04/09/10) keeps a recorded result alive through an offline blob GC (W7R2-10)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) multi-writer deferred results (W7R2-04/09/10) registers the deferred-result records and legacy blobs as GC roots (W7R2-10)",
        "apps/daemon/test/tool-handler.integration.test.ts :: daemon tool handler admits an environment operation only after its exact approval (AC-049)",
        "apps/daemon/test/tool-handler.integration.test.ts :: daemon tool handler enforces an approved Grant limit with BUDGET_EXCEEDED (AC-049)",
        "apps/daemon/test/tool-permission-runner.integration.test.ts :: environment-operation approval with a real Runner child (AC-049/AC-080) refuses, records the request, and really executes the model retry after the user approves (AC-049/AC-080)",
        "apps/daemon/test/tool-permission.integration.test.ts :: permission.request / permission.respond over the workbench protocol refuses a path-shaped permission.request with no targets before any decision exists (AC-049)",
        "apps/daemon/test/tool-permission.integration.test.ts :: permission.request / permission.respond over the workbench protocol refuses to approve a path-shaped operation whose recorded binding has no targets (AC-049)",
        "apps/daemon/test/tool-permission.integration.test.ts :: permission.request / permission.respond over the workbench protocol closes the environment-operation loop: refuse → approve (protocol) → retry executes (AC-049/AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) executes an in-scope granted call and audits it, and refuses out-of-scope/expired/sibling calls with no side effect (AC-049, AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) replays the original once result for the same input and refuses a different input (AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) refuses an out-of-scope read by the same role with no executor call and no row (AC-049)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) reads the frozen verification input but not the source, and gains no write, in host and container mode (AC-048, AC-050)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) writes a Review report inside its declared report root and never the source (W7R1-13)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) refuses the run database to a verifier without any caller-declared protected path (W7R1-04)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) keeps the frozen source read-only inside the real container (AC-048, AC-050)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) injects the decoy into the authorised child and never into a log, Artifact, UI payload, audit row or the host environment (AC-051)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) gives the unauthorised sibling Run no credential at all, on every channel (AC-051)",
        "packages/core/test/tool-http.integration.test.ts :: tool.execute over the real control endpoint (T3.2) admits an environment operation only after the real approval chain (AC-049/AC-080)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-050",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) admits a read and records the tool operation and the audit event (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses an out-of-scope target with no execution and records the refusal (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses an operation the Grant does not cover (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses an expired Grant at use time and does not execute (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses a role the Grant does not belong to (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses the sibling Run of the same role with no side effect (AC-080)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) replays the recorded result for the same once operation (AC-080)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) file boundary (AC-048) refuses a symlink pointing outside the workspace in both modes with no read (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) file boundary (AC-048) refuses a symlink escape for a write in both modes with no write (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) file boundary (AC-048) refuses a .. escape and an absolute escape (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) file boundary (AC-048) resolves a legitimate path inside the root (positive control)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) container mode without a Docker daemon (AC-048) refuses with the observed reason and never falls back to host execution (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) host-mode domain gates (AC-050) refuses a Review Run write access to source even in host mode (AC-050)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) host-mode domain gates (AC-050) keeps the run database unreadable to a Review Run in both modes (AC-050)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) network boundary (AC-048) classifies loopback, private, link-local and metadata hosts as internal",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) network boundary (AC-048) refuses a private target by default and passes an exact authorized target",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) network boundary (AC-048) refuses a private network target before any tool runs (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) network boundary (AC-048) refuses a container network call when no Core proxy exists, even if the Grant covers it (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) network boundary (AC-048) refuses an operation with no built-in executor instead of faking a result (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) network boundary (AC-048) plans the hardened container invocation with no network by default (AC-048)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 1 regressions (W7R1) refuses a hostname that DNS resolves into loopback, with no transport call (W7R1-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 1 regressions (W7R1) refuses an authorized private literal over plain http unless plaintext was enabled (W7R1-07)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 1 regressions (W7R1) classifies the hexadecimal IPv4-mapped IPv6 forms the URL parser produces (W7R1-02)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 1 regressions (W7R1) protects the run database without any caller-declared protected path (W7R1-04)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 1 regressions (W7R1) allows a Review report write root while refusing source (W7R1-13)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 1 regressions (W7R1) passes container content over stdin, so a delimiter line cannot become a command (W7R1-09)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) test environment creates its own database file and port, never the reserved dev values",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) test environment refuses to allocate when the only port is the reserved development port",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) test environment reports a temp-directory cleanup failure as RECOVERY_REQUIRED (required failure test)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) test environment skips a port the OS has already taken and one a sibling manager holds (W7R1-05)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) test environment reports a child that dies before readiness as failed, never running (W7R1-05)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) test environment reports a process-group cleanup failure as RECOVERY_REQUIRED (required failure test)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) refuses a read-only role a host bash write to source, leaving the file intact (W7R2-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) refuses a read-only role a host git write to source (W7R2-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) strips caller writableRoots for a read-only role in container mode (W7R2-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) refuses a read-only role a non-path mutating tool even with a report root (W7R2-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) still admits a report write for a read-only role (W7R2-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) still runs an arbitrary-command tool for a write-capable role (W7R2-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) refuses a target whose DNS answer is private before consuming the Grant (W7R2-02)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) still admits a public address literal at admission (W7R2-02)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) pins the transport to the address the policy validated (W7R2-03)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) never lets a rebinding answer reach the second address (W7R2-03)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) connects to the pinned address through the built-in transport (W7R2-03)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) turns a throwing resolver into a refusal instead of an exception (W7R2-05)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) decodes local-use NAT64 prefixes and treats undecodable ones as private (W7R2-06)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) refuses readiness when the port is owned by an external listener (W7R2-07)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 2 regressions (W7R2) releases a claimed port when create fails, so a later create succeeds (W7R2-08)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) refuses a read-only role writeFile to source from a read body, leaving the file intact (W7R3-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) refuses a read-only role ctx.run from a read body, leaving the file intact (W7R3-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) still admits a report-root body write for a read-only role (W7R3-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) refuses ctx.run inside an admitted report write body for a read-only role (W7R3-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) still gives a write-capable role both writeFile and run (W7R3-01)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) turns a transport error into a structured refusal (W7R3-03)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) returns a PROVIDER_UNAVAILABLE result when the port probe throws (W7R3-04)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) review round 3 regressions (W7R3) carries a literal target its own address, pinning the transport (W7R3-05)",
        "apps/daemon/test/tool-handler.integration.test.ts :: daemon tool handler pins Review calls to the container even under a host policy (AC-050)",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) runs a real host child process through an admitted Grant (AC-048)",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) refuses a redirect to a link-local address without following it (required failure test)",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) refuses a private network target before any request (required failure test)",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) runs a command inside a real isolated test environment and cleans it up",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) never hands the same port to a second manager, and skips an occupied one (W7R1-05)",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) runs a container read through Docker and reports the real non-root account",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) replays a once result in a separate OS process through the durable store (W7R1-10)",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) keeps the once result replayable across a real execution (AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) executes an in-scope granted call and audits it, and refuses out-of-scope/expired/sibling calls with no side effect (AC-049, AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) replays the original once result for the same input and refuses a different input (AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) refuses an out-of-scope read by the same role with no executor call and no row (AC-049)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) reads the frozen verification input but not the source, and gains no write, in host and container mode (AC-048, AC-050)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) writes a Review report inside its declared report root and never the source (W7R1-13)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) refuses the run database to a verifier without any caller-declared protected path (W7R1-04)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) keeps the frozen source read-only inside the real container (AC-048, AC-050)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) injects the decoy into the authorised child and never into a log, Artifact, UI payload, audit row or the host environment (AC-051)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) gives the unauthorised sibling Run no credential at all, on every channel (AC-051)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-051",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) resolves a registered ref for the authorized Grantholder (AC-051)",
        "packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) refuses an unknown ref with NOT_FOUND for an authorized ref shape (AC-051)",
        "packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) refuses an unauthorized caller without disclosing whether the ref exists (AC-051)",
        "packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) refuses a foreign role, operation or target with NOT_AUTHORIZED (AC-051)",
        "packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) refuses a sibling Run trying to reuse a run-scoped Grant (AC-051)",
        "packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) refuses an expired Grant with AUTH_EXPIRED and resolves nothing (AC-051)",
        "packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) refuses a foreign purpose at the registration boundary (AC-051)",
        "packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) refuses the wrong audience channel (AC-051)",
        "packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) refuses a role the registration does not allow (AC-051)",
        "packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) refuses a malformed ref with VALIDATION_ERROR",
        "packages/core/test/secrets.test.ts :: SecretStore resolution (AC-051) binds the one-argument Gateway resolver to one authorized context (AC-051)",
        "packages/core/test/secrets.test.ts :: query surface never carries a value (AC-051) lists refs and metadata without the value (AC-051)",
        "packages/core/test/secrets.test.ts :: query surface never carries a value (AC-051) derives the documented environment variable names",
        "packages/core/test/secrets.test.ts :: query surface never carries a value (AC-051) offers audit helpers that mask and scan every known value (AC-051)",
        "packages/core/test/secrets.test.ts :: query surface never carries a value (AC-051) replaces a registration on the same ref and validates the input",
        "packages/core/test/secrets.test.ts :: scoped environment injection (AC-051) injects only the secrets the Run is authorized for (AC-051)",
        "packages/core/test/secrets.test.ts :: scoped environment injection (AC-051) refuses the whole environment when one requested ref is unauthorized (AC-051)",
        "packages/core/test/secrets.test.ts :: scoped environment injection (AC-051) refuses injection for an unknown ref with NOT_FOUND",
        "packages/core/test/secrets.test.ts :: redaction (AC-051) masks every occurrence of a known value in text",
        "packages/core/test/secrets.test.ts :: redaction (AC-051) redacts nested structures and error messages without mutating them (AC-051)",
        "packages/core/test/secrets.test.ts :: redaction (AC-051) redacts Map, Set and Date contents defensively",
        "packages/core/test/secrets.test.ts :: redaction (AC-051) replaces the longest known value first",
        "packages/core/test/secrets.test.ts :: leak scanning (AC-051) finds the decoy in a nested object and an array (AC-051)",
        "packages/core/test/secrets.test.ts :: leak scanning (AC-051) finds the decoy in an error message and stack (AC-051)",
        "packages/core/test/secrets.test.ts :: leak scanning (AC-051) finds the decoy in a log line and an array item (AC-051)",
        "packages/core/test/secrets.test.ts :: leak scanning (AC-051) reports which known value matched and stays silent on clean input",
        "packages/core/test/secrets.test.ts :: leak scanning (AC-051) finds a decoy used as an object key without echoing it in the path",
        "apps/daemon/test/tool-handler.integration.test.ts :: daemon tool handler injects the tool-audience secret a Grant covers, and only then (AC-051)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) executes an in-scope granted call and audits it, and refuses out-of-scope/expired/sibling calls with no side effect (AC-049, AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) replays the original once result for the same input and refuses a different input (AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) refuses an out-of-scope read by the same role with no executor call and no row (AC-049)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) reads the frozen verification input but not the source, and gains no write, in host and container mode (AC-048, AC-050)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) writes a Review report inside its declared report root and never the source (W7R1-13)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) refuses the run database to a verifier without any caller-declared protected path (W7R1-04)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) keeps the frozen source read-only inside the real container (AC-048, AC-050)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) injects the decoy into the authorised child and never into a log, Artifact, UI payload, audit row or the host environment (AC-051)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) gives the unauthorised sibling Run no credential at all, on every channel (AC-051)",
        "packages/core/test/secrets.integration.test.ts :: SecretStore isolation with a real child process (AC-051) injects the decoy into the authorised child environment only (AC-051)",
        "packages/core/test/secrets.integration.test.ts :: SecretStore isolation with a real child process (AC-051) keeps the decoy out of the unauthorised sibling Run and its child (AC-051)",
        "packages/core/test/secrets.integration.test.ts :: SecretStore isolation with a real child process (AC-051) never serialises the decoy into a grant row, log, Artifact or UI payload (AC-051)",
        "packages/core/test/secrets.integration.test.ts :: SecretStore isolation with a real child process (AC-051) refuses an expired secret Grant at use time (AC-051)",
        "packages/core/test/secrets.integration.test.ts :: SecretStore isolation with a real child process (AC-051) resolves the decoy for the credentialed Run through the real Grant row (AC-051)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-052",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) carries the isolation policy on every preview (AC-052)",
        "apps/daemon/test/server.test.ts :: daemon HTTP surface (WP-03) serves a preview of a hostile document under the same isolation (AC-052)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-053",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/pi-runtime/test/trust.test.ts :: untrusted repository (AC-053) never imports, reads or activates a repository resource and reports every skip",
        "packages/pi-runtime/test/trust.test.ts :: untrusted repository (AC-053) still activates the shipped release whitelist, which is not repository content",
        "packages/pi-runtime/test/trust.test.ts :: trusted repository (AC-053) imports a selected, whitelisted repository extension only after trust",
        "packages/pi-runtime/test/trust.test.ts :: trusted repository (AC-053) refuses a repository extension outside the selected set, without importing it",
        "packages/pi-runtime/test/trust.test.ts :: trusted repository (AC-053) refuses a selected repository extension the release does not ship",
        "packages/pi-runtime/test/trust.test.ts :: trusted repository (AC-053) refuses a module path that escapes the project root",
        "packages/pi-runtime/test/trust.test.ts :: trusted repository (AC-053) refuses a symlinked module that resolves outside the project root",
        "packages/pi-runtime/test/trust.test.ts :: trusted repository (AC-053) loads only the selected skill and records its declared name",
        "packages/pi-runtime/test/trust.test.ts :: trusted repository (AC-053) refuses a symlinked SKILL.md inside a selected directory (W7R1-03)",
        "packages/pi-runtime/test/trust.test.ts :: trusted repository (AC-053) refuses a selected skill outside the project and agent roots",
        "packages/pi-runtime/test/trust.test.ts :: trusted repository (AC-053) blocks startup when a critical repository extension fails to import",
        "packages/pi-runtime/test/trust.test.ts :: trusted repository (AC-053) keeps the built-in activation semantics: a failed optional only disables itself",
        "packages/pi-runtime/test/trust.test.ts :: loader trace (AC-053 evidence) records every input exactly once, in order, with a contracts code on every refusal",
        "packages/pi-runtime/test/trust.test.ts :: loader trace (AC-053 evidence) rejects a missing project root as a caller error",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) executes an in-scope granted call and audits it, and refuses out-of-scope/expired/sibling calls with no side effect (AC-049, AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) replays the original once result for the same input and refuses a different input (AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) refuses an out-of-scope read by the same role with no executor call and no row (AC-049)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) reads the frozen verification input but not the source, and gains no write, in host and container mode (AC-048, AC-050)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) writes a Review report inside its declared report root and never the source (W7R1-13)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) refuses the run database to a verifier without any caller-declared protected path (W7R1-04)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) keeps the frozen source read-only inside the real container (AC-048, AC-050)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) injects the decoy into the authorised child and never into a log, Artifact, UI payload, audit row or the host environment (AC-051)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) gives the unauthorised sibling Run no credential at all, on every channel (AC-051)",
        "packages/core/test/permissions.integration.test.ts :: repository trust boundary over a real repository (AC-053) does not execute an untrusted repository auto-load extension, and honours only the selected resource after trust (AC-053)",
        "packages/core/test/permissions.integration.test.ts :: repository trust boundary over a real repository (AC-053) never reads a selected skill from an untrusted repository (AC-053)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-054",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/client/test/commands.test.ts :: AC-054 reconnect and bounded backoff reconnects on the documented schedule and replays the hello",
        "packages/client/test/commands.test.ts :: AC-054 reconnect and bounded backoff applies bounded exponential backoff while every reconnect fails",
        "packages/client/test/commands.test.ts :: AC-054 reconnect and bounded backoff reports the attempt number while reconnecting and ends at the limit",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) replays events after a watermark with no duplicates and no gaps (AC-054)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) keeps background Work running when the WebSocket disconnects (AC-054/AC-078)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-055",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/client/test/commands.test.ts :: AC-055 write retry with the same idempotency key replays a write whose answer was lost and reports the replay",
        "packages/client/test/commands.test.ts :: AC-055 write retry with the same idempotency key queues a write that never reached the wire and replays it after reconnect",
        "packages/client/test/commands.test.ts :: AC-055 write retry with the same idempotency key retries a BUSY write with backoff and the same key",
        "packages/client/test/commands.test.ts :: AC-055 write retry with the same idempotency key reports a first-attempt write as not replayed",
        "packages/client/test/commands.test.ts :: AC-055 write retry with the same idempotency key fails a queued write when the client ends before a socket returns",
        "packages/core/test/dispatcher.integration.test.ts :: write path (AC-055) applies one write, then replays the same result for the same key",
        "packages/core/test/dispatcher.integration.test.ts :: write path (AC-055) refuses the same key with a different payload",
        "packages/core/test/dispatcher.integration.test.ts :: write path (AC-055) reports a version conflict with the current version",
        "packages/core/test/dispatcher.integration.test.ts :: write path (AC-055) rolls back the ledger, events and outbox when the handler fails",
        "packages/core/test/dispatcher.integration.test.ts :: write path (AC-055) answers BUSY without executing when the mailbox queue is full",
        "packages/storage/test/ledger.integration.test.ts :: command ledger (AC-055) replays the original result for the same key and payload",
        "packages/storage/test/ledger.integration.test.ts :: command ledger (AC-055) refuses the same key with a different payload or another caller",
        "packages/storage/test/ledger.integration.test.ts :: command ledger (AC-055) scopes lookup to the calling subject and prunes old rows"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-056",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/mailbox.test.ts :: ProjectMailbox answers a new command while a long effect is still running (AC-056)",
        "packages/core/test/dispatcher.integration.test.ts :: long operations do not block commands (AC-056) answers a command within a second while a model call is in flight"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-057",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) withholds a new Attempt while the old execution is unconfirmed (W8R1-04)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) binds a resume decision to its own Run, not to the whole Work (W8R2-03)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) keeps a Run-bound resume decision past a window of unrelated decisions (W8R3-04)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) parses only real process identities and reports the rest as unconfirmed",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) rotates an expired lease to a new owner and revokes it for the old one",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) parks a running Run as interrupted when its process is confirmed gone",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) requires a RecoveryDecision while the old process is alive or unconfirmable",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) requires a RecoveryDecision for an unconfirmed tool side effect",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) checks real process state instead of the persisted status (AC-061 matrix)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) uses a legal two-step path for a waiting Run",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) leaves a Run with no live state alone",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses an old-epoch success but keeps its diagnostics (AC-058)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses a late success after cancellation, keeping diagnostics (AC-058)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses a late success superseded by a newer accepted decision (AC-058)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) accepts the current epoch when nothing superseded it",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) fences daemon epochs across restarts and records the reports",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) announces each restart report once with a resolvable report reference (AC-061)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) builds a RecoveryReport from real runner, lease and tool facts",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) preserves the narrow DispatchSnapshot scope after a restart (AC-082)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses to recover a Run whose dispatch snapshot is missing or tampered with",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) reports NOT_FOUND instead of throwing for an unknown Run"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        },
        {
          "tool": "pnpm test:live",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-058",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) withholds a new Attempt while the old execution is unconfirmed (W8R1-04)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) binds a resume decision to its own Run, not to the whole Work (W8R2-03)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) keeps a Run-bound resume decision past a window of unrelated decisions (W8R3-04)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) parses only real process identities and reports the rest as unconfirmed",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) rotates an expired lease to a new owner and revokes it for the old one",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) parks a running Run as interrupted when its process is confirmed gone",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) requires a RecoveryDecision while the old process is alive or unconfirmable",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) requires a RecoveryDecision for an unconfirmed tool side effect",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) checks real process state instead of the persisted status (AC-061 matrix)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) uses a legal two-step path for a waiting Run",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) leaves a Run with no live state alone",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses an old-epoch success but keeps its diagnostics (AC-058)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses a late success after cancellation, keeping diagnostics (AC-058)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses a late success superseded by a newer accepted decision (AC-058)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) accepts the current epoch when nothing superseded it",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) fences daemon epochs across restarts and records the reports",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) announces each restart report once with a resolvable report reference (AC-061)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) builds a RecoveryReport from real runner, lease and tool facts",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) preserves the narrow DispatchSnapshot scope after a restart (AC-082)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses to recover a Run whose dispatch snapshot is missing or tampered with",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) reports NOT_FOUND instead of throwing for an unknown Run"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-059",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/events-hub.integration.test.ts :: connection back-pressure (AC-059) coalesces transient frames once the soft limit is crossed",
        "packages/core/test/events-hub.integration.test.ts :: connection back-pressure (AC-059) closes the connection at the hard limit without dropping durable events",
        "packages/core/test/events-hub.integration.test.ts :: connection back-pressure (AC-059) keeps default limits at the documented 2 MiB / 8 MiB"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-060",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/web/test/multi-project.integration.test.ts :: single-entry multi-project BFF (WP-12 T5.5) binds the event socket to one project and never replays another project cursor (AC-034/AC-060)",
        "packages/core/test/events-hub.integration.test.ts :: scope change (AC-060) answers a fresh snapshot at a new watermark and covers later events",
        "packages/core/test/events-hub.integration.test.ts :: scope change (AC-060) reports an empty batch with its scan watermark",
        "packages/core/test/events-hub.integration.test.ts :: scope change (AC-060) refuses a backward ack and clamps to the watermark",
        "packages/core/test/events-hub.integration.test.ts :: scope change (AC-060) does not disguise a storage failure as a resync request",
        "packages/core/test/events-hub.integration.test.ts :: scope change (AC-060) classifies errors of a cursor-based subscribe the same way",
        "packages/core/test/events-hub.integration.test.ts :: scope change (AC-060) validates scope shape and removes subscriptions",
        "packages/core/test/events-hub.integration.test.ts :: scope change (AC-060) drops the subscriptions of a closed connection"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-061",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) withholds a new Attempt while the old execution is unconfirmed (W8R1-04)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) binds a resume decision to its own Run, not to the whole Work (W8R2-03)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) keeps a Run-bound resume decision past a window of unrelated decisions (W8R3-04)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) parses only real process identities and reports the rest as unconfirmed",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) rotates an expired lease to a new owner and revokes it for the old one",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) parks a running Run as interrupted when its process is confirmed gone",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) requires a RecoveryDecision while the old process is alive or unconfirmable",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) requires a RecoveryDecision for an unconfirmed tool side effect",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) checks real process state instead of the persisted status (AC-061 matrix)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) uses a legal two-step path for a waiting Run",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) leaves a Run with no live state alone",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses an old-epoch success but keeps its diagnostics (AC-058)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses a late success after cancellation, keeping diagnostics (AC-058)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses a late success superseded by a newer accepted decision (AC-058)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) accepts the current epoch when nothing superseded it",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) fences daemon epochs across restarts and records the reports",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) announces each restart report once with a resolvable report reference (AC-061)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) builds a RecoveryReport from real runner, lease and tool facts",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) preserves the narrow DispatchSnapshot scope after a restart (AC-082)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses to recover a Run whose dispatch snapshot is missing or tampered with",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) reports NOT_FOUND instead of throwing for an unknown Run"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-062",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/wp08-failures.test.ts :: required WP-08 failure tests Task 合并冲突: two passed Tasks conflict, the repair Task is independent and CAS protects HEAD (AC-062)",
        "packages/core/test/wp08-failures.test.ts :: required WP-08 failure tests T-01: the repair revision converges and is what the final manifest records (AC-062)",
        "packages/workspace/test/cas.integration.test.ts :: dependency lineage with real revisions (AC-081) produces an independent repair task when two passed Tasks conflict (AC-062)",
        "packages/workspace/test/cas.integration.test.ts :: worktree ownership against a real repository (AC-062) creates one writer per worktree, refuses dirty removal, then discards on request",
        "packages/workspace/test/cas.integration.test.ts :: final integration repair convergence (AC-062, T-01/T-02) converges the conflict through the repair revision and emits one completion event (T-01)",
        "packages/workspace/test/cas.integration.test.ts :: final integration repair convergence (AC-062, T-01/T-02) reports a missing Task revision as a gate refusal instead of an internal error (T-02)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-063",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/wp08-failures.test.ts :: required WP-08 failure tests ref 后崩溃: the restart reuses the commit, completes the state and emits one event (AC-063)",
        "packages/core/test/settlement.integration.test.ts :: Crash after the ref update: reuse the commit, complete once (AC-063) runs the whole settlement path: freeze, CAS and complete once",
        "packages/core/test/settlement.integration.test.ts :: Crash after the ref update: reuse the commit, complete once (AC-063) takes the shared integration lock and refuses while a requirement save holds it (W8R2-02)",
        "packages/core/test/settlement.integration.test.ts :: Crash after the ref update: reuse the commit, complete once (AC-063) reuses the committed revision, completes the state and emits one event",
        "packages/core/test/settlement.integration.test.ts :: Crash after the ref update: reuse the commit, complete once (AC-063) installs the existing commit when the ref never moved (crash before the CAS)",
        "packages/core/test/settlement.integration.test.ts :: Crash after the ref update: reuse the commit, complete once (AC-063) refuses to recover onto an unrelated delivery revision"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-064",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/wp08-failures.test.ts :: required WP-08 failure tests 备份演练: backup → restore keeps hashes/knowledge/evidence and blocks a missing Secret (AC-064)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) backs up and restores the real database through the protocol (AC-064 surface)",
        "packages/core/test/backup.integration.test.ts :: Backup, restore and relocate (AC-064) restores a backup into a new directory with consistent hashes, knowledge and evidence",
        "packages/core/test/backup.integration.test.ts :: Backup, restore and relocate (AC-064) requires recovery for the active Run and revokes every old lease and grant",
        "packages/core/test/backup.integration.test.ts :: Backup, restore and relocate (AC-064) blocks a restored project whose required Secret is missing",
        "packages/core/test/backup.integration.test.ts :: Backup, restore and relocate (AC-064) refuses an incomplete or tampered backup",
        "packages/core/test/backup.integration.test.ts :: Backup, restore and relocate (AC-064) relocates a restored project to a new root and re-checks the doctor",
        "packages/core/test/backup.integration.test.ts :: Backup, restore and relocate (AC-064) refuses a relocate onto a directory that is not this repository, leaving the mapping (W8R1-05)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-065",
      "status": "PASS",
      "accepted": false,
      "mapping": "curated",
      "evidence": [
        "packages/storage/test/migrations.integration.test.ts :: migrations backs up before pending work and writes a usable copy",
        "packages/storage/test/migrations.integration.test.ts :: migrations rolls a failed migration back and reports its version",
        "packages/storage/test/migrations.integration.test.ts :: migrations stops on a checksum mismatch instead of starting",
        "packages/storage/test/migrations.integration.test.ts :: migrations refuses a database written by a newer build",
        "packages/storage/test/migrations.integration.test.ts :: migrations is idempotent on the second start",
        "packages/storage/test/migrations.integration.test.ts :: migrations applies the core schema and records a checksum"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-066",
      "status": "PASS",
      "accepted": false,
      "mapping": "curated",
      "evidence": [
        "packages/pi-runtime/test/session.integration.test.ts :: Pi session lifecycle creates a session with the configured model and no network",
        "packages/pi-runtime/test/events.test.ts :: SDK event mapping maps assistant text and thinking deltas",
        "packages/pi-runtime/test/events.test.ts :: SDK event mapping maps tool execution boundaries",
        "packages/pi-runtime/test/session.integration.test.ts :: Pi session lifecycle subscribes, unsubscribes and disposes",
        "packages/pi-runtime/test/session.integration.test.ts :: Pi session lifecycle aborts an idle session without error",
        "packages/pi-runtime/test/session.integration.test.ts :: Pi session lifecycle refuses to compact a session that has nothing to compact",
        "packages/pi-runtime/test/session.integration.test.ts :: Pi session lifecycle wires the resume path for a stored session file"
      ],
      "drills": [
        {
          "tool": "pnpm test:live",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-067",
      "status": "PASS",
      "accepted": false,
      "mapping": "curated",
      "evidence": [
        "packages/pi-runtime/test/extensions.test.ts :: extension activation rejects an id the release does not ship",
        "packages/pi-runtime/test/extensions.test.ts :: extension activation blocks startup when a critical capability fails",
        "packages/pi-runtime/test/extensions.test.ts :: extension activation disables only the failing optional extension",
        "apps/runner/test/attempt.integration.test.ts :: AttemptRunner blocks the attempt when a critical extension fails, before any session exists",
        "apps/runner/test/attempt.integration.test.ts :: AttemptRunner rejects an extension id the release does not ship"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-068",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/web/test/pages.test.ts :: board page offers a direct cancel and a refused pause for Queued without Work (AC-068)",
        "apps/web/test/views.test.ts :: board projection (AC-068) keeps one identity per requirement, in the documented four columns",
        "apps/web/test/views.test.ts :: board projection (AC-068) reports the pause refusal for a Queued requirement without local Work",
        "apps/web/test/views.test.ts :: board projection (AC-068) flags a requirement that appears in two columns as a duplicated identity",
        "apps/web/test/views.test.ts :: board projection (AC-068) reads the save state and the task ratio from the projection",
        "apps/web/test/views.test.ts :: board projection (AC-068) states the record branch, commit and push state from the real payload (AC-090)",
        "apps/web/test/views.test.ts :: board projection (AC-068) never invents a commit or a push state the payload did not report (AC-090)",
        "apps/web/test/views.test.ts :: board projection (AC-068) exposes exactly the lifecycle actions the daemon commands can express",
        "apps/daemon/test/assessment-dispatch.integration.test.ts :: message → Chief → DispatchSpec → Requirement → Run → stage result (WP-12 T2) never puts an L1 assessment on the board (AC-007/AC-068)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) answers every workbench query from real state (AC-068/AC-070/AC-074)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) refuses to cancel a Queued requirement it cannot record and refuses to pause it (AC-068)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) renders the board with the same requirement identity and no L1 card (AC-068)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) offers a direct cancel for a Queued requirement without Work and refuses its pause (AC-068)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) walks login → board → detail → approve → event in one headless flow (AC-068–AC-072)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack reads all nine surfaces from real state in one drill (AC-068–AC-078, AC-084, AC-087–AC-090, AC-093)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack cancels a Queued requirement with no Work through the real Git record service (AC-068)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack keeps an L1 Work off the board and reports it as excluded (AC-068)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack answers the card actions with the real protocol codes the UI renders (AC-068/AC-089)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-069",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/web/test/views.test.ts :: run status honesty (AC-069/AC-070) treats only a completed Run as a success",
        "apps/web/test/views.test.ts :: run status honesty (AC-069/AC-070) separates direct/L1 work from board work in the Runs page",
        "apps/daemon/test/assessment-dispatch.integration.test.ts :: message → Chief → DispatchSpec → Requirement → Run → stage result (WP-12 T2) runs the whole path from one message with no seeded row (AC-003/AC-005/AC-069)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) sends a message that creates real Work and a real event (AC-069/AC-084)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) sends a message through the BFF and creates a real Work and event (AC-069)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) streams real events over the WebSocket proxy and resumes from a watermark (AC-069/AC-078)",
        "apps/web/test/workbench-failures.integration.test.ts :: WP-09 T4 required failure tests 持续对话: keeps the conversation usable at every stage and routes the opinion (AC-069)",
        "apps/web/test/workbench-failures.integration.test.ts :: WP-09 T4 required failure tests 断连: reports the break, replays from the watermark and keeps the Work (AC-078/AC-069)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack routes a conversation message through the Chief and keeps the composer usable (AC-069)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        },
        {
          "tool": "pnpm test:live",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-070",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/web/test/views.test.ts :: requirement detail (AC-070) marks the plan card expired when the shown version is not the current one",
        "apps/web/test/views.test.ts :: requirement detail (AC-070) keeps a current plan card approvable",
        "apps/web/test/views.test.ts :: requirement detail (AC-070) carries artifact version and validity without presenting history as current",
        "apps/web/test/views.test.ts :: requirement detail (AC-070) states waiting-to-continue for an imported active record with no Work",
        "apps/web/test/views.test.ts :: requirement detail (AC-070) states the delivery branch, the commit and the actions it can offer (AC-090)",
        "apps/web/test/views.test.ts :: requirement detail (AC-070) reads an explicit unpushed result and treats a working tree as no commit (AC-090)",
        "apps/web/test/views.test.ts :: requirement detail (AC-070) surfaces attempts, epoch and evidence in a Run detail",
        "apps/web/test/views.test.ts :: run status honesty (AC-069/AC-070) treats only a completed Run as a success",
        "apps/web/test/views.test.ts :: run status honesty (AC-069/AC-070) separates direct/L1 work from board work in the Runs page",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) answers every workbench query from real state (AC-068/AC-070/AC-074)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) refuses a plan approval for an expired version with the version in view (AC-070)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) refuses an expired Plan version with the live version and keeps the Work running (AC-070)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) renders a truncated artifact preview with the full download entry (AC-070)",
        "apps/web/test/workbench-failures.integration.test.ts :: WP-09 T4 required failure tests 过期卡片: refuses an expired Plan card with the live version and disables it (AC-070/AC-074)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack refuses an expired Plan approval with the live version and keeps the Work running (AC-070)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack approves the Plan the card shows through the real gate (AC-070, W9R1-01)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack renders a truncated artifact with the full one-shot download (AC-070)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-071",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/web/test/client-script.test.ts :: interface language switching (WP-12 T4) returns focus to the Live restore control when the overlay closes (AC-071)",
        "apps/web/test/pages.test.ts :: shared shell carries the panel mode on the shell so the top bar restores it (AC-071)",
        "apps/web/test/pages.test.ts :: shared shell keeps the restore control before the panel contents in the tab order (AC-071)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) shares the panel mode across pages and keeps Chief-only controls off other pages (AC-071/AC-072)",
        "apps/web/test/workbench-failures.integration.test.ts :: WP-09 T4 required failure tests 窄屏焦点: keeps dock focus order, the overlay close and the top-bar restore (AC-071/AC-073)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-072",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/web/test/pages.test.ts :: shared shell offers no conversation create/switch control outside Chief (AC-072)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) shares the panel mode across pages and keeps Chief-only controls off other pages (AC-071/AC-072)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) walks login → board → detail → approve → event in one headless flow (AC-068–AC-072)",
        "apps/web/test/workbench-failures.integration.test.ts :: WP-09 T4 required failure tests Chief: renders only conversation controls that a real method backs (AC-072, W9R1-07)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-073",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/web/test/pages.test.ts :: shared shell exposes a language switch that only touches the interface dictionary (AC-073)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) translates only the interface strings and leaves project content untouched (AC-073)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) answers a page request with the language the browser asked for (AC-073)",
        "apps/web/test/workbench-failures.integration.test.ts :: WP-09 T4 required failure tests 窄屏焦点: keeps dock focus order, the overlay close and the top-bar restore (AC-071/AC-073)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-074",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/web/test/client-script.test.ts :: inbox actions (WP-12 T4c, AC-074) routes a saved decision choice through decision.resolve",
        "apps/web/test/client-script.test.ts :: inbox actions (WP-12 T4c, AC-074) routes approve and deny through permission.respond",
        "apps/web/test/client-script.test.ts :: inbox actions (WP-12 T4c, AC-074) refuses a denial with no recorded reason before any request",
        "apps/web/test/client-script.test.ts :: inbox actions (WP-12 T4c, AC-074) wires the handler with an idempotency key, the target version and no reload on refusal",
        "apps/web/test/client-script.test.ts :: inbox actions (WP-12 T4c, AC-074) never approves on its own and shows the binding before the deliberate click",
        "apps/web/test/client-script.test.ts :: inbox actions (WP-12 T4c, AC-074) refreshes the Inbox from the server on the documented live events",
        "apps/web/test/pages.test.ts :: inbox page (AC-074) renders one row per target version and disables an expired decision",
        "apps/web/test/pages.test.ts :: inbox request cards (WP-12 T4c, AC-074) renders a product decision with its question, choices, target and raiser",
        "apps/web/test/pages.test.ts :: inbox request cards (WP-12 T4c, AC-074) states an unreadable question and an empty question instead of an empty card",
        "apps/web/test/pages.test.ts :: inbox request cards (WP-12 T4c, AC-074) shows what an approval grants before the click, with a required denial reason",
        "apps/web/test/pages.test.ts :: inbox request cards (WP-12 T4c, AC-074) disables a blind approval and still offers a recorded denial",
        "apps/web/test/pages.test.ts :: inbox request cards (WP-12 T4c, AC-074) renders a resolved permission request inert and a legacy decision as before",
        "apps/web/test/pages.test.ts :: inbox request cards (WP-12 T4c, AC-074) never renders a secret value or a secretRef in either entry kind",
        "apps/web/test/views.test.ts :: inbox projection (AC-074) collapses a decision to one row per target version",
        "apps/web/test/views.test.ts :: inbox projection (AC-074) marks an expired decision actionable=none and expired=true",
        "apps/web/test/views.test.ts :: inbox projection (AC-074) summarises internal repairs per Work+severity instead of listing them",
        "apps/web/test/views.test.ts :: inbox projection (AC-074) keeps a recovery wait as its own row",
        "apps/web/test/views.test.ts :: inbox request kinds (WP-12 T4c, AC-074) resolves a product question from the targetRef Artifact and keeps its choices",
        "apps/web/test/views.test.ts :: inbox request kinds (WP-12 T4c, AC-074) keeps the read failure as the reason instead of an empty question",
        "apps/web/test/views.test.ts :: inbox request kinds (WP-12 T4c, AC-074) falls back to an explicit empty question when no body was resolved",
        "apps/web/test/views.test.ts :: inbox request kinds (WP-12 T4c, AC-074) types a permission request with its binding and the Run it parks",
        "apps/web/test/views.test.ts :: inbox request kinds (WP-12 T4c, AC-074) flags a permission request whose binding the daemon did not report",
        "apps/web/test/views.test.ts :: inbox request kinds (WP-12 T4c, AC-074) gives a non-product, non-permission decision no question contract",
        "apps/web/test/views.test.ts :: inbox request kinds (WP-12 T4c, AC-074) never copies a secret value or a secretRef out of an inbox payload",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) answers every workbench query from real state (AC-068/AC-070/AC-074)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) deduplicates the Inbox by target version and keeps an expired decision inert (AC-074)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) submits a real finding and resolves a decision through the real rows (AC-074)",
        "apps/web/test/inbox.integration.test.ts :: Inbox requests over the real daemon (WP-12 T4c, AC-074) renders a product question from its real targetRef Artifact body",
        "apps/web/test/inbox.integration.test.ts :: Inbox requests over the real daemon (WP-12 T4c, AC-074) names the parked Run and states the binding the daemon did not report",
        "apps/web/test/inbox.integration.test.ts :: Inbox requests over the real daemon (WP-12 T4c, AC-074) forwards permission.respond as a write and keeps the protocol error code",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) deduplicates decisions per target version and keeps an expired one inert (AC-074)",
        "apps/web/test/workbench-failures.integration.test.ts :: WP-09 T4 required failure tests 过期卡片: refuses an expired Plan card with the live version and disables it (AC-070/AC-074)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack deduplicates decisions per target version and disables an expired one (AC-074)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-075",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/web/test/pages.test.ts :: settings page (AC-075) renders the active revision, the editor and the test control",
        "apps/web/test/pages.test.ts :: settings page (AC-075) gives every provider row a real editor with a never-pre-filled password field (WP-12 T1.2B)",
        "apps/web/test/pages.test.ts :: settings page (AC-075) never renders a provider secret value, even for post-save state (WP-12 T1.2B)",
        "apps/web/test/pages.test.ts :: settings page (AC-075) disables the connection test until a provider declares a model",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) preserves the input and the active revision when config.save is refused (AC-075)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) reports an unusable provider profile without changing the configuration (AC-075)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) reports a bad config patch with the input preserved and the revision unchanged (AC-075)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) reports an unusable provider profile from config.test (AC-075)",
        "apps/web/test/workbench-failures.integration.test.ts :: WP-09 T4 required failure tests 配置失败: reports an unusable provider, preserves the input and the revision (AC-075)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack preserves the input on a provider failure and leaves the active revision unchanged (AC-075)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-076",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/web/test/views.test.ts :: attachment limits (AC-076) accepts a documented set",
        "apps/web/test/views.test.ts :: attachment limits (AC-076) refuses more than five attachments",
        "apps/web/test/views.test.ts :: attachment limits (AC-076) refuses one file over 20 MiB and a total over 50 MiB",
        "apps/web/test/views.test.ts :: attachment limits (AC-076) refuses an unsupported mime type",
        "apps/web/test/views.test.ts :: attachment limits (AC-076) treats a mime parameter as the same type",
        "packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) enforces the upload limits before anything is stored (AC-076)",
        "apps/daemon/test/server.test.ts :: daemon HTTP surface (WP-03) rejects unsupported and oversized uploads server-side (AC-076)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) binds an uploaded attachment to the first message and refuses a bad upload (AC-084/AC-076)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack binds an uploaded attachment to the first message and refuses a bad one (AC-084/AC-076)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-077",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/web/test/pages.test.ts :: files page (AC-077) shows the branch, the target revision and the read-only boundary",
        "apps/web/test/pages.test.ts :: files page (AC-077) renders a refused path as an error with its code, not an empty tree",
        "apps/web/test/views.test.ts :: file boundary (AC-077) resolves a nested relative path inside the root",
        "apps/web/test/views.test.ts :: file boundary (AC-077) refuses a path that escapes the root",
        "apps/web/test/views.test.ts :: file boundary (AC-077) refuses an absolute path instead of re-rooting it",
        "apps/web/test/views.test.ts :: file boundary (AC-077) renders a root-relative path for the wire",
        "apps/web/test/views.test.ts :: file boundary (AC-077) maps mime types and keeps the inline line/byte limits explicit",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) reads the target revision inside the root boundary without touching the snapshot (AC-077)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack reads the branch preview inside the root boundary without touching a snapshot (AC-077)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-078",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) accepts a read through the BFF cookie and forwards the daemon session",
        "apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) refuses an unauthenticated write with UNAUTHENTICATED and does not forward it",
        "apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) refuses a wrong-Origin write with NOT_AUTHORIZED while reads stay allowed",
        "apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) gates provider.upsert and provider.test as writes and forwards them with the daemon session (WP-12 T1.2B)",
        "apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) refuses a write with no Origin at all",
        "apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) refuses an expired daemon session and forgets the browser session",
        "apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) answers /api/session only for a live cookie and never exposes the daemon cookie",
        "apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) renders the first paint in the agentdev_language cookie and embeds the client dictionary (WP-12 T4)",
        "apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) clears the browser session on logout and refuses the old cookie afterwards",
        "apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) refuses a login from a disallowed origin and a wrong token",
        "apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) renders the sign-in page instead of any workbench page without a session",
        "apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) serves the static assets and refuses a traversal path",
        "apps/web/test/server.test.ts :: BFF HTTP surface (AC-078) reports health without a path or a secret",
        "packages/client/test/commands.test.ts :: AC-078 authentication lifecycle surfaces an expired session as a typed error without retrying",
        "packages/client/test/commands.test.ts :: AC-078 authentication lifecycle never retries a NOT_AUTHORIZED write",
        "packages/client/test/commands.test.ts :: AC-078 authentication lifecycle does not reconnect when the handshake itself is refused",
        "packages/client/test/subscriptions.test.ts :: AC-078 subscription expansion is refused refuses a subscription naming another Project",
        "packages/client/test/subscriptions.test.ts :: AC-078 subscription expansion is refused refuses a kind outside the session allowlist",
        "packages/client/test/subscriptions.test.ts :: AC-078 subscription expansion is refused surfaces the server refusal for a cross-Project id",
        "packages/client/test/subscriptions.test.ts :: AC-078 subscription expansion is refused keys a subscription by project and scope",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) answers a cross-project id with NOT_FOUND and never another project data (AC-078)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) refuses an unauthenticated or foreign-origin upgrade (AC-078)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) refuses a cross-project subscription and closes on an expired session (AC-078)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) keeps background Work running when the WebSocket disconnects (AC-054/AC-078)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) refuses unauthenticated and wrong-Origin writes while the Work keeps running (AC-078)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) keeps the background Work after a logout and refuses the stale cookie (AC-078)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) streams real events over the WebSocket proxy and resumes from a watermark (AC-069/AC-078)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) refuses an unauthenticated WebSocket upgrade and keeps the Work alive (AC-078)",
        "apps/web/test/workbench-failures.integration.test.ts :: WP-09 T4 required failure tests 断连: reports the break, replays from the watermark and keeps the Work (AC-078/AC-069)",
        "apps/web/test/workbench-failures.integration.test.ts :: WP-09 T4 required failure tests 订阅扩大: refuses a cross-Project widening and answers a fresh scoped snapshot (AC-078)",
        "apps/web/test/workbench-failures.integration.test.ts :: WP-09 T4 required failure tests 订阅扩大: refuses an out-of-authorisation scope locally, with no request sent (AC-078)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack reads all nine surfaces from real state in one drill (AC-068–AC-078, AC-084, AC-087–AC-090, AC-093)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-079",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/context-acl.test.ts :: context ACL — future artifacts (AC-079) denies a future artifact class to an earlier stage",
        "packages/core/test/context-acl.test.ts :: context ACL — future artifacts (AC-079) denies review/test artifacts to a Developer",
        "packages/core/test/context-acl.test.ts :: context ACL — future artifacts (AC-079) keeps a plan readable to Review and Test but not a settlement report",
        "packages/core/test/context-acl.test.ts :: context ACL — future artifacts (AC-079) derives the artifact class from the blob path when it is not declared",
        "packages/core/test/context-acl.test.ts :: context ACL — future artifacts (AC-079) refuses an artifact whose class cannot be established",
        "packages/core/test/context-acl.test.ts :: context ACL — future artifacts (AC-079) refuses a declared class that contradicts the artifact blob path (W5R2-02)",
        "packages/core/test/context-acl.test.ts :: context ACL — future artifacts (AC-079) lets a downstream stage read a Chief-session decision or attachment (W5R1-03)",
        "packages/core/test/context-acl.test.ts :: context ACL — future artifacts (AC-079) still refuses a future pipeline artifact to an earlier stage (W5R1-03, AC-079)",
        "packages/core/test/context-acl.test.ts :: context ACL — future artifacts (AC-079) lets an L1 Develop read nothing from a future Plan",
        "packages/core/test/context-acl.test.ts :: context ACL — future artifacts (AC-079) derives every declared artifact class from a legal stage (W5R1-03)",
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) returns MISSING_CONTEXT with the precise gap and no frozen snapshot",
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) does not expand a module to satisfy a gap",
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) does not let an asserted artifact-backed input satisfy the table (W5R2-04)",
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) starts initialize in an empty Project with a BootstrapObservation (AC-079 #1)",
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) starts initialize with a Project overview instead (AC-079 #1 alt)",
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) starts a Product stage with an overview and a confirmed source (AC-079 #2)",
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) starts Planning with only a ProductDefinition and acceptance (AC-079 #3)",
        "packages/core/test/context-builder.test.ts :: buildContext — required inputs (AC-031, AC-079) starts L1 Develop with only a CompactPlan (AC-079 #4)",
        "packages/core/test/context-requirements.test.ts :: context requirements — table integrity has no row that still requires a future artifact (AC-079)",
        "packages/core/test/context-requirements.test.ts :: context requirements — AC-079 positives starts initialize in an empty Project with no overview/Product/Plan",
        "packages/core/test/context-requirements.test.ts :: context requirements — AC-079 positives rejects initialize when neither the overview nor a BootstrapObservation exists",
        "packages/core/test/context-requirements.test.ts :: context requirements — AC-079 positives runs a Product stage in that same empty Project",
        "packages/core/test/context-requirements.test.ts :: context requirements — AC-079 positives runs Planning with a ProductDefinition and no Plan (future artifact)",
        "packages/core/test/context-requirements.test.ts :: context requirements — AC-079 positives runs an L1 Develop with only a CompactPlan and no full Plan/Task",
        "packages/core/test/context-requirements.test.ts :: context requirements — AC-079 positives accepts an L1 document check with either a CompactPlan or a Plan",
        "packages/core/test/context-requirements.test.ts :: context requirements — AC-079 negatives fails Planning without a ProductDefinition and names the gap",
        "packages/core/test/context-requirements.test.ts :: context requirements — AC-079 negatives fails L2 Develop without the Plan and lists every missing upstream input",
        "packages/core/test/context-requirements.test.ts :: context requirements — AC-079 negatives fails Test without a valid Review",
        "packages/core/test/context-requirements.test.ts :: context requirements — AC-079 negatives fails Settlement without the final verification result",
        "packages/core/test/context-requirements.test.ts :: context requirements — AC-079 negatives rejects a forbidden input even when everything required is present",
        "packages/core/test/context-requirements.test.ts :: context requirements — AC-079 negatives returns VALIDATION_ERROR for a pair the table does not define"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-080",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) admits the exact once binding and reports no replay for a first use",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) replays a consumed once grant for the same operation and input (AC-080)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) binds a replay to the full operation/role/stage triple, not just the run (W7R1-06)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) refuses a different input hash with IDEMPOTENCY_CONFLICT and names the field (AC-080)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) refuses a different tool operation on a consumed grant with IDEMPOTENCY_CONFLICT (AC-080)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) refuses a different operation on a live grant without consuming anything (AC-049)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) refuses the wrong role or stage with NOT_AUTHORIZED (AC-049)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) isolates sibling runs on a run-scoped grant and keeps work-scoped grants shared (AC-080)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) refuses every later use of an expired or revoked grant (AC-049)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) keeps replaying a completed once transaction after its expiry (AC-080)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) refuses a sibling run reaching for a consumed once grant (AC-080)",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) refuses a malformed target and an out-of-grant target with the documented codes",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) keeps the target rules the rest of the codebase relies on",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) derives scope bindings from the request identity fields",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) issuance validation (AC-049) accepts an in-scope request",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) issuance validation (AC-049) refuses an operation outside the Work envelope",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) issuance validation (AC-049) refuses a foreign work id and a role at a stage it does not operate",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) issuance validation (AC-049) refuses a missing once binding and a malformed input hash with VALIDATION_ERROR",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) issuance validation (AC-049) refuses a target outside the Work paths and a malformed target",
        "packages/domain/test/permission-delivery.test.ts :: grant admission (AC-049, AC-080) issuance validation (AC-049) does not apply the path envelope to non-path operations",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) refuses the sibling Run of the same role with no side effect (AC-080)",
        "packages/core/test/broker.test.ts :: Broker (AC-048, AC-050) admission through the Grant service (AC-048) replays the recorded result for the same once operation (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) issuing mints a grant that carries every documented binding and audits it (AC-049)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) issuing refuses an unknown Work without writing a row (AC-049)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) issuing refuses an operation and a target outside the Work scope (AC-049)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) issuing refuses a Run from another Work and a role that was never dispatched (AC-049)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) issuing refuses a once request without its operation/input binding (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) issuing refuses to mint for a Work that is not running (AC-049)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) executes once and replays the original result for the same input (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) leaves the grant unconsumed and rolls the tool operation back when the tool fails (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) replays after the grant has expired, because the result is the recorded fact (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) refuses a different input hash with IDEMPOTENCY_CONFLICT and consumes nothing (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) refuses a different tool operation with IDEMPOTENCY_CONFLICT (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) refuses a different operation than the grant was issued for (AC-049)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) refuses a replayed reference whose result cannot be resolved as RECOVERY_REQUIRED (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) reports RECOVERY_REQUIRED when a started tool operation has no recorded result (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) once consumption (AC-080) refuses a recorded tool operation id reused with a different input hash (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) asynchronous tool bodies (W7R3-02) awaits an async body, records its resolved value and replays it (W7R3-02)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) asynchronous tool bodies (W7R3-02) consumes nothing and leaves nothing finished when an async body rejects (W7R3-02)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) asynchronous tool bodies (W7R3-02) refuses a thenable from the synchronous path instead of recording it (W7R3-02)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) sibling run isolation (AC-080) refuses the sibling Run on a run-scoped grant with no side effect (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) sibling run isolation (AC-080) refuses the sibling Run reaching for a consumed once grant (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) sibling run isolation (AC-080) keeps a work-scoped grant usable by both Runs (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) sibling run isolation (AC-080) refuses a request claiming another Work, with no row written (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) expiry and revocation (AC-049) refuses an expired grant at use time and does not execute (AC-049)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) expiry and revocation (AC-049) refuses every later use after revoke, while a completed once still replays (AC-049, AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) expiry and revocation (AC-049) refuses to revoke a grant that is already closed",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) query helpers (AC-049) reports the current grants of a run and a work, and removes a consumed one",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) query helpers (AC-049) keeps a consumed once grant visible to coverage, because it still replays (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) query helpers (AC-049) answers coverage with the same rules consumption would apply",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) query helpers (AC-049) never mutates the rows it reads",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) query helpers (AC-049) does not let a consumed once grant cover a different operation/role/stage (W7R1-06)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) query helpers (AC-049) surfaces the tool operation a grant was consumed by",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) concurrent double-consume (AC-080) lets exactly one of two connections claim the grant, and executes once (AC-080)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) durable deferred results (W7R1-10) replays the recorded result from a second store, rather than RECOVERY_REQUIRED",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) durable deferred results (W7R1-10) reports RECOVERY_REQUIRED only for a sink that cannot resolve the reference",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) multi-writer deferred results (W7R2-04/09/10) sees another sink's result immediately, with no stale manifest cache (W7R2-04)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) multi-writer deferred results (W7R2-04/09/10) replays a recorded null result instead of reporting it missing (W7R2-09)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) multi-writer deferred results (W7R2-04/09/10) replays a recorded undefined result as present (W7R2-09)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) multi-writer deferred results (W7R2-04/09/10) keeps a recorded result alive through an offline blob GC (W7R2-10)",
        "packages/core/test/grants.test.ts :: GrantStore (AC-049, AC-080) multi-writer deferred results (W7R2-04/09/10) registers the deferred-result records and legacy blobs as GC roots (W7R2-10)",
        "apps/daemon/test/tool-permission-runner.integration.test.ts :: environment-operation approval with a real Runner child (AC-049/AC-080) refuses, records the request, and really executes the model retry after the user approves (AC-049/AC-080)",
        "apps/daemon/test/tool-permission.integration.test.ts :: permission.request / permission.respond over the workbench protocol closes the environment-operation loop: refuse → approve (protocol) → retry executes (AC-049/AC-080)",
        "packages/core/test/broker.integration.test.ts :: Broker integration (AC-048, AC-050) keeps the once result replayable across a real execution (AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) executes an in-scope granted call and audits it, and refuses out-of-scope/expired/sibling calls with no side effect (AC-049, AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) replays the original once result for the same input and refuses a different input (AC-080)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) refuses an out-of-scope read by the same role with no executor call and no row (AC-049)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) reads the frozen verification input but not the source, and gains no write, in host and container mode (AC-048, AC-050)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) writes a Review report inside its declared report root and never the source (W7R1-13)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) refuses the run database to a verifier without any caller-declared protected path (W7R1-04)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) keeps the frozen source read-only inside the real container (AC-048, AC-050)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) injects the decoy into the authorised child and never into a log, Artifact, UI payload, audit row or the host environment (AC-051)",
        "packages/core/test/permissions.integration.test.ts :: end-to-end permission chain (AC-048, AC-049, AC-050, AC-051, AC-053, AC-080) gives the unauthorised sibling Run no credential at all, on every channel (AC-051)",
        "packages/core/test/tool-http.integration.test.ts :: tool.execute over the real control endpoint (T3.2) admits an environment operation only after the real approval chain (AC-049/AC-080)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-081",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) integrates B-on-A without re-applying the ancestor and settles the Requirement",
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) refuses a Task without a frozen manifest and writes nothing",
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) refuses a real merge conflict and leaves the delivery ref and the manifest untouched",
        "packages/core/test/integrate.integration.test.ts :: Accept/Integrate and Settlement over real Git (AC-010, AC-012, AC-041, AC-081) settlement refuses a Task whose manifest vanished before any write",
        "packages/core/test/wp08.integration.test.ts :: WP-08 T4 end-to-end integration drill runs the L2 route Plan/Develop/Review/Test/Settlement and settles the Requirement (AC-081)",
        "packages/core/test/wp08.integration.test.ts :: WP-08 T4 end-to-end integration drill chains dependent Tasks, invalidates on ancestor change and skips a merged ancestor (AC-081)",
        "packages/workspace/test/cas.integration.test.ts :: dependency lineage with real revisions (AC-081) orders the DAG deterministically and rejects a cycle",
        "packages/workspace/test/cas.integration.test.ts :: dependency lineage with real revisions (AC-081) records dependencyRevision and dependencyManifestRefs, then starts B from A",
        "packages/workspace/test/cas.integration.test.ts :: dependency lineage with real revisions (AC-081) invalidates B when its ancestor revision moves",
        "packages/workspace/test/cas.integration.test.ts :: dependency lineage with real revisions (AC-081) does not re-apply an already-merged ancestor in the final integration",
        "packages/workspace/test/cas.integration.test.ts :: dependency lineage with real revisions (AC-081) produces an independent repair task when two passed Tasks conflict (AC-062)",
        "packages/workspace/test/cas.integration.test.ts :: dependency lineage with real revisions (AC-081) integrates two non-conflicting passed Tasks in dependency order and CASes once"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-082",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) records an immutable assessment with the routing evidence",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) applies the documented routing floor from the payload alone (R9-01, DC-62)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) fails closed on unknown risk flags and on authorization provenance (R10-01/R10-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) never lets an intent label open the L3 gates (R11-01/R11-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) requires a verified authorization to create a Run for an L3 Work (R11-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) applies the L3 floor from the spec scope, not only the Work level (R12-01/R12-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) treats the authorization envelope as the scope boundary (R13-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) treats git as a workspace write and network targets as network writes (R14-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) requires a matching capability for every declared dimension (R15-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) lets a none-level Work produce its own artifact but not act on the world (R16-01/M-1)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) counts a local write operation as modification authority (R13-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) cleans absent optional fields instead of failing on the snapshot (R13-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) never freezes write authority for a none-level Work (R12-01, DC-66)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) freezes the authorization the Core actually verified (R12-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) routes environment operations to L3 whatever the intent label says (R10-07)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) rejects a malformed runParams and dispatch authorization before writing (R10-05)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) requires explicit authorization for L3 and refuses an unknown Work",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) freezes config, context and dispatch before queueing the Run",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) creates a professional Run only as a direct child of the Chief Run",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) binds a professional Run to a task of the same Work",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) refuses a stale profileRevision instead of running an unexpected model",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) refuses a dispatch that the role may not carry or that the budget cannot fund",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) blocks the dispatch when the role has no usable model",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) restores the narrow frozen scope after a restart (AC-082)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) reserves the Work budget on dispatch and releases it when the Run ends",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) applies the authorized Run parameter layer when freezing a profile",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) refuses an assessment below the level the routing rules require",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) frees a settled child's share of the parent allocation (M-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) charges measured usage and records an unmeasured release honestly (M-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) keeps budget accounting honest across cancel, over-usage and replay (R5-02/03/04/09)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) caps a usage report that exceeds the reservation and records the excess (R5-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) reconciles usage once and only consumes its own hold (R5-04)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) reports a malformed spec as VALIDATION_ERROR and writes no snapshot (R7-01/R7-07)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) rejects malformed protocol requests before persisting anything (R8-01/R8-02)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) leaves no snapshot behind when the frozen inputs are invalid (R8-04/R8-09)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) treats a different cost for the same Run as a conflict (R7-02/R7-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) releases the reservation of a never-started child when a parent is cancelled (R7-09)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) never re-books an already measured Run (R6-01/R6-04/R6-05)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) books measured usage on cancellation and refuses a contradictory report (R6-03)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) derives an idempotency key and reports bad input as VALIDATION_ERROR (R6-09/R6-10)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) answers an operationId replay even after the Chief Run has ended (R5-09)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) refuses to end a parent while join=all children are live, and cancel propagates (Q-04)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) rejects a reused operationId with a different payload (Q-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) refuses a dispatch request when the Chief Run itself cannot act (H-01)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) turns an agent dispatch request into a chief todo, never a grandchild Run",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) persists the assessed level on the Work so the next dispatch is authorized",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) derives the authorization from the assessment and freezes a real Run (Q1=B)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) injects the profile revision instead of trusting the draft (data.md §3)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) caps the allocation at what the parent Chief Run can still fund (N-10)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) fails closed on an empty scope: nothing is derived and the dispatch is refused",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) refuses a path that would leave the project root before writing authority",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) fails closed on an environment operation",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) keeps an existing authorization instead of deriving a second one",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) assessWithDerivation writes the authority the assessment path will reuse",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) refuses an out-of-envelope agent.dispatch with zero residue (WP-12 T2.5)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) refuses to queue a child Run the Chief Run cannot fund (review P3)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) refuses an agent.dispatch write scope with no authorization (review P2-1)",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) refuses agent.dispatch from a Run that is not the Work’s Chief",
        "packages/core/test/orchestrator.test.ts :: chief orchestration (AC-045, AC-044, AC-082) assessment persistence and derived authorization (WP-12 T2.2) leaves no Run or snapshot behind when the draft spec is invalid",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) withholds a new Attempt while the old execution is unconfirmed (W8R1-04)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) binds a resume decision to its own Run, not to the whole Work (W8R2-03)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) keeps a Run-bound resume decision past a window of unrelated decisions (W8R3-04)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) parses only real process identities and reports the rest as unconfirmed",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) rotates an expired lease to a new owner and revokes it for the old one",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) parks a running Run as interrupted when its process is confirmed gone",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) requires a RecoveryDecision while the old process is alive or unconfirmable",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) requires a RecoveryDecision for an unconfirmed tool side effect",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) checks real process state instead of the persisted status (AC-061 matrix)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) uses a legal two-step path for a waiting Run",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) leaves a Run with no live state alone",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses an old-epoch success but keeps its diagnostics (AC-058)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses a late success after cancellation, keeping diagnostics (AC-058)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses a late success superseded by a newer accepted decision (AC-058)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) accepts the current epoch when nothing superseded it",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) fences daemon epochs across restarts and records the reports",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) announces each restart report once with a resolvable report reference (AC-061)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) builds a RecoveryReport from real runner, lease and tool facts",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) preserves the narrow DispatchSnapshot scope after a restart (AC-082)",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) refuses to recover a Run whose dispatch snapshot is missing or tampered with",
        "packages/core/test/recovery.test.ts :: Run recovery: leases, epochs and restart inspection (AC-057/058/061/082) reports NOT_FOUND instead of throwing for an unknown Run",
        "packages/core/test/wp08.integration.test.ts :: WP-08 T4 end-to-end integration drill preserves the narrow DispatchSnapshot scope across a restart recovery (AC-082)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-083",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) returns work to development without a human forwarding step (AC-017)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) invalidates the old Review/Test after a fix and refuses self-verification (AC-017/AC-018)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) binds the verification to the fixing revision and the real Test conclusion (AC-018, W6R1-01/W6R1-08)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) closes through evaluateFindingClosure and stops at the rework allowance (AC-017/AC-022)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) blocks completion for blocked and undisposed not_covered results (AC-019)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) binds a document/integration Finding without a taskId (AC-083)",
        "packages/domain/test/delivery.test.ts :: findings (AC-017/AC-018/AC-019/AC-083) routes a document Finding through the same closure rules (AC-083)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) binds a task-less integration Finding and sends it straight back to development (AC-083, AC-017)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a task target without a taskId, a foreign task and a developer Run, writing nothing (AC-083)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) closes a fixed Finding only after a new independent Review and Test, and refuses a developer self-verify (AC-018)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a pre-fix revision and a non-passed Test conclusion even when the Runs are new (AC-018, W6R1-01/W6R1-08)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses an old Review, the raising Review and a wrong-role Run as the fix verifier (AC-017, AC-018)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) records a user-accepted residual risk only from a real accepted risk Decision (AC-018)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) never completes on a blocked Test result and never on a caller-asserted one (AC-019, W6R1-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a Test evidence bound to another revision or without an environment (AC-019, W6R1-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) requires an explicit risk disposition for every not_covered acceptance id (AC-019)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) completes a passed Test result with no uncovered acceptance ids (AC-019)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) never completes a code L2 Work on a Test Run alone (AC-010/AC-019, W6R4-01)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) blocks completion while a blocking Finding is open or addressed (AC-017, AC-019)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) pauses at a safe point, admits no write, and resumes into a new Attempt after the version check (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to resume a Work that changed while it was paused (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to pause while a Run still needs recovery (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to resume while a Run still needs recovery (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to resume a recovery_required Run that has no persisted verdict (WP11R4-04)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to pause a blocked Work, which recovers through its own path (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) walks a queued Work to the pause safe point (AC-020)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) cancels the Run tree through cancelling to cancelled, keeping the artifacts un-integrated (AC-021)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) stops at blocked(recovery) when side effects are unknown and only then reaches cancelled (AC-021)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) lets a recovery decision resume the Work instead of cancelling it (AC-021)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to cancel a finished Work",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) never completes on Test evidence a Finding invalidated and advances the revision on the fix (AC-017/AC-019, W6R2-01)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a fix whose Run self-reports the invalidated pre-fix revision (AC-018, W6R2-03)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses to complete a Work that froze no base revision (AC-019, W6R2-04)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) binds a Test to its frozen VerificationManifest when the Run produced no artifact (AC-019, W6R2-05)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) fails closed when a stage result names a manifest that is not frozen (W6R2-05)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) admits a write only when the newest Attempt is ready (AC-020, W6R2-08)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) completes an L1 Work without a Test Run, through its Review and a frozen CompletionManifest (AC-007/AC-019, W6R2-09)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) reports review evidence under review fields and no test status on an L1 completion (AC-007, W6R4-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) keeps the document route on its own rule: Review evidence, no code Test Run (AC-012, W6R2-09)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) derives the completion route from the Work intent and refuses a conflicting one (AC-019, W6R3-01)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses every write once the Work is completed or failed, with zero write events (AC-013/AC-020, W6R3-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses writes after a cancel stops at blocked(recovery) (AC-021, W6R3-02)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) refuses a fix that re-anchors to a revision a Finding invalidated (AC-017/AC-018, W6R3-03)",
        "packages/core/test/findings.test.ts :: Finding lifecycle, completion and pause/cancel (AC-017…AC-021, AC-083) keeps the frozen-manifest lookup on the real manifestId key space (W6R3-05)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) runs the L1 typo chain to a CompletionManifest and CAS with no Planning/Test Run and no board entry (AC-007)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) drives a validated ProductDefinition through Plan/Develop/Review/Test/Settlement in order (AC-010)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) saves a confirmed design as Product/Planning candidate diffs with an independent Review and Settlement only (AC-012)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) requires explicit authorization, rollback, per-item audit and a recovery drill before an L3 migration is implemented (AC-011)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) closes a task-less Review Finding through a fix and a new independent Review/Test, refusing self-verification (AC-017, AC-018, AC-083)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) pauses at a safe point, resumes into a new Attempt, and cancels the Run tree while keeping the artifacts (AC-020, AC-021)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) shows an imported active Requirement as waiting to continue and re-plans it in a new Work without reusing old verification (AC-089)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) refuses the superseded Plan after an upgrade and leaves the source hash unchanged (AC-009, AC-013)",
        "packages/core/test/wp08.integration.test.ts :: WP-08 T4 end-to-end integration drill runs the document route with an independent Review and an integration Finding (AC-083)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-084",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) stages an upload with a 24h TTL and binds it once (AC-084)",
        "packages/core/test/artifacts.test.ts :: attachments, artifacts and previews (WP-03) sends a message, creates its assist Work and binds uploads atomically (AC-084)",
        "apps/daemon/test/server.test.ts :: daemon HTTP surface (WP-03) refuses unauthenticated requests (AC-084)",
        "apps/daemon/test/server.test.ts :: daemon HTTP surface (WP-03) uploads, binds and previews an HTML explanation end to end (AC-002/AC-084)",
        "apps/daemon/test/server.test.ts :: daemon HTTP surface (WP-03) deletes only staged uploads and refuses bound ones (AC-084)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) sends a message that creates real Work and a real event (AC-069/AC-084)",
        "apps/web/test/server.integration.test.ts :: workbench BFF over the real daemon (WP-09 T3) binds an uploaded attachment to the first message and refuses a bad upload (AC-084/AC-076)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack reads all nine surfaces from real state in one drill (AC-068–AC-078, AC-084, AC-087–AC-090, AC-093)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack binds an uploaded attachment to the first message and refuses a bad one (AC-084/AC-076)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-085",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/context-ledger.test.ts :: read ledger — seal and stale binding (AC-085) seals the ordered entries and refuses every later append",
        "packages/core/test/context-ledger.test.ts :: read ledger — seal and stale binding (AC-085) re-sealing is idempotent",
        "packages/core/test/context-ledger.test.ts :: read ledger — seal and stale binding (AC-085) verifies the correct binding and rejects an older seq or a different hash",
        "packages/core/test/context-ledger.test.ts :: read ledger — seal and stale binding (AC-085) refuses verification while the ledger is still open",
        "packages/core/test/context-ledger.test.ts :: read ledger — seal and stale binding (AC-085) seals an empty ledger to seq 0 so a no-read stage result still binds",
        "packages/core/test/context-ledger.test.ts :: read ledger — seal and stale binding (AC-085) is a stable chain over the documented entry fields",
        "packages/core/test/tool-http.test.ts :: tool.execute endpoint handler carries the Attempt read-ledger binding when the handler supplies one (AC-085)",
        "apps/runner/test/control-client.test.ts :: runner control client (protocol.md §6) remembers the read-ledger binding a context.request expansion answered with (AC-085)",
        "apps/runner/test/read-ledger.test.ts :: Runner read ledger seal (AC-085, WP-12 R3-2d) seals an empty ledger to the genesis value, not a placeholder",
        "apps/runner/test/read-ledger.test.ts :: Runner read ledger seal (AC-085, WP-12 R3-2d) chains each read into the accumulator and reports the last seq",
        "apps/runner/test/tool-client.test.ts :: tool call transport starts at the derived empty read-ledger binding, not a placeholder (AC-085)",
        "apps/daemon/test/tool-handler.integration.test.ts :: daemon tool handler records the read in the Attempt ledger and returns its binding (AC-085)",
        "apps/runner/test/attempt.integration.test.ts :: AttemptRunner seals stage_yield with the read-ledger binding the control channel reached (AC-085)",
        "packages/core/test/read-ledger-seal.integration.test.ts :: read ledger seal (AC-085) appends every read in order and derives the binding from the entries",
        "packages/core/test/read-ledger-seal.integration.test.ts :: read ledger seal (AC-085) verifies the exact binding and refuses placeholders or stale values",
        "packages/core/test/read-ledger-seal.integration.test.ts :: read ledger seal (AC-085) records an out-of-scope read request in the same ledger (AC-032)",
        "packages/core/test/read-ledger-seal.integration.test.ts :: read ledger seal (AC-085) admits only paths inside the readScope, before anything is read (AC-032)",
        "packages/core/test/read-ledger-seal.integration.test.ts :: read ledger seal (AC-085) agrees with the ledger append on artifact and feature paths",
        "packages/core/test/read-ledger-seal.integration.test.ts :: read ledger seal (AC-085) accepts a stage result whose binding matches, then seals the ledger",
        "packages/core/test/read-ledger-seal.integration.test.ts :: read ledger seal (AC-085) refuses a stage result that reports a placeholder instead of the real reads",
        "packages/core/test/read-ledger-seal.integration.test.ts :: read ledger seal (AC-085) refuses to certify an Attempt whose admitted read could not be recorded",
        "packages/core/test/read-ledger-seal.integration.test.ts :: read ledger seal (AC-085) accepts the derived empty binding for an Attempt that read nothing"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-086",
      "status": "PASS",
      "accepted": false,
      "mapping": "curated",
      "evidence": [
        "packages/knowledge/test/feature-format.test.ts :: parseFeatureDocument parses a complete document with real-valued fields",
        "packages/knowledge/test/feature-format.test.ts :: parseFeatureDocument rejects design=confirmed without one resolvable decision reference",
        "packages/knowledge/test/feature-format.test.ts :: parseFeatureDocument rejects verification=passed without evidence references",
        "packages/knowledge/test/feature-format.test.ts :: parseFeatureDocument rejects verification=passed without coverage",
        "packages/knowledge/test/feature-format.test.ts :: parseFeatureDocument rejects verification=passed recorded against another code tree",
        "packages/knowledge/test/feature-format.test.ts :: parseFeatureDocument rejects investigation=investigated without a scope",
        "packages/knowledge/test/feature-format.test.ts :: parseFeatureDocument rejects investigation=investigated without sources"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-087",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) keeps an imported requirement identity and its evidence availability honest (AC-087/AC-088/AC-089)",
        "apps/daemon/test/requirement-import.integration.test.ts :: first-open requirement import from the delivery revision (WP-12 T5.4) restores every lifecycle from a real clone with an empty database (AC-087/AC-088/AC-089)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack reads all nine surfaces from real state in one drill (AC-068–AC-078, AC-084, AC-087–AC-090, AC-093)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack shows an imported active requirement as waiting to continue with no Run (AC-087/AC-089)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-088",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/knowledge/test/requirements-pool.test.ts :: imported history (AC-088) keeps completion, cancellation and pre-archive state without migrating evidence",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) keeps an imported requirement identity and its evidence availability honest (AC-087/AC-088/AC-089)",
        "apps/daemon/test/requirement-import.integration.test.ts :: first-open requirement import from the delivery revision (WP-12 T5.4) restores every lifecycle from a real clone with an empty database (AC-087/AC-088/AC-089)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-089",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/web/test/pages.test.ts :: board page offers Continue only for a record that waits to continue (AC-089)",
        "packages/core/test/requirement-continue.test.ts :: Requirement continuation (AC-089) lists an imported active Requirement as waiting to continue without starting a Run (AC-089)",
        "packages/core/test/requirement-continue.test.ts :: Requirement continuation (AC-089) continues into a new local Work with a recorded authorization and the unmet Gates (AC-089)",
        "packages/core/test/requirement-continue.test.ts :: Requirement continuation (AC-089) refuses a Requirement that is not active or already has a local Work (AC-089)",
        "packages/core/test/requirement-continue.test.ts :: Requirement continuation (AC-089) reports the L3 stages plus the rollback/audit/drill evidence the continuation still owes (AC-089)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) keeps an imported requirement identity and its evidence availability honest (AC-087/AC-088/AC-089)",
        "apps/daemon/test/requirement-import.integration.test.ts :: first-open requirement import from the delivery revision (WP-12 T5.4) restores every lifecycle from a real clone with an empty database (AC-087/AC-088/AC-089)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack shows an imported active requirement as waiting to continue with no Run (AC-087/AC-089)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack answers the card actions with the real protocol codes the UI renders (AC-068/AC-089)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) runs the L1 typo chain to a CompletionManifest and CAS with no Planning/Test Run and no board entry (AC-007)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) drives a validated ProductDefinition through Plan/Develop/Review/Test/Settlement in order (AC-010)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) saves a confirmed design as Product/Planning candidate diffs with an independent Review and Settlement only (AC-012)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) requires explicit authorization, rollback, per-item audit and a recovery drill before an L3 migration is implemented (AC-011)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) closes a task-less Review Finding through a fix and a new independent Review/Test, refusing self-verification (AC-017, AC-018, AC-083)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) pauses at a safe point, resumes into a new Attempt, and cancels the Run tree while keeping the artifacts (AC-020, AC-021)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) shows an imported active Requirement as waiting to continue and re-plans it in a new Work without reusing old verification (AC-089)",
        "packages/core/test/delivery.integration.test.ts :: graded delivery chains (WP-06 T4, AC-007…AC-021/AC-083/AC-089) refuses the superseded Plan after an upgrade and leaves the source hash unchanged (AC-009, AC-013)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-090",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/web/test/pages.test.ts :: board page renders the branch, commit and push state and offers the lifecycle actions (AC-090)",
        "apps/web/test/pages.test.ts :: requirement detail page renders the delivery branch, commit, push state and the card actions (AC-090)",
        "apps/web/test/pages.test.ts :: requirement detail page says the push state is unreported when the read payload carries none (AC-090)",
        "apps/web/test/views.test.ts :: board projection (AC-068) states the record branch, commit and push state from the real payload (AC-090)",
        "apps/web/test/views.test.ts :: board projection (AC-068) never invents a commit or a push state the payload did not report (AC-090)",
        "apps/web/test/views.test.ts :: requirement detail (AC-070) states the delivery branch, the commit and the actions it can offer (AC-090)",
        "apps/web/test/views.test.ts :: requirement detail (AC-070) reads an explicit unpushed result and treats a working tree as no commit (AC-090)",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) refuses requirement.save without the Git record service instead of faking a save (AC-090/AC-093)",
        "apps/daemon/test/requirement-commands.integration.test.ts :: documented requirement commands over real Git (WP-12 T4b) exposes branch/commit/unpushed on board, get and list, and flips after a real push (AC-090)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack reads all nine surfaces from real state in one drill (AC-068–AC-078, AC-084, AC-087–AC-090, AC-093)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack shows a requirement in the UI only after Git and the projection agree (AC-090/AC-093)",
        "packages/core/test/requirement-save.integration.test.ts :: requirement instant save (AC-090) commits requirement.json, content.md and the rebuilt README in one commit",
        "packages/core/test/requirement-save.integration.test.ts :: requirement instant save (AC-090) reports the unpushed state against a configured remote (`AC-090`)",
        "packages/core/test/requirement-save.integration.test.ts :: requirement instant save (AC-090) leaves the branch untouched when the integration lock is held by a delivery",
        "packages/core/test/requirement-save.integration.test.ts :: requirement instant save (AC-090) refuses a second create for the same id and writes nothing",
        "packages/core/test/requirement-save.integration.test.ts :: requirement instant save (AC-090) updates an existing record with a new version and includes both records in the pool",
        "packages/core/test/requirement-save.integration.test.ts :: requirement save failure and retry (AC-090) hands back the original operation when the baseline moved, and retries onto it",
        "packages/core/test/requirement-save.integration.test.ts :: requirement save failure and retry (AC-090) reports RECOVERY_REQUIRED with a repair-only retry when the projection fails after the commit"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-091",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/requirement-save.test.ts :: completion/settlement consistency (AC-091) accepts a completion record that binds the Settlement revision, tree and manifests",
        "packages/core/test/requirement-save.test.ts :: completion/settlement consistency (AC-091) refuses a completion record whose code revision is not the final revision",
        "packages/core/test/requirement-save.test.ts :: completion/settlement consistency (AC-091) refuses a Settlement that verified a different code tree",
        "packages/core/test/requirement-save.test.ts :: completion/settlement consistency (AC-091) refuses a manifest that invalidated or verified another tree",
        "packages/core/test/requirement-save.test.ts :: completion/settlement consistency (AC-091) refuses to present a metadata-only change as code verification",
        "packages/core/test/requirement-save.test.ts :: completion/settlement consistency (AC-091) requires a completion summary at all",
        "packages/core/test/requirement-save.test.ts :: completion/settlement consistency (AC-091) refuses an empty change set as code verification (W8R1-07)",
        "packages/core/test/requirement-save.test.ts :: completion/settlement consistency (AC-091) refuses a revision range that starts at the final revision (W8R1-07)",
        "packages/core/test/requirement-save.test.ts :: completion/settlement consistency (AC-091) reports the range it verified on success (W8R1-07)",
        "packages/core/test/requirement-save.test.ts :: Project integration lock (AC-091) names the one resource requirement saves and code delivery share",
        "packages/core/test/requirement-save.test.ts :: Project integration lock (AC-091) refuses a second writer while the lock is held, and frees it for a retry",
        "packages/core/test/requirement-save.test.ts :: Project integration lock (AC-091) replaces an expired lock so a crashed save can be retried",
        "packages/core/test/requirement-save.integration.test.ts :: requirement save versus code delivery (AC-091) carries the latest requirement pool into a code integration built on an older baseline",
        "packages/core/test/requirement-save.integration.test.ts :: requirement save versus code delivery (AC-091) serializes a save and a delivery through the same integration lock (W8R2-02)",
        "packages/core/test/wp08.integration.test.ts :: WP-08 T4 end-to-end integration drill serializes a requirement save and a code delivery through the shared lock (AC-091)"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-092",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "apps/daemon/test/requirement-import.integration.test.ts :: first-open requirement import from the delivery revision (WP-12 T5.4) keeps valid records visible next to a broken one and reports the conflict (AC-092 surface)",
        "packages/knowledge/test/requirements-pool.test.ts :: importRequirementPool imports a pool, is idempotent, and keeps local and record versions apart",
        "packages/knowledge/test/requirements-pool.test.ts :: parseRequirementPool keeps valid records visible next to a broken one and never rewrites the files",
        "packages/knowledge/test/requirements-pool.test.ts :: importRequirementPool reports the same recordVersion with different content as a per-record conflict",
        "packages/knowledge/test/requirements-pool.test.ts :: importRequirementPool refuses to overwrite when Git moved but the projection is stale",
        "packages/knowledge/test/requirements-pool.test.ts :: importRequirementPool conflicts per record when a local row has no readable Git record",
        "packages/knowledge/test/requirements-pool.test.ts :: importRequirementPool reports a duplicate id inside one batch instead of importing either copy",
        "packages/knowledge/test/requirements-pool.test.ts :: importRequirementPool clears a conflict after Git is repaired and the record is re-imported"
      ],
      "drills": [],
      "reason": null
    },
    {
      "id": "AC-093",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/core/test/context-builder.test.ts :: buildContext — excluded and unknown refs (AC-093) records a reference that does not exist and never expands it",
        "packages/core/test/context-builder.test.ts :: buildContext — excluded and unknown refs (AC-093) keeps the selection’s own excluded and unknowns verbatim",
        "packages/core/test/requirement-save.test.ts :: prepareRequirementSave (AC-093) builds both files with one version and the documented combined record hash",
        "packages/core/test/requirement-save.test.ts :: prepareRequirementSave (AC-093) changes the combined record hash when the body changes",
        "packages/core/test/requirement-save.test.ts :: prepareRequirementSave (AC-093) normalizes CRLF to LF before hashing so the same text hashes the same",
        "packages/core/test/requirement-save.test.ts :: prepareRequirementSave (AC-093) refuses a body that does not have the six documented headings",
        "packages/core/test/requirement-save.test.ts :: prepareRequirementSave (AC-093) refuses metadata that violates the RequirementMetadata contract",
        "packages/core/test/requirement-save.test.ts :: prepareRequirementSave (AC-093) refuses a non-increasing recordVersion",
        "packages/core/test/requirement-save.test.ts :: prepareRequirementSave (AC-093) validates the body structurally without interpreting prose",
        "packages/core/test/requirement-save.test.ts :: prepareRequirementSave (AC-093) produces metadata that its own schema accepts",
        "packages/core/test/requirement-save.test.ts :: pool records and README (AC-093) rebuilds the README from the records and commits both files of each",
        "packages/core/test/requirement-save.test.ts :: pool records and README (AC-093) sorts the index by id so a rebuild is deterministic",
        "apps/daemon/test/protocol.integration.test.ts :: workbench protocol over the real Core (WP-09 T2) refuses requirement.save without the Git record service instead of faking a save (AC-090/AC-093)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack reads all nine surfaces from real state in one drill (AC-068–AC-078, AC-084, AC-087–AC-090, AC-093)",
        "apps/web/test/workbench.integration.test.ts :: WP-09 T4: the workbench end to end over the real stack shows a requirement in the UI only after Git and the projection agree (AC-090/AC-093)",
        "packages/core/test/requirement-save.integration.test.ts :: stale projection refuses to overwrite (AC-093) refuses a same-version record whose body another server changed",
        "packages/core/test/requirement-save.integration.test.ts :: stale projection refuses to overwrite (AC-093) refuses a create when Git already holds a record the projection does not know",
        "packages/core/test/requirement-save.integration.test.ts :: stale projection refuses to overwrite (AC-093) refuses a stale local expectation when it cannot satisfy the projection version",
        "packages/core/test/requirement-save.integration.test.ts :: stale projection refuses to overwrite (AC-093) reads the pool at the delivery ref, never the stale working tree (W8R1-02)",
        "packages/core/test/requirement-save.integration.test.ts :: stale projection refuses to overwrite (AC-093) reports a HEAD-only record as a per-record conflict instead of an ENOENT (W8R1-03)",
        "packages/core/test/requirement-save.integration.test.ts :: stale projection refuses to overwrite (AC-093) returns a structured INTERNAL_ERROR when the committed blob cannot be read (W8R1-03)"
      ],
      "drills": [
        {
          "tool": "pnpm test:e2e",
          "status": "PASS"
        }
      ],
      "reason": null
    },
    {
      "id": "AC-094",
      "status": "PASS",
      "accepted": false,
      "mapping": "test-name",
      "evidence": [
        "packages/workspace/test/cas.integration.test.ts :: CAS integration against a real Git repository (AC-094) creates the commit with the requirement pool files and moves the branch once",
        "packages/workspace/test/cas.integration.test.ts :: CAS integration against a real Git repository (AC-094) refuses a stale writer with VERSION_CONFLICT and leaves the branch untouched",
        "packages/workspace/test/cas.integration.test.ts :: CAS integration against a real Git repository (AC-094) re-uses the commit after a crash between the commit and the status write",
        "packages/workspace/test/cas.integration.test.ts :: CAS integration against a real Git repository (AC-094) refuses a half requirement pair and commits nothing",
        "packages/workspace/test/cas.integration.test.ts :: CAS integration against a real Git repository (AC-094) refuses a dirty integration worktree before touching the branch",
        "packages/workspace/test/cas.integration.test.ts :: CAS integration against a real Git repository (AC-094) reuses the candidate when another operation already installed it, never force-moving the branch",
        "packages/workspace/test/cas.integration.test.ts :: CAS integration against a real Git repository (AC-094) never commits in the delivery working tree: a candidate revision is required (W8R1-01)",
        "packages/workspace/test/cas.integration.test.ts :: CAS integration against a real Git repository (AC-094) refuses a competing ref move between the compare and the swap (W8R1-01)",
        "packages/workspace/test/cas.integration.test.ts :: CAS integration against a real Git repository (AC-094) refuses a candidate that is not a descendant of the expected revision (W8R2-01)",
        "packages/workspace/test/cas.integration.test.ts :: CAS integration against a real Git repository (AC-094) returns a structured INTERNAL_ERROR when the candidate tree cannot be read (W8R2-04)",
        "packages/core/test/requirement-save.integration.test.ts :: stale projection refuses to overwrite (AC-093) refuses a same-version record whose body another server changed",
        "packages/core/test/requirement-save.integration.test.ts :: stale projection refuses to overwrite (AC-093) reports a HEAD-only record as a per-record conflict instead of an ENOENT (W8R1-03)",
        "packages/core/test/requirement-save.integration.test.ts :: requirement save working copy and journal identity (W8R3-01..03, T-03/T-05) reports a half pair as a per-record conflict instead of dropping it (T-03)",
        "packages/core/test/requirement-save.test.ts :: prepareRequirementSave (AC-093) builds both files with one version and the documented combined record hash",
        "packages/core/test/requirement-save.test.ts :: completion/settlement consistency (AC-091) requires a completion summary at all"
      ],
      "drills": [],
      "reason": null
    }
  ]
}
```

