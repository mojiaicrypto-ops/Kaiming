# 当前设计与实现验证记录

本页记录开明（Kaiming）各模块的验证基线、关键实现证据与边界，不定义协议。整理日期：2026-11-18。下一轮开发计划与未关闭风险见 [缺口登记](gap-register.md)。

---

## 一、当前验证基线总览（截至 2026-11-14）

| 验证层 | 入口命令 | 当前通过规模与覆盖核心 |
|---|---|---|
| **服务端单元/集成** | `npm --prefix kaiming test` | **66 文件 / 632 用例通过**（SQLite WAL 接纳/认领/迁移至 v19、Pi 1.0 SDK 桥接、五领域工具、待办双向解析、交付快照与 Git 提交门禁、步骤停稳唤醒、空闲按需扫描、报告重试结构账本、`codemode` 沙箱权限等，含负向控制与变异自检） |
| **前端单元** | `npm --prefix kaiming/webapp test` | **20 文件 / 133 用例通过**（`slot.ts` 流式合并与重连去重、任务流程推导 `task-flow`、看板分组、模糊模型匹配、链接归属解析、提醒差分、错误码映射等） |
| **类型与构建** | `npm --prefix kaiming run typecheck`、`npm --prefix kaiming/webapp run typecheck`、`npm --prefix kaiming run build` | 服务端与 webapp `tsc --noEmit` 零错误，Vite 生产构建产出 `web-static/` |
| **提示词契约** | `npm --prefix kaiming run check:prompts` | **15/15 通过**（9 份角色提示词与 `AGENTS.md` 按 G4 边界切片、无中日韩字符、装配顺序正确、39 个内部链接与锚点全部可解析） |
| **浏览器 E2E** | `npm --prefix kaiming run test:browser` | **Playwright 真实 Chromium + 真 Server 套件通过**（三屏导航、流式对话、提问答复、双击防重、断线恢复、项目看板、文件/报告画布、模型分层与思考等级、用量统计、会话归档、320/390px 窄屏无溢出等） |
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
