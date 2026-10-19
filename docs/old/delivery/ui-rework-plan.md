# WebUI 整体改造计划

状态：**已冻结（v2，纳入 D5 会话持久化 / D6 重连缓冲）**。架构依据：[ui.md](../architecture/ui.md)；设计规格：`webui/DESIGN.md`（仓库根）。
本计划替代并吸收前轮讨论（无 Git 打开、样式修补、流式管线缺口），按"先整体设计 → 冻结 → 切片开发"执行。

## 0. 目标与不目标

**目标**：九面板工作台以 React 19 + Vite 8 重建于新工程 `apps/webui`；AI 流式信息在对话流真实渲染（text/thinking/工具/bash 四类 delta）；Pi 会话持久化启用（复用 Pi JSONL，不另建对话史表）；mock 设计语言 1:1；存量 AC 语义全部继承；旧视图半部最终删除。

**不目标**：不改 daemon 协议与 Schema（P1 例外：新增临时帧转发与 `session_ref` 回填）；不做移动端专项；不做多主题；不迁移"旧 SSR HTML 断言"的字面实现（迁移其语义）。

## 1. 阶段总览（依赖驱动，可部分并行）

| 阶段 | 内容 | 估时 | 依赖 | 可并行 |
|---|---|---:|---|---|
| **P0.5** | **Pi 会话持久化（先行，独立交付）** | **1-1.5d** | — | — |
| P0 | 事件词汇表冻结 | 2-3d | — | 与 P2 脚手架并行 |
| P1 | 流式管线打通 + 重连缓冲 | 3-3.5d | P0 | — |
| P2 | 新工程脚手架 + Shell 骨架 | 2-3d | — | 与 P0/P1 并行 |
| P3 | Chief 垂直切片（首个可演示交付） | 3-4d | P1+P2 | — |
| P4 | 面板批量移植（8 面板） | 8-10d | P3 | 两名开发者可拆并行 |
| P5 | 流式渲染器完备化（含 jsonl 回放源） | 4-5d | P3 | 与 P4 后半并行 |
| P6 | 切换与清理 | 2-3d | P4+P5 | — |

关键路径：**P0.5 → P0 → P1 → P3 → P4**，约 4 周（含缓冲）；P2/P5 并行压缩后约 3 周。
执行顺序按产品裁决：**P0.5 会话持久化先做**（独立价值：Run 对话史落盘、token 真值、恢复链补全），再做 UI 优化链（P0→）。

## 2. P0.5 Pi 会话持久化（1-1.5d，先行）

- Runner：`createPiSession` 接收 `sessionDir`/`resumeFrom`；Attempt 1 `SessionManager.create(cwd, sessionDir)`，恢复 Attempt `SessionManager.open(sessionFile)`；`attempt.ready` 上报 `sessionFile` 路径。
- daemon：`prepare-run` 为每 Run 分配 `sessions/<runId>/attempt-<n>.jsonl`（目录 0700）；supervisor 收 `attempt.ready` 后回填 `attempt.session_ref`（`sessionId` + `sessionFile`）。
- 恢复链：暂停/恢复走 Checkpoint 既有 `sessionRef` 轮换语义，新 Attempt 从上一 Attempt 的 jsonl `resumeFrom`。
- **验收**：集成测试——Run 结束后 jsonl 存在且含 assistant/toolResult 全量条目；`session_ref.sessionFile` 非空且路径存在；恢复 Attempt 从 jsonl 续会话（上下文延续断言）；0700 权限断言；backup 演练包含 sessions/ 目录。

## 3. P0 事件词汇表冻结（2-3d）

- `pi-runtime/events.ts`：补全 toolcall delta、`bash_execution_update`、`queue_update`、`auto_retry_*` 映射；`raw` 仅保留真正未知事件。
- `contracts`：新增 `RunDeltaFrame` Schema（ui.md §2.3）与 WS 临时帧编解码；`protocol.md` §7 的临时流契约落为可执行 Schema。
- **验收**：契约测试（帧编解码 round-trip、seq 单调、未知 kind 拒绝）；map 覆盖率测试（SDK 每个事件类型显式归位）。

## 4. P1 流式管线打通 + 重连缓冲（3-3.5d）

- supervisor：`attempt.event` → daemon 转发（按 runId 多路广播；text/bash 30fps 聚合 flush，tool start/end 立即）。
- daemon WS：`run.delta` 临时帧下发（复用现有连接认证；不落表不占 cursor）。
- **重连缓冲（D6）**：daemon 为进行中 Attempt 维护 256KB 内存环形 buffer，WS（重）连时先推快照再接 live；Attempt 终态即弃，不进 SQLite。
- **验收**：集成测试——真实 Runner 会话中，WS 客户端按序收到 text/tool/bash 帧；断线重连收到 buffer 快照后无缝接 live；`run.ended` 后帧停止且 buffer 释放；两客户端互不串台。

## 5. P2 新工程脚手架 + Shell（2-3d）

- `apps/webui`：Vite + React 19 + TS strict；vendor 无；依赖 react/react-dom/@tanstack/react-query/zustand/react-router。
- BFF：`serveAsset` 指向 `apps/webui/dist`（灰度开关，旧 SSR 默认仍服务）；SPA fallback 路由。
- Shell 三件套按 DESIGN.md §3：topbar（switcher 下拉 + ⌘K 占位）/ sidebar / statusbar；设计令牌 1:1。
- 接线：`@agentdev/client` ProtocolClient（登录、WS、订阅）+ i18n 字典共享包。
- **验收**：登录→空白九面板可导航；令牌与 mock 并排对比通过；AC-073 的 ARIA 地标在新壳等义存在。

## 6. P3 Chief 垂直切片（3-4d）★首个可演示交付

范围：对话流全链——发消息 → Chief Run 流式回复（MarkdownStream + ThinkingBlock）→ 角色摘要卡（stage.completed）→ 断线重连水合。
皮肤：mock .message/.conversation/.composer 1:1。
**验收**：真实 Provider 演示（token 级流式可见）；断线恢复用例；并排截图对比。

## 7. P4 面板批量移植（8-10d）

顺序按使用频率：看板+需求详情（board/requirement）→ Runs → Projects（含 picker/trust/clone/无 Git 状态）→ Inbox → Docs/Files → Agents/Settings。
每面板：models 接线（协议不变）→ mock 结构 1:1 → 结构断言进 CI → 并排截图。
**验收**：每面板独立 AC 清单（存量 AC-068/074/076/077/087-090 语义逐条映射到新 DOM 选择器）。

## 8. P5 流式渲染器完备化（4-5d，可与 P4 后半并行）

- Live Dock/Runtime 控制台：RunTree + 选中 Run 流区（ToolCard/BashBlock/log-line 语法）；后台 Run 帧照收不渲染、切回即全量；
- **jsonl 回放源（D5 消费端）**：终态 Run 的详情回放从 Pi 会话 JSONL 水合（消息级，含工具全输出与 usage）；Run 详情新增"对话史"视图；statusbar token 用量以 jsonl `usage` 聚合为权威；回放 API 按 Run 归属执行 ACL；
- 多路复用压测：4 并发 Run × 200 token/s，主线程无长任务（Performance API 断言）；
- 半截 Markdown 边界用例集（未闭合 fence/表格/列表中断线）。

## 9. P6 切换与清理（2-3d）

- 浏览器套件全量指向新 DOM；`pnpm test:e2e` 全绿；
- 默认路由切 v2（灰度开关翻转）；真实浏览器人工走查；
- **删除** `apps/web` 视图半部（pages/shell/views 渲染半部/app.js/styles.css 旧版）——干净切换，无 shim；
- `ARCHITECTURE.md` §2/§3 修订（webui 工程与栈描述）、`experience.md` 无需改（路由不变）。

## 10. 回归守门（全程有效）

| 门 | 内容 |
|---|---|
| 静态 | typecheck（webui 独立 tsconfig strict）/ eslint / prettier |
| 单元 | contracts 帧测试、StreamStore seq/冻结测试、models 测试 |
| 集成 | P1 管线测试；协议兼容（daemon 侧 572 用例不回归） |
| 浏览器 | 存量 24 用例逐步迁到新 DOM（AC-071/072/073/074/076/087/090 + 002/052 隔离）；新增流式专项（P3/P5） |
| 视觉 | 每面板并排截图对比（mock vs 真实），人工签认 |

## 11. 风险登记

| 风险 | 缓解 |
|---|---|
| 流式洪泛卡主线程 | daemon 节流 + 前端 buffer 上限 + 虚拟列表（P5） |
| mock 结构与协议数据错位 | DESIGN.md §6 差距表前置，实现禁止现场发明 |
| 双前端并存期行为漂移 | 灰度开关单点；浏览器套件双跑直至切换 |
| zod→TS 类型漂移 | contracts 单一来源；webui 禁止手写协议类型 |
| P1 转发影响 daemon 稳定 | 转发失败只降级为无流式（回退现有最终消息路径），绝不阻断 Run |
| jsonl 含工具读到的敏感内容 | 目录 0700 + 项目状态目录随 backup；回放 API 按 Run 归属 ACL 强制（Reviewer/Test 不见他 Run 会话）；Secret 不经模型路径，文件无密钥值 |
| 会话文件增长（长 Run） | Pi 原生 Compaction 生成自包含检查点条目，文件保持可解析；无需自行截断 |
| P3 演练中浏览器收到 0 个 run.delta 帧（Run 快速完成时订阅滞后于 Run 生命周期；订阅建立后的 live delta 路径已在协议与代码层接线并单测覆盖） | 已登记缺口：订阅建立时若 Run 已结束，回放走 Pi JSONL（P5）；live delta 到达浏览器的端到端时序验证顺延至 P5 的多路复用压测 |

## 12. 明确的顺序纪律

按产品裁决执行顺序：**P0.5 会话持久化（先行，独立交付）→ P0 → P1 → P3 切片演示 → P4 批量移植**；P2 与 P0/P1 并行、P5 后半与 P4 并行。文档已冻结（v2），再变更需修订记录；每阶段有可演示产物，不做大爆炸合并。
