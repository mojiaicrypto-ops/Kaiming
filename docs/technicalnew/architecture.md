# 执行架构与职责

当前技术设计。产品含义见 [产品总览](../productnew/README.md)，实现字段和算法按链路展开。

## A1 执行总图

全局一个 Server。每个逻辑 Session 绑定独立 Pi 实例/历史；主管和专业 Agent 共用 Runtime。

```mermaid
flowchart TB
  UI[UI / CLI：主管入口] --> API[API：认证、归属、去重]
  API --> STORE[短事务接纳 / 查询 / 控制]
  STORE --> DB[(统一 SQLite：WAL)]
  DB -->|已提交输入| DISPATCH[Session Dispatcher]
  DISPATCH --> RUNTIME[Session Registry / 共用 Runtime]
  RUNTIME --> PI[独立 Pi 1.0 Session]
  PI --> LOCAL[Pi 原生 Local 工具 / 原生历史]
  PI --> TOOLS[Task 工具 / 专业报告]
  PI --> NATIVE[官方question移植扩展 / 工具ctx.ui原生请求]
  NATIVE --> ADAPTER[Server 原生 UI 适配]
  ADAPTER -->|请求提交| DB
  ADAPTER -->|提交后按当前主管路由| HUB
  TOOLS --> STORE
  TOOLS --> WAIT[父委派等待 Task 当前步骤]
  DB -->|当前成员全部停稳 / 等待超时| WAIT
  WAIT -->|原工具返回；主管继续决策| PI
  PI --> HISTORY[(指定 Pi JSONL)]
  PI --> HUB[按 sessionId 内存广播]
  HUB --> UI
  UI -->|请求身份 + 答复| RESPONSE[直接交互响应入口]
  RESPONSE --> DB
  RESPONSE -->|保存后解除原请求等待| RUNTIME
  RUNTIME -->|停稳 / 保存边界| FINISH[输入收尾]
  FINISH --> DB
```

| 边界 | 行为 | 展开 |
|---|---|---|
| 请求/写工具 → SQLite | 等短事务/必要文件保存；回执绑定原请求 | [S3/S6](storage-and-recovery.md) |
| SQLite → Dispatcher | 提交唤醒、启动/周期扫描；异步消费输入行 | [R3](runtime-contract.md#r3-共用-session-执行链路) |
| 委派工具 → 专业 Session | 创建/绑定后等待；事务不跨等待 | [M1](messaging-and-collaboration.md#m1-task-多-session-协作子图) |
| 子正式结果 → 主管 | 当前等待工具返回；原生交互由宿主转发，父委派仍等待；不另投重复结果输入 | [M2](messaging-and-collaboration.md#m2-委派等待协议) |
| 用户交互答复 → 原请求 | 直接保存并解除等待，不经过忙碌 Session 普通队列 | [M5](messaging-and-collaboration.md#m5-统一交互与授权) |
| Pi → UI | 原生事件内存广播；历史从 Pi 读取 | [M4](messaging-and-collaboration.md#m4-ui-快照与实时事件) |
| 停止/恢复 → Runtime | 直接控制，保存意图后中止/核对 | [S5/S7](storage-and-recovery.md) |

## A2 一项输入的执行子图

```mermaid
flowchart TD
  INPUT[接纳输入] --> COMMIT[保存 queued / 原请求回执]
  COMMIT --> ACK[返回接纳身份]
  COMMIT --> SCAN[唤醒 / 扫描]
  SCAN --> READY{Session 空闲且可执行？}
  READY -->|否| KEEP[保留 queued 与原因]
  READY -->|是| CLAIM[事务认领 / generation]
  CLAIM --> LOAD[显式配置、角色、工具、Pi 绑定]
  LOAD --> INTENT[提交 deliveryStartedAt]
  INTENT --> PI[追加关联标记；调用 Pi]
  PI --> WAIT[工具可等待子成果 / 用户答复；让出执行容量]
  WAIT --> PI
  PI --> END{实际停稳及保存核对}
  END -->|已知正常| DONE[completed / 历史边界]
  END -->|已知错误| FAIL[failed / 真实证据]
  END -->|确认停止| STOP[stopped / 已有影响]
  END -->|边界未知| UNKNOWN[interrupted / 阻断此 Session]
  DONE --> NEXT[释放资源 / 扫描下一输入]
  FAIL --> NEXT
  STOP --> NEXT
  UNKNOWN --> RECOVER[直接核对 / 新输入续办剩余工作]
```

工具等待期间输入仍 processing，逻辑 Session 仍被占用；Server 继续服务其他 Session。主管等待不占专业 Session 并发名额。输入 completed、专业成果完成和 Task 完成分别核对。

## A3 对象与事实来源

```mermaid
erDiagram
  PROJECT ||--o{ SESSION : owns
  PROJECT ||--o{ TASK : owns
  SESSION ||--o{ TASK : coordinates
  TASK ||--o{ TASK_SESSION : contains
  SESSION ||--o| TASK_SESSION : implements
  TASK_SESSION ||--o{ RESULT : reports
  SESSION ||--o{ INPUT : consumes
  SESSION ||--o{ INTERACTION : originates
```

主管可累计完成多项 Task，同时只绑定一项未结束 Task，包括已暂停工作。完成、取消或安全交接后释放 currentTaskId。TaskSession 是 Task 与专业 Session 的内部关联；当前步骤需要时才创建，可以接续开发返工。新 Review/Test 使用独立 Session。没有用户层面的第二套分工对象。

| 事实 | 权威 |
|---|---|
| 项目/Session 身份、当前 Task、阶段、子 Session 关联、结果、交互、回执 | 统一 SQLite |
| 外部通道的固定会话 | `sessions.channel`（程序字段，如 `mcp`）：同一项目每个通道至多一条；显示名仍是 `title`，改名不改变身份。产品语义见 X-02 |
| 总体 Plan / 正式报告 | read Task 存 Server `work/<taskId>/`；write Task 存项目 `.dev/work/<taskId>/`；DB 存引用与摘要 |
| 会话、工具正文、压缩与分支 | 精确绑定的 Pi JSONL |
| 需求内容与状态 | Markdown + YAML 头部，列表重建 |
| 项目知识与实际成果 | 项目权威文件；索引只导航 |
| 原生流式输出 | 内存广播；断线重取快照/历史 |

## A4 模块责任

| 模块 | 职责 |
|---|---|
| API / EventHub | 认证、接纳/查询/控制、快照/广播；只在主管通道展示其交互 |
| ProjectService | realpath 绑定、入口初始化、需求保存/列表、配置 |
| TaskService | 四个主管核心工具、当前 Task、总体 Plan、关联/结果、完成核对；阶段由主管显式写入 |
| Store / Dispatcher | 短事务、CAS、去重、认领、专业并发限制、扫描；不解释自然语言或选择角色 |
| SessionRegistry / Runtime | 独立 Pi/工具/上下文、等待与收尾；模型循环仍归 Pi |
| 原生 UI 适配 | 原请求身份、路由到当前主管协作通道、答复保存并直接恢复源请求；不需要主管模型处理转发 |
| RecoveryService | 读取 DB/Pi 历史/实际成果；核实后续办剩余工作，未知不重放 |

这些是同一 Server 的职责，不要求每项建包/进程。SQLite WAL 是存储机制；Dispatcher 查询 session_inputs，不直接消费 -wal 文件。

## A5 运行资源与边界

- 同一部署环境的 AgentDev 全局一个 Server，统一入口/数据库；状态目录仅是存储位置。应用级 OS 排他锁身份固定，不随项目或传入目录改变；重复启动返回已有入口或明确拒绝。启动成功后增加 serverEpoch。
- Server 保存 DB、Pi 文件、规则/配置和恢复产物；项目保存 AGENTS.md、.dev/、成果与可迁移报告。凭证只存 Server 私有存储。
- 每个 Session 显式 cwd/model/credentialRef/role/tools/piFile；不切换全局 cwd/env，不寻找最近会话。
- 同一 Task 的当前步骤可以有多个写成员并行，但必须按模块分工：每个写成员声明 `writeScope`，程序只核对范围重叠并告警，是否并行由主管判断。首版不要求分离目录；并行多个 Task 使用独立 git worktree 属于后续版本。
- Review/Test 针对当前工作树的实际交付；程序在报告提交时记录交付状态（见 [G3](agents-and-tools.md#g3-task-流程交付核对与完成)），交付变化时才要求重新复核，模型不携带候选或版本。测试有环境需要时使用副本/独立 worktree。独立 Session 不等于 OS 沙箱，首版复用 Pi Local 工具。
- 其他话题新开主管 Session；状态查询、暂停/取消、已有交互答复可随时操作。Task 复制/迁移不会继承本环境执行权或授权。

## A6 主源与采用范围

| 主源 | 采用 | AgentDev 负责 |
|---|---|---|
| [Pi v1.0.0 SDK](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/sdk.md) | Session、模型循环、原生工具/历史/取消、UI 适配 | 项目/Task、可靠接纳、当前步骤等待与交互事实持久化 |
| [OMP 同步委派](https://github.com/can1357/oh-my-pi/blob/9348320cc4a30a7195d36a1f05a6c11bcb701a17/packages/coding-agent/src/task/index.ts#L1463-L1570) | 有界并发、独立角色/Session、聚合工具返回 | 正式 Task、当前步骤成员聚合、超时状态返回、重启后事实核对与续办 |
| [Durable 固定版本](https://github.com/earendil-works/pi/blob/a13d35a742c6ef8462812a28fbe1d8c8b7431c32/packages/durable/README.md) | 稳定请求、先保存、提交边界、未知效果不重放 | coding-agent SDK 中的所需机制 |

Durable 使用 pi-ai + Chord 的独立 Harness。这里使用 coding-agent SDK；关键能力按 [I1](implementation-checks.md#i1-pi-接入必须先通过的试验) 取证。

## A7 前端层

浏览器界面是一层独立实现，不改动 A1～A6 的 Server 语义；产品能力见[产品总览第 6 节](../productnew/README.md#6-用户实际能看到和操作什么)，实现依据见[UI 设计契约](ui-design.md)。

```text
浏览器(单页应用)
  → /api/v1/rpc           请求/答复：认证、归属、去重
  → /api/v1/sessions/<id>/stream   session.stream.prepare 快照 + SSE 增量(M4)
```

| 事实 | 现状 | 位置 |
|---|---|---|
| 技术栈 | React 19 + Vite 7 + TypeScript；`npm run build` 产出 `web-static/`，同一 Server 在 `/` 托管 | `devagent/webapp/` |
| 入口 | 只有一套外壳：`/` 即新壳；`/requirements`、`/settings/*` 是客户端路由，未知无扩展名路径回退 `index.html`；旧地址 `/app/*` 301 到同路径 | `src/server/http.ts`、`src/server/main.ts` |
| 数据来源 | 会话流复用 `session.stream.prepare` + SSE；其他界面只调用已注册的只读/写入方法 | `src/server/read-methods.ts`、`write-methods.ts` |
| 外部接入 | 编码 Agent 通过 MCP 调用同一 Server：`/mcp`（Streamable HTTP，与前端同进程）与 `npm run mcp`（stdio 子进程，附着或自启 workbench）；工具面与状态推导见 [MCP 服务](mcp-service.md) | `src/mcp/` |
| 构建产物 | `devagent/web-static/` 不入库，构建后可被测试与服务端使用 | `devagent/.gitignore` |
| 样式 | 令牌与组件层照 `docs/design/tui/tui.css` 重写；代码/标识等宽，中文正文无衬线 | `devagent/webapp/src/theme/` |
| 会话标题 | 服务端不存标题：界面取首条用户消息派生，新会话显示"新会话" | `devagent/webapp/src/state/useWorkspace.ts` |

服务端当前没有项目/会话列表方法，界面只能持有本地最近选择；多项目、多会话导航的真实列表需要只读查询方法，属待补齐缺口。
