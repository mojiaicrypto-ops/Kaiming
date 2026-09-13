# WP-09 实现 Plan（完整Web工作台）

- planVersion: 1
- workId: WP-09
- level: L2（新增 `packages/client` 与 `apps/web`，扩展 `apps/daemon` 的 HTTP/WS 协议面；按 `docs/architecture/protocol.md`、`docs/product/experience.md`、`docs/rules/{workflow,agents}.md` 既有定义实现）
- authorization_ref: 用户目标轮次「继续」（2026-09-11）；上级授权为「我要完全实现这个产品，让你来实现」
- productRef: 无独立 Requirement；行为依据为 `docs/delivery/implementation.md` WP-09 与关联 AC（AC-068–078、AC-084、AC-087–090、AC-093）
- 依赖：WP-01/WP-03（可先行）、WP-04–WP-08（真实能力，已结算至 `d6c766b`）；基线 WP-08 结算 `d6c766b`（代码树 `7422646`）

## 1. goal

让「全部页面连接真实 Core 与 WP-04–08 能力」真实可用：BFF 提供登录/会话/Cookie 与静态 UI，WS 提供命令与订阅（含水位重连、受限重试、过期会话拒绝）；Chief 对话、看板、详情、Docs/Files、Agents、Settings、Inbox、Runs、Live 九个界面读真实协议（状态投影不复制需求、L1 不入板、Queued 无 Work 可取消、过期 Plan/大 Diff 显示版本与截断下载、面板三态与窄屏焦点、非 Chief 页面无创建切换、i18n 与 a11y、决定去重与内部修复汇总、Provider 校验保留输入、分支预览不动 Agent Snapshot、未登录/过期 Cookie/错误 Origin 拒绝、附件首条消息绑定）；失败/等待/有效版本如实显示。

**工程决定（登记）**：本仓库不引入 React 等新依赖（`pnpm-workspace` 供应链策略与「no new dependencies」约束），UI 以**零依赖静态资源 + 原生 JS** 实现并由 BFF 提供真实数据；这不影响任何 AC（AC 均以行为/协议/可访问性定义）。`webui/index.html` 仅为 Mock 参考，不作为实现依据。

## 2. scope

writePaths:

- `packages/client/**`（新增 workspace：WS 连接、命令/查询、订阅与水位、鉴权与重试）
- `apps/web/**`（新增 workspace：Fastify BFF、会话/Cookie、静态 UI、服务端渲染页面）
- `apps/daemon/**`（扩展 HTTP/WS 协议面：命令/查询/订阅，接真实 Core）
- `apps/web/public/**`（零依赖 UI 资源：页面、样式、脚本、i18n 词条）
- 各包 `test/**`（含 `*.integration.test.ts`）
- `.agentdev/work/WP-09/**`

readPaths: `docs/**`、`packages/**`、`apps/**`、`webui/**`（仅参考 Mock）
不可写：`docker/**`、`docs/**`（除结算时更新 `docs/INDEX.md`）

## 3. tasks（DAG）

| id | 角色 | goal | dependsOn | acceptanceIds |
|---|---|---|---|---|
| T1 | frontend | `packages/client`：WS 连接与重连（水位/`since` 重放、断连后受限重试）、命令调用、订阅管理（订阅扩大受 ACL/Project 约束）、Cookie/Origin/过期会话处理 | — | AC-054, AC-078 |
| T2 | backend | `apps/daemon` 协议面：命令（message.send/work.control/requirement.save/plan.approve/finding.submit/decision.resolve/config.save/config.test/backup.run/restore.run）、查询（projects/knowledge.get/work.list/work.get/requirement.list/run.list/run.get/artifact.list/inbox/agents/settings）、WS 订阅（事件水位、Project 作用域），全部接真实 Core（WP-01–08） | T1 | AC-068–078, AC-084, AC-087–090, AC-093 |
| T3 | frontend | `apps/web` BFF + 零依赖 UI：登录/Cookie/Origin 校验；九个界面（Chief/看板/详情/Docs·Files/Agents/Settings/Inbox/Runs/Live）；面板三态与窄屏焦点、非 Chief 页无创建切换、i18n 与 ARIA、决定去重与过期禁用、Provider 校验保留输入、分支预览与截断下载、附件上传与首条消息绑定、失败/等待/有效版本如实显示 | T1, T2 | AC-068–078, AC-084 |
| T4 | frontend | 端到端与必需失败测试（持续对话、过期卡片、窄屏焦点、断连、配置失败、订阅扩大）+ 独立 Review + 修复 + 独立 Test + 结算 | T1–T3 | 全部 |

### 必需失败测试（`docs/delivery/implementation.md` WP-09）

| 必需失败测试 | 归属 |
|---|---|
| 持续对话 | T3（发送消息后 Composer 可用、消息处理状态真实、Chief 路由意见） |
| 过期卡片 | T3（过期 Plan/决定禁用且显示版本，批准被拒） |
| 窄屏焦点 | T3（三态面板在窄屏的焦点顺序与顶栏恢复，不影响 Run） |
| 断连 | T1/T3（WS 断开后按水位重连补齐，写请求受限重试，后台 Work 保留） |
| 配置失败 | T2/T3（模型不支持 reasoning 或连接失败 ⇒ 清晰校验、保留输入、活动配置不变） |
| 订阅扩大 | T1/T2（跨 Project/越权订阅被拒且不泄漏） |

## 4. 接口与数据影响

- 协议按 `protocol.md`：HTTP 命令/查询 + WS 事件订阅；BFF 以 Cookie 会话（`apps/daemon` 的 `AuthService` 复用），WS 鉴权与 Origin 校验共用。
- 复用既有 Core（`ProjectStore`、`Orchestrator`、`Broker`、`ContextBuilder`、`knowledge`、`workspace`、`RequirementSaveService`、`SettlementService`、`RunRecoveryService`）；不新增表。
- 不引入新依赖（UI 为零依赖静态资源）。

## 5. 验证策略

- 单元：client 重连/水位/订阅 ACL、BFF 会话与 Origin、UI 模板渲染（ARIA/键盘/i18n/面板三态/状态文案）。
- 集成（真实 Core + 真实 SQLite + 真实 HTTP/WS）：AC-068～078、AC-084、AC-087～090、AC-093 的端到端（登录 → 页面读真实数据 → 命令写回 → 事件订阅同步）。
- 必需失败测试见上表。
- 退出：全部界面读真实协议；失败/等待/有效版本如实显示；结算与文档入口更新。
