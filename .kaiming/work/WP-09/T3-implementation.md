# WP-09 / T3 实现记录：`apps/web`（BFF 与完整工作台 UI）

- task: T3（frontend）
- planVersion: 1（`.agentdev/work/WP-09/plan.md`）
- 状态：Developing 完成（等待独立 Review/Test）
- 关联验收：AC-068–078、AC-084（本片声明）；AC-071/072/073 的跨页一致性一并覆盖

## 1. 交付范围

| 文件 | 内容 |
|---|---|
| `apps/web/package.json`、`apps/web/tsconfig.build.json` | 新增 workspace `@agentdev/web`（依赖 `@agentdev/client`、`@agentdev/contracts`、`@agentdev/core`，无第三方依赖） |
| `apps/web/src/app.ts` | BFF：会话/Cookie、Origin 校验、`/rpc` 代理、`/ws` 升级、`/artifacts/*` 透传、`/assets/*` 静态资源、九个页面路由与真实协议读取 |
| `apps/web/src/sessions.ts` | BFF 自有内存会话（`agentdev_web` 随机 id）、`HttpOnly; SameSite=Strict` Cookie、精确 Origin 判定、daemon 会话复验 |
| `apps/web/src/daemon.ts` | daemon 客户端（`forwardRpc`/`daemonRead`/`daemonLogin`/`daemonLogout`）、RFC6455 服务端帧编解码、每个浏览器 socket 一条 daemon socket 的桥（请求 id 双向映射 + 订阅水位 + 有界重连） |
| `apps/web/src/files.ts` | 只读文件端口（`file.list`/`file.read` 语义）、根边界、截断/二进制判定、真实 revision 标签 |
| `apps/web/src/views.ts` | 九个界面的真实投影（看板、Inbox 去重、Plan 版本、Run 状态、附件限额、Live 事件） |
| `apps/web/src/shell.ts` | 共享 Project Shell：导航、顶栏、Live Dock 三态、面板模式机制、非 Chief 页归属 |
| `apps/web/src/pages.ts` | 九个页面的服务端 HTML（ARIA、键盘顺序、状态如实显示、项目内容转义且不翻译） |
| `apps/web/src/html.ts`、`apps/web/src/i18n.ts` | 转义/文档渲染；220 条界面词条（en/zh），`data-i18n`/`data-i18n-aria`/`data-i18n-project` 约定 |
| `apps/web/public/app.js`、`apps/web/public/styles.css` | 零依赖浏览器脚本与样式（协议写入、面板三态、语言切换、ARIA、窄屏覆盖层） |
| `apps/web/test/*.test.ts`、`apps/web/test/server.integration.test.ts` | 4 个测试文件、95 个用例（78 unit + 17 integration） |
| 根 `tsconfig.json`、`vitest.config.ts`、`eslint.config.js` | `@agentdev/web` paths/alias；`apps/web/public/*.js` 的浏览器 globals |
| `pnpm-lock.yaml` | `apps/web`（及 T1 的 `packages/client`）importer 记录 |

## 2. 工程决定（登记）

1. **不引入新依赖**（无 React、无 Fastify、无 `ws`）：BFF 用 `node:http`，WS 服务端按 RFC6455 手写帧编解码，UI 为零依赖静态资源 + 原生 JS。计划文档建议的 Fastify/React 以 Node 内建与静态资源等价实现，AC 均以行为/协议/可访问性定义，不受影响。
2. **BFF 拥有浏览器会话，浏览器不持有 daemon 凭证**：登录把安装令牌换成 daemon 会话，daemon cookie 与 CSRF 只留在 BFF 内存；浏览器只拿 `agentdev_web`（随机 32 字节）。因此“未登录/过期 Cookie/错误 Origin 拒绝”是服务端判定（AC-078），BFF 重启只要求重新登录，后台 Work 不受影响。
3. **写入双重校验**：BFF 先按精确 Origin 白名单拒绝跨站写，再用服务端会话向 daemon `AuthService.authenticate` 复验（`isWrite`/CSRF/origin 用 daemon 自己的 Origin），daemon 仍是权威。
4. **`/ws` 每浏览器 socket 一条 daemon socket**：请求 id 双向映射（浏览器保留自己的 id），订阅按 `batch_end.scannedThrough`/事件 cursor 记录水位，daemon 断线按 1s→30s 有界退避重连并带 `afterCursor` 重订阅；daemon `1008`（过期会话/拒绝 Origin）按 `AUTH_EXPIRED` 关闭且不重试。
5. **files 面在 BFF 内实现**：`apps/daemon/src/protocol.ts` 未实现 `file.list`/`file.read`（见 §5 残余）。为不伪造数据，`apps/web` 以只读端口读取项目根内的真实文件（manifest 中的 revision 标签来自 Project 行），根边界、截断与二进制判定均在此层可测。
6. **Plan 版本取自 Plan 产物**：`plan.approve` 需要 `PlanDraft` 与服务端核对的 `authorizationRef`，工作台协议没有“读取当前 Plan 正文”的查询；详情页因此以 gate 自身写出的最新 `plan` 产物版本作为“当前版本”，使过期卡片在点击前可见（AC-070），批准请求沿用该版本与 `expectedVersion`。

## 3. 关键行为与依据

- **AC-068**：看板身份恒为 Requirement id（`data-identity`），L1/assist Work 由 daemon 排除并在页面显式说明；Queued 无 Work 卡片给出直接取消，Pause 标记 `data-refused="INVALID_STATE"`；冻结状态显示真实 `saveState`/blocker/decision 计数。
- **AC-069**：Composer 在全部阶段可用；消息状态按 `received/processing/processed/failed/decision_required` 渲染，发送后不推断完成；意见经 Chief 路由（Work 归属由 daemon 决定）。
- **AC-070**：详情页显示 Plan 当前/请求版本；过期时禁用批准并给出原因；批准冲突（`VERSION_CONFLICT`）就地刷新版本；产物卡片显示版本、`isLatest`、有效期与截断提示 + 一次性 token 完整下载。
- **AC-071**：`#shell[data-panel-mode]` 承载 Open/Compact/Hidden，顶栏按钮按 Open→Compact→Hidden 循环并恢复上次模式；窄屏下 Open 为可关闭覆盖层，关闭后焦点回到同一顶栏按钮；切换面板不发任何请求。
- **AC-072**：仅 Chief 渲染新建/切换对话控件；其他页面只有携带对象引用的 `Discuss in Chief` 深链。
- **AC-073**：导航/按钮/表单均为原生可聚焦元素，顶栏控件在 DOM 顺序上先于面板；`aria-current`/`aria-label`/`aria-live`/`role=group|alert|status`；语言切换只改 `data-i18n`/`data-i18n-aria` 元素，`data-i18n-project` 子树保持原文。
- **AC-074**：Inbox 决策按 `targetRef.id + version` 去重，过期决定保留可见但按钮 disabled，内部修复按 Work+severity 汇总计数。
- **AC-075**：设置页显示活动 revision 与编辑器；保存被拒时保留 textarea 原文并显示协议码与原因；`config.test` 对不可用 Profile 返回清晰拒绝；Provider 列表只显示 `secretConfigured`，不回显密钥。
- **AC-076**：Composer 先按 5/20 MiB/50 MiB/白名单本地拒绝（与服务端同表），服务端再次拒绝且不残留引用。
- **AC-077**：文件页显示交付分支与目标 revision，路径限定在项目根内（`..`/绝对路径拒绝并给出 `NOT_FOUND`），搜索按路径过滤，只读读取不触碰任何快照。
- **AC-078**：未登录写 401、错误 Origin 写 403、过期 daemon 会话 401 且清除 BFF 会话、退出后旧 Cookie 立即失效；三种拒绝都不断开后台 Work；WS 升级同样要求会话与 Origin，事件按水位重连补齐。
- **AC-084**：附件先上传得到 staged id，首条消息在 daemon 事务内绑定到新 Work；重复绑定被拒；失败上传不产生记录，草稿保留可重试。

## 4. 测试与证据

命令（全部在仓库根、`export PATH="$HOME/.local/bin:$PATH"` 下执行）：

| 文件 | 用例 | 覆盖 |
|---|---|---|
| `test/views.test.ts` | 31 | 看板身份/列/暂停拒绝、Inbox 去重与修复汇总、Plan 过期与产物版本、Run 成功判定、附件限额、文件根边界 |
| `test/pages.test.ts` | 32 | ARIA/标签/键盘顺序、i18n 词条齐全且双语、面板三态属性、非 Chief 无创建切换、各页面真实状态渲染（过期/截断/禁用/无 Provider） |
| `test/server.test.ts` | 15 | 会话过期与清理、Cookie 属性、Origin 精确匹配、`/rpc` 代理（只带 daemon cookie）、未登录/错误 Origin/无 Origin 写拒绝、过期会话与退出失效、登录拒绝、首页登录页、静态资源与穿越拒绝、`/healthz` 不泄漏路径 |
| `test/server.integration.test.ts` | 17 | 真实 daemon（真实 SQLite/Core/WS）：登录→看板→详情→批准→事件一条链、过期 Plan 拒绝且 Work 继续、附件上传/绑定/拒绝、文件目标 revision 与根边界、配置拒绝保留输入且 revision 不变、Provider 不可用、Inbox 去重、未登录与错误 Origin 写拒绝、退出后 Cookie 失效、面板模式跨页与非 Chief 归属、zh 页面、WS 事件水位与重连补齐、未认证升级拒绝 |

命令结果：

```
node_modules/.bin/prettier --write apps/web eslint.config.js tsconfig.json vitest.config.ts
  → All matched files use Prettier code style!
pnpm install --offline
  → Scope: all 13 workspace projects / Already up to date / Done
pnpm typecheck                                    → 退出 0（strict，无错误）
pnpm lint                                         → 退出 0（ESLint + Prettier check）
pnpm test:unit                                    → 54 文件 / 1096 用例通过
pnpm test:integration                             → 23 文件 / 277 用例通过
pnpm build                                        → apps/web 与其余 12 个 project 全部 Done
```

## 5. 残余与未做（可能需超出本片写权限）

1. **`conversation.create` 未实现**：Chief 顶栏/对话栏的“新建对话”控件已按 AC-072 只出现在 Chief，但 `apps/daemon/src/protocol.ts` 的 dispatch 没有 `conversation.create`，点击会得到 `NOT_FOUND`。属 T2 协议面缺口，未越权修改。
2. **`requirement.archive/restore` 未实现**：看板归档动作因此未渲染（避免出现必然失败的按钮）；`work.control` 的 pause/resume/cancel 已可用。
3. **`file.list`/`file.read` 未实现**：见 §2.5，本片以 `apps/web/src/files.ts` 只读端口实现文档化行为；若 T2 后续在 daemon 增加同名方法，BFF 只需把端口换成协议调用。
4. **Queued 取消在测试 daemon 上不返回成功**：`cancelRequirement` 需要 `RequirementSaveService`（Git 记录服务），T2 的 `WorkbenchProtocol` 装配未提供该依赖，负例返回 `INVALID_STATE` 而非静默成功；真实 Git 记录路径由 WP-08 覆盖，本片按“绝不伪造成功”处理。
5. **Plan 正文未展示**：协议没有“读取当前 Plan 正文”的查询，详情页只呈现版本与批准状态，不从别处拼造正文（见 §2.6）。
6. **未做**：`ui.translate` 词条仍由 BFF 自己的字典渲染（daemon 的 `ui.translate` 供浏览器按需覆盖）；事件流的临时 `log.delta`/`token.delta` 只随事件面板展示，不做 Artifact 补全。
7. **未越权修改**：`apps/daemon/**`、`packages/client/**`、`packages/core/**`、`docs/**` 均未改动（工作区中 `apps/daemon/src/server.ts`、`apps/daemon/src/protocol.ts`、`apps/daemon/test/**`、`packages/client/**` 的改动来自 T1/T2）。
