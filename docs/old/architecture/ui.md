# WebUI 架构（v2 重构）

状态：**评审稿**。产品依据：[产品方案](../product/PRODUCT.md)、[工作台交互](../product/experience.md)；设计规格：`webui/DESIGN.md`（仓库根）；改造计划：[ui-rework-plan](../delivery/ui-rework-plan.md)。

## 0. 重构裁决记录

- **D1 新建独立前端工程**：`apps/web` 的视图层（`pages.ts`/`shell.ts`/`views.ts` 的渲染半部/`public/app.js`）不再原地演进；新工程 `apps/webui`（React 19 + Vite 8）从干净基线实现九面板工作台。存量 `apps/web` 在切换完成前保持服务（灰度并存），迁移完成后删除其视图半部。
- **D2 回到既定技术栈**：`ARCHITECTURE.md` §3 本就规定 React 19.3.0 + Vite 8.2.2；现状的"apps/web 零依赖"是执行偏差而非设计约束。本次回归设计，修订 apps/web 的文档表述。
- **D3 契约不动**：WS/HTTP 协议、zod Schema、错误码、幂等语义全部不变。前端重构对 daemon 是纯消费者替换。
- **D4 BFF 归属**：认证、Cookie 会话、Origin 校验、`/rpc`、`/ws` 桥、文件夹选择器、产物转发**保留在 `apps/web`（Node BFF）**——这些是安全边界不是 UI。`apps/webui` 构建产物（纯静态 `dist/`）由 BFF 的 `serveAsset` 服务，部署形态不变（单进程、回环、无新增端口）。
- **D5 Pi 会话持久化（复用 Pi 存储，不另建对话史表）**：每个 Run 的 Pi 会话启用 `sessionDir` 文件持久化（JSONL，消息级含工具全输出与 usage token 账本），落 `~/.agentdev/projects/<projectId>/sessions/<runId>/attempt-<n>.jsonl`；`attempt.session_ref.sessionFile` 回填真实文件路径。理由：Pi 的 JSONL 已持久化 UI 回放所需的一切（content blocks、toolCall 全参数/全结果、usage 含 cache 计费、压缩检查点），自建对话史表是重复建设；`SessionManager.open/resumeFrom` 恢复机制现成；`session_ref`/Checkpoint 契约字段早已预留。安全边界：目录 0700；UI 回放按 Run 归属执行既有 ACL（"Reviewer 不能访问其他 Run 的 Session"，context.md §5）；Secret 不经模型路径注入，会话文件天然无密钥值。终态 Run 的回放以 jsonl 为权威水合源；delta 实时流仍不落库（protocol.md §7 W8-2 不变），statusbar 的 token 用量以 jsonl `usage` 聚合为权威。
- **D6 P1 增加运行中流的重连缓冲**：daemon 为每个进行中 Attempt 维护内存环形 buffer（上限 256KB/Run，超限丢最旧，Attempt 终态即弃），WS 重连时先推 buffer 快照再接 live delta；不进 SQLite、不改持久语义。该缓冲解决"运行中刷新丢失已输出内容"的体验缺口，与 D5 的跨 Attempt 回放互补。

## 1. 分层

```
┌─────────────────────────────────────────────────────┐
│ 浏览器 apps/webui (React 19 SPA, Vite 构建静态产物)  │
│  令牌层  mock CSS 变量 1:1（--font-scale 密度旋钮）   │
│  组件层  Timeline / ToolCard / RunTree / StageStrip  │
│  状态层  Query(REST+持久事件) · StreamStore(WS流) ·  │
│          本地 UI state                               │
│  类型层  @agentdev/contracts zod → z.infer 单一来源   │
├─────────────────────────────────────────────────────┤
│ BFF apps/web (Node, 不变)                            │
│  Cookie 会话 · Origin/CSRF · /rpc · /ws 桥 · picker  │
│  · 产物转发 · serveAsset(webui dist)                 │
├─────────────────────────────────────────────────────┤
│ daemon apps/daemon (不变)                            │
│  P1 新增：run.delta 临时流转发（supervisor→WS）      │
└─────────────────────────────────────────────────────┘
```

## 2. 事件管线（P0/P1 打通的目标态）

### 2.1 现状缺口（重构前的事实基线）

- Pi SDK（`@earendil-works/pi-coding-agent` 0.85.1）RPC 事件表完整：`message_update`（text/thinking/toolcall delta）、`tool_execution_start/update/end`、`bash_execution_update`、`queue_update`、`compaction_*`、`auto_retry_*`。
- `pi-runtime/events.ts` 现映射砍掉 toolcall delta（归 `raw`）。
- Runner 经 IPC `attempt.event` 上报；supervisor 只累积文本供合同检查，**不转发**。
- `protocol.md` §7（W8-2）已定义 `token.delta`/`log.delta`/`heartbeat` 为连接内临时帧，**实现缺位**。

### 2.2 目标事件流

```
Pi SDK ──→ pi-runtime（全量映射，不再归 raw）
       ──→ Runner IPC attempt.event（现有，扩展载荷）
       ──→ supervisor（转发 + 30fps 节流聚合）
       ──→ daemon EventHub ──→ WS 临时帧 run.delta（不落表、不占 cursor）
       ──→ 浏览器 StreamStore（按 runId 分 buffer）
```

### 2.3 run.delta 帧（词汇表，contracts 冻结）

```ts
// 连接内临时帧；断线不回放，由持久事件 + 最终消息/Artifact 补全（protocol.md §7）
type RunDeltaFrame = {
  v: 1;
  type: 'run.delta';
  runId: ID;
  attemptId: ID;
  seq: number;            // attempt 内单调，供前端丢帧检测
  delta:
    | { kind: 'text'; text: string }            // 助手正文增量
    | { kind: 'thinking'; text: string }        // 思考增量
    | { kind: 'tool'; phase: 'start'|'update'|'end'; toolName: string;
        callId: string; argsSummary?: string; isError?: boolean }
    | { kind: 'bash'; text: string };           // 终端输出增量
};
```

节流：daemon 侧按 attempt 聚合 text/bash 增量，30fps flush；tool start/end 立即发（状态翻转不可延迟）。

### 2.4 三条信息通道（子 Agent 信息流的呈现）

| 通道 | 数据源 | 呈现 | 恢复语义 |
|---|---|---|---|
| A 对话流（Chief） | 持久事件 message.* + stage.completed | 消息时间线 + 角色摘要卡 | 断线重连从 cursor 回放，完整 |
| B 运行流（Live Dock/Runtime） | run.delta 临时帧 + run.* 持久事件 | 运行树（Chief→子 Run）+ 选中 Run 的流区（text/thinking/工具卡/bash 块） | live 流仅属于进行中 Run；断线后该 Run 以持久消息/Artifact 水合，delta 不回放 |
| C 阶段时间线（需求详情） | run.*/stage.*/artifact.* 持久事件 | 静态时间线，历史可查 | 全量来自持久事件，无丢失 |

前端不变量：**live 流只属于进行中 Run；终态 Run 的内容一律从持久数据水合**。StreamBuffer 收到对应 Run 的 `run.ended` 持久事件即冻结并丢弃 delta 状态。

## 3. apps/webui 工程结构

### 3.0 Pi 会话持久化（D5 的落地形态）

```
~/.agentdev/projects/<projectId>/sessions/<runId>/
  attempt-1.jsonl          # 每次 Attempt 一个文件；会话轮换不混淆
  attempt-2.jsonl          # 恢复 Attempt 经 SessionManager.open(resumeFrom) 续写或新开
```

- **写入方**：Runner `createPiSession` 按 invocation 传参建会话——Attempt 1 `SessionManager.create(cwd, sessionDir)`，恢复 Attempt `SessionManager.open(sessionFile)`；`attempt.ready` 上报 `sessionFile`。
- **登记方**：supervisor 收到后写 `attempt.session_ref = {sessionId, sessionFile}`（contracts `sessionRefSchema`，字段已预留）；Checkpoint 的 `sessionRef` 轮换语义不变。
- **消费方**：UI 回放（P5）`SessionManager.open()` 读条目树按类型渲染；token 用量 = `usage` 聚合；备份随项目状态目录走。
- **不动的**：delta 实时流仍不落库；`event` 表仍只存终态事实；Review/Test 对其他 Run 会话的 ACL 拒绝在回放 API 层强制。

```
apps/webui/
  package.json          # deps: react, react-dom, @tanstack/react-query, zustand
  vite.config.ts        # base:'/assets/', build.outDir:'dist'
  src/
    api/                # ProtocolClient(浏览器直连 /ws) + REST 封装
    streams/            # StreamStore：Map<runId, Buffer>、节流、seq 校验、冻结
    models/             # 视图模型（自 contracts 推导；吸收旧 views.ts 半部）
    ui/
      tokens.css        # mock :root 原样 + --font-scale
      components/       # Badge/Chip/DataList/Dialog/Toast/StageStrip/RunTree/LogLine
      timeline/         # 对话流：Timeline、MarkdownStream、ThinkingBlock、ToolCard、BashBlock
      panels/           # 九面板：chief/ requirements/ requirement/ docs/ files/
                        #         agents/ runs/ inbox/ settings/ projects
    app.tsx             # 路由（react-router）+ QueryClient + WS provider
```

- **直接复用 `@agentdev/client`**（已验证：纯 WS/fetch、零 Node 依赖、浏览器可运行）——连接、退避重连、命令幂等键、订阅水位全部继承存量实现，约 2594 行不经重写。
- **i18n 字典复用**：存量 `i18n.ts` 的 685 行双语字典导出为共享包（`@agentdev/web-i18n` 或并入 contracts），新旧前端共用；key 不变则 AC-073 的 ARIA/i18n 语义直接继承。
- **picker/trust/clone**：纯后端行为（`/picker/list`、`project.trust`、安装级 Grant），前端只换皮。

## 4. 路由与页面（不变更协议面）

沿用 `experience.md` §1 的路由表：`/projects`、`/projects/:id/{chief,requirements,requirement/:rid,docs,files,agents,runs,inbox}`、`/settings`。SPA 路由由 BFF 回退到 `index.html`（serveAsset 增加 SPA fallback，仅对已认证 GET 且 Accept: text/html）。

## 5. 状态管理规则

| 状态 | 归属 | 示例 |
|---|---|---|
| 服务端事实 | TanStack Query | project.list、requirement.get、run.list、file.list |
| 实时流 | StreamStore（zustand） | run.delta buffer、connection state、live 计数 |
| 持久事件 | Query invalidation（WS event 帧触发） | board 列变化、inbox 未读、run 列表 |
| 本地 UI | useState/zustand 局部 | 面板三态、语言、对话框开关、Timeline 折叠态 |

写命令纪律（继承存量）：幂等键客户端生成、同一请求应答前禁用重复提交、服务端拒绝保留输入并展示 `CODE: message`、**服务端状态是完成的唯一权威**。

## 6. 无障碍与 i18n 基线（AC-071/073/074/076 继承）

- 逐面板移植时保持 ARIA 地标/名称/aria-live 语义与存量等价：`#messages`、`#liveDock`、`#connectionState`、`#composerBody` 等 id 与 aria 属性在新前端保留同名等义（浏览器套件按此断言）。
- 窄屏：Live Dock Open→可关闭覆盖层、关闭后焦点回触发按钮（AC-071 三处缺陷的修复语义原样保留）。
- 项目内容永不翻译；界面双语字典与存量同源。

## 7. 安全边界（不变项）

- 凭证不进浏览器：登录用安装凭证换 Cookie 会话；CSRF 注入表单；Origin 精确校验（BFF 既有实现）。
- 产物/文件访问：一次性下载 token、跨项目拒绝、CSP `default-src 'none'` 预览（AC-002/052）由 BFF 承担，SPA 不新增攻击面。
- Vite 构建不开 dev server 到生产；生产仅 `dist/` 静态文件。

## 8. 迁移与回退

- 灰度并存：`apps/web`（旧）继续服务；新前端在 `/assets/app-v2/` 下挂载，BFF 按配置开关选择渲染旧 SSR 或新 SPA shell。
- 切换：浏览器套件逐面板把选择器指向新 DOM（结构断言同步更新）→ 验收通过后默认路由切 v2 → 旧视图半部删除（干净切换，无过渡 shim 长存）。
- 回退：配置开关一键回旧版（旧代码在切换提交前始终可构建）。
