# Plan · 验证档结构化与最小充分验证

日期：2026-11-20
状态：已结算
Verification profile: broad（Task schema v20→v21 迁移 + 派发契约 + 工具参数 + 提示词）

## 目标

把「验证档」从 Markdown 正则猜测变成 Task 的结构化事实；在不放宽 `focused` 独立 Test 的前提下，让验收/验证范围严格受档位约束，并区分开发者与只读测试者的负证方式。

## 背景（实测）

- `kaiming/src/runtime/plan-contract.ts:87` 只认反引号，不认 `**bold**`；本仓库 P0-1～P1-1 的 Plan 全部写成 `Verification profile: **focused**` / `**broad**`。`node -e` 复现：四条样本只有两条匹配。后果是 broad Task 的派发信封静默显示 "none declared … treat it as focused"，属低估风险。
- `task(op=create/update)` 没有 `verificationProfile` 参数（`task-tools.ts:177,198` 只有 `requiresTest`），档位只能靠 Plan 文本。
- t-5fbb1a0b69d4：主管把全流程回归写进 `## 验收`，信封原样下发给开发者/测试者；派发又要求只读 Tester 用改源码的变异做负证。33 秒的真实 curl 验收被 20 多分钟的全套 Electron 流程掩盖。

## 范围

- `kaiming/src/store/store.ts`：tasks 增加 `verificationProfile` 列（v21 迁移、读写映射、非 implement 拒绝）。
- `kaiming/src/runtime/plan-contract.ts`：声明行接受 `**bold**` / `__bold__` / `*italic*` / 反引号；结构化参数与声明冲突由工具拒绝。
- `kaiming/src/tools/task-tools.ts`：create/update 增加 `verificationProfile`；implement 必填；校验 `requiresTest === (profile !== 'visual')`；Plan 声明冲突拒绝；输出与摘要带档位。
- `kaiming/src/tools/delegation-tools.ts`：信封优先读库，历史存量（null）回退读 Plan；上限句覆盖 `## 验收` 与 `## 验证`。
- `kaiming/src/server/read-methods.ts`：Task 读取面暴露档位。
- `kaiming/test/{store,plan-contract,task-tools,delegation}.test.ts` 及既有 create 调用：补档位、加负向控制。
- `docs/technicalnew/prompts/{chief,developer,tester,reviewer}.md`：结构化参数、最小真实入口、验收上限、只读 Tester 不改源码做变异、Review 以库值为准。
- `docs/productnew/modules/delivery.md`：D-04/D-05 同步；去掉 pending/队列/按钮等项目耦合措辞。
- `docs/technicalnew/agents-and-tools.md`：G2 task 参数表。
- `docs/technicalnew/validation.md`、本目录 settlement。
- 不做：新增 minimal 档；放宽 focused/broad 的独立 Test；新增 UI 状态；给 MCP 调用方新增结构化档位（仍由主管按 D-04 判断）。

## 验收

- `task(op=create, workKind=implement)` 缺少 `verificationProfile` 返回 INVALID_ARGUMENT；`visual`+`requiresTest=true`、`focused|broad`+`requiresTest=false` 均拒绝；非 implement 声明档位拒绝。
- Plan 正文（含 `**bold**`）声明与结构化参数不一致时 create/update 拒绝，错误同时给出两个值；一致或未声明时通过。
- Task 落库并可从 `task(op=get)` 与任务读模型读到；v20 数据库迁移后旧行档位为 null 且数据不变。
- 派发信封对已落库 Task 使用库值（即使 Plan 文本不同）；旧 Task（null）回退 Plan 声明；两者都没有时提示按 focused。
- 上限句明确覆盖 `## 验收` 与 `## 验证`，要求只执行档位允许的检查并报告冲突。
- 提示词：focused 的最小真实入口为“直接调用变更函数/CLI、一次 API 请求或一条浏览器路径”；Tester 用非法输入/越界请求/错误预期做负证，禁止改产品源码做变异；`## 验收` 不得写入未改动上下游或全量套件。
- 证据：`tsc`、`vitest run` 全量、`check:prompts`；独立 Review 与独立 Test（含一个真正变红的负向控制）。

## 风险与边界

- v21 只加可空列，旧 Task 不回填；写入路径由工具保证新 Task 必填，读取路径保留 Plan 回退。
- 结构化档位与 Plan 文本可能被人工改成不一致；create/update 时拒绝，派发以库为准。
- 提示词按进程缓存，落地后必须重启工作台才生效。
- 不放宽独立 Test：本次只收紧范围，不改变 D-04/D-05 的验证承诺。
