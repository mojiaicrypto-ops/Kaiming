# Settlement · 验证档结构化与最小充分验证

日期：2026-11-20
验证档：broad（Task schema v20→v21、派发契约、工具参数、提示词）

## 交付

- `kaiming/src/store/store.ts`：`SCHEMA_VERSION=21`；tasks 增加 `verificationProfile TEXT`（`SCHEMA_SQL` 与 v20→v21 迁移同时具备，迁移用 `addColumn` 幂等）；`TaskRow`/`CreateTaskParams`/`UpdateTaskParams`/`toTaskRow`；create/update 拒绝非 implement 档位与 `visual↔requiresTest` 不配对。
- `kaiming/src/runtime/plan-contract.ts`：独占行声明接受 `**bold**`、`__bold__`、`*italic*`、反引号；围栏与 4 空格缩进仍视为示例；`broader` 不匹配。
- `kaiming/src/tools/task-tools.ts`：create/update 增加 `verificationProfile`；implement 必填；与 `requiresTest` 配对；Plan 声明冲突拒绝；旧 Task 只改 Plan 并新增声明时要求同时给出结构化档位；`get` 摘要暴露档位。
- `kaiming/src/tools/delegation-tools.ts`：`resolveVerificationProfile` 以 Task 字段为准，旧 Task（null）回退 Plan；信封标明来源；验收行注明档位是本次派发的上限；上限句覆盖 `## 验收` 与 `## 验证`。
- `kaiming/src/server/read-methods.ts`：Task 列表/详情读模型暴露档位。
- `docs/technicalnew/prompts/chief.md` v11、`developer.md` v7、`tester.md` v6、`reviewer.md` v6：结构化参数、最小真实入口、验收/验证上限、只读 Tester 不改源码做变异、Review 以库值为准。
- `docs/productnew/modules/delivery.md`：D-04 档位随 Task 保存、验收/验证受档位约束；focused 行去项目耦合措辞；D-05 最小入口与负向控制分工。
- `docs/technicalnew/agents-and-tools.md`：G2 create/update 参数、信封读库与旧 Task 回退。
- 测试：`store`（v20→v21、落库、配对拒绝）、`plan-contract`（bold/italic/围栏）、`task-tools`（必填、配对、Plan 冲突、旧 Task 三条路径、update 降 Test 拒绝）、`delegation`（库值优先、旧 Task 回退、上限句）；既有 create fixtures 补档位。

## 效果

- 主管在 `task(op=create)` 时必须显式给档位，宿主不再从 Markdown 猜；`requiresTest` 与档位由程序校验，不再依赖 Review 事后发现。
- 即使 Plan 正文写成 `**broad**` 或带反引号，宿主也能正确读出；旧 Task 仍按 Plan 回退，派发在信封里标明来源。
- 验收/验证章节不再能无声扩大范围：成员收到的上限句明确包含两节，并保留“冲突要报告”。
- `focused`/`broad` 仍保留独立 Test；focused 的 Test 只在变更契约的最小真实入口上执行，不再默认全链路。

## 证据

- 作者：`tsc` 通过；全量 `vitest run` 68 文件 697 通过；`check:prompts` 15/15；定向 `task-tools`/`delegation`/`store`/`plan-contract` 通过。
- 独立 Review：Round 1 NEEDS_FIX（旧 Task 仅改 Plan 可形成 broad 无 Test），修复后 Round 2 PASS（含迁移探针与旧行矩阵）；见 `review.md`。
- 独立 Test：passed。真实 task 工具 + 临时 Store 覆盖创建拒绝矩阵、旧行三条 update 路径、派发来源与上限句、v20→v21、bold 解析；在 `/tmp` 副本删掉旧行守卫后对应用例按预期变红（`expected false to be true` at `task-tools.test.ts:800`）；主树 `tsc`、697/697、15/15 复跑通过；主树源码未改。详见 `test.md`。

## 边界

- 不新增 minimal 档；不放宽 focused/broad 的独立 Test。
- 宿主不审查 Plan/派发的自然语言，验收被原样下发；实际约束靠档位上限句与成员的冲突报告，不新增语言审查。
- 旧 Task 不回填，派发回退读 Plan；新建与 update 路径要求结构化档位。
- 生产库未迁移；测试库均为临时目录/副本。
- 提示词按进程缓存，工作台重启后生效。
- 本仓库工作树中的 `README*.md`、`docs/assets/kaiming-intro*`、`kaiming/.kaiming/kaiming.db` 是用户既有改动/产物，未纳入本次交付。
