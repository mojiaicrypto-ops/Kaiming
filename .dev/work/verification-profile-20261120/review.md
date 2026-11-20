# Independent Review · 验证档结构化

日期：2026-11-20
验证档：broad
审核对象：`.dev/work/verification-profile-20261120/plan.md` 与工作树改动（schema v21、task create/update、派发信封、提示词与交付契约）。

## Round 1: NEEDS_FIX

1. `kaiming/src/tools/task-tools.ts:660-673`：旧 Task（`verificationProfile=NULL`、`requiresTest=false`）只改 `planMarkdown` 并新增 `Verification profile: **broad**` 时被接受，行仍是 `null/false`；派发回退后有效档位是 broad，但 `phasesFor('implement', false)` 没有 test 阶段，形成“broad 无独立 Test”的阻断状态。端到端探针复现：update 返回成功，库值不变，`resolveVerificationProfile` 返回 `{profile:'broad', fromTask:false}`。

非阻断建议：`SCHEMA_SQL` 的 tasks 表未同步新列；`DispatchEnvelopeFacts` 注释仍写“Plan 声明”；`reviewer.md` 仍让 Review 只看 Plan 档位；`tester.md:7` 开头仍像“先跑端到端”。

## Round 2: PASS

原问题已修复并复核：

- 旧行 + 仅 Plan 声明 `**broad**` → 拒绝 `missing=verificationProfile`，行保持 `null/false`；仅 Plan 纯文本改写 → 接受，行仍为 null（回退语义不变）。
- 旧行 + Plan `broad` + `verificationProfile=broad` + `requiresTest=true` → 接受并落库 broad/true；旧行 + profile-only `focused` → 接受，派发解析为 `{profile:'focused', fromTask:true}`。
- 旧行 + Plan `broad` + `requiresTest=false`（无 profile）→ 拒绝；旧行 + Plan `broad` + profile `focused` → 拒绝并给出 `declared=broad`。
- 已存 profile 的 Task：Plan-only 改成不同值仍拒绝；相同值或无声明仍接受。
- 回归：`task-tools`/`delegation`/`store` 90/90 通过；`check:prompts` 15/15。

其他修正核对：`SCHEMA_SQL` 已含 `verificationProfile TEXT`，v20→v21 的 `addColumn` 在新建库上是幂等空操作；信封注释、`reviewer.md:25`、`tester.md:7` 已同步。判定：无剩余阻断项。作者自报的 `tsc` 与全量 697 通过未由 Review 重跑（由独立 Test 负责）。
