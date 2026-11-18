# 下一轮开发计划与缺口登记

日期：2026-11-18（整理自首轮真实项目开发周期复盘）。本页是**下一轮开发路线图（P0 → P1 → P2）**、活动风险与历史缺口归档的唯一入口；实现证据见 [验证记录](validation.md)，产品验收标准见 [产品验收](../productnew/acceptance.md)。

维护规则：新增公开方法、删除界面入口、修正合同时同步本页；关闭一项时移入底部归档表并附提交或测试位置。

---

## 一 下一轮开发计划 P0 → P1 → P2

基于第一个完整项目周期的实战复盘与第一性原理评估，现阶段核心架构（SQLite WAL + Pi 1.0 SDK + 五核心工具 + 独立 Review/Test 证伪 + Git/交付绑定）已经成型，不再引入新角色或新状态枚举。下一轮优先级按**“砍掉运行期隐性协调税 → 硬化脏工作区交付隔离 → 解锁高杠杆算力与会话分支”**排列：

### P0：运行期减摩与提速（首选切入）

消除单次 Task 流转中最高频的非业务摩擦、跨会话补救往返与无效轮询：

| 编号 | 目标与根因 | 涉及代码位置 | 方案要点与完成判据 |
|---|---|---|---|
| **P0-1** | **专业成员派发信封与 `REPORT_MISSING` 同回合自愈**（升级原 R6）<br>根因：① `dispatch` 只传主管手写的裸 `instructions`，子 Agent 开局需花 2～3 轮调 `task(op=get)` 和 `read` 查背景；② 主管漏写“调用 `agent_report`”或模型把结论打成纯文本时（suangua 现场占 Reviewer 的 16.5%），直接落 `failed/REPORT_MISSING`，需唤醒主管再重派一轮 | `src/tools/delegation-tools.ts`<br>`src/runtime/runner.ts` | 1. **派发自动组装上下文信封**：在 `delegation-tools.ts` 构造子 Session 输入时，由宿主确定性附加上下文摘要（Task 目标、`plan.md` 路径与验收/范围摘要、`expectedKind`、`writeScope`）及硬性收尾要求（必须以 `agent_report` 结束）。<br>2. **同回合隐藏补交**：在 `runner.ts` 判定 `reportMissing` 前，若成员正常结束（无 error/abort）但未交报告，沿用 `recoverModelOutput` 机制在同一 `runNext` 内发一次 `display: false` 的隐藏提醒 turn，仍未交再记 `REPORT_MISSING`。 |
| **P0-2** | **结算报告（Settler）单写对齐**<br>根因：D-07 要求 Settler 先把正文写入 `.dev/work/<taskId>/<sessionId>/settlement.md` 并 `git commit`，随后再调 `agent_report` 传入一字不差的全文 `body`（不一致即报 `VERSION_CONFLICT`），迫使模型在 JSON 参数里重复输出长文，易触发转义差异冲突或参数截断退化（11-13 事故诱因） | `src/tools/report-tools.ts`<br>`docs/technicalnew/prompts/settler.md`<br>`docs/technicalnew/agents-and-tools.md` | 当 `kind === 'settlement'` 且目标路径 `.dev/work/<taskId>/<sessionId>/settlement.md` 在磁盘上已存在非空正文时，`agent_report` 以磁盘已提交文件为权威正文（允许 `body` 省略或传入简短摘要而不再因换行/摘要差异报 `VERSION_CONFLICT`）；磁盘无文件时仍把 `body` 写入该路径。 |
| **P0-3** | **委派等待窗口调优与控制唤醒闭环**（含原 C8）<br>根因：① `DEFAULT_WAIT_MS` 仅 2 分钟（上限 5 分钟），而 C10 已将 `settleStep` 计入 `hostWaits`（不计入主管看门狗），过短的等待使长任务中主管每 2 分钟空转一次 LLM 回合；② 暂停→恢复、停止排队输入、`session.recovery.resolve` 不产生 run outcome，步骤停稳后不自动唤醒主管 | `src/tools/delegation-tools.ts`<br>`src/runtime/runner.ts`<br>`src/server/write-methods.ts`<br>`src/server/step-wake.ts` | 1. 上调 `DEFAULT_WAIT_MS`（如 10 分钟）与 `MAX_WAIT_MS`（如 30 分钟），子成员完成时仍毫秒级返回，消除主管高频空转。<br>2. 在 `controlTask(resume)`、`requestStop`（取消 queued 输入）与 `session.recovery.resolve` 后调用 `wakeForSettledStep`（复用既有按步骤去重），闭合 C8。 |

### P1：脏工作区交付隔离（硬化多模块协作边界）

| 编号 | 目标与根因 | 涉及代码位置 | 方案要点与完成判据 |
|---|---|---|---|
| **P1-1** | **Task 级交付基线（Baseline Dirty Isolation）**<br>根因：`snapshotDelivery` 与 `changedProjectPaths` 观察整个工作树状态；若项目在 Task 启动前已有未提交的无关改动（且未被 `.gitignore` 忽略），会被计入 `scopeDrift` 越界列表与 Review 的 `deliveryState.paths`，导致无关文件变动破坏 Review 绑定或阻塞 `task(op=end)` 的提交门禁 | `src/runtime/deliverable.ts`<br>`src/runtime/plan-contract.ts`<br>`src/tools/completion-git.ts`<br>`src/store/store.ts` | 在 Task 创建（或首次进入写阶段）时记录工作区已有 dirty 文件的路径与内容摘要基线；计算 `scopeDrift`、Review `deliveryState` 与 `deliveryCommitGaps` 时，排除“Task 启动前已存在且此后摘要未变”的无关脏文件，真正落实“保留无关改动且不阻塞完成”。 |

### P2：高杠杆算力与会话体验（按需推进）

| 编号 | 目标与根因 | 涉及代码位置 | 方案要点与完成判据 |
|---|---|---|---|
| **P2-1** | **订阅账号 OAuth 接入（原 S8）**<br>根因：多角色协作消耗大量 Token；Pi SDK 已支持 Anthropic（Claude Pro/Max）与 OpenAI（Sign in with ChatGPT）OAuth 刷新并读取 `auth.json`，但工作台设置页只接受带 `apiKey` 的自定义 provider | `src/runtime/pi-runtime.ts`<br>`src/runtime/provider-store.ts`<br>`src/server/methods.ts`<br>`webapp/src/settings/ProvidersPage.tsx` | 暴露订阅 provider 认证与状态接口，前端 Providers 页支持连接 Claude/ChatGPT 订阅账号并在 Models 页选择对应目录模型（历史草案见 `.kaiming/work/pi-subscription-providers-20261028/requirement.md`）。 |
| **P2-2** | **从当前主管会话 Fork 新会话（原 F1）**<br>根因：一个主管会话同时只推进一项未结束 Task；当讨论衍生出第二个独立目标时，新建会话会丢失已讨论的项目背景 | `src/runtime/pi-runtime.ts`<br>`src/store/store.ts`<br>`src/server/write-methods.ts`<br>`webapp/src/chat/SessionsList.tsx` | 基于 Pi `createBranchedSession` 与新 `session_bindings` 从当前主管会话分支出独立新会话；源会话忙或无历史时拒绝，fork 不继承未结束 Task、排队输入或旧授权（设计见 `.kaiming/work/fork-chief-session-20261101/plan.md`）。 |

---

## 二、活动风险与登记项

### R 风险（未记通过）

| 编号 | 风险 | 现状与处置策略 |
|---|---|---|
| R1 | 真实模型下的部分产品验收场景（J-09/J-10 设计与返工、J-12/J-13 新旧项目起步、AC-51～AC-62）尚未逐条独立打卡 | 已通过一个完整真实项目周期验证主干能力，且 `check:workflow`（8/8）、`check:backlog`（4/4）已覆盖真实模型核心路径；剩余场景随日常迭代自然检验，不脱离真实任务做机械打卡 |
| R2 | 触屏手势与软键盘遮挡未在真机验证 | CSS 已用 `100dvh` + 安全区并在 320/390px Chromium 走查通过；真机留待 M 系列实施时一并验证 |
| R3 | 320px 以下视口不作承诺 | 明确声明下限 320px |
| R4 | 转录未虚拟化 | 快照上限 100 条 + `MessageItem` memo + `rAF` 合帧后，300 行流式脚本耗时已从 797ms 降至 178ms；超长历史出现卡顿时再按需引入虚拟滚动 |
| R5 | 外部接入缺会话级用量推送（原 S6）与单次委派模型覆盖（原 S7） | `usage.report` 统计项目/全局；MCP 协议未声明 `usage_update`/`config_option`，沿用设置页配置，不算违约 |
| R6 | 专业成员漏调 `agent_report`（`REPORT_MISSING`） | 提示词约束（`09f8f0a`）与退化重试预算（`REPORT_RETRY_EXHAUSTED`）已上线；**派发信封与同回合自动补交已列入 P0-1**（见[验证记录](validation.md#2026-11-06--评审-report_missing-根因suangua-现场)与[预算记录](validation.md#2026-11-14--报告重试预算结构账本替代内容签名防线)） |
| R7 | 成功调用非结果工具的无限探索循环（如 `read` 成功 ×∞）不触发报告重试预算 | 300+ 历史会话未出现；由运行 watchdog（90 分钟）兜底。若真实出现，按同结构扩展账本（同工具+同参数摘要连击），不回到内容签名 |

### P 最佳实践（后续开发持续遵守）

| 编号 | 做法 | 理由 |
|---|---|---|
| P1 | 列表类界面一次请求取齐所需字段（`project.list` / `session.list`） | 避免 N+1 往返与无用流订阅 |
| P2 | 有推送就不高频轮询；轮询只在页面可见时运行，完成后停表 | 降低后台标签页与空闲负载 |
| P3 | 服务端错误码映射本地文案，服务端 detail 作为第二行 | 共享 `catalogErrorKey`，避免中英混排且保持未知码可见 |
| P4 | 遮罩层具备焦点陷阱、Esc 关闭、焦点归还与 `aria-live` 通知 | 保证键盘与无障碍可用性 |
| P5 | 「方法消费」门禁：[ui-design.md](ui-design.md#u9-方法消费) 列出每个公开方法的消费界面 | 防止新增孤儿后端方法 |
| P6 | 新方法清单：参数校验、归属校验、CAS/幂等、契约测试、`runtime-contract.md`、README 索引齐全 | 避免实现与合同分叉 |
| P7 | 三态（加载/空/错误）复用 `State` 与既有样式类 | 防止各页面自造状态样式 |
| P8 | 分页 cursor 语义统一并在合同表注明 | 避免同一资源多套分页语义 |
| P9 | 测试只钉可观察行为与合同边界，且标准代码 Test 必含负向控制 | 杜绝抄实现输出当期望值、杜绝源码文本正则断言 |

---

## 三、明确搁置与不做

### M 移动端（方向已定，尚未实施）

手机端**不可用的缺陷已全部修复**（320/390px 五屏无横向溢出、控件可达，见 [验证记录](validation.md)）。剩余 M1～M5 属于将窄屏“响应式压缩版”重做为“底部固定 Tab Bar + 全屏会话列表”的形态升级；因编码工作台重度场景在桌面端与 IDE（MCP），**明确搁置，不入近期排期**：
- **M1**：主导航在窄屏改为底部固定 Tab Bar（≥48px），顶栏只留项目名与连接状态。
- **M2**：手机上「会话」Tab 进入全屏会话列表页，选中后返回对话。
- **M3**：Tab Bar 固定最底，输入框在其上方，留出 `100dvh` + `env(safe-area-inset-bottom)`。
- **M4**：窄屏 CSS 媒体查询按外壳四段结构收敛。
- **M5**：iOS Safari 与 Android Chrome 真机软键盘与安全区走查。

### N 需求体系外接远程系统（已存档，暂不讨论）

2026-10-26 用户决定存档，外部同步仅在 [A8 协调扩展点](architecture.md#a8-协调扩展点本阶段只定义不实现) 保留结构边界（本机是自主执行节点，执行端永不修改需求目标与验收，只回传事实），不写网络代码、不排期。历史调研见 `.kaiming/work/remote-requirement-sources-20261027/research.md`。

### 明确不做

- 不引入前端状态管理库或请求缓存层（现有 `useState` + 单 `RpcClient` 足够）。
- 不把 `config.test` 扩成未保存草稿试连（U9）。
- 不为会话输入新增结构化待办引用参数（S5）；关联写在 Task 的 `backlogIds`。

---

## 四、已关闭缺口归档（2026-10 ～ 2026-11）

以下历史缺口均已修复并通过验证，详细证据见对应提交与 [验证记录](validation.md)。

### Q 待改（已决定方向，尚未实施）

*注：本节标题保留以兼容 [UI 设计契约](ui-design.md#u4-组件) 的历史锚点引用；Q1～Q4 已于 2026-10-25 随会话转录 TUI 化全部关闭。*

| 编号 | 现象与已定方向 | 状态与证据 |
|---|---|---|
| Q1～Q4 | 转录间距分档（同轮 8px / 换轮 24px）、成员行状态归并到 `TaskTodo`、工具卡 `create`/`dispatch` 默认单行折叠、移除常驻挤压转录的执行面板 | **已关闭（2026-10-25）** — `chat-tui-flow-20261025`，见 [验证记录](validation.md#2026-10-25-会话转录-tui-化与工作流全量展示) |

### 已关闭的界面缺陷（D）、后端方法（S）、合同偏差（C）与未消费入口（U/N/P）

| 编号 | 简述 | 关闭时间与证据位置 |
|---|---|---|
| **P10 / S9 / S10 / D10(看板)** | 删除旧 9 状态需求实体，落地待办（`.dev/backlog.md`）+ 规格 + 模块地图 + Plan 验收必填与范围越界检查（`scopeDrift`）+ `/project` 五列看板与 MCP `kaiming_backlog` | **已关闭（2026-11-09）** — WP-1～WP-8，服务端 59 文件 566 用例、webapp 108 用例、`check:workflow` 8/8、`check:backlog` 4/4 |
| **U11(错误码)** | 任务花名册失败行渲染 `session_inputs.errorCode`（`REPORT_RETRY_EXHAUSTED`、`MODEL_OUTPUT_CORRUPTED` 等）本地化原因句 | **已关闭（2026-11-14，`95bc4cc`）** — `u11-error-label-20261114` |
| **C6** | 已终止 Task 的队列清扫误杀该主管会话自己的 queued 用户消息 | **已关闭（2026-10-31，`7b8d9bc`）** — `test/store.test.ts`、`test/server-write.test.ts` |
| **C7 / C9 / C12 / C13** | 主管回合结束后成员才完成/中断/重启时无人接收：新增 `step-wake.ts` 步骤停稳自动唤醒、`onRunSettled` 上报、interrupted 成员专用恢复通知与启动扫描补唤醒 | **已关闭（2026-10-31，`d5f4e53` / `b27093d` / `bbc3d9c`）** — `test/step-wake.test.ts`、`test/step-wake-e2e.test.ts` |
| **C10** | 主管在 `settleStep` 等待成员的时间被计入自身 stall/total 看门狗导致 90 分钟必被杀 | **已关闭（2026-10-31，`b27093d`）** — `hostWaits` 豁免等待计时，`test/runtime.test.ts` |
| **C11** | `task` 工具 schema 漏声明顶层 `sessionId` 导致 `task(op=recover)` 恒被 Pi 校验拒绝 | **已关闭（2026-10-31，`a881e3c`）** — `src/tools/task-tools.ts`、`test/runtime.test.ts` |
| **C14** | 阶段退回 `develop` 并续办原成员时，`listTaskSessions` 按 `createdAt` 排序产生空 frontier | **已关闭（2026-10-31，`f536fea`）** — 改按 `updatedAt, createdAt, sessionId` 排序 |
| **C15** | bash 工具无默认超时，子进程打印后不退出拖死整个 run 15 分钟 | **已关闭（2026-10-31，`c382c3a`）** — 宿主注入默认 600s 超时，`test/tool-guard.test.ts` |
| **C16 / C22** | 交付快照包含 `.gitignore` 忽略产物、结算修改 `docs/**` 导致 Review 绑定失效 | **已关闭（2026-11-01 `ac2ba50` / 2026-11-02 `c18a395` / 2026-11-13 `1139eb9`）** — `test/deliverable.test.ts`、`test/report.test.ts` |
| **C17 / C18 / C20** | 前端 `slot.ts` 按正文去重误删同文新回复、旧完成帧顶掉新流式条目、超过 100 条历史重连后旧消息排到最新消息下方 | **已关闭（2026-11-01 `c7d5afd` / `4ac20f2`、2026-11-02 `feece57`）** — `webapp/test/slot.test.ts` |
| **C19** | Task 成员行长 question 标题撑爆 `auto` 轨道导致横向溢出 | **已关闭（2026-11-01，`482d69e`）** — 状态列改为 `fit-content(45%)` |
| **C21** | 专业成员正常结束但未调 `agent_report` 仍被记为 `completed` 并算作通过 | **已关闭（2026-11-02，`c199154`）** — 无对应结果记 `failed/REPORT_MISSING`，拒绝完成并提示原会话补交 |
| **C23** | 切换主管会话后残留上一条会话的 Task 条与轮询回包 | **已关闭（2026-11-03，`ff104e9`）** — `taskSessionId` 归属校验，`webapp/test/task-scope.test.ts` |
| **U7(MCP)** | 会话列未标注外部接入固定会话 | **已关闭（2026-11-09）** — `SessionRow.channel === 'mcp'` 渲染 `MCP` 标记 |
| **C5** | `task.get` 合同与 `task.report.get` 报告正文获取方式表述不一 | **已关闭（2026-10-28）** — 统一为 `includePlan` 取 Plan、报告正文走 `task.report.get` |
| **N1 / N2 / N3** | 补齐 `web_search`/`web_fetch`/`browser` 外部工具、自定义 provider 图片 `input` 声明与前端图片上传/渲染 | **已关闭（2026-10-22）** — `npm run check:tools` 4/4 |
| **D1～D10(初版) / S1～S4 / C1～C4 / U1～U10** | 模型项目级覆盖、抽屉焦点陷阱、后台暂停轮询、`project.list`/`session.list`、Task 变更推送、阻断横幅快照、全屏文件与报告查看画布（`FileViewer`）、历史反向翻页等 26 项基础缺口 | **已关闭（2026-10-22 ～ 2026-10-26）** — 见 [UI 设计契约](ui-design.md) |
| **D11～D16** | Provider 协议必选、显示名与编辑弹框、主管会话自定义改名（`session.rename`）、项目内按角色配置模型与 `config.clear`、Task 成员行内联与刷新可见 | **已关闭（2026-10-23 ～ 2026-10-24）** — 见 [验证记录](validation.md#2026-10-23-provider-命名协议与会话命名) |
