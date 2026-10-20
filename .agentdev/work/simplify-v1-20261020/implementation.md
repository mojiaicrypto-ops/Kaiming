# 阶段 1 实施记录

日期:2026-10-20。提交:`c09410e`。Plan: `plan-stage1.md`。

## 改动

| 区域 | 内容 |
|---|---|
| 模型工具面 | 五个领域工具:`task`(create/update/dispatch/control/end/get/adopt/recover)、`agent_report`、`requirement`、`project`、`question`。`createTaskSessions`/`createTask`/`updateTask`/`endTask`/`reconcile` 删除;专业 Session 只看到 `task(op=get)` |
| 去令牌 | update/end/control/adopt/recover、requirement.save、project.initialize 均无 revision/摘要/版本参数;plan 改动以「记录版本 vs 磁盘 vs 新内容」三者比较,不要求模型回显 |
| 读取记忆 | requirement/project 工具以 `(cwd, sessionId, id)` 记录本会话看到的内容;文件被他人改动时返回当前正文并拒绝覆盖 |
| 报告 | kind 由派发时 expectedKind 决定;body 必填;删除 reportRef/candidateId/supersedesResultId。结算正文固定路径 `.dev/work/<taskId>/<sessionId>/settlement.md`,内容不同则拒绝 |
| 交付绑定 | 新增 `src/runtime/deliverable.ts`:项目文件内容摘要,排除 `.git`/`node_modules`/`.dev`/已初始化知识入口;随报告保存路径清单;完成时按清单重算;Test 复用最近通过复核的清单 |
| 存储 | schema v9:删除 tasks.candidate、results.candidateId/supersedesResultId、task_sessions.candidateId;新增 results.deliveryState、task_sessions.writeScope。迁移按列存在性执行(`applyV9`) |
| 操作 | `adopt`(转移 Task 所有权)与 `recover`(由成员的中断输入与证据关闭)在 store/tool 实现 |
| 读 API | taskSummary 去 candidate;resultSummary 去 candidateId/supersededBy,改示 delivery 摘要 |

## 验证

| 检查 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过 |
| `npx vitest run` | 25 文件 / 269 项通过(含真实 Pi SDK + stub 模型的工具循环) |
| `node checks/prompt-language.ts` | 15/15 |
| 交付摘要实跑(本仓库) | 311 文件,103 ms,重算一致 |
| 迁移 | v1→v9 模拟库与全新库均通过;V9 列检查幂等 |
| `npx playwright test` | 8/8 通过(真实浏览器 + 真实 Server) |
| `npm run check:workflow`(真实模型) | 4 次实跑:4/4 完成完整流程;最终 8/8 检查通过(开发→审核→测试→结算→结束,约 4–6 分钟) |
| v8→v9 迁移 | 用仓库自带的 v8 状态库副本实跑:打开、迁移、列形状与幂等重开均正确;`store.test.ts` 有等价回归用例 |

## 与文档的对应

- G2 工具表、G3 交付绑定、agent_report 路径规则、R6 错误目录(REPORT_STALE)已按实现更新。
- 结算正文路径规则同时写入 `prompts/settler.md`。

## 独立复核

另一上下文只读复核(不读开发对话)结论:changes requested → 修复后复核通过。

| 轮次 | 结论 | 处置 |
|---|---|---|
| 第一轮 | 1 blocking + 4 major + 9 minor | 全部修复:补 v8→v9 分支(实跑仓库 v8 库副本复现并验证)、endTask 完成核对移入提交事务、恢复通知改 `task(op=recover)`、Test 派发前核对已通过的独立复核、强制 writeScope 并给出重叠告警、其余文档/注释/参数问题 |
| 第二轮 | 14 项全部 fixed,无新增 blocking/major;2 项 minor 残留 | 已修复:续办 tester 也过复核前置门;根级 glob 视为与一切范围重叠。两项均有新测试 |
| 验证 | 修复后 `tsc` 干净、269 项测试、8 项浏览器 E2E、prompt 检查 15/15 | — |

## 阶段 4:可发现性

| # | 改动 | 位置 |
|---|---|---|
| 4.1 | create/update/dispatch/get/end/adopt/control 的返回带 `nextActions`(动作 + op + 原因)与 `gaps`(程序观察到的事实);`end` 只在缺项为空时列入动作 | `src/tools/guidance.ts`,`task-tools.ts`,`delegation-tools.ts` |
| 4.2 | 派发/阶段切换被拒时附 `phase`/`status`/`allowedRoles`/`members`(含 state 与结果 id);无 Task 时提示先 `create` | 同上 |
| 4.3 | 结构化字段继续进入 content(`ok`/`fail`/`enrich`) | `src/tools/tool-kit.ts` |
| — | dispatch 省略 label/expectedKind 时按 roleId 派生,减少必填项(与 G2 一致) | `delegation-tools.ts` |
| — | Task 卡显示成员 writeScope | `read-methods.ts`,`web/views/runs.js` |

## 真实流程实测

`npm run check:workflow`(真实 deepseek-flash + 真实 Pi SDK,无浏览器;提问按「同意」自动答复):

| 运行 | 结果 | 记录 |
|---|---|---|
| 3 次完整流程 | 每次都完成 `create → develop → review → test → settle → end`;交付物真实存在,`node --test` 通过 | 任务状态 completed,报告 implementation/review/test/settlement 齐全 |
| 最终指标 | 38 次协议工具调用,7 次错误(18.4%);步骤/前置拒绝 0,读前写保护 1 | 错误全部为参数形状(缺 summary、authorizationRef 形状、空 files、结算正文与已提交文件不同),模型当轮纠正 |
| 交付绑定 | review/test 都记录程序观察的交付(2–3 个文件) | `delivery=review:2 files, test:2 files` |

错误率说明:计划目标是流程类错误 < 5%。实测 18.4% 全部是模型参数失误,不是状态机摩擦(step refusals=0);协议侧已把可选字段改为宿主派生、报错附可行动事实。

## 未覆盖 / 后续

- 结算提交顺序依赖 settler 先写固定路径正文并提交;程序只校验磁盘内容一致,不校验 Git 提交是否包含该文件(需要宿主读取 Git,留待结算阶段)。
- 真实流程在 CLI 里由脚本代答提问;浏览器端的真人交互链路已有独立的 8 项 E2E,但未与完整 Task 流程串跑。
- 不校验 Git 提交确实包含结算正文(需要宿主读 Git)。
- 不支持并行多个 Task 的独立 worktree(v1 明确不做)。
