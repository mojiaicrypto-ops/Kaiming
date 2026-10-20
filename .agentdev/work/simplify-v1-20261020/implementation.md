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
| `npx vitest run` | 25 文件 / 280 项通过(含真实 Pi SDK + stub 模型的工具循环) |
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
| 验证 | 修复后 `tsc` 干净、280 项测试、8 项浏览器 E2E、prompt 检查 15/15 | — |

## 阶段 4:可发现性

| # | 改动 | 位置 |
|---|---|---|
| 4.1 | create/update/dispatch/get/end/adopt/control 的返回带 `nextActions`(动作 + op + 原因)与 `gaps`(程序观察到的事实);`end` 只在缺项为空时列入动作 | `src/tools/guidance.ts`,`task-tools.ts`,`delegation-tools.ts` |
| 4.2 | 派发/阶段切换被拒时附 `phase`/`status`/`allowedRoles`/`members`(含 state 与结果 id);无 Task 时提示先 `create` | 同上 |
| 4.3 | 结构化字段继续进入 content(`ok`/`fail`/`enrich`) | `src/tools/tool-kit.ts` |
| — | dispatch 省略 label/expectedKind 时按 roleId 派生,减少必填项(与 G2 一致) | `delegation-tools.ts` |
| — | Task 卡显示成员 writeScope | `read-methods.ts`,`web/views/runs.js` |

## 阶段 4 复核

另一上下文只读复核(与阶段 1 不同任务):changes requested(1 blocking + 4 major + 3 minor)→ 全部修复后确认 pass,无新增阻断。

| 发现 | 处置 |
|---|---|
| 派生 expectedKind 后 Test 前置门仍按原始字段判断(blocking) | 门改用派生 kind;新增「不写 expectedKind 的 tester」回归用例 |
| guidance 自行估算完成条件,可能与 store 不一致 | 抽出 `Store.completionBlockers`,end 与 guidance 共用同一算法 |
| read Task 建议 designer、test 阶段无复核仍建议 tester | `dispatchAdvice` 按 Task 类型/已通过复核给建议;新增两个用例 |
| 专业 Session 收到首席专属动作 | `guidanceFor(..., {chief:false})` 返回空动作,只给 gaps |
| ROLE_PHASE 两份表 | 合并为 guidance 导出的单一表 |
| 中断成员先建议 wait(等不出结果) | 全部中断时只给 recover;`recover` 进入 NextAction.op |
| 检查脚本「恰好一个 Task」未断言 / 多 Task 误判 | 断言恰一个 write Task;前置的只读 Task 属正常产品行为 |
| 授权引用报错不说明收到了什么 | 报错附收到的键名(不含值) |

## 真实流程实测

`npm run check:workflow`(真实 deepseek-flash + 真实 Pi SDK,无浏览器;提问按「同意」自动答复):

| 运行 | 结果 | 记录 |
|---|---|---|
| 7 次完整流程 | 每次都完成 `create → develop → review → test → settle → end`;交付物真实存在,`node --test` 通过 | 任务状态 completed,报告 implementation/review/test/settlement 齐全 |
| 最终指标(最后一次) | 26 次协议调用,4 次错误(15.4%);步骤/前置拒绝 0,读前写保护 0,完成拒绝 0 | 4 次均为 `task` 参数形状(建 Task 前先 get、authorizationRef 形状 ×2、漏 op);模型当轮纠正 |
| 交付绑定 | review/test 记录程序观察的交付(2–3 个文件) | `delivery=review:2 files, test:2 files` |
| 波动 | 有一轮创建了 2 个 Task(含一个前置只读/分析 Task),另一轮在事实未齐时先调 end 被 COMPLETION_INCOMPLETE 挡回 | 都不是协议死结;检查脚本已按「恰一个 write Task + 完成拒绝计入指标」修正 |

错误率说明:计划目标是流程类错误 < 5%。实测 15–18% 全部是模型参数失误,不是状态机摩擦(step refusals=0);协议侧已把可选字段改为宿主派生、报错附可行动事实。

## 未覆盖 / 后续

- 结算提交顺序依赖 settler 先写固定路径正文并提交;程序只校验磁盘内容一致,不校验 Git 提交是否包含该文件(需要宿主读取 Git,留待结算阶段)。
- 真实流程在 CLI 里由脚本代答提问;浏览器端的真人交互链路已有独立的 8 项 E2E,但未与完整 Task 流程串跑。
- 不校验 Git 提交确实包含结算正文(需要宿主读 Git)。
- 不支持并行多个 Task 的独立 worktree(v1 明确不做)。

## 缺陷修复:等待用户提问被当作停滞(实跑发现)

用户在 16:29 输入「查看一下文件下的所有文档…」后,主管在 16:40:48 通过 `question` 提问(select),用户未及时回答;16:55:52 run watchdog 以 `RUN_STALLED`(900s 无活动)中止该 run,交互标记 stale。用户 17:00 再发消息进入队列,但被「本 Session 有 interrupted 输入 → RECOVERY_REQUIRED」挡住(界面表现为卡住),4 分钟后用户手动停止。

| 缺陷 | 原因 | 修复 |
|---|---|---|
| 等待用户回答被算作停滞 | watchdog 只看 Pi 事件;`question` 等人在 `ctx.ui` 里等待,不产生事件 | `InteractionBridge.isWaiting(sessionId)`;watchdog 新增 `waiting`,等待用户期间不计入停滞窗口与总时长窗口 |
| 主管自身 interrupted 输入冻结整个会话 | 认领门禁要求先恢复,而主管无法解析自己的输入;宿主只在启动时关闭 | `server/host-recovery.ts`:`closeInterruptedChiefInput` 记录 `host:*` 证据、关闭为 stopped、注入「结果未知,先核实」系统提示;启动与 run 结束(interrupted)都调用 |
| 回归证据 | — | `run-watchdog.test` 等待暂停两窗口;`runtime.test` 提问后超过停滞窗口再回答仍 completed(去修复会失败);`workbench-entry.test` 真实 startWorkbench + 挂起 provider:run 被中止 → 输入 stopped、通知存在、下一条消息正常运行(去修复会停在 interrupted) |

验证:`tsc` 干净;26 文件 / 286 项测试;浏览器 8/8;提示词 15/15。运行中的服务需重启以加载修复。

## 工具集:主管可直接执行命令

实测确认各角色工具集(旧代号 `createTask/updateTask/...` 已在下线),与 G1 一致:developer/tester/settler 有 bash,designer 只有读+写,reviewer/investigator 只读。缺口是主管:只能 read/grep/find/ls,无法自己看 git 状态、跑测试入口或核实文件布局,只能采信别人给的摘要。

| 变更 | 内容 |
|---|---|
| `tool-sets.ts` | chief 原生工具增加 `bash`;实现类写入仍交专业 Session,read Task 仍移除 bash |
| 契约 | G1 主管行与上下文表同步;主管可用 bash 核实状态,不承担实现写入 |
| 提示词 | chief.md 明确:读数不够时用 bash 查真实状态(git、测试入口、文件布局),不靠假设;实现仍委派 |
| 证据 | `tool-sets.test` 断言主管在 write Task 与无 Task 时都有 bash、仍无 write/edit;`runtime.test` 用真实 Pi + stub 模型让主管执行 `echo chief-shell-ok`,断言 toolResult 出现真实输出 |

验证:`tsc` 干净;26 文件 / 288 项测试;浏览器 8/8;提示词 15/15;服务已重启(pid 43767)加载新工具集。
