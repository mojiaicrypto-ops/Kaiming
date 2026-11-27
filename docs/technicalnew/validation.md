# 当前设计与实现验证记录

本页记录开明（Kaiming）各模块的验证基线、关键实现证据与边界，不定义协议。整理日期：2026-11-18。下一轮开发计划与未关闭风险见 [缺口登记](gap-register.md)。

---
本页记录开明（Kaiming）各模块的验证基线、关键实现证据与边界，不定义协议。整理日期：2026-11-27。下一轮开发计划与未关闭风险见 [缺口登记](gap-register.md)。
## 一、当前验证基线总览（截至 2026-11-27）

| 验证层 | 入口命令 | 当前通过规模与覆盖核心 |
|---|---|---|
| **服务端单元/集成** | `npm --prefix kaiming test` | **75 文件 / 785 用例通过**（SQLite WAL 接纳/认领/迁移至 v23、Pi 1.0 SDK 桥接、五领域工具、待办双向解析、交付快照与 Git 提交门禁、P3-2a 分配与 v23 迁移、真实 Git Worktree 创建/ff-only/branch_kept/Monorepo/根拒绝/task end 落地/provisioning 清理、步骤停稳唤醒、空闲按需扫描、报告重试结构账本、`codemode` 沙箱权限、P3-1 OS 沙箱与角色边界、模型失败分类与快照错误恢复等，含负向控制与变异自检） |
| **前端单元** | `npm --prefix kaiming/webapp test` | **21 文件 / 146 用例通过**（`slot.ts` 流式合并与重连去重、任务流程推导 `task-flow`、看板分组、模糊模型匹配、链接归属解析、提醒差分、输入失败横幅与终态等待、根错误边界等） |
| **类型与构建** | `npm --prefix kaiming run typecheck`、`npm --prefix kaiming/webapp run typecheck`、`npm --prefix kaiming run build` | 服务端与 webapp `tsc --noEmit` 零错误，Vite 生产构建产出 `web-static/` |
| **提示词契约** | `npm --prefix kaiming run check:prompts` | **15/15 通过**（9 份角色提示词与 `AGENTS.md` 按 G4 边界切片、无中日韩字符、装配顺序正确、39 个内部链接与锚点全部可解析） |
| **浏览器 E2E** | `npm --prefix kaiming run test:browser` | **Playwright 真实 Chromium + 真 Server 套件通过**（三屏导航、流式对话、提问答复、双击防重、断线恢复、项目看板、文件/报告画布、模型分层与思考等级、模型额度失败横幅与刷新保留、用量统计、会话归档、320/390px 窄屏无溢出等） |
| **真实模型探针** | `npm --prefix kaiming run check:{model,runtime,tools,backlog,workflow}` | `check:model` 4/4、`check:runtime` 4/4、`check:tools` 4/4、`check:backlog` 4/4、`check:workflow` 8/8（真实主管完成 `create → develop → review → test → settlement → end` 闭环） |

---

## 二、基础架构与早期工作包基线（2026-10-04 ～ 2026-10-22）

| 阶段与工作包 | 核心验证结论 | 归档记录 |
|---|---|---|
| **文档与提示词归一化** | 产品/技术契约统一 `read/write` Task、当前步骤成员聚合、Pi 原生历史续办与七角色英文提示词；独立上下文审阅通过 | `.kaiming/work/pi-native-normalization-20261004/`、`role-lessons-20261004/`、`testing-responsibilities-20261004/` |
| **P0 SDK 机制与真实模型** | PI-01/02/05/07/08 共 47/47 断言通过；证实 UI 适配器必须绑定且为普通对象（不能是类实例）；真实模型（deepseek-flash）问答往返 4/4 通过 | `.kaiming/work/kaiming-bootstrap-p0-20261004/`、`kaiming-real-model-20261005/` |
| **P1～P4 存储、RPC 与 React 单壳** | SQLite 去重认领与代次分类；同源 RPC + Cookie/CSRF + SSE 快照与增量缓冲；2026-10-21 合并为单一 React 19 外壳（`/`），按 `docs/design/tui/` 重写 | `.kaiming/work/kaiming-p1-store-dispatcher-20261005/`、`kaiming-p4-webui-20261008/`、`workbench-gaps-20261022/` |
| **v1 协议简化与 P7 模型配置** | 模型工具从 10 个收敛为 5 个，去模型版本令牌，复核绑定改为程序观察交付摘要；provider 私有存储（`0600`）、私有路径与项目边界守卫生效 | `.kaiming/work/simplify-v1-20261020/`、`kaiming-p7-model-config-20261010/` |

---

## 三、分阶段演进与实战排雷证据（2026-10-23 ～ 2026-11-14）

### 2026-10-23 Provider 命名/协议与会话命名

- **协议显式必选**：`config.save` 强制要求声明 `openai-completions` / `openai-responses` / `anthropic-messages`，不靠 Pi 推断（修复自定义 id 拒载与 `openai` 静默变 `openai-responses` 导致 400 的问题）。
- **显示名与编辑弹框**：schema v9→v10 新增 `providers.name` 与 `sessions.title`；支持修改 Provider（弹窗带焦点陷阱）与主管会话自定义改名（`session.rename`，空值回退首条发言派生）。
- **模型分层与目录选择器（2026-10-24 ～ 2026-10-26）**：
  - `model_overrides` 支持 `项目内角色 → 全局角色 → 项目默认 → Server 默认` 四层解析与 `config.clear` 恢复继承（schema v11）。
  - 支持思考等级 `thinkingLevel`（schema v12）与网关别名映射目录模型（`config.catalog` 模糊匹配，schema v13）。
  - **关键教训（I6）**：写给 `models.json` 的目录模型只复制能力事实（`reasoning`/`thinkingLevelMap`/`contextWindow`/`maxTokens`/`input`），**绝不复制 vendor 的 `api` 字段**，防止覆盖网关自身的传输协议；所有写给 Pi 的配置均由 `ModelRuntime` 读回断言。

### 2026-10-24 任务在对话里的渲染

- **顶部与转录分工**：顶部 `TaskStrip` 只保留流程链、耗时与暂停/继续，完成或取消后隐藏；实时成员状态唯一归口到转录末尾的任务清单 `TaskTodo`（按阶段-轮次分组，支持返工轮次 `×2` 与计划内未开始尾段展示），历史 `dispatch` 卡片折叠为单行。

### 2026-10-25 会话转录 TUI 化与工作流全量展示

- **终端流与尾部跟随**：全站等宽字体栈，用户行 `❯` 内联引导，发送即显示 `pendingEcho` 回显，会话非空闲全程显示 `chief-working` 指示；自动跟随改为按用户意图钉住 + `useLayoutEffect` 绘制前定位（消除高速流式输出脱离底部）。
- **统一文件与报告查看画布（U11）**：`files/FileViewer`（目录树 + `SourceView` 源码高亮行号 + `MarkdownView` 渲染/源码切换）+ 只读字节路由 `GET /api/v1/project-files/<projectId>/<path>`（拒绝路径穿越与指向项目外的符号链接）；文档与聊天中的项目内宿主绝对路径点击时自动转为画布内打开。
- **用量统计、上下文占用与主动压缩（2026-10-26 ～ 2026-10-28）**：
  - `usage_entries` 追加式账本（schema v14），每次 assistant `message_end` 刷新累计值，设置页三层结构展示项目/全局、按角色/按模型统计。
  - 状态栏实时显示 `已用 / 窗口 · 百分比`；支持全局主动压缩阈值（默认 70%，schema v16）与空闲时手动压缩（`session.compact`）。
- **外部 Agent 接入（MCP，2026-10-28）**：`src/mcp/` 同时支持 stdio 与 `/mcp` HTTP，每个项目固定一条 `channel='mcp'` 主管会话（schema v15）；进度推导 `task-progress.ts` 与前端 `task-flow.ts` 共用 `test-fixtures/task-progress.json`；Codex 与 Claude Code 实测走通 `delegate → status → read`。

### 2026-10-31 ～ 2026-11-05 主管会话连续性与交付门禁加固

- **主管连续性与步骤停稳唤醒（C6～C15）**：
  - 修复已结束 Task 清扫误杀主管排队用户消息（`7b8d9bc`）；暂停期允许主管运行只读/控制回合（`paused-chief-input-20261028`）。
  - 新增 `src/server/step-wake.ts`：当主管回合已结束而当前步骤成员随后停稳（或重启扫描发现已停稳）时，宿主按步骤成员输入集合去重投递一次 `system_notice` 唤醒主管；含 `interrupted` 成员时投递带 `task(op=recover)` 指引的恢复通知。
  - `settleStep` 等待期间标记 `hostWaits`，不计入主管自身的 stall/total 看门狗窗口（`b27093d`）；宿主为未传 `timeout` 的 `bash` 注入默认 600s 超时（`c382c3a`）。
- **反证门禁与验证档（2026-11-03 ～ 2026-11-04）**：D-04/D-05 确立 `visual` / `focused` / `broad` 验证档，标准代码独立 Test 必须包含真实失败的负向控制（negative control）或检查器坏样本自检，期望值必须源自验收或不变量（AC-46/47/49）。
- **更名与安全边界（2026-11-05 ～ 2026-11-06）**：项目统一更名为“开明（`kaiming`）”并完成存量数据库与 JSONL 书签无损迁移；上线宿主目录选择器 `fs.browse`、文件工具项目根目录边界守卫（`createFileBoundaryGuard`）、删除命令引号感知门禁与会话内“完全信任”选项（`deletion-gate.ts`，2026-11-11 收窄为仅真正删除命令触发）。

### 2026-11-06 · 评审 REPORT_MISSING 根因（suangua 现场）

- **现场统计**：suangua 项目 133 条 reviewer 输入中出现 22 条 `REPORT_MISSING`（16.5%）。其中 **21/22 属于指令形态问题**（主管派发指令只描述“输出 N 行结论”，未提 `agent_report`，模型打完正文即停）；**1/22 属于模型退化**（thinking 与 text 逐字重复后停止）。
- **已落地面**：`runner.ts` 在成员输入结束无对应 `expectedKind` 结果时记 `failed/REPORT_MISSING`（`c199154`），`guidance.ts` 指引原 Session 补交；`prompts/chief.md` 增加派发必写 `agent_report` 规则（`09f8f0a`）。程序层派发信封与同回合自动补交已列入下一轮 **P0-1**。

### 2026-11-06 ～ 2026-11-12 前端性能、待办重构与交互兜底

- **标签页隔离与流式渲染提速（2026-11-06）**：项目/会话选择迁入 `sessionStorage` 实现多标签页独立；`MessageItem` memo + `SessionStream` `rAF` 合帧将 300 行历史下的流式脚本耗时从 797ms 压降至 **178ms**。
- **待办 + 规格 + 设计流水线重构（2026-11-09，WP-1～WP-8）**：
  - 移除旧 9 状态需求模块，全面落地 `.dev/backlog.md`（双向解析、问题与警告分类、锁内写入）、Plan 验收必填与范围越界提示（`scopeDrift`）、`workKind` 四种完成链（`design`/`implement`/`document`/`investigate`，schema v17～v18）及 `/project` 看板。
  - 真实模型验证 `npm run check:workflow`（8/8）与 `npm run check:backlog`（4/4）全部通过。
- **会话归档、完成提醒与原始 question 兜底（2026-11-10 ～ 2026-11-12）**：
  - 主管会话支持归档与恢复（schema v19 `archivedAt`）；对话完成与新问题到达支持页内 toast 及浏览器系统通知（`reminders.ts`）。
  - `src/runtime/raw-question.ts`：当模型违规把 `<question …>` 打在纯文本末尾且同消息无工具调用时，宿主在 `message_end` 自动拦截转为持久交互并把答复送回同一 run。
- *历史注记（2026-11-10 ～ 2026-11-11）*：期间完成的 Agent 交付方法论公众号文稿、手绘插图及历史草稿清理属于内容发布工作（最终保留于 `articles/publish/agent-delivery-system-wechat-v2/`，历史过程可通过 `git show a7361c6` 查阅），不计入软件功能验收。

### 2026-11-13 ～ 2026-11-14 交付快照稳定化、空闲 CPU 治理与 codemode

- **Review/Test 交付按 `.gitignore` 稳定观察（2026-11-13）**：`ignoredProjectPaths` 改为对已观察路径分批执行 `git check-ignore -z --stdin`；未跟踪的 ignored 产物及 `.gitignore` 策略文件本身不进入代码 Review 绑定路径，结算清理构建物不再导致 `end` 误报交付变化；Git 存在但不可读时失败关闭。

### 2026-11-14 · 空闲调度成本治理（worker 按需探测 / 可用性快照 / 语句缓存）

- **根因与修复**：CDP CPU Profile 定位空载 1.56 核（148% CPU / 940MB RSS）源于 worker 每 250ms 扫描全部 346 个会话且每次 `isAvailable` 重刷 42 个 provider 凭据。修复为：① `Store.listRunnableSessionIds()` 只返回 `queued/processing/interrupted` 会话供 worker 探测；② `PiRuntimeFactory.isAvailable` 读内存快照，仅在配置文件 `(mtimeMs,size)` 变化时 `refresh`；③ Store 查询全面启用 `stmt()` 预编译缓存。
- **A/B 实测证据**：同数据副本 42s 空载窗口 CPU 从 **62s（148%）降至 0s**，RSS 从 ~940MB 降至 ~50MB；新增 `worker-idle-scan`、`availability-cache`、`store-statement-reuse` 单元与负向控制通过。

### 2026-11-14 · 报告重试预算（结构账本替代内容签名防线）

- **根因与决策**：11-12 的流式正则签名防线在 11-13 事故（settler `agent_report` 48 连败、developer 68 分钟退化）中拦截 0 次且消耗 CPU。删除全部内容签名正则，改为**纯结构记账（`src/runtime/model-output-guard.ts`）**：流式参数超 1MB 硬上限立即中止；单次输入内 `agent_report` 连续 5 次错误结果（schema/截断/16KB 超限/工具报错）触发 1 次隐藏纠正 turn 并清零连击，再 5 败以 `failed/REPORT_RETRY_EXHAUSTED` 终止（仅 `agent_report` 自身成功可清零连击）。`guidance.ts` 对该终态指引派发新会话，避免复发历史投毒。
- **证据**：单元 18 例（含变异自检与 200 种子对抗发生器）+ 集成 2 例 + 历史转录回放 **1003 个真实 input**（精准命中事故会话、健康流量零误杀）。
- **codemode 批量工具接入（2026-11-14）**：`PiRuntimeFactory.create` 预装 `createCodemodeExtension({ models: false })` 并仅对 `developer`/`tester` 开放 allowlist，嵌套调用共享同一权限、删除门禁与文件边界（`test/codemode-runtime.test.ts` 正负向控制通过）。

### 2026-11-18 · P0-1 派发信封与同回合补交（升级 R6）

- **根因**：派发只把主管自由文本 `instructions` 交给成员，成员要先花 2～3 个回合 `task(op=get)`/读 Plan 才开工；成员以纯文本结束（漏调 `agent_report`）即被判 `failed/REPORT_MISSING`，逼主管跨会话再派一轮（suangua 现场占 Reviewer 的 16.5%）。
- **实现**：`delegation-tools.ts` 新增纯函数 `buildDispatchEnvelope`，宿主把 Task 身份/目标、新建成员的计划路径与验收摘要（≤1500 字符）、范围核对、writeScope/引用、Review/Test/Settle 的最新上游报告与 `agent_report` 硬性收尾（review/test 需 verdict）写进 **Pi payload**；`task_sessions.instructions` 保持主管原话。`store.continueTaskSession` 接受可选 `inputPayload`，续办同样携带信封。`runner.ts` 新增 `recoverMissingReport`：成员正常停稳但无结果时先发一次隐藏补交提醒（`display=false`），补交成功即 `completed`，仍无报告才 `REPORT_MISSING`；隐藏 turn 类型统一收敛到 `model-output-guard.ts` 的 `isHiddenInternalTurnEvent`，浏览器流与历史重载都看不到。
- **证据**：`test/delegation.test.ts` 断言 instructions 列为原文而 payload 含信封、Review 阶段带上游 implementation 路径；`test/runtime.test.ts` 正向自愈（prose → 提醒 → `agent_report` → `completed`，1 条结果、提醒 `display:false`）与负向控制（两次纯文本 → `failed/REPORT_MISSING`、历史中提醒恰好 1 次、含 verdict 指引）；独立 Test 以删掉唯一调用点的变异验证正向用例真的变红并逐字节还原。定向 3 文件 99 用例、关联 5 文件 133 用例、`tsc --noEmit` 通过。独立 Review 结论 pass，唯一 minor（纯等待路径也计算信封）已修复。
- **边界**：补交每输入最多一次，不重放工作；服务端丢弃隐藏 turn 只有谓词单测 + 一行接线，没有端到端断言（登记为覆盖缺口）；`recoverMissingReport` 的六个短路条件各自没有独立用例（改动它们只会多/少一次无害提醒）。

### 2026-11-18 · P0-3 委派等待窗口与唤醒闭环（关闭 C8）

- **根因**：`dispatch` 缺省只等 120 秒，而 C10 已把 `settleStep` 排除在主管看门狗之外——2 分钟超时只是让主管在长开发/测试中反复跑空名单回合。另外三条转换会让当前步骤停稳却不产生 run outcome：`task.control(resume)`、`session.input.stop` 停掉 queued 成员、`session.recovery.resolve` 关闭 interrupted 成员；它们都不触发宿主唤醒，主管要等用户开口才继续。
- **实现**：`delegation-tools.ts` 缺省等待改为 600 秒、上限 1_800 秒（下限 1 秒不变）。`write-methods.ts` 新增 `wakeSettledStep`：沿用 `wakeForSettledStep` 的全部去重/忙/Task 状态规则，成功时使主管会话失效并在 queued 停止路径立即 `notify()`；wake 抛错不会让已完成的转换变成 RPC 失败。主管回合内自己调用 control/recover 不另行唤醒（它正在 processing，结果必为 `chief-busy`）。
- **证据**：`test/server-write.test.ts` 三条正向路径各断言恰好一条 `notice-step-*`、其 `taskId` 属于本 Task、主管会话被 invalidate；负向控制两条——同步骤仍有 queued 成员时零通知、Task 暂停时零通知。`test/delegation.test.ts` 断言缺省 600_000 与上限夹取 1_800_000。独立 Test 逐条删除三个唤醒调用点，对应用例均按预期变红并逐字节还原；把 `UNSETTLED` 改成只认 `processing` 时负向控制变红。定向 4 文件 59 用例、`tsc --noEmit` 通过。独立 Review 结论 pass，四条 P3（停止路径漏 `notify`、invalidate 未测、暂停负向缺失、R3 路由措辞）均已修复。
- **边界**：wake 抛错分支只靠代码检视；pause/cancel 与 `input.taskId === null` 短路没有 RPC 级用例；主管在回合内用 `task(op=recover)` 关闭中断成员后若直接结束回合，仍属既有空档（唤醒发生时主管已在 processing），不改动。

### 2026-11-18 · P0-2 结算单写对齐（磁盘正文权威）

- **根因**：`agent_report` 强制 `body` 必填，且结算文件内容与参数不一致即 `VERSION_CONFLICT`，逼 Settler 把数千字 Markdown 逐字塞回 JSON 参数——11-13 事故（48 连败）的直接诱因。
- **决策与实现**（与用户确认）：写 Task 的 `<taskId>/<sessionId>/settlement.md` 已存在且非空时，它就是唯一正文——`body` 可省略、传了也不生效、磁盘字节不被改写，结果带 `bodySource: 'disk'`；文件缺失或为空时仍要求非空 `body` 并写入（`bodySource: 'param'`）。`resultId`、`bodyRef`、写盘与回读统一使用 `effectiveBody`，`VERSION_CONFLICT` 分支删除。`runner.ts` 的补交提醒与重试纠正 turn 共用 `reportFields`：结算成员被告知“已提交的 settlement.md 即正文，仅文件缺失时才传 body”。`settler.md` 流程块、`specialists.md` 与 S6 结算序列同步，不再要求正文。
- **证据**：`test/report.test.ts` 磁盘权威（省略 body → 记录、`bodyRef.sha256` 等于文件摘要、文件 inode/字节不变；传入不同 body 仍以磁盘为准）与负向控制（无文件/空文件省略 body → `INVALID_ARGUMENT` 且零结果；非结算种类仍要求 body）；`test/runtime.test.ts` 真实 Pi + stub 端到端——settler 不带 body 调 `agent_report` 通过 schema 校验并落盘（回退 schema 即失败），以及两次纯文本仍记 `REPORT_MISSING` 且提醒恰好一次、指向 settlement.md。独立 Test 的四个变异（参数优先、`body ?? diskBody`、去掉磁盘读取、去掉提醒分支）均按预期变红并逐字节还原；定向 4 文件 107 用例、`check:prompts` 15/15。独立 Review 结论 pass；三条阻断性发现（schema 无负向控制、其余注入提示仍索要正文、纠正 turn 仍称 body 必填）已修复。
- **边界**：结算文件“已写未提交”仍被接受——工具不核对 Git，提交由完成门禁检查（非目标）；磁盘读取与写盘守卫之间存在理论 TOCTOU（既有模式，窗口可忽略）；prompt 正文按进程缓存，`settler.md`/`specialists.md` 改动需重启 workbench 生效。

### 2026-11-18 · P1-1 Task 级脏基线（脏工作区交付隔离）

- **根因**：Task 创建前就脏的文件被当成该 Task 的改动——范围越界清单、Review/Test 交付快照与完成提交门禁全部包含它，`task(op=end)` 因此拒绝收口一个从未碰过该文件的任务，与「无关脏文件保留且不阻塞完成」直接冲突。
- **实现**：写 Task 创建时快照当时 Git 已脏文件的**内容摘要**（`tasks.dirtyBaseline`，schema v20；只含本项目目录内、交付遍历会观察到的普通文件——符号链接、FIFO、`node_modules`/`.git` 与普通 Task 的 `.dev/**` 不进基线；设计 Task 额外记录 `.dev/product/**`、`.dev/technical/**`）。摘要未变的继承文件从范围核对、Review/Test 快照（含设计绑定与 Test 复用的旧路径清单）、完成重算与提交门禁中一致排除；摘要一旦变化即进入本 Task 交付，若变化发生在复核之后，完成核对要求重新复核（限定在复核真正能覆盖的路径：代码文件 / 仅文档交付的文档 / 设计 Task 的设计产物；结算输出、`.dev/**` 与 `project.initialize` 的知识入口永不触发重审）。`changedProjectPaths` 只返回项目相对路径，monorepo 兄弟目录的脏文件不再被散列成假文件。
- **证据**：`test/store.test.ts` v19→v20（真实旧行保留、NULL 不过滤、新值往返）；`test/deliverable.test.ts` 捕获/释放/NULL/目录前缀/三种复核绑定与设计产物捕获；`test/git-commit-gate.test.ts` 端到端——继承文件未提交时 `end` 通过且文件字节保留、Task 改动继承文件后进入越界并拒绝收口、复核后更改要求重审、结算输出与知识入口改写不要求重审、仅文档交付仍绑定文档；`test/report.test.ts` 复核/Test 复用/设计三个快照分支；`test/server-read.test.ts` `task.get` RPC；`test/design-completion.test.ts` 复核与完成重算同一规则。独立 Test 对每个过滤点做删除式变异，全部由 shipped 用例按预期变红并逐字节还原；定向 6 文件 127 用例、全量 **66 文件/661 用例**、`tsc --noEmit` 通过。独立 Review 三轮（needs_fix → 重审 → pass）：首轮发现设计完成重算未过滤、复核后变化逃逸、两个过滤点无变异敏感用例、迁移无旧行、monorepo 兄弟路径；次轮发现重审域过宽（结算输出不可满足）；末轮发现知识入口在仅文档交付下形成永久阻塞，均已修复并复验。
- **边界**：`delegation-tools` 信封范围行与 `task-tools` `updateOp` 的基线传递没有专测（单参数透传，行为已在 create/get 与 `task.get` RPC 钉住）；迁移后旧 Task 无基线即恢复旧行为，不做历史回填；不试图区分「人改」与「Agent 改」，内容变化即视为本 Task 变化；Prompt/行为均随进程重启生效。

### 2026-11-18 · P2-2 主管会话 Fork（原 F1）

- **需求与机制**：在一条主管会话里讨论出多个方向时，把当前对话上下文复制成新会话并行推进，原会话及其 Task 归属不受影响。采用 Pi 的 `SessionManager.open` + `createBranchedSession(leaf)`：只复制当前分支，新 JSONL 头部记录父会话，源文件字节、mtime 与绑定不变；不使用整文件 `forkFrom`，也不做运行期 fork。
- **实现**：`session.fork(projectId, sessionId, title?)`（写方法）：源须为本项目 chief、无 queued/processing/interrupted 输入、已有持久化历史且文件存在（分别 `INVALID_ARGUMENT` / `WORKSPACE_BUSY` / `HISTORY_UNAVAILABLE`）；允许源仍有未结束 Task，新会话 `currentTaskId`/`channel` 为 null、无输入/交互/授权。标题缺省为「源标题 + `(fork)`」（源自定义名或首条用户输入首个非空行，为后缀留位）；显式 `title` 归一化空白后使用、不加后缀；上限 60 个 UTF-16 单元（与 `session.rename` 及 rail 同一口径，不劈代理对），`titleOf` 同步改为同一单位。分叉点取文件当前 leaf（记录中的 branchEntryId 可能落后于压缩）。先复制文件、再在同一事务写 session + binding，行失败删除文件不留孤儿。`s-<12 hex>` 对齐既有会话 ID。前端会话列每行加「⎇」，成功后刷新并选中副本、toast 确认，拒绝时显示服务端原因。
- **证据**：`test/server-write.test.ts` 新增 7 例——真实历史 fork（源文件字节不变、binding 不同、副本经 `session.messages.list` 可读、两侧各发一条互不串扰）、源带未结束 Task 仍可 fork 且副本不继承、空/无历史/忙(processing 与 interrupted)/非 chief/跨项目拒绝且零新行、缺历史文件 `HISTORY_UNAVAILABLE`、标题后缀保留与显式标题（含 astral 不劈开）、行写入失败不留 JSONL。`browser/session-fork.spec.ts` 真实浏览器：一轮对话后点「⎇」→ 出现 `… (fork)` 并选中、副本可读回复；新空会话 fork 显示 `Not forked` toast；`browser/smoke.spec.ts` 10/10 不回归。独立 Test 变异（busy、hasHistory、复用源文件、去掉 unlink、截断副本）全部由 shipped 用例按预期变红；webapp 137 用例、build、服务端 `tsc --noEmit` 通过。独立 Review 两轮（needs_fix → 修复 → pass）。
- **边界**：快速双击「⎇」可产生两个 fork（每次新 requestId，无 in-flight 守卫）；浏览器拒绝 toast 只覆盖空会话原因；头部血缘不在会话列展示（仅 JSONL header）；无分支树 UI；不做历史回填。

### 2026-11-18 · P2-4 项目页密度与阶段显示

- **问题**：项目页卡片把完成链画成四个胶囊并重复展开切片编号，四列在 1080 宽度下每列约 250px；待设计确认的切片没有领取 Task，`flowChain` 只看 `openTasks`，于是显示尚未开始的实施链（Plan 高亮），与“待设计确认”矛盾。流程带用六个描边块，与列头重复计数。
- **实现**：`activeWork` 先取未结束领取 Task，否则取仍在进行、产出该切片的 design Task；阶段链与工作类型都由它推导（待确认切片显示设计链并按真实 phase 高亮）。卡片保留编号、两行标题、阶段链与一行元信息；切片编号只在详情抽屉。直接工作移到流程带之后；内容区加宽到 1320，流程带改为带分隔线的摘要行，阶段链改为三态文本，卡片/列间距放宽（U6 同步）。
- **证据**：`webapp/test/project-model.test.ts` 15/15（待确认设计链、领取优先、结算后忽略产出 Task、待确认切片进就绪）；webapp 140/140；`browser/project.spec.ts` 等 project 相关 16/16；`test/backlog-rpc.test.ts` 8/8。真实 CharKeep 数据下设计完成前后两种状态都观察到：设计进行中 11 条切片在“就绪”并标“待设计确认”、直接工作显示 `t-2dbe518eeb45 · Design · Review · Running`；设计结算后卡片回到实施链 `Plan→…→Settle`，11 条仍在“就绪”，直接工作区随 Task 完成消失。抽屉保留来源与产生它的 Task；被拆分原条目才显示 `split into …`。
- **边界**：分列语义未改（“设计中”仍只统计被领取的条目；从对话发起的整项目设计属于直接工作）；不新增请求、状态或存储。设计 Task 未领取任何条目时（本次 CharKeep），11 条切片不再各自显示“10 slice(s)”——它们不是拆分来源；卡片“切片数”只属于被领取并拆分的原条目。
- **补充（拆分去向）**：`backlog.list/get` 的 `splitInto` 只对“被该设计 Task 领取的原条目”计算；设计产出的切片不再把兄弟切片列为自己的拆分去向，仍通过 `producerTasks` 指回设计 Task。`test/backlog-rpc.test.ts` 覆盖原条目列出 B-7/B-8、切片自身为空；改回按全部关联 Task 计算时该用例变红。
- **补充（待确认切片分列）**：分列仍按 BL-04：“就绪”要求规格引用。由未结束设计 Task 产出、尚无引用的切片留在“想法”，但卡片标“待设计确认”并按产出设计 Task 的真实阶段显示设计链（不再显示未开始的实施链）；单元用例锁定“想法 + awaitingDesign + 设计链”，去掉该判定时用例变红。
- **复核收口**：计划中的阶段链改为纯文字三态并去掉 `opacity`（实测深/浅色 5.22:1 / 4.62:1，满足 U7）；撤销“无规格引用也进就绪”，这类切片留在想法但保留“待设计确认”与设计链（用例锁定）；卡片“等你决定”改看 `activeWork`（含未领取的产出设计 Task）。

### 2026-11-18 · P2-5 待办详情正文编辑器

- **问题**：待办抽屉的正文 textarea 复用了 `.inp` 的固定 32px 高度，rows 不生效，正文实际只有一行可见；规格引用同样如此，抽屉固定 560px。
- **实现**：32px 只属于单行输入，`textarea.inp` 高度自适应并多行排版；正文编辑器至少 `max(240px, 34vh)`；待办抽屉宽 `min(760px, 94vw)`（≤560px 全宽）。
- **证据**：真实 CharKeep 项目实测 1440×900 下抽屉 760px、正文 695×306、规格 96px；390×844 下抽屉全宽、正文 357×287、无横向溢出。`webapp` 140/140、project 浏览器 16/16 通过。

### 2026-11-18 · P2-6 设计目录可见性与 backlog edit 语义

- **问题**：设计完成门禁只读 `.dev/product/`/`.dev/technical/`，但这两条路径只写在 designer 正文；主管据此把设计写进 `.dev/specs`/`.dev/tech` 后被门禁拒绝。backlog 工具描述把 add/close/edit 统称为“Writes allocate ids…”，主管误以为 `edit` 会刷新更新时间并绑定设计 Task。
- **实现**：base v6 固定写明知识目录；chief v8 写明设计门禁路径与切片写入通道；backlog/project 工具描述改准确；design+designer 派发信封追加同一条宿主事实。存储行为未改：`edit` 仍是纯文本替换，不新增 op。
- **证据**：design designer 信封含目录门禁与 add/edit 说明，developer 与 reviewer 信封不含（负向对照）；chief 装配文本包含目录与门禁句，且不包含 designer 的 “Default responsibilities”（说明来自 base）。`delegation+context` 32/32、`backlog-tools+task-tools+project` 42/42、`tsc`、`check:prompts` 15/15。提示词需重启 workbench 后生效。

### 2026-11-19 · P0-4 主管只读 inspect 与 Review 后新增文件门禁

- **问题**：主管没有 `write/edit`，但保留 `bash`；主管一条 bash 可写完 25 个文件，然后不建 Task、以纯文本结束回合，宿主判 `completed`，所有 Task 门禁一次都不触发。另一个同级漏洞：Review 之后新增的交付文件不在 `reviewed.paths`，摘要复查与 inherited 复查都看不到，`task(op=end)` 仍可放行。
- **决定**：用户拍板 B+ —— 去掉主管 bash，换成宿主只读 `inspect`；用 `task(op=end)` 的“Review 后新增可评审文件”校验替代跨回合 Git 账本；提示词写明免打扰授权不等于跳过 Task。
- **实现**：`tool-sets` chief = read/grep/find/ls/inspect（其他角色 denied inspect，paused/read 仍保留它）；`inspect` 以 `execFile` 执行固定 argv，只允许 status/log/diff/show/rev-parse，禁 ext-diff/textconv/fsmonitor 与可选锁，模型不能传 flag；结算提交归 settler。`deliverable.newReviewableDeliveryPaths` 在 `store.completionBlockers` 中检查当前交付路径减去 Review 路径（排除 baseline、按 Task 类型过滤、候选才查 gitignore），无 Git 同样生效。chief v9 增加免打扰语义。
- **证据**：`test/inspect-tool.test.ts` 6/6（固定 argv、bad rev/path、真实仓库只读：status/HEAD 前后不变、非仓库报错、仓库配置的 external diff/textconv/fsmonitor helper 不执行）；`inspect-tool + tool-sets + report + runtime + deletion-gate-runtime` focused 107/107；全量 67 文件 683/683；`tsc`；`check:prompts` 15/15。独立 Test 用 7 条变异（加回 chief bash、放开 bad rev、去掉 fsmonitor 抑制、清空新文件检查、去掉 baseline 排除、去掉 ignored 过滤、把 docs 当代码交付）逐一确认对应用例按预期变红。Review 后新增代码文件、设计产物、无 Git 项目均被报告，settlement 文档、ignored 构建产物、未变的 inherited 文件不误报（`report.test.ts` 5 例）。提示词按进程缓存，重启 workbench 后才生效。
- **边界**：不引入跨回合写入账本；未回填已有脏工作区的历史；`inspect` 不是沙箱。2026-11-21 的 A 条目已恢复主管观察 shell（带 HEAD/工作区审计），P0-4 的“主管没有 shell/写能力”不再是当前契约；本条的 Review 后新增文件门禁仍然有效。

### 2026-11-19 · P0-5 交付收敛：结算遗留、验证档上限与信封注入

- **问题**：结算条款要求把 leftover 写成 `backlog(op=add)`，与“用户明确要求才记待办”冲突；aisuangua 的 t-ec18b49b852e 据此把测试超时、历史页视觉偏差、刚登记为“不做视觉回归”的页面和一行文档缺漏记成 B-1～B-4。同一 Task 的 Plan 头部写 `focused`，验证配置和派发却要求全量单测与全站视觉，成员照做后扫出无关脏文件；用户说“全部补做”时又把上一轮无关未提交文件并进同一个 Task。
- **决定**：用户 2026-11-19 要求不再切分，按一个 Plan 全部落地。结算遗留语义收窄到“本次范围内未完成、需要继续”；验证档是上限，Plan 的验证配置和派发不得为 visual/focused 加全量；一个 Task 一个目标；交付完成后不提议立刻开新 Task。
- **实现**：`plan-contract` 解析独占一行的 `verification profile`（值后可带说明；围栏按 CommonMark 字符/长度配对，4 空格缩进视为代码）；implement Task 派发 developer/tester 时信封注入档位、该档允许范围和“派发不得加码”；无声明按 focused。chief v10、settler v3、developer v6、tester v5 与 BL-02/BL-13、D-04/D-07、G2/G4/G5、AC-23、S6、README、journeys 同步；`guidance.ts` 的 settle 指引不再要求 `backlog(op=add)` 记 leftover；backlog 工具描述补规格引用格式与 add 范围。无 schema、无新 op、无宿主命令文本审查。
- **证据**：`plan-contract 12/12`、`delegation 27/27`（含声明/无声明注入、reviewer/design/document 负向对照）、`guidance 1/1`；全量 68 文件 690/690；`tsc`；`check:prompts` 15/15。独立 Review 首轮 NEEDS_FIX（settle 指引与四处文档仍要求把 leftover 记为待办），修正后复核；独立 Test 首轮 passed 并给出围栏配对/缩进代码的 false positive，修正后重测。提示词按进程缓存，重启后生效。
- **边界**：不阻止主管在派发文字里写全量命令（宿主不做自然语言审查）；不做 backlog 存储层的特判；`add` 仍支持设计切片与用户明确要求。

### 2026-11-19 · 会话列行内动作收纳

- **问题**：240px 会话列每行常驻最多 4 个动作（改名/分支/归档/清理），约 110px 被按钮占走，标题与日期在剩余宽度里截断；用户截图指出“按钮占据位置太长”。
- **实现**：动作包进 `.sx-group`，静止 `max-width: 0; overflow: hidden`，行悬停、键盘 `:has(:focus-visible)` 或清理确认态展开到行宽（`max-width: 100%`），`hover: none` 触屏常驻；按钮的键盘焦点改为内嵌 accent 环，避免被组裁剪。行为、testid、事件与当前会话排除不变；浏览器用例在点击动作前先悬停所在行。
- **证据**：真实 Chromium 四个受影响的用例通过（改名、清理含忙会话拒绝、归档/恢复、分支）；静止组宽 0、悬停 111.31px 无裁剪；确认态 161.89px（内容 162px，亚像素差），按钮右边 = 行右边 227 < 列右边 240；`hover: none` 下计算值 `max-width: none`；`webapp` typecheck/build 通过。独立 Review 首轮 NEEDS_FIX（确认文字被 148px 上限裁剪、焦点环被 `overflow: hidden` 裁掉），修正后复核。
- **边界**：未加菜单/弹层状态；悬停展开期间标题临时截断是取舍；触屏移动端形态仍按缺口登记 M1–M5 重做。

### 2026-11-20 · 验证档结构化与最小充分验证

- **问题**：`focused` 必须独立 Test 的规则与 `chief.md:51` 只给“API E2E / 浏览器 E2E”两个入口，使小改动被派成整套端到端；同时 `verification profile` 只靠 Markdown 正则识别，`Verification profile: **broad**` 不匹配（本仓库 P0-1～P1-1 的 Plan 都这么写），broad 被信封静默降为 focused。`task(op=create)` 只有 `requiresTest`，档位不是程序事实。
- **决定**：用户 2026-11-20 拍板方案 C：保留 visual/focused/broad 三档与 focused/broad 的独立 Test，只锁死“能观测被改契约的最小真实入口”；档位升级为 Task 结构化字段；开发者的变异只用于自己的 TDD，只读 Tester 用非法输入/越界请求/错误预期做负证。
- **实现**：Store schema v21 增加 `tasks.verificationProfile`（SCHEMA_SQL 与迁移同时具备）；`task(op=create/update)` 对 implement 必填档位，校验 `visual↔requiresTest=false`、`focused/broad↔true`，Plan 声明（允许 bold/italic/反引号）不一致即拒绝；旧 Task 只改 Plan 并新增声明时要求同时给出结构化档位；派发信封读 Task 字段，旧行回退 Plan 并标明来源，验收行与上限句明确覆盖 `## 验收`/`## 验证`。chief v11、developer v7、tester v6、reviewer v6、D-04/D-05、G2 同步；无新档、无自然语言审查。
- **证据**：`tsc` 通过；全量 68 文件 697 通过；`check:prompts` 15/15；`task-tools`/`delegation`/`store`/`plan-contract` 定向通过（含旧行三条路径、v20→v21、bold 解析）。独立 Review Round 1 NEEDS_FIX（旧行仅改 Plan 可形成 broad 无 Test），修复后 Round 2 PASS；独立 Test passed：真实 task 工具覆盖创建拒绝矩阵、旧行 update、派发来源与上限句、迁移与解析器，并在 `/tmp` 副本删除旧行守卫后对应用例按预期变红（`test.md`）。
- **边界**：宿主不审查 Plan/派发的自然语言，验收原文仍下发；实际约束依赖档位上限句与冲突报告。旧 Task 不回填；生产库未迁移；提示词按进程缓存，重启后生效。

### 2026-11-21 · A — 主管恢复观察 shell + HEAD/工作区审计

- **问题**：P0-4 为堵“主管不建 Task 用 bash 偷改项目”把主管 shell 整个拔掉，结果是 ssh/端口/容器/日志/git-ignored 本地 env 的日常排障也必须建 Task、派 member、走 Review/Settle；aisuangua 出现过查一个端口 5 分钟、为一条 `ssh ss -ltnp` 开 implement Task 的现场。根因是把“shell 可写”与“shell 可观察/运维”当成同一件事；read Task 又会过滤所有角色的 bash，所以给 investigator 加 bash 并不能修复那次 read Task 的卡壳。
- **决定**：用户 2026-11-21 选 A（沙箱以后再说）：主管恢复 `bash`，只用于观察/运维；不持有 write/edit；read Task 与 paused hold 仍过滤 bash；每次主管 bash 后由宿主比较 HEAD/status/脏内容并告警；主管会话另对 commit/历史改写/工作区丢弃命令询问；investigator 保持只读。
- **实现**：`tool-sets` chief = read/grep/find/ls/bash/inspect；`shell-audit.ts` 读 `rev-parse --show-prefix`、`rev-parse --verify HEAD`、`status --porcelain -z --untracked-files=all --no-renames`、`diff --binary HEAD` 与未跟踪文件 lstat；HEAD/status/脏内容/未跟踪标记任一变化即在工具结果追加 `chief shell audit` 并标 `isError`，不阻止、不回滚。git 调用 5s/16MB 上限；失败标 `limited` 并回退 HEAD/status；无 git 返回 null。`deletion-gate` 新增 `guardHistory`：主管对 commit/merge/rebase/cherry-pick/force-push/reset-hard/checkout--|./restore 询问，默认表对其他角色不变；`Trust all` 仍绕过门禁，但不绕过审计。`runner` 只为主管安装审计并开启 `guardHistory`。chief v12、G1/G2/G4、install/README 安全边界同步；提示词按进程缓存，重启后生效。
- **补强（Review）**：`status` 失败不再静默返回 null，而是 `statusAvailable:false` + `limited` 的观察并追加非错误提示；审计首句改为“project state changed while this command ran”，避免把并发成员/后台写入归因给当前命令；新增 developer `git commit` 不询问的运行时负向对照；中文 README 的角色权限行同步。
- **证据**：`test/shell-audit.test.ts` 12/12（干净、已脏文件二次编辑、未跟踪新增/修改、commit、ignored、子目录项目、无 git、status 不可读、单侧 status 失败不伪造变化、HEAD 不可读不比较、扩展告警/`isError`）；`tool-sets` 15/15、`deletion-gate` 11/11、`deletion-gate-runtime` 5/5（含 developer `git commit` 不询问的负向对照）；`runtime.test.ts` 新增真实 Pi 用例（主管 bash 改 tracked 文件→审计告警；只读 `git status` 不告警；主管 `git commit` 询问并拒绝）；全量 69 文件 717/717；`tsc`；`check:prompts` 15/15。独立 Review 首轮 5 项、二轮单侧 status/HEAD 与命令替换门禁均修复，三轮 PASS；独立 Test PASS（frozen tree 43/43 focused、717/717 full，含 6 组变异与负向对照，见 `.dev/work/chief-shell-audit-20261121/{review,test}.md`）。
- **边界**：审计不是沙箱，不能阻止修改；只覆盖本地项目根内、git 可见的状态。并发成员写入、`nohup` 后台、`ssh` 远端、`.git` 内部与 ignored 文件不被归因；未跟踪文件只比较 size/mtime；超大脏树可能 `limited`。`git commit` 的文本门禁可被 `ssh host 'git commit'`、`sh -c` 等绕过，HEAD 审计只让本地提交可见。需要“物理上改不了”时走后续 OS 沙箱方案。

### 2026-11-23 · P3-1 OS 执行沙箱与角色边界

- **问题**：P0/A 之后主管与专业角色的 `bash` 仍与启动用户同权限，文件工具边界只覆盖 read/write/edit/ls/find/grep；主管的 HEAD/status 审计只能事后可见，不能阻止项目源码或 `.env` 被读/写。产品 P-05 已确认执行沙箱目标，但实现缺失。
- **决定**：用户 2026-11-23 确认 `auto|strict|off`：`auto`/`strict` 缺后端或启动探针失败即 fail-closed，只有 `off` 允许无沙箱并显示「保护已关闭」；`auto` 与 `strict` 仅 Docker socket 不同，二者保留网络与 SSH agent；主管只读、设计/开发/测试 workspace-write + `.git` 只读、结算 `.git` 可写/hooks 只读、审核/调查/read 无 bash；工作台加载的 `.env` 精确屏蔽，项目自身 `.env` 不误伤；主管 history 命令在只读沙箱下直接拒绝，不弹确认。
- **实现**：新增 `os-sandbox.ts`（策略、真实探针、macOS SBPL、Linux bwrap、精确文件 stub、env allowlist）；`runner` 以原生 `createBashToolDefinition` 覆盖内建 bash，覆盖 `codemode` 嵌套调用；`deletion-gate` 增加 `historyCommandReason` 与 `readOnlySandbox`；`registry` 绑定 `cwd`/`sandboxKey`；`server/main` 在启动时构建运行时，`session.get`/`stream.prepare` 返回实时 `sandbox`，历史 `effectiveConfig.sandbox` 仅审计；`StatusBar` 显示实时徽标；`setup.sh`/`start.sh`/`package.json` 处理新数据目录 `.env` 与旧位置兼容；README/install/G1/runtime-contract/ui-design 与 chief/designer/developer/tester 提示词同步。
- **证据**：`test/os-sandbox.test.ts` 11/11（真实内核：私密读、精确 `.env` 读写、项目外写、自举嵌套、developer `.git` 只读、settler commit/hooks、linked worktree settler commit、私密 Unix socket、nohup 后台完成、env allowlist、缺后端 fail-closed、伪 executor 探针）；`tool-guard` 15/15、`deletion-gate` 13/13、`runtime` 63/63、`server-read` 26/26、`server-stream` 13/13、`codemode-runtime` 4/4、`registry` 1/1、`workbench-entry` 6/6；全量 71 文件 735/735；`tsc`、webapp typecheck、`npm --prefix kaiming run build`；浏览器 `browser/sandbox-status.spec.ts` 2/2（off/auto 徽标）；`check:prompts` 15/15。独立 Review 首轮 NEEDS_FIX 的 6 项、linked-worktree settler 项均修复并复审 PASS；独立 Test 结果见 `.dev/work/p3-1-os-sandbox-20261123/{review,test}.md`。
- **边界**：Linux `bwrap` 本机未安装，代码路径（精确文件 stub、挂载顺序、strict Docker）未在本机执行，探针会 fail-closed；网络、SSH、Docker（auto）、项目 `.env`、home 其他密钥和远端副作用不在边界内；macOS 不清理 `nohup`/`setsid` 孤儿进程；模式是服务端启动变量，无前端动态切换；提示词缓存需重启。它不是恶意代码隔离，不可信仓库使用容器/VM/独立用户。

### 2026-11-24 · 模型失败可见性与恢复

- **问题**：prepdex 的真实主管会话已持久化多条 `MODEL_ERROR`（Kiro `429 ... MONTHLY_REQUEST_COUNT`），但浏览器只显示用户消息；空内容的 assistant error 消息被转录过滤，`lastInputError` 不存在，失败输入又被提醒系统当成“对话已完成”。用户看到的是没有原因的空屏。
- **实现**：新增纯分类器 `runtime/model-error.ts`，把额度/限流/凭证/上下文/未知错误映射为 `MODEL_QUOTA_EXHAUSTED`、`MODEL_RATE_LIMITED`、`MODEL_AUTH_FAILED`、`MODEL_CONTEXT_EXCEEDED`、`MODEL_ERROR`，服务商原文保留；`runner` 存真实分类；`session.stream.prepare` 返回最新 failed 输入的 `lastInputError`（未关闭的成员 interrupted 也可显示；主管 watchdog 中断先被宿主记为 stopped，仍走恢复路径；旧 `MODEL_ERROR` 在读取时分类，无需迁移）；Pi `message_end` 错误与运行终态发布顶层 `input` SSE 帧；快照与真实帧分别覆盖刷新与实时。前端 `slot` 持有错误并忽略旧输入迟到帧，`agent_end` 后等待终态帧再允许完成提醒，`InputErrorNotice` 显示双语分类句、服务商原文和模型设置入口；根 `ErrorBoundary` 把渲染异常变成可读错误页和重新加载。
- **证据**：`test/model-error.test.ts` 5/5（真实 Kiro 月额度样本必须归额度；`429 Rate limit reached ...` 必须归限流；401/上下文/未知 negative control；详情截断）；`runtime` 月额度真实 stub 用例通过；`server-stream` 快照持久化/清除旧分类通过；webapp focused 43/43（`slot` 终态等待、提醒、边界 markup）；全量 72 文件 742/742、前端 21/146、两套 typecheck、构建、`check:prompts` 15/15；浏览器 `browser/model-error.spec.ts` 1/1（额度横幅、无完成提醒、刷新仍可见、设置入口）；既有完成提醒用例 1/1。全量浏览器为 74/76；失败是既有 acceptance 的 task-create 用例缺少 `verificationProfile` 与状态栏宽度注入用例，均不作为本次通过证据。真实 prepdex 数据用于问题定位；未用其真实凭证重放。
- **边界**：不自动重试、不换模型、不把 provider 失败改成成功；provider 自身的重试可能让错误横幅晚于首次 429 出现；分类只基于 provider 文本，未知仍保留原文。`ErrorBoundary` 只覆盖 React 渲染异常，事件处理器/网络错误走各自 banner/toast；本次未做全站故障注入。

### 2026-11-25 · 宿主 GUI 取证 tool

- **问题**：P3-1 后 tester 沙箱内的系统 Chrome 会在 `ProcessSingleton` 创建 socket 目录时失败，`screencapture` 也被 macOS TCC 拒绝；桌面窗口、托盘图标和菜单栏因此只能间接验证。把 `screencapture` 移到宿主 tool 并不能自动获得 TCC，必须有持有 Screen Recording 权限的签名进程。
- **实现**：新增宿主侧只读 `gui` tool，固定 `screen/region/window` 目标，参数边界与跨目标字段在 TS 侧校验，PNG 走既有附件存储并返回 image 内容块；通过 LaunchServices 启动 `kaiming/native/GuiCapture.app`，helper 只接收固定 argv 并调用 CoreGraphics。`tester/developer` 获得 `gui`（read Task 保留），其他角色不获得；不修改 OS 沙箱、不启动 Chrome、不执行任意命令。新增 `kaiming/native/{gui-capture.swift,Info.plist,build.sh}` 与 `npm --prefix kaiming run build:gui`；G1、tester v8、developer v9 与 TCC 说明同步。
- **证据**：`gui-tool` 8/8（screen/region/window 校验、未知/跨目标字段、固定 argv、附件、TCC/helper/缺图错误、非 macOS）；`tool-sets` 16/16（tester/developer 有 `gui`，其他角色无，read Task 保留）；`external-tools-runtime` 6/6（真实 Pi 运行时 tester 的 activeTools 含 `gui`，非法 region 在 helper 前返回 `INVALID_ARGUMENT`）；全量 73 文件 752/752；`tsc`；`check:prompts` 15/15；`bash kaiming/native/build.sh` 编译并 ad-hoc 签名成功；helper 非法参数返回 `INVALID_ARGUMENT`，宿主 TCC 未授权时 `screen` 返回 `TCC_DENIED`；`open -W` 启动 helper 并读取 status 的链路已验证。
- **边界**：本机未给 `Kaiming GUI Capture` 授予 Screen Recording，因此真实像素截图未验证，不能宣称托盘/菜单栏外观已可视化；ad-hoc helper 重新构建可能重置 TCC，需重新授权。系统 Chrome 仍不在 tester 沙箱内启动；网页继续用 `browser`，应用窗口优先 `capturePage`。工具只对 developer/tester 开放，未做独立 Review/Test。

### 2026-11-25 · 沙箱激活时的删除确认

- **问题**：P3-1 的 `auto|strict` 已在内核层把角色写边界固定，但 `deletion-gate` 仍对 `rm`/`rmdir`/`find -delete`/脚本删除逐次发起交互；最近 Task 的确认记录显示大量 Trust all 和数小时等待。更具体地，`q-4e8a5390`（`s-73e06eea` / `t-b601964eb02a`）是测试 Agent 用 heredoc 写 B-42 测试脚本，正文里的 `rmSync` 被当成正在执行，任务一度被 pending 交互冻结；用户随后在旧进程选择 Trust all，该交互已 resolved。
- **决定**：用户 2026-11-25 确认方案 A；接受工作区内 untracked 文件可能被普通删除的风险，不增加 Task 信任、项目开关或前端配置。`off`、高危 Git 清理、主管只读和 settler 保持原确认。
- **实现**：`deletion-gate` 在规则匹配前只剥离**写入型** heredoc 正文：`cat` 在 `<<` 前或后有输出重定向、`tee`、`git commit -F -`；`bash`/`sh`/`python3`/`node` 等执行型 heredoc 保留正文，`<<` 后接解释器管道时也不剥离。`git commit -F -` 的判定改用 `[ \t]` 字符类，不再误用正则字面量里的 `\\s`。删除规则增加 high-risk 标记（`git clean -f`、`git stash drop/clear`、`git branch -D`）；`sandboxActive` 仅在当前策略为 `workspace-write` 且启动探针 active 时跳过普通文件删除，其他路径保留原行为。`runner` 仅对设计/开发/测试传入该标志，`off`/chief/settler 不传。G1、P-05、AC-66、base/specialists 提示词同步。
- **证据**：`deletion-gate` 19/19（写入型 `cat >`/`cat << >`/`tee`/`git commit -F -` 不触发；执行型 `python3`/`node`/`bash` 及 `tee`/`cat` 管道给解释器仍触发；`bash <<EOF` 内的 `git clean -f` 在沙箱 active 下仍被门禁拦截；heredoc 后真实删除仍触发；普通删除在 active workspace-write 下不询问；`git clean -f`/stash/branch 负控制；无沙箱仍询问）；`deletion-gate-runtime` 5/5（既有 approve/reject/trust 管道未回归）；全量 73 文件 758/758；`tsc`；`check:prompts` 15/15；全量测试覆盖 runner 与 P3-1 沙箱。`q-4e8a5390` 的原始 heredoc 形状已由单测覆盖；该交互在旧进程已由用户选择 Trust all 解除。
- **边界**：旧进程已由用户选择 Trust all 解除等待；旧 PID 20482 已终止，曾启动 PID 60850 验证监听后按用户要求停止，当前没有 kaiming 进程，由用户自行重启；未在真实运行中的 B-42 tester 上重放；文本门禁不是完整 shell 解析器，复杂 heredoc/嵌套脚本仍可能漏判；未跟踪文件保护和项目级 opt-out 不在本次范围；本次未做独立 Review/Test。提示词内容变更需要重启后生效。

### 2026-11-25 · 并行、返工与合流验证边界

- **问题**：底层 `runAndWait`/`settleStep` 支持同一步多成员并行，但历史 663 个专业 Session / 479 个步骤中 develop/test 并行几乎为 0；`chief.md` 只写“可并行”，模型默认串行。B-42 还出现非阻塞问题拉起整轮返工、focused 跑全量套件、Tester 越位钻依赖源码。
- **决定**：Plan 的每一步显式写 `parallel`（成员 + 精确 `writeScope`）或 `serial`（共享文件/依赖原因）；同一步用一个 `task(op=dispatch)` 带多个成员；共享契约文件前置；并行写入停稳后由 developer 续跑组合 typecheck/build，主管不跑构建/测试；Tester 可并行独立入口并隔离端口/`$TMPDIR`，主管只核对报告并集和组合验收。B-44～B-47 按 `focused` 合并，不标 `visual`。
- **实现**：`chief.md` 增补并行决策、一次 dispatch、共享文件、合流构建归属和同类机械任务合并规则，以及非阻塞不返工边界；`reviewer.md` 增加 passed/failed 边界（只缺 Test 可执行的证据时列 `not_run`，不由只读 Reviewer 判 failed）；`tester.md` 增加复现即止损，不修生产代码/不钻依赖；`developer.md` 增加优先 `edit`/`write` 和可见 UI 必须跑一次真实入口。未新增状态、调度层或 OS 写锁。
- **证据**：`check:prompts` 15/15；全量 73 文件 758/758；`tsc` 通过；改动内容与 D-03/D-05 的职责边界一致。`writeScope` 仍然是告警而非写锁，并行安全依赖 Plan 的精确切分。
- **边界**：提示词缓存需重启工作台后生效；尚未用真实模型在 B-44～B-47 上验证“主动并行”，也未验证两个 Tester 的并发 Electron/浏览器环境；若实际仍越界，再考虑在 tool-guard 对 write/edit 做 writeScope 拦截。

### 2026-11-26 · 历史图片归档与 UI 自检边界

- **问题**：37 张历史截图约 7.79MB base64；每张约 957 tokens，但同一模型 7–8 图已需 43–74s、37 图需 184–205s，纯文本 168K/0 图仅约 3.6s；按 K=8 滑动窗口仍达不到目标，并会从中段改写前缀、反复击穿 Prefix Cache。压缩本身仍按 `thresholdPercent × contextWindow`，没有固定上限。
- **实现**：新增 `history-image-archive.ts`，以 Pi `context` 事件在每次 LLM 调用前归档 tool-result 图片：user 图片永不改写；只有位于最后一条成功 assistant 消息之后的当前工具批次保留，更早的 tool-result 图片替换为固定文本占位符；错误/中止的 assistant 不算成功回复。归档不修改 Pi JSONL、数据库或附件；占位符不含时间戳/计数/动态 ID，重复执行幂等。`runner` 为每个 Pi 实例安装该扩展。该扩展不改 compaction policy，也不处理 tool-set resume bug。
- **提示词/工具**：developer v10 限制 UI 冒烟为一条核心入口、最多 1–2 张截图、临时 HTTP 服务，禁止手写 CDP/Electron 框架；chief v14 增加内容页建 Plan 前的受众/主张/禁用术语对齐、方向成立直接进 Review、重载上下文另开 developer Session。`browser(open)` 拒绝 `file:` 时提示临时 loopback HTTP 服务。
- **证据**：`test/history-image-archive.test.ts` 10/10（当前批次保留、成功 assistant 消费后归档、并行工具结果、user 图片负向对照、错误/中止 assistant 不归档、幂等、前缀稳定、新工具批次不改旧前缀、无图/实际归档不原地修改、context handler 注册）；`test/browser-tool.test.ts` 7/7（`file:` 大小写拒绝提示）；全量 74 文件 768/768；`tsc` 通过；`check:prompts` 15/15。占位符固定且只影响尾部批次；测试断言 user 图片不被改写、无图/归档路径不修改输入、已归档重复处理无变化。独立 Review PASS（未发现阻断项；非阻断建议已处理大小写 file 提示、实际归档不变异、原始工具文本保留、新工具批次前缀稳定、error/aborted 不归档）。
- **边界**：当前生产进程仍运行旧代码；提示词按进程缓存，扩展只对新创建/重建的 Pi 实例生效，必须等工作台重启。真实延迟/缓存对比基准尚未在重启后的副本会话执行，不能宣称已达到 5–10s 或 98%+ 新命中率；待当前 `t-7adcab264a9c` 收口后执行。旧 user 图片保留会增加少量上下文，作为用户证据与缓存稳定性取舍。

### 2026-11-27 · 委派等待的模型阻断与停止响应

- **问题**：prepdex 项目把 `developer` 指向不可用模型后，`task(op=dispatch)` 的子成员输入保持 `queued`；`settleStep` 只看到 `queued`，主管等到 `waitTimeoutMs`，而不是得到 `MODEL_UNAVAILABLE`。用户在 16:08:30 停止主管后，主管输入仍是 `processing`，stop RPC 直到 16:13:34 子成员完成才 committed（约 5 分钟）；根因是轮询没有检查当前主管输入的 `stopRequestKey`。
- **实现**：`runner.settleStep` 轮询当前成员 input；对仍为 `queued` 的成员按 Task 的 role/project 解析有效配置并查询 `PiRuntimeFactory.isAvailable`，不可用时返回 `blocked` 且在该成员 `error` 写入 `MODEL_UNAVAILABLE`，不修改 queued 输入；每条轮询先检查当前主管 live input 的 `stopRequestKey`，命中立即返回 `stopped`。`DelegationReturn.outcome` 增加 `stopped`；不新增 Store schema，不把成员改成 failed/blocked 终态，配置修复后 worker 仍可继续。
- **证据**：`test/runtime.test.ts` 67/67 通过（新增 3 个用例：不可用成员模型立即 `t-blocked blocked` 且成员仍 queued；主管等待中 stop 在 2s 内返回 `t-stop stopped`、主管输入 stopped、成员仍 queued；可用 queued 成员返回 timeout 且无 `MODEL_UNAVAILABLE`）；`npm run typecheck` 通过。独立 Test 在反转两处源码的临时副本上观察对应用例分别以 5204ms > 2s、19811ms > 2s 失败，证明测试有区分力；独立 Review PASS，唯一非阻断的 outcome 断言缺口已补。验证档 `focused`，只运行 `test/runtime.test.ts`；未跑全量套件或 E2E。
- **边界**：当前运行中的 workbench 尚未重启，本修复只对重启后的代码生效；没有改变工作台 UI 对子会话 blocked 事件的呈现，主管当前回合通过 `task(op=dispatch)` 的结构化结果获得原因；超时后主管不再等待但未被唤醒的边界未在本任务扩展。

### 2026-11-27 · P3-2/P3-3 契约定版与单 Task 多待办准入

- **问题**：P3-2 草案把 Worktree 放进 `<dataDir>/worktrees`，与 P3-1 的私有路径冲突；同时缺少迁移、provisioning 恢复、backlog 一致性、setup 沙箱和 `branch_kept` 历史读取的定版；单 Task 多待办也缺少合并准入规则。
- **决定**：Worktree 独立根（`~/.kaiming-worktrees`，可覆盖，三禁校验）；`worktreeRoot`/`workspacePath`/`workspaceRelPath` 分离；v21→v22 legacy/provisioning 状态与项目级 in_place 索引；失败/崩溃两条清理路径；backlog 先提交后 hash；setup 走 workspace-write 沙箱并只白名单命名的 `KAIMING_*`；`branch_kept` 保留分支并用 `git show` + SHA-256 兜底。P3-3a 调度/配额为 `broad`，默认 4；P3-3b 重叠/文件视图为 `focused`。单 Task 多待办要求同一目标、同一 workKind、共同验收、相同验证档、正交写面。
- **证据**：本次只改文档与 `test/task-backlog.test.ts`；`task-backlog.test.ts` 7/7（新增 n=2 关联和“后一项 closed 拒绝、无 Task 行、可重试”负向控制）；`npm run typecheck` 通过；`npm run check:prompts` 15/15；独立 Review 先 NEEDS_FIX（显式隔离失败、取消 Worktree 回收、配额默认值），修复后 PASS；独立 Test 7/7，确认 focused 范围充分。
- **边界**：T1 当时未改 Schema；随后的 T2a 切片已加 v22 workspace 元数据，但 P3-2 的 Worktree 创建、索引和合流仍未实现，非 Git 第二个 write Task 与默认并发配额 4 仍需升级说明。旧程序不可回读 v22。

### 2026-11-27 · P3-2a 切片 1：Workspace 元数据与 Task cwd

- **问题**：P3-2 需要 Task 级工作目录，但当时只有 chief cwd；直接加 Worktree 而没有统一 cwd 会让 Plan 修订、交付核对和成员目录各写一处。
- **实现**：v21→v22 additive 加 `workspaceState`/`worktreeRoot`/`workspacePath`/`workspaceRelPath`/`branchName`/`baseCommit`；旧 Task 为 `legacy`，新 Task 为 `in_place`；`resolveTaskCwd` 对 legacy/in_place 取 chief cwd、active/provisioning 取 `workspacePath`（缺失明确失败）。`completion-git` 与 Task Plan 修订改用统一 cwd；Task 摘要暴露 workspace 字段。
- **证据**：定向 6 文件 **120/120**；全量 **74 文件 / 775 用例**；`npm run typecheck` 通过。独立 Review 首轮发现 Plan 修订仍写 chief 目录（P1），修复为同一 `planTarget` 复用于记引用和写字节后 PASS；独立 Test 120/120、全量 775，并指出缺路径分支无回归；已补 `WORKSPACE_BUSY` 断言与 6 个 legacy 列断言。
- **边界**：本切片没有 Worktree 创建/回收、项目级 in_place 唯一索引、provisioning 状态迁移或合流；当前运行中的 workbench 仍是旧进程。下一片是分配器 + Worktree 创建，不能把本记录视为 P3-2 完成。

### 2026-11-27 · P3-2a-2：Workspace 分配、Worktree 创建与诚实落地

- **问题**：第二个活动 write Task 仍与第一个共享主工作区；创建/完成路径没有隔离，也没有主分支前移或切换时的安全门禁。
- **实现**：v23 将旧 `in_place` 转 `legacy` 并加项目级 in_place 唯一索引；task 创建先尝试 in_place，冲突/显式 isolation 时建 `kaiming/<taskId>` Worktree（根默认 `~/.kaiming-worktrees`，可配置，三禁校验）；记录 baseBranch/baseCommit；provisioning 失败强制清理；`task(op=end)` 先检查全部 completion/design/commit 缺口，再按 baseBranch+HEAD+clean 决定 ff-only 或 branch_kept。
- **证据**：`test/worktree.test.ts` 10/10（创建、ff-only、主分支前移/脏/切换、Monorepo、根拒绝无副作用、显式 isolation 分配、provisioning 失败清理、task end 端到端 merged）；全量 **75 文件 / 785 用例**；`npm run typecheck` 通过。独立 Review 首轮 5 项 + relative root，修复后 PASS；独立 Test 9/9 时确认端到端落地，随后补 cleanup 用例。
- **边界**：setup hook、孤儿扫描、显式 workspace.remove、Plan/报告正式相对化、UI/P3-3 未做；Worktree 在 merged 后仍保留，清理需后续。当前 workbench 已停止，等待全部完成后重启。
