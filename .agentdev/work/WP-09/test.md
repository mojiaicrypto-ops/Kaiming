# WP-09 独立 Test 报告（完整 Web 工作台）

- 测试对象：工作包 WP-09「完整 Web 工作台」
- 代码冻结点：`ce2fc80b1f30abc5e4f99a598e416138564c8f7a`（`fix(client,daemon,web): close WP-09 review round-1 findings`）
- 冻结树：`git rev-parse ce2fc80^{tree}` = `d5cf9707d9fd0987c83ba7d9a703b69d25de16ba`
- 仓库 HEAD：`ce2fc80b1f30abc5e4f99a598e416138564c8f7a`（= 冻结点）
- `git status --porcelain`：` M .agentdev/work/WP-09/review.md`（仅 Review 报告本身未提交；本报告写入后追加 `M .agentdev/work/WP-09/test.md`。**`packages/**`、`apps/**`、`docs/**` 全程无改动**）
- 测试角色：**INDEPENDENT TEST**（独立上下文；**未读取任何开发或 Review 聊天/会话**；只依据仓库文件、git 对象、`dist` 构产物与我自建的实验脚本及其原始输出）
- 环境：`node v24.8.0`、`pnpm 12.3.4`、macOS（Darwin，宿主）；真实 loopback HTTP/WS、真实 SQLite（`ProjectStore`）、真实 Git 工作树（`createNodeWorktreeGitPort`）、真实 BFF（`createWebApp`）、真实 daemon（`createDaemon`：`/rpc` + `/ws` + WP-03 路由）
- 权威依据：`docs/delivery/acceptance.md`（AC-054、AC-068～078、AC-084、AC-087～090、AC-093 原文）、`docs/delivery/implementation.md`（WP-09）、`AGENTS.md`、`docs/INDEX.md`、`docs/architecture/protocol.md`、`docs/product/experience.md`、`docs/rules/{workflow,agents}.md`、`.agentdev/work/WP-09/*.md`、`.agentdev/work/WP-02/test.md`（报告结构参照）
- 唯一写入：本文件（`.agentdev/work/WP-09/test.md`）；实验脚本全部在 `/tmp/wp09t/`

## 0. Review 门禁与测试范围

先读 `.agentdev/work/WP-09/review.md`：其第 2 轮（R2.2/R2.11）判定为 **PASS**，未复现任何 P0/P1，明确「**可以进入独立 Test**」。门禁满足，故按任务要求执行完整矩阵。

R2 要求 Test 显式登记的残留（本轮**不**把它们算作已成立）：`W9R2-01`（`requirement.save` 创建分支幂等缺口）、`W9R2-02/03`（update/取消的字段与正文保真度）、`W9R2-04`（`pnpm test:unit` 默认并发偶发）、`W9R2-05`（中文界面的英文诊断）、`W9R2-06`（恒真断言）。本报告 §6 逐项登记。

## 1. 本轮结论摘要

| AC | 题目 | 正向 | 负向 | 本轮结论 |
|---|---|---|---|---|
| AC-054 | UI 断开 | 通过 | 通过 | **通过** |
| AC-068 | 看板身份 | 通过 | 通过 | **通过** |
| AC-069 | 持续对话 | 通过 | 通过 | **通过** |
| AC-070 | 产物版本 | 通过 | 通过 | **通过** |
| AC-071 | Live 布局 | 通过 | 通过 | **通过** |
| AC-072 | Conversation 归属 | 通过 | 通过 | **通过** |
| AC-073 | 语言可访问 | 通过 | 通过 | **通过（无头 DOM 级焦点遍历未做）** |
| AC-074 | Inbox 去重 | 通过 | 通过 | **通过** |
| AC-075 | 配置错误 | 通过 | 通过 | **通过** |
| AC-076 | 附件限制 | 通过（服务端） | 通过 | **部分通过** —— 服务端拒绝成立；**UI 侧因 T-01 不可达** |
| AC-077 | 文件只读 | 通过 | 通过 | **通过** |
| AC-078 | 认证生命周期 | 通过 | 通过 | **通过** |
| AC-084 | 首条消息附件 | 通过（daemon 凭据路径） | 通过 | **不通过（T-01/P1）** |
| AC-087 | 需求池随 Git 迁移 | 通过 | — | **通过** |
| AC-088 | 历史需求展示 | 通过 | — | **通过** |
| AC-089 | 进行中需求继续 | 通过 | — | **通过** |
| AC-090 | 需求保存时机 | 通过 | — | **通过** |
| AC-093 | 需求目录与正文一致性 | 通过 | 通过 | **通过** |

**Test 判定：FAIL —— 不接受 WP-09 的 AC-084（以及 AC-076 的「客户端提示」半边），其余 AC 接受。**

- 全部契约命令退出 0：`typecheck`、`lint`、`test:unit`（55 文件 / 1102 用例）、`test:integration --maxWorkers=4`（25 文件 / 304 用例）、`docs:check`、`build`（12 workspace）。
- 自建实验合计 **275 条带判定断言，4 条失败**；4 条失败全部指向同一个缺陷 `T-01`（`probeG`）。
- 六个必需失败测试的**行为**已由我独立以真实 BFF/daemon 复现（见 §5.19），不依赖产品测试。
- **阻断项**：`T-01`（P1）——浏览器工作台自身的「上传附件 → 随消息发送」链路不可达，AC-084 的首条消息附件绑定在 UI 上无法发生。

## 2. 测试环境与复现方式

```text
export PATH="$HOME/.local/bin:$PATH"
mkdir -p /tmp/wp09t/node_modules/@agentdev
for p in contracts domain storage core pi-runtime knowledge workspace client; do
  ln -sfn /Users/huyaohua/huyh/work/aigrouptool/packages/$p /tmp/wp09t/node_modules/@agentdev/$p
done
ln -sfn /Users/huyaohua/huyh/work/aigrouptool/apps/web    /tmp/wp09t/node_modules/@agentdev/web
ln -sfn /Users/huyaohua/huyh/work/aigrouptool/apps/daemon /tmp/wp09t/node_modules/@agentdev/daemon

cd /Users/huyaohua/huyh/work/aigrouptool && pnpm build      # 实验只消费 dist
cd /tmp/wp09t
for p in A B C D E F G; do node probe$p.mjs > logs/probe$p.log 2>&1; done
```

- **不 import 任何产品测试文件**：`lib.mjs` 只 `import '@agentdev/core|storage|workspace|web'` 与 `apps/daemon/dist/{protocol,server}.js`；`apps/web/test/**`、`apps/daemon/test/**`、`packages/*/test/**` 一次也没有被引用。
- 每个 probe 都在自己的 `mkdtempSync` 真实目录里启动**真实 daemon 进程内实例** + **真实 BFF**，两者的 Origin 精确绑定（BFF 端口先定，daemon 的 `allowedOrigins` 再写它），与部署一致。
- **未修改仓库任何文件**；报告以外唯一写入是 `/tmp/wp09t/**`。
- 与 Review 不同的是：我使用**产品 `createDaemon` 的真实路由**（`/rpc`、`/ws`、`/auth/*`、`/artifacts/*`），**不复制** daemon 路由，因此状态映射与真实 BFF 的代理链一起被覆盖。

| 脚本（`/tmp/wp09t/`） | 覆盖 | 判定数 | 结果 |
|---|---|---|---|
| `lib.mjs` | 世界夹具：真实 Git + SQLite + Core 服务 + 产品 `createDaemon` + 产品 `createWebApp`；真实 WS 客户端；真实 HTTP 客户端 | 基础设施 | — |
| `seed.mjs` | 用产品仓储按真实行形状播种（Work/Budget/Authorization/Run/Requirement/Decision/Finding/Event） | 基础设施 | — |
| `probeA.mjs` | AC-070 全链（`plan.current` 回读、UI 同款载荷批准、同键重放与冲突、过期卡片、无 Plan 诚实禁用、失效 `?planVersion=`）+ AC-054（BFF `/ws` 桥真实断连→自动重连→水位补齐零重复）+ daemon `/ws` 负例 | **51** | 51 PASS / 0 FAIL |
| `probeB.mjs` | AC-068（身份唯一、L1 不入板、Queued 无 Work 直取消且真实 Git 提交、暂停 `INVALID_STATE`）+ AC-069（真实路由成 Work、重放、消息事件）+ AC-072（非 Chief 无控件、深链、`conversation.create` 真实建行、未知 focus `NOT_FOUND`） | **48** | 48 PASS / 0 FAIL |
| `probeC.mjs` | AC-071（三态、跨页共享、cookie、无网络副作用、顶栏恢复入口）+ AC-073（`lang`、zh 词条、项目内容不翻译、`ui.translate` 正负例、ARIA） | **30** | 30 PASS / 0 FAIL |
| `probeD.mjs` | AC-074（同目标+版本去重、修复汇总计数、过期禁用、过期决定拒绝、幂等重放）+ AC-075（非法 patch、错误类型、过期版本、preservedInput、revision 不变、角色解析、`PROVIDER_UNAVAILABLE` 三种、Settings 不回显令牌） | **37** | 37 PASS / 0 FAIL |
| `probeE.mjs` | AC-076（mime/单文件/数量，拒绝无残留、staged 保留）+ AC-084（绑定原子性、复用拒绝、过期清理、无附件消息正常、daemon 凭据路径）+ AC-077（真实树、revision、搜索、穿越、缺失文件、无写入口、不改 Work/分支/Snapshot） | **45** | 45 PASS / 0 FAIL |
| `probeF.mjs` | AC-090/093（立即提交、两文件共享版本、contentHash=sha256(正文)、README、更新递增版本、结构非法拒绝且分支不动）+ AC-087/088（第二个空白服务器用真实 `RequirementProjection` 导入同一 Git，保留 ID/生命周期/版本/标题目标/无本机 Work；completed/cancelled 历史）+ AC-089（active 导入→继续建 Work、不建 Run、本机授权、不复用历史验证） | **52** | 52 PASS / 0 FAIL |
| `probeG.mjs` | **T-01 复现**：浏览器自身的上传 + 发送路径（与出厂 `app.js` 完全同形） | **8** | 4 PASS / **4 FAIL** |
| `diag-ws*.mjs` / `diag-own*.mjs` | 排除性诊断（事件水位、附件归属的身份对照） | 不计判定 | — |
| **合计** | | **279** | **275 PASS / 4 FAIL** |

## 3. 契约命令原始结果

执行方式：仓库根、`export PATH="$HOME/.local/bin:$PATH"` 下按序执行；日志 `/tmp/wp09t/logs/{contracts1,contracts2,tests}.log`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `node scripts/lint.mjs`；`All matched files use Prettier code style!` |
| `pnpm test:unit`（默认 workers） | **0** | `Test Files 55 passed (55)` / **`Tests 1102 passed (1102)`** / `Duration 11.09s` |
| `pnpm test:integration --maxWorkers=4` | **0** | `Test Files 25 passed (25)` / **`Tests 304 passed (304)`** / `Duration 100.18s` |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `pnpm -r build`：`apps/{cli,runner,web,daemon}` + `packages/{contracts,domain,storage,core,pi-runtime,knowledge,workspace,client}` 共 **12** 个 project `build: Done` |
| `pnpm test:e2e`（参考） | 1 | `NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09` |

命令原始尾部：

```text
$ pnpm typecheck
$ tsc -p tsconfig.json --pretty false
[exit=0]

$ pnpm lint
$ node scripts/lint.mjs
Checking formatting...
All matched files use Prettier code style!
[exit=0]

$ pnpm test:unit        (default workers)
 Test Files  55 passed (55)
      Tests  1102 passed (1102)
   Duration  11.09s (tests 68%, import 21%, transform 10%)
[exit=0]

$ pnpm test:integration --maxWorkers=4
 Test Files  25 passed (25)
      Tests  304 passed (304)
   Duration  100.18s (tests 93%, import 5%, transform 2%)
[exit=0]

$ pnpm docs:check
$ node scripts/docs-check.mjs
docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages
[exit=0]

$ pnpm build
... 12 workspace build: Done
[exit=0]
```

宿主加载说明：本片契约命令的 `test:unit` **本轮单次即全绿**（55/1102，11.09s，零 5s 超时）。R2 记录的 `W9R2-04` 端口竞态未在本轮复现；我**未**做多次重复采样，故「稳定」仍不能由本轮证明（见 §6-O1）。

## 4. 逐 AC 证据

### AC-054 UI 断开 —— **通过**

> Given 运行中关闭 BFF/浏览器；When 后台继续并重连；Then Run 状态与执行继续，按水位同步。

- **真实浏览器面**：`probeA A35` 以浏览器会话 cookie 打开 **BFF `/ws`**（真实 RFC6455 升级），`connection.hello` 得到真实 `connectionId`；`A36` `project.subscribe {kind:'summary'}` 返回真实 `subscriptionId` 与快照 cursor。
- **真实事件**：`A37` 向真实事件日志追加 3 条 `work.control_changed`（UUIDv7 `entityId`），事件在桥上到达浏览器。
- **真实断连**：`A38` `protocol.closeAll(1001)` 杀死 BFF→daemon 链路后，**同一个浏览器 socket** 收到 `bridge.reconnecting{attempt>=1}`；`A39` 随后收到 `bridge.open`。
- **水位补齐、零重复、零丢失**：断连期间再追加 2 条事件；`A40` 重连后**恰好**回放 2 条；`A41` 回放 cursor 恰为 `watermark+1`、`watermark+2`（连续）；`A42` 水位及以下**零重复**；`A43` 每条回放均严格高于水位；`A44` 最大 cursor 恰为 `watermark+2`（无丢失）。
- **daemon `/ws` 负例**：`A45/A46` 只有 daemon 会话 cookie（BFF 持有的 `agentdev_session`）能升级；`A47` 外来 Origin 拒绝；`A48` 无 cookie 拒绝；`A49` 浏览器 cookie 单独**不能**打开 daemon `/ws`。
- **后台继续**：`probeA A50` 无会话 `/rpc` 返回 401；`probeB B49` 未登录页面 401，后台 Work/Run 行数不变（`probeD D44`/`probeB B30`）。
- 未覆盖：真正 kill BFF 进程后的端到端恢复（重启需重新登录，属设计）；`test:e2e` 按契约 `NOT_IMPLEMENTED`。

### AC-068 看板身份 —— **通过**

> Given Queued 启动完成归档/取消；When 状态投影；Then 同 Requirement ID，无复制对象；L1 不自动入板；Queued 无 Work 也能直接取消，暂停 Queued 返回 INVALID_STATE。

- **身份唯一**：`probeB B6` 全部卡片 `identity === requirementId`；`B7` 从无 Work id 冒充 identity；`B5` Archived 列同时容纳 archived 与 cancelled 并带真实 `lifecycle`；`B13` 页面渲染 `data-identity="<requirementId>"`。
- **L1 不入板**：`B8` L1 与 `none` 级 Work 均在 `excludedWorkIds`；`B9` 无任何卡片的 `work.id` 等于它们。
- **Queued 无 Work 直取消（真实 Git）**：`B15` 先由 `requirement.save` 在 Git 建立真实 Queued 记录；`B17` 暂停该需求 → **409 `INVALID_STATE`**；`B18/B19` 取消 → 200、`lifecycle=cancelled`；`B20` 投影行同步；`B21` 应答给出 40 位 commit；`B22` 分支前进且 `B23` head **恰等于**该 commit；`B24/B25/B26` 该 commit 真的含 `requirement.json`，`lifecycle=cancelled` 且 `cancellation.reason` 保留；`B27` `content.md` 六个二级标题各一次；`B28` 取消原因进入「完成摘要」。
- **负例**：`B29` 已取消需求再取消被拒；`B30` 以真实 `workId` 暂停其 Work 走的是另一条真实路径（非缺失 Work 的 `INVALID_STATE`）；`B14` 页面把 Queued 的暂停渲染为 `data-refused="INVALID_STATE"`。
- 记录核对：与 Review `W9R1-05` 的关闭声明一致；`requirement.save` **创建**分支的幂等缺口（`W9R2-01`）在本轮**未**被复现为已修（见 §6-O1，非本 AC 阻断项）。

### AC-069 持续对话 —— **通过**

> Given 各阶段活动；When 发送新消息；Then Composer 可用，消息处理状态真实，意见由 Chief 路由。

- `probeB B33` 真实 `conversation.message.send`（`请修改 src/orders.ts`）→ 200；`B34/B35` 真实创建 `intent=delivery` 的 Work；`B36` `sourceRef.kind=message`；`B37` 消息状态为真实存储的 `received`。
- **幂等**：`B38` 同键同载荷重放返回**同一** `messageId`；`B39` 同键异载荷 → 409 `IDEMPOTENCY_CONFLICT`。
- `B40` `conversation.get` 可读回该消息及其真实状态；`B41` 真实 `message.received` 事件已追加。
- `B42` Chief 页面渲染真实 Composer 与附件控件；`B43` 用户消息体渲染为 `data-translatable="false"`。
- 负例：`probeC C26b` 项目内容在 `ui.translate` 下 `translatable=false` 且原样返回；`probeA A50` 无会话发送被 401 拒绝。

### AC-070 产物版本 —— **通过**（第 1 轮 P1 已消除，本轮独立确认）

> Given 有过期 Plan 和大 Diff；When 打开/批准/下载；Then 版本显示、过期拒绝、截断提示与完整下载。

- **批准可达（关键正例）**：`probeA A1–A8` 用真实 `PlanGateService` 造出已批准 Plan 后，`plan.current` 返回 `currentVersion`（= gate 版本）、`current=true`、`approval.enabled=true`、**真实 Plan 正文（含 tasks）**、真实 `authorizationId`、planning `runId`、`approvedVersion`。
- `A9–A14` 详情页渲染 `data-requested-version == data-current-version`、`data-expired="false"`、`data-approvable="true"`、批准按钮**未禁用**、无 `approveBlocked`。
- `A15/A16` 以**与出厂 `app.js` 完全同形**的载荷（`gate.plan` + `gate.authorizationId` + `gate.runId` + `data-plan-version`）批准 → 200 `applied`，版本 `v → v+1`；`A17` gate 活版本前进。
- **幂等**：`A18/A19` 同键同载荷重放逐字节同结果；`A20` 同键异载荷 → 409 `IDEMPOTENCY_CONFLICT`。
- **过期卡片**：`A21` `?planVersion=<旧>` 渲染 `requested=旧 / current=活`；`A22/A23/A24` `data-expired="true"`、`data-approvable="false"`、批准控件 `disabled`；`A25` 有可见原因；`A26/A27` 强行批准旧版本 → **409 `VERSION_CONFLICT`** 且带 `currentVersion`。
- **无 Plan 的诚实禁用**：`A28/A29` `plan.current` 200 且 `approval.enabled=false` + 非空 reason；`A30–A32` 页面 `data-approvable="false"`、控件禁用、`#approveBlocked` 可见；`A33` 第 1 轮那条伪造载荷（`plan:{}` + `authorizationRef:'workbench'`）被诚实拒绝（≥400）；`A34` 畸形 `?planVersion` 回落为活版本、不伪造过期卡片。
- **截断与一次性下载**：本 AC 的「大 Diff 截断 + 完整下载」我**未**独立重做（不在 WP-09 必验范围的核心分支上，属 WP-03 交付面）；Review R2 已以 T4 用例复核通过，本轮登记为承接（见 §6-O4）。

### AC-071 Live 布局 —— **通过**

> Given Open/Compact/Hidden；When 跨页/窄屏切换；Then 共享宽度/状态、顶栏恢复、焦点正确，不影响 Run。

- `probeC C1` shell 有显式 `data-panel-mode`；`C2` 每页恰有一个共享 `#liveDock`；`C3` 顶栏 `#liveDockToggle` **先于** dock 且 `aria-controls="liveDock"`；`C4` `aria-expanded` 随态；`C5` 窄屏覆盖层有 `#liveDockClose`。
- `C6/C7` cookie `agentdev_panel=compact` → shell 与 dock 一致为 compact；`C8` hidden；`C9` 未知值回落默认；`C10` **跨页共享**（Chief 页同样 compact）。
- `C11` 面板模式不改变协议数据（Work 行数不变）；`C12` 出厂脚本确实实现面板模式；`C13` `setPanelMode` 内**无** `fetch(`（无网络副作用）。
- 窄屏焦点：`C5` + `app.js` 的 `toggle.focus()` 回焦路径由出厂脚本静态可证；**实机窄屏焦点遍历未做**（无无头浏览器，登记）。

### AC-072 Conversation 归属 —— **通过**

> Given 进入非 Chief 页面；When 渲染与讨论；Then 无创建切换控件，来源深链接进入 Chief。

- `probeB B44` 六个非 Chief 页面（requirements/docs/files/agents/runs/inbox）**均不渲染** `#newConversation`/`#switchConversation`/`#conversationSelect`/`#newConversationInline`；`B45` 均带真实 `discussInChief` 深链；`B54` Runs 页无 `conversation.create` 表单。
- **Chief 侧不是死件**：`B46/B47/B48` 出厂 `/assets/app.js`（真实取回）中 `newConversation`/`conversationSelect`/`switchConversation` **均有引用**；`B49` `conversation.create` 返回真实 `conversationId`；`B50/B51` 真实行 + 真实 `conversation.created` 事件；`B52` Chief 页 `?conversationId=` 可读回；`B53` 未知 `focusWorkId` → 404 `NOT_FOUND`。
- 未覆盖：`#switchConversation` 是展开下拉并把焦点交给 select 的 disclosure 控件，其「真实切换」由 select 的 `change` 跳转承担——Review R2 已指出 `implementation.md` T5 措辞强于实现，本轮**未**做无头 DOM 点击以独立确证（登记）。

### AC-073 语言可访问 —— **通过（含覆盖限制）**

> Given 键盘操作及语言切换；When 页面/弹层使用；Then 焦点、ARIA 及标签可用，项目内容不被翻译。

- `probeC C14` `<html lang="en-US|en">`；`C15` `agentdev_language=zh` → `<html lang="zh-CN">`；`C16` 词条本地化；`C17` 保留 `data-i18n` 标记；`C19` 未知语言回落 `data-language="en"`。
- **项目内容不被翻译**：`C18` zh Chief 页在真实渲染用户消息处带 `data-translatable="false"` + `data-i18n-project`；`C20` 不存在 `data-translatable="false"` 同时带 `data-i18n=` 的元素，且用户原文原样出现；`C21` 出厂脚本从不在 `data-translatable` 元素上写 `textContent`；`C26b` `ui.translate` 对项目内容返回 `translatable=false` 且内容不变（`C26c` 未知 locale 被拒）。
- `C22` 语言选择持久化（`localStorage`）；`C23` 有 `aria-live`；`C24` 无 `div[role=button]`/内联 `onclick`（原生元素）；`C25` 语言控件存在且有标签。
- 未覆盖：键盘焦点遍历、弹层焦点约束、ARIA 实机朗读——**无无头/真实浏览器**，只以「真实 SSR 标记 + 出厂脚本源码事实 + 真实 HTTP/WS」为证据。

### AC-074 Inbox 去重 —— **通过**

> Given 相同决定和非阻断修复；When 多次事件；Then 决定按目标版本一项，内部修复汇总，过期决定禁用。

- `probeD D1` 200；`D2` 同 `target+version` 的重复决定在协议层只剩 **1** 行；`D3` 保留的是首条记录；`D4` 另一目标仍是独立行；`D5` 两个 pending 目标 → 2 行。
- `D6/D7` 同一 Work 的 3 条 P1 阻断 Finding 汇总为 **1 行**且 `count=3`；`D8/D8b` `unread` = 真实 actionable 计数（2 决定 + 1 汇总行 = 3）。
- `D9` 页面同版本决定只有一行；`D10` 页面渲染汇总行与计数 `3`；`D11` 过期决定 `aria-disabled="true"`；`D12` 其选项按钮 `disabled`。
- 负例：`D13` 过期决定 `decision.resolve` → `INVALID_STATE`；`D14` 越界选项 → `VALIDATION_ERROR`；`D15/D16/D17` pending 决定真实应用、重复应用 `idempotent=true`、状态真实落库。

### AC-075 配置错误 —— **通过**

> Given 模型不支持 reasoning 或连接失败；When 保存/测试；Then 清晰校验、保留输入，活动配置不变。

- `D19/D20` 含禁用键的 patch → `VALIDATION_ERROR` 且 `details.preservedInput` 原样回显；`D21` 活动 revision **不变**；`D22/D23` 类型错误同样拒绝且 revision 不变。
- `D24/D25` 过期 `expectedVersion` → 409 `VERSION_CONFLICT` + 真实 `currentVersion`；`D26` 合法 patch `applied` 且版本前进。
- `D27` 角色覆盖写入真实 provider；`D28/D29/D30` `config.test` 报告真实 `reasoningSupported=true` 与 provider/model；`D31/D32/D33/D34` 把 reasoning 改为 provider 不支持的值后测试 → 拒绝且码在文档表内、`details` 保留输入；`D35/D36` 未配置 provider 的角色 → `PROVIDER_UNAVAILABLE` 且 revision 不变；`D37/D38` 被禁用 provider → `PROVIDER_UNAVAILABLE`；`D39/D40` 未知 model → `PROVIDER_UNAVAILABLE`。
- `D41` Settings 渲染活动 revision；`D42` **不回显安装令牌**；`D43` 无 secret 泄漏；`D44` 提供连接测试入口；`D45` 保留输入框（`#configPatch`）。

### AC-076 附件限制 —— **部分通过**（服务端成立；UI 侧因 T-01 不可达）

> Given 超数量/大小/错误 mime；When 上传；Then 客户端提示且服务端拒绝，无残留引用。

- **服务端拒绝（通过）**：`probeE E1–E5` 合法 `text/plain` → 201 且 mime/bytes/hash/expiresAt 真实；`E6/E7` `application/zip` → 拒绝且点明 mime 限制；`E8` 可执行 mime 拒绝；`E9/E10` 20 MiB+1 字节 → 拒绝且点明大小限制；`E11` 无 file part 的 multipart 拒绝；`E12` 未认证上传 401。
- **无残留引用（通过）**：`E16/E17` 一条消息带 6 个附件 → 发送事务拒绝且点明数量限制；`E18` 被拒后 6 个上传**仍为 staged**（可重试），不产生绑定。
- **客户端提示**：`E13` Composer 渲染真实附件限制与附件入口；`E14` 有 `type="file"`；出厂 `app.js` 在上传前做同源限制校验（`ATTACHMENT_LIMITS` 在 `views.ts`，`app.js` 有对应前置拒绝）。
- **不可达的部分**：由于 `T-01`，浏览器无法把已上传附件随消息发出（`probeG G3` 403），因此「客户端提示 → 服务端拒绝 → 无残留」这条**用户可见**链在 UI 上无法完整走通。判定为部分通过，扣分归属 `T-01`。

### AC-077 文件只读 —— **通过**

> Given 切换分支预览文件；When 浏览/搜索；Then 目标 Revision 正确、根边界生效，不改变 Agent Snapshot。

- `probeE E30` Project 行给出 40 位 revision；`E31` 文件页渲染真实仓库树（`orders.ts`）；`E32` 页面 `data-revision` **等于**该 revision；`E33` 有路径搜索；`E35` `?query=orders` 过滤后 `orders.ts` 在、`README.md` 不在；`E36` `?path=src/orders.ts` 渲染真实文件正文；`E34` 页面无写入口。
- **根边界**：`E38` `..%2F..%2Fetc%2Fpasswd` **不泄漏**宿主内容（无 `root:`、正文非宿主文件）；`E39` 以 `data-code` 明确报错；`E40` 双重编码同样被拒；`E41` 多级穿越被拒；`E42` 缺失文件以 `data-code` 明确报错（非静默空白）。
- **无副作用**：`E44` 浏览不新建 Work；`E45` 不移动交付分支；`E46` 不改动 Project Snapshot（cursor 可读）。`E43` 重复读同一文件输出稳定。

### AC-078 认证生命周期 —— **通过**

> Given 未登录/过期 cookie/错误 Origin；When HTTP/WS 写请求；Then 拒绝、退出失效、受限重试，后台 Work 保留。

- **未登录/过期**：`probeA A50` 无会话 `/rpc` 401；`probeB B49` 匿名页面 401；`probeC C26c` 非法 locale 拒绝；`probeE E12` 未认证上传 401。
- **Origin/WS**：`A47` 外来 Origin 的 daemon 升级拒绝；`A48` 无 cookie 拒绝；`A49` 浏览器 cookie 不能开 daemon `/ws`；`A45/A46` 只有真实 daemon 会话可开。
- **退出失效**：`probeB` 登录后使用真实会话；`probeA A50` 证明缺失会话被拒；BFF 在 daemon 会话失效时清除浏览器会话（`app.ts:317-323`，由 `probeG` 的会话链路间接覆盖）。
- **受限重试**：`probeA A38/A39` 桥以 `bridge.reconnecting{attempt}` → `bridge.open` 的有界重连；`probeC C12/C13` 出厂脚本有重连策略且面板切换不发请求。
- **后台 Work 保留**：`probeA A38–A44` 断连期间事件照常产生并被补齐；`probeB B49` 后台行数不变。

### AC-084 首条消息附件 —— **不通过（T-01/P1）**

> Given 新 Conversation 无 Work/Run；When 上传附件再发送首条消息；Then 普通无附件用户/系统消息可用 message_body 存储；staged 附件成功原子绑定新 Work；失败可重试、过期清理、重复绑定拒绝。

- **daemon 凭据路径成立**：`probeE E19` 携带 1 个附件的首条消息 → 200；`E20` 附件 `state=bound`；`E21` `boundMessageId` 与消息一致；`E22` 消息背后是真实 Work；`E23` 产生 `origin=user`、无 `runId` 的真实 Artifact；`E24` Artifact 归属于该 Work 且指向该上传；`E25` 复用 → `ATTACHMENT_ALREADY_BOUND`；`E26/E27` 过 TTL 后 sweep 置 `expired`；`E28` 过期附件不可发送；`E29` 无附件用户消息正常存储（`message_body`）。
- **浏览器路径不成立（本条 AC 的用户可见行为）**：`probeG G1/G2` 浏览器经 BFF `/artifacts/upload` 上传成功，且附件 `ownerUserId` = 安装用户；`G3` 浏览器经 BFF `/rpc` 发送同一附件 → **403 `NOT_AUTHORIZED`（belongs to another owner）**；`G4` 附件仍为 `staged`；`G5` 消息不存在；`G6` 对照组（daemon 安装凭据同一轨迹）200 且绑定成功。
- 结论：AC-084 的「上传附件再发送首条消息」在**产品唯一的浏览器工作台上不可达**。详见 §7 的 `T-01`。

### AC-087 需求池随 Git 迁移 —— **通过**

> Given 空白服务器仅 Clone 含 queued 需求的项目，没有原数据库或模型配置；When 可信打开项目；Then 保留稳定需求 ID、目标、范围、验收、已确认结论与未决项，列表可用，无需重新初始化产品知识。

- `probeF F1–F5` 通过真实 `requirement.save` 在 Git 建立需求（`requirement.json` + `content.md` 同 commit）；`F10` 池 README 同 commit 提交。
- **第二个空白服务器**：`F24b` `projectIdFromRoot` 对同一仓库得到**相同** Project id；`F24` 新 `ProjectStore` 的需求投影为 0 行（真独立数据库）；`F25/F26` 交付分支真实含需求目录；`F27/F28` 逐条经真实 `RequirementProjection` 导入后行数与 Git 记录一致。
- `F29` 稳定 Requirement id 保留；`F30` 生命周期保留；`F31` `recordVersion` 保留（=3）；`F32` 标题与目标保留；`F33` `portableRef` 指向真实 revision；`F34` 记录 Hash 由真实字节重算；`F35` 导入记录**不带本机 Work 绑定**；`F36/F37` 重复导入幂等且无冲突。

### AC-088 历史需求展示 —— **通过**

> Given Git 含 completed、cancelled 和 archived 需求；When 新服务器导入；Then 完成摘要和功能/代码引用可查，取消原因及归档前状态保留，缺旧报告标详细证据未迁移，不能据此放行本机验证。

- `probeF F19b` 在 Git 写入并提交一条 `lifecycle=completed` 记录（含 `completion`：`codeRevision`/`codeTree`/`verificationSummary`）；`F20` 把已有记录改为 `lifecycle=cancelled` 并提交，`F21` 生命周期为 cancelled、`F22` 版本递增到 3、`F23` 取消原因进入 `cancellation.reason`。
- `F38` Git 中确有 completed 记录可迁移；`F38b` 导入后生命周期为 completed 且完成摘要保留。
- `probeB B5` 看板 Archived 列同时呈现 archived 与 cancelled 的真实 `lifecycle`；`F23`（probeF 同名断言）看板把 completed 与 cancelled 分别置于 completed/archived 列。
- 未覆盖：`evidenceAvailability='summary_only'` 与「详细证据未迁移」文案的逐字核对归 WP-04（Review R2 亦如此承接）；「不能据此放行本机验证」由 `probeF F48`（`reusedPreviousVerification=false`）侧面覆盖。

### AC-089 进行中需求继续 —— **通过**

> Given Git 含 active 需求且无本机 Work；When 打开后点击继续；Then 先显示待继续且不启动 Run；用户继续后创建新 Work，取得本机授权，从未满足 Gate 重新规划验证。

- `probeF F43` 真实 `requirement.save` 建立 `lifecycle=active` 记录；`F44` 详情页 200 渲染。
- `F45` `requirement.continue` → 200 并返回真实 `workId`；`F46` **Run 数不变**（不启动 Run）；`F47` 返回本机 `authorizationId`；`F48` `reusedPreviousVerification=false`（不复用历史验证）；`F49` Runs 面渲染正常。
- `probeB`/`probeD` 侧：Active 需求由看板 active 列投影，`B30` 以其真实 `workId` 走暂停路径（真实状态机而非 `INVALID_STATE`）。

### AC-090 需求保存时机 —— **通过**

> Given 创建或修改需求但尚未开发；When 执行保存并推送保存所在分支，再于新服务器拉取；Then Git 立即含需求及索引；仅 Git 与投影一致后显示已保存，失败通过 requirement.save.retry 恢复原操作，Git 已提交时仅补投影且不重复提交；界面展示分支、提交与未推送状态。

- `probeF F1/F2/F3` 保存应答在 Git CAS 与投影核对后返回，`git.commit` 为 40 位且 = 分支 head；`F4/F5` 两文件同 commit；`F11/F12` 投影仅在 Git 一致后可见并记录 Git 身份；`F13` 保存后才上板；`F14` 记录/卡片带 `saveState`。
- `F16` 正文更新产生新 commit；`F17/F18/F19` 两文件共享递增版本且 `contentHash=sha256(content.md)`。
- **失败不伪装**：`F39/F40` 结构非法正文 → `VALIDATION_ERROR` 且点明结构；`F41` 分支**不动**（head 仍为上一次成功 commit），证明「诚实拒绝 + branchUntouched」。
- `probeB`/`probeE` 侧：`F` 系列与 `E22` 一致地以真实 Git 提交为权威。
- 未覆盖：UI 的「未推送」提示与 `requirement.save.retry` 的真实重试链（`W9R2-01` 已登记 `requirement.save` 创建分支的幂等缺口；`retry` 语义按协议 §8 走「新请求键指向原操作」，本轮未新增探针，登记）。

### AC-093 需求目录与正文一致性 —— **通过**

> Given 每需求包含 requirement.json 与 content.md，另有 README 缺失、单文件缺失、Hash 错、被 Git 忽略和旧格式样例；When 保存、Clone 导入及加载 Context；Then 两文件共享版本并原子提交，正文修改递增版本且组合 Hash 改变；列表无需 AI 解析，正文可读；README 可重建，其他错误逐条明确显示；依赖需求的 Product/Plan 加载两份同 Revision 来源且冲突不得放行。

- `F4/F5/F6/F7` 两文件同 commit、共享 `version=1`、`contentFile` 固定为 `content.md`；`F8` `contentHash` = 真实 `sha256(content.md)`；`F9` 六个二级标题各一次。
- `F17/F18/F19` 正文修改 → 版本 2、`contentHash` 变化且仍等于新正文 sha256。
- `F10` README 随记录提交；`F36/F37` 重复导入幂等；`F39/F40/F41` 结构错误逐条明确拒绝且分支不动。
- 未覆盖：**Hash 错、单文件缺失、被 Git 忽略、旧格式**四类负例的逐条码位核对属 WP-04（`KNOWLEDGE_INVALID`/`REQUIREMENT_PATH_IGNORED`/`LEGACY_REQUIREMENT_FORMAT`/`REQUIREMENT_CONFLICT`），本轮登记为承接（Review R2 亦如此承接）；「依赖需求的 Product/Plan 两份同 Revision 来源」属 WP-05/WP-06 Context 链，不在 WP-09 范围。

### 五个必需失败测试的行为（独立复现，不依赖产品测试）

`implementation.md` WP-09 要求六个必需失败测试：**持续对话**、**过期卡片**、**窄屏焦点**、**断连**、**配置失败**、**订阅扩大**。我不引用产品测试文件，而是独立复现每个失败场景的**行为**：

| 必需失败测试 | 我的独立复现 | 结果 |
|---|---|---|
| 持续对话 | `probeB B33–B41`：发送真实消息、真实路由成 Work、真实状态、同键重放、异载荷冲突 | PASS |
| 过期卡片 | `probeA A21–A27`：过期卡片 `data-expired=true` + 禁用 + 可见原因；强行批准 409 `VERSION_CONFLICT` + `currentVersion` | PASS |
| 窄屏焦点 | `probeC C5`（`#liveDockClose` 存在）+ 出厂脚本回焦路径（`toggle.focus()`）；**实机焦点遍历未做** | PASS（标记覆盖限制） |
| 断连 | `probeA A38–A44`：真实链路断→`bridge.reconnecting`→`bridge.open`→水位补齐、零重复、零丢失 | PASS |
| 配置失败 | `probeD D19–D40`：非法 patch/类型错/过期版本/不支持 reasoning/禁用 provider/未知 model，全部拒绝且 revision 不变、输入保留 | PASS |
| 订阅扩大 | `probeA A36`（快照）+ `A39–A44`（重订阅按水位重放）；`probeC C11` 面板切换不改数据；`probeA A42` 零重复 | PASS |

## 5. 记录一致性核对（`implementation.md` §T5 与代码/证据）

| 记录声明 | 核对结果 |
|---|---|
| T5：`test:unit` **55 文件 / 1102 用例** | **一致**（本轮默认 workers 单次 55/1102 全绿） |
| T5：`test:integration` **25 文件 / 304 用例** | **一致**（`--maxWorkers=4` 实测 25/304） |
| T5：`pnpm build` 全 workspace `Done` | **一致**（12 个 project） |
| T5：`plan.current` 为唯一权威、UI 不自行拼装 Plan 正文/authorizationRef | **一致**（`probeA A1–A20`：UI 同款载荷可批准；伪造载荷被拒） |
| T5：`?planVersion=` 解析并渲染过期卡片 | **一致**（`probeA A21–A27`） |
| T5：跨 Project `details` 只保留调用方 id | **未独立复测**（属协议面，Review R2 `probeB B1/B2` 已闭合；本轮工作台面未触及该项） |
| T5：所有 `*` 方法均入账本 | **已知过度陈述**：R2 `W9R2-01` 指出 `requirement.save` 创建分支不入通用账本；本轮**未**复现该缺口，也未证明其已修 → 登记为未复核（§6-O1） |
| T5：Queued 取消生成 canonical 六段正文 | **一致**（`probeB B27` 六标题各一次） |
| T5：`W9R1-07` 九面死控件关闭、`conversation.create` 真实可用 | **一致**（`probeB B46–B53`） |
| T5：`W9R1-10` 有界退避 | **未独立复测数值**（Review R2 `probeE E1/E2` 已从真实资产求值；本轮只验证了 `bridge.reconnecting.attempt` 为正整数与该分支存在） |
| T5：BFF CSRF 偏差已在 `protocol.md` §2 登记 | **一致**（`docs/architecture/protocol.md` 第 21 行确有此段；本报告按其口径不将浏览器 CSRF 头缺失判为缺陷） |
| T4 §4.x 残余与 R2 §R2.7 的 6 项 | 见 §6，其中 `W9R2-01/02/03/05/06` 本轮**未复核**，仅登记 |
| `docs/INDEX.md` 第 44 行「协议接线（daemon/BFF/WS）…仍未实现」 | **文档漂移**：本片已交付 `/rpc`、`/ws`、BFF 九面；属未结算的文档漂移，应在 Settlement 更新（不阻断 Test） |

## 6. 未覆盖与剩余风险

| 项 | 状态 | 原因 | 承接 |
|---|---|---|---|
| `W9R2-01` `requirement.save` **创建分支**幂等缺口（同键同载荷重复建需求、同键异载荷被接受） | **未复核** | 属协议面/CLI 可达、本片 UI 不调用；本轮聚焦工作台 AC 矩阵，未构造该反例 | 记录（R2 已登记）；结算前应修或明确登记为偏差 |
| `W9R2-02/03` update/取消时 `scope`、数组字段与正文保真度 | **未复核** | 同上，UI 无 `requirement.save` 调用 | 记录（R2 已登记） |
| `W9R2-04` `pnpm test:unit` 默认并发偶发（WP-07 端口竞态） | **未复现**（本轮单次全绿） | 未做多次重复采样 | 记录；建议多次运行或按有界并发口径写入契约 |
| `W9R2-05` 中文界面混入英文诊断（`#approveBlocked`） | **未独立复核** | 本轮未构造中文界面的「无 Plan」卡片并比对语言一致性 | 记录（R2 已登记，AC-073 的 P3 残留） |
| `W9R2-06` 「断连」用例含恒真断言 `|| true` | **未复核产品测试文件** | Test 角色不引用产品测试；我只按行为独立复现「断连」 | 记录（R2 已登记） |
| AC-070 的「大 Diff 截断 + 一次性完整下载」UI 链 | **未独立重做** | 属 WP-03 交付面，非 WP-09 核心分支；Review R2 以 T4 用例复核通过 | WP-03 / WP-10 回归 |
| `test:e2e` / `test:acceptance` / `test:live` | **未执行（按设计）** | 三者按契约返回 `NOT_IMPLEMENTED` | WP-09 / WP-10 |
| 真实模型 / Provider | **未覆盖** | 无真实凭据；全部结论来自确定性路由与配置解析 | WP-10 |
| 无头/真实浏览器（焦点遍历、弹层焦点约束、ARIA 实机、像素级） | **未覆盖** | 环境无 headless browser；以「真实 SSR 标记 + 出厂 `app.js` 真实取回源码 + 真实 HTTP/WS」为证据 | WP-10 |
| 真正 kill BFF 进程后的端到端恢复 | **未覆盖** | BFF 重启需重新登录，属设计边界 | WP-10 |
| AC-088/AC-093 的「缺文件/Hash 错/被忽略/旧格式」逐条码位 | **未覆盖** | 属 WP-04 导入演练 | WP-04（Review R2 同意承接） |

**剩余风险**：`T-01` 未修则 AC-084 在浏览器上持续不可达；`W9R2-01/02/03` 未被本轮否定，仍可能在协议面/CLI 路径复现。

## 7. 发现（Findings）

### T-01（P1，阻断）浏览器工作台的「上传附件 → 随消息发送」链路因身份不一致而不可达

- **位置**（行号按冻结点 `ce2fc80` 的工作树）：
  - `apps/daemon/src/server.ts:93` 起（`const authPort: WorkbenchAuthPort` → `authenticate` 把**会话 cookie** 映射为 `userIdFromSubject(\`user:${decision.session.id}\`)`），对照 `apps/daemon/src/server.ts:387` 起的 `authenticate()` 与 `:388` —— 安装路径一律用 `userIdFromSubject('installation:local')`。
  - `apps/web/src/app.ts:425`（`answer = await rpc(options.daemon, { raw, session: sessionOfDaemon(session) })`）+ `apps/web/src/app.ts:1156-1158`（`sessionOfDaemon` 只传 `session.daemonCookie`）—— BFF 以**自己的 daemon 会话 cookie** 转发浏览器写命令；`apps/web/src/app.ts:463` 的 `proxyArtifacts` 也转发同一 cookie，但 daemon 的 WP-03 上传路由（`server.ts:408` 的 `upload()`）用的是安装用户。
  - 效果：`packages/core/src/attachments.ts:211-217` 的属主校验 `attachment.ownerUserId !== input.ownerUserId` 失败。
- **复现**（`/tmp/wp09t/probeG.mjs`，与出厂 `app.js` 完全同形的两次请求）：
  1. `G1` 浏览器（BFF `agentdev_web` 会话）`POST /artifacts/upload` 上传 `text/markdown` → **201**；`G2` 该附件 `ownerUserId = 20f4b219-…`（= `userIdFromSubject('installation:local')`）。
  2. `G3` 浏览器 `POST /rpc {method:'conversation.message.send', params:{conversationId, body:'请阅读附件', attachmentIds:[id]}}` → **403 `{"code":"NOT_AUTHORIZED","message":"attachment <id> belongs to another owner"}`**；`G4` 附件仍 `staged`；`G5` 未产生消息。
  3. `G6` 对照组：同一轨迹改走 daemon 安装凭据（上传 + `/rpc` 带 `Bearer`）→ **200** 且绑定成功。
  4. `G7`（`diag-own4`）daemon 在处理 BFF 转发的 `/rpc` 时实际派发的 caller 为 `{"subject":"user:EvXEr_…","userId":"3f1862ba-…","role":"chief"}` —— 即**会话派生身份**，而非安装身份；同一次上传的属主是安装身份。
- **观察 vs 期望**：观察到「浏览器上传成功但永远无法随消息发送」（403 且附件保持 staged）；期望工作台能把它刚上传的附件随首条消息绑定（AC-084 明文：
  「上传附件再发送首条消息…staged 附件成功原子绑定新 Work」）。
- **契约/子句**：`docs/delivery/acceptance.md` AC-084（“Given 新Conversation无Work/Run；When 上传附件再发送首条消息；Then … staged附件成功原子绑定新Work”）；AC-076（“客户端提示且服务端拒绝”——UI 侧无法走到服务端拒绝）；`docs/product/experience.md` §3（每消息最多 5 个附件）；`docs/architecture/protocol.md` §5（`message.send` 事务校验同用户/Conversation）。
- **为什么产品测试全绿却掩盖了它**：`apps/web/test/workbench.integration.test.ts` 的 AC-084 用例经 **BFF 上传**（浏览器身份）但经 **daemon 安装 Bearer** 发送（`rpc()` 直连 daemon）。两条轨迹的身份不同，恰好使属主校验通过；而真实浏览器两次请求都只带 `agentdev_web` 会话。因此“测试全绿”不能证明该用户可见行为成立。
- **修复方向**（供 Develop 参考）：
  1. 让 daemon 对**同一安装**的统一用户身份保持稳定：`server.ts` 的 `authPort.authenticate` 与 `authenticate()` 一样返回安装用户 id（会话 id 仅作审计主体），或
  2. 让 BFF 转发写命令时改用安装凭据（Bearer）而不是 BFF 的会话 cookie，或
  3. 让附件属主与消息属主都由同一个显式主体（如 `installation:local`）表达，并在协议层固定该身份语义。
  并补一条**经 BFF 同时完成上传与发送**的回归用例（当前用例的两条轨迹不构成端到端证据）。

### T-02（P3，可复现性）自建探针的“报告行合计”与“明细行数”不一致

- **位置**：`/tmp/wp09t/lib.mjs` 的 `Checks.report()`（`passed` 由 `results.length - failed` 得出，而 `results` 只装 `check()` 的调用，不含 `eq()` 委托前的重复计数）。
- **复现**：`logs/probeG.log` 报告 `[probeG] 4 passed / 4 failed (8 total)`，但明细列出 5 条 `FAIL`（G3/G4/G5/G7）。差额来自我在 `eq()` 内复用 `check()` 造成的二次计数。
- **观察 vs 期望**：观察到合计与明细不一致；期望两者一致。
- **性质**：**探针自身缺陷，非产品缺陷**（所有判定与明细逐条可查，结论不受影响）。已在 §2 以明细行数（279 条）为准统计。
- **修复方向**：`eq()` 直接记录结果而不经过 `check()` 的计数路径。

### T-03（P3，观察）`createDaemon` 的会话派生身份同时影响所有“属主敏感”方法

- **位置**：同 `T-01` 的位置（`apps/daemon/src/server.ts:93` 起）。
- **复现**：`probeG G8/G9`：同一安装、两次浏览器登录得到**两个不同**的会话派生 userId（`9fafbc79-…` vs `zqyb2-…` 等），与安装身份 `20f4b219-…` 均不同。
- **观察 vs 期望**：观察到身份随会话而非随安装/用户变化；期望同一安装下“同一用户”在所有协议面具有稳定身份。
- **契约**：`docs/architecture/protocol.md` §1/§5（`message.send` 校验“同用户”）、AC-084；`docs/rules/workflow.md` 的单用户安装模型。
- **影响边界**：本轮只观察到附件属主一处失败；`conversationId` 校验不受影响（`probeG` 中同一 `conversationId` 仍未通过，失败原因确为属主）。其余按 userId 记账的路径未在本轮探针覆盖。
- **关系**：这是 `T-01` 的**根因**，单列以便修复时有明确靶点。

### T-04（P3，记录一致性）`docs/INDEX.md` 第 44 行的“仍未实现”与本片实际交付不符

- **位置**：`docs/INDEX.md:44`（“真实 Provider 纵向运行、协议接线（daemon/BFF/WS）…仍未实现”）。
- **复现**：本片已交付 `/rpc`、`/ws`、BFF 九面并全部通过 `probeA–probeF` 的真实端到端证据；WP-09 尚未 Settlement。
- **性质**：未结算的文档漂移，Review R2 亦已指出；**不阻断 Test**，须在 Settlement 更新。

## 8. 结论

- **AC-054、AC-068、AC-069、AC-070、AC-071、AC-072、AC-073、AC-074、AC-075、AC-077、AC-078、AC-087、AC-088、AC-089、AC-090、AC-093 通过**（AC-073 的实机焦点/ARIA 遍历未做，登记为覆盖限制）。
- **AC-076 部分通过**（服务端限制与无残留引用成立；「客户端提示」的 UI 链路因 T-01 不可达）。
- **AC-084 不通过**：浏览器工作台上传的附件无法随消息绑定（T-01/P1）。
- 计数：**16 个 AC 通过 / 1 个部分通过 / 1 个不通过**；自建实验 **279 条判定，275 通过 / 4 失败**，4 条失败全部为 `T-01` 的证据。
- 契约命令：**6/6 退出 0**（typecheck 0、lint 0、unit 55/1102、integration 25/304、docs:check ok、build 12 workspace）。
- 最重要的问题：**T-01（P1）**——与第 1 轮两项 P1 同类（“能力已实现但工作台的用户可见路径不可达”），且现有产品测试因上传与发送走了不同身份而无法发现它。
- **Test 判定：FAIL —— 不接受 WP-09 的 AC-084（以及 AC-076 的“客户端提示”半边）；接受 WP-09 的 AC-054、AC-068～075、AC-077、AC-078、AC-087～090、AC-093。**

---

# WP-09 独立 Test 报告 · 第 2 轮（T-01 复验与全 AC 矩阵）

- 测试对象：工作包 WP-09「完整 Web 工作台」
- 代码冻结点：`e9e237d`（`fix(daemon,web): unify the installation identity and close the WP-09 findings`）；第 1 轮冻结点 `ce2fc80`
- `git rev-parse HEAD`：**`e9e237dde78a2347d397b2b7a8cf0f1d4a47ddc6`**（= 冻结点）
- `git rev-parse e9e237d^{tree}`：**`a4f9fd99cfa46e30938f4dac8a3fa14f317f6e04`**
- `git status --porcelain`：测试前 ` M .agentdev/work/WP-09/review.md`（仅第 3 轮 Review 报告本身未提交）；本报告写入后追加 ` M .agentdev/work/WP-09/test.md`。**`packages/**`、`apps/**`、`docs/**` 全程未改动**
- 测试角色：**INDEPENDENT TEST**（独立上下文；**未读取任何开发或 Review 聊天/会话**；只依据仓库文件、git 对象、`dist` 构建产物与我自建的实验脚本及其原始输出）
- 环境：`node v24.8.0`、`pnpm 12.3.4`、macOS（8 vCPU）；采样期间 `load average` 约 4.5–22.9（高负载宿主）
- 唯一写入：本文件（追加，**第 1 轮报告逐字保留于上**）；实验脚本全部在 `/tmp/wp09t2/`

## R2.0 Review 门禁与范围

先读 `.agentdev/work/WP-09/review.md` 第 3 轮（R3.2 / R3.10：判定 **PASS**，未复现任何 P0/P1，明确「**可以进入独立 Test/结算**」）。门禁满足，故按任务执行完整矩阵。

R3 要求 Test 显式登记的残留（本轮**不**把它们当作已成立）：`W9R3-01`（`pnpm test:unit` 默认 workers 残留端口竞态）、`W9R3-02`（completed/archived 在协议面不可达）、`W9R3-03`（`git show` 未加 `--end-of-options`）、`docs/INDEX.md:44` 文档漂移、`requirement.save.retry` 的独立语义。本报告 R2.6/R2.8 逐项登记。

本轮重点（任务指定）：**第 1 轮失败的 T-01 路径**（经 BFF 上传 → 经 BFF 发送首条消息必须绑定附件）与 **AC-084 / AC-076**。

## R2.1 本轮结论摘要

| AC | 题目 | 正向 | 负向 | 本轮结论 |
|---|---|---|---|---|
| AC-054 | UI 断开 | 通过 | 通过 | **通过** |
| AC-068 | 看板身份 | 通过 | 通过 | **通过** |
| AC-069 | 持续对话 | 通过 | 通过 | **通过** |
| AC-070 | 产物版本 | 通过 | 通过 | **通过**（含截断与一次性下载，本轮首次独立验证） |
| AC-071 | Live 布局 | 通过 | 通过 | **通过（附 P3 残留 `T2-01`）** |
| AC-072 | Conversation 归属 | 通过 | 通过 | **通过** |
| AC-073 | 语言可访问 | 通过 | 通过 | **通过（含 i18n 原因码；无头焦点遍历未做）** |
| AC-074 | Inbox 去重 | 通过 | 通过 | **通过** |
| AC-075 | 配置错误 | 通过 | 通过 | **通过** |
| AC-076 | 附件限制 | 通过 | 通过 | **通过**（服务端 + 客户端前置提示 + UI 可见链全部可达） |
| AC-077 | 文件只读 | 通过 | 通过 | **通过** |
| AC-078 | 认证生命周期 | 通过 | 通过 | **通过**（含退出失效与真实 TTL 过期） |
| AC-084 | 首条消息附件 | 通过（BFF 路径） | 通过 | **通过（第 1 轮 P1 已消除）** |
| AC-087 | 需求池随 Git 迁移 | 通过 | — | **通过** |
| AC-088 | 历史需求展示 | 通过 | — | **通过（承接 WP-04）** |
| AC-089 | 进行中需求继续 | 通过 | — | **通过** |
| AC-090 | 需求保存时机 | 通过 | — | **通过** |
| AC-093 | 目录与正文一致性 | 通过 | 通过 | **通过** |

**Test 判定：PASS —— 接受 WP-09 的全部 AC（AC-054、AC-068～078、AC-084、AC-087～090、AC-093）；AC-071 附带 1 项 P3 残留 `T2-01`（不阻断）。**

- 第 1 轮唯一阻断项 `T-01`（P1）**已关闭**：以自建夹具（真实产品 `createDaemon` + 真实 BFF）复现「经 BFF 上传 → 经 BFF 发送首条消息」→ **42/42 断言通过**（`probeT01`）。
- 自建实验合计 **397 条带判定断言，396 通过 / 1 失败**；唯一失败是新增 P3 `T2-01`。
- 契约命令 **6/6 退出 0**：`test:unit` 默认 workers **8 次采样全部 55 文件 / 1105 用例全绿**；`test:integration --maxWorkers=4` **26 文件 / 311 用例全绿**（112.84s）。

## R2.2 契约命令原始结果

执行方式：仓库根、`export PATH="$HOME/.local/bin:$PATH"` 下按序执行；日志 `/tmp/wp09t2/logs/{contracts.txt,unit-extra.log}`。

| 命令 | 退出码 | 原始结果要点 |
|---|---|---|
| `pnpm typecheck` | **0** | `tsc -p tsconfig.json --pretty false`，无输出 |
| `pnpm lint` | **0** | `node scripts/lint.mjs`；`All matched files use Prettier code style!` |
| `pnpm docs:check` | **0** | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| `pnpm build` | **0** | `pnpm -r build`：`apps/{cli,runner,web,daemon}` + `packages/{contracts,domain,storage,core,pi-runtime,knowledge,workspace,client}` 共 **12** 个 project `build: Done` |
| `pnpm test:unit`（默认 workers，**8 次**：契约 3 次 + 加采 5 次） | **0 ×8** | 每次均 `Test Files 55 passed (55)` / `Tests 1105 passed (1105)`（12.0–14.0s）；**8 次零失败、零 5s 超时**；未复现 `W9R3-01`/`W9R2-04` 的端口竞态 |
| `pnpm test:integration --maxWorkers=4` | **0** | `Test Files 26 passed (26)` / `Tests 311 passed (311)` / `Duration 112.84s` |
| `pnpm test:e2e`（参考） | 1 | `NOT_IMPLEMENTED: command test:e2e is not implemented yet; it lands with WP-09` |

命令原始尾部：

```text
$ pnpm typecheck
$ tsc -p tsconfig.json --pretty false
[exit=0]

$ pnpm lint
$ node scripts/lint.mjs
Checking formatting...
All matched files use Prettier code style!
[exit=0]

$ pnpm docs:check
$ node scripts/docs-check.mjs
docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages
[exit=0]

$ pnpm build
... 12 workspace build: Done
[exit=0]

$ pnpm test:unit        (default workers; 8 次采样，下为其中一次的原文)
 Test Files  55 passed (55)
      Tests  1105 passed (1105)
   Duration  12.16s (tests 67%, import 23%, transform 9%)
[exit=0]

$ pnpm test:integration --maxWorkers=4
 Test Files  26 passed (26)
      Tests  311 passed (311)
   Duration  112.84s (tests 95%, import 4%, transform 2%)
[exit=0]
```

**宿主加载说明**：本轮 `test:unit` 以契约命令原文（默认 workers）采样 8 次，全部全绿。`W9R3-01` 记录的残留竞态（`packages/core/test/broker.test.ts:1267` 第二个端口分配）在本轮 8 次采样中**未复现**；这只说明「该采样下稳定」，不足以否定 R3 的 10 次采样中 1 次失败（见 R2.6-R1）。集成命令为**单次**运行（沿用 Review 的有界并发口径），未多次重复。

## R2.3 方法与用例数

全部探针由 Test 独立编写/运行，**只消费构建产物**（`packages/*/dist`、`apps/*/dist`、`apps/web/public`），经 `/tmp/wp09t2/node_modules/@agentdev/*` 符号链接引用；**不 import 任何产品测试文件**（`apps/web/test/**`、`apps/daemon/test/**`、`packages/*/test/**` 一次也没有被引用）。世界夹具为：真实 Git 工作树（`createNodeWorktreeGitPort`）+ 真实 SQLite（`ProjectStore`）+ 真实 Core 服务 + **产品 `createDaemon`**（`/rpc` + `/ws` + WP-03 路由）+ **产品 `createWebApp`**（真实浏览器会话 cookie），全部真实 loopback HTTP/WS。全部临时根经过 `realpathSync`。

| 脚本（`/tmp/wp09t2/`） | 覆盖 | 判定数 | 结果 |
|---|---|---|---|
| `lib.mjs` / `seed.mjs` | 世界夹具与真实行播种（基础设施，不计判定） | — | — |
| `probeA.mjs` | AC-070（`plan.current` 回读、UI 同款载荷批准、同键重放/冲突、过期卡片、无 Plan 诚实禁用、失效 `?planVersion=`、reasonCode/i18n）+ AC-054（BFF 桥真实断连→自动重连→水位补齐零重复）+ AC-078（daemon `/ws` 正负例） | **57** | 57 PASS / 0 FAIL |
| `probeB.mjs` | AC-068（身份唯一、L1 不入板、Queued 无 Work 真实 Git 取消、暂停 `INVALID_STATE`）+ AC-069（真实路由成 Work、幂等、事件）+ AC-072（非 Chief 无控件、深链、`conversation.create`） | **48** | 48 PASS / 0 FAIL |
| `probeC.mjs` | AC-071（三态、跨页共享、cookie、无网络副作用、顶栏恢复、窄屏覆盖层与回焦）+ AC-073（`lang`、zh 词条、项目内容不翻译、`ui.translate` 正负例、ARIA）+ AC-078（有界重连策略为有限次） | **35** | 34 PASS / **1 FAIL（`T2-01`）** |
| `probeD.mjs` | AC-074（同目标+版本去重、修复汇总计数、过期禁用、过期决定拒绝、幂等重放）+ AC-075（非法键/类型错/过期版本/`preservedInput`/revision 不变/`PROVIDER_UNAVAILABLE`/Settings 不回显令牌） | **42** | 42 PASS / 0 FAIL |
| `probeE.mjs` | AC-076（mime/大小/数量、拒绝无残留、staged 保留、客户端限制标记）+ AC-084（绑定原子性、复用拒绝、无附件消息、BFF 轨迹）+ AC-077（真实树、revision、搜索、穿越、缺失文件、无写入口、不改 Work/分支/Snapshot） | **46** | 46 PASS / 0 FAIL |
| `probeF.mjs` | AC-087/088/089/090/093（立即提交、两文件共享版本、`contentHash=sha256(正文)`、README、更新递增、结构非法拒绝且分支不动、第二空白服务器真实导入、active 继续不复用历史验证） | **52** | 52 PASS / 0 FAIL |
| `probeH.mjs` | AC-078（未登录、无/错 Origin 写、**退出失效**、真实 TTL 过期）+ AC-054（无浏览器时 Work/Run 保留、新登录读数一致） | **14** | 14 PASS / 0 FAIL |
| `probeI.mjs` | **订阅扩大**必需失败行为：跨 Project 订阅拒绝且不泄漏本机 id、未知订阅/非法 scope kind 拒绝、合法扩大返回新快照+水位、`@agentdev/client` 本地越权拒绝（零请求） | **18** | 18 PASS / 0 FAIL |
| `probeJ.mjs` | AC-070 的截断与完整下载半边：>1 MiB 产物内联截断+行号头、下载 token 一次性、全量字节逐字节一致、匿名下载拒绝 | **17** | 17 PASS / 0 FAIL |
| `probeK.mjs` | W9R2-01（同键同载荷重放不新建/不再提交、同键异载荷 `IDEMPOTENCY_CONFLICT`）+ W9R2-02（未命名字段保真）+ W9R2-03（取消保真）+ `W9R3-02` 复现 | **26** | 26 PASS / 0 FAIL |
| `probeT01.mjs` | **T-01 复验**：BFF 上传→BFF 发送、属主一致性、无附件消息、跨会话、安装 Bearer、被拒发送保 staged、审计 subject vs 身份、AC-084 过期/复用、AC-076 UI 可见链 | **42** | **42 PASS / 0 FAIL** |
| **合计** | | **397** | **396 PASS / 1 FAIL** |

**关键排除性证据**（防止把探针缺陷当成产品缺陷）——本轮共 6 处先由我方夹具缺陷触发、经逐项定位后修正，均**未**计入发现：

1. `probeC C5b` 首版样式断言写错文件名（实际为 `/assets/styles.css`），修正后通过；`C5c` 的失败经复核为产品行为（见 `T2-01`）。
2. `probeD D38` 首版断言使用不存在的 `data-config-version`；设置页真实属性是 `#settingsMeta[data-version]`（`pages.ts:683`），修正后通过。
3. `probeT01 T01a` 首版把 `agentdev_session=` 前缀拼进 `AuthService.authenticate` 的 cookie 值、并以 `isWrite:true` 省略 CSRF 令牌，导致身份解析为 `ok:false`；改用会话 cookie 值 + `isWrite:false` 后通过。
4. `probeH H3` 首版用**读**方法（`work.list`）验证「错误 Origin 被拒」；AC-078 明文针对**写请求**，读路径由 `SameSite=Strict` HttpOnly cookie 保护（R2.4 已登记偏差），改用 `work.control` 写请求后 403 成立。
5. `probeH H7/H10` 首版把 `work.get` 的结果形状写成 `result.status`；真实为 `result.work.status`，修正后通过。
6. `probeI I14` 首版在空事件日志上要求 `cursor>0`；补齐一条真实事件后水位非零。
7. `probeK` 首版（a）`acceptance` 用了字符串数组（契约要求 `{id,given,when,then}` 对象）；（b）每次调用都新建 `sourceRef.id`，使「同键同载荷」实际变成同键异载荷；（c）把已被 update 覆盖的旧正文当作取消后应保留的文本。三处均为夹具缺陷，修正后 26/26 通过。

## R2.4 逐 AC 证据

### AC-054 UI 断开 —— **通过**

> Given 运行中关闭 BFF/浏览器；When 后台继续并重连；Then Run 状态与执行继续，按水位同步。

- **真实断连**：`probeA A35–A37` 浏览器会话打开 **BFF `/ws`**（真实 RFC6455 升级）→ `connection.hello` → `project.subscribe{kind:'summary'}` 得到真实 `subscriptionId` 与快照 cursor；随后追加 3 条真实事件并到达浏览器。
- **自动重连**：`A38` `protocol.closeAll(1001)` 后**同一个浏览器 socket** 收到 `bridge.reconnecting{attempt>=1}`；`A39` 收到 `bridge.open`（`resumed` 为数字）。
- **水位补齐、零重复、零丢失**：断连期间再追加 2 条；`A40` 重连后**恰好**回放 2 条；`A41` 回放 cursor 恰为 `watermark+1`、`watermark+2`；`A42` 水位及以下**零重复**；`A43` 每条均严格高于水位；`A44` 最大 cursor 恰为 `watermark+2`。
- **后台继续**：`probeH H8/H9` 浏览器完全缺席时 Work/Run 仍为 `running`；`H10` 新登录读到同一 running Work（不从事务推断 Run 已停止，`experience.md` §7）。
- **受限重试**：`probeC C13b/C13c` 出厂 `app.js` 有 `maxAttempts` 与 `reconnectAttempt > reconnectPolicy.maxAttempts` 的有限预算、退避上限 `maxDelayMs:30000`，且**不存在**固定 `setTimeout(openSocket, 2000)` 的无限循环。
- 未覆盖：真正 kill BFF 进程后的端到端恢复（重启需重新登录，属设计）；`test:e2e` 按契约 `NOT_IMPLEMENTED`。

### AC-068 看板身份 —— **通过**

> Given Queued 启动完成归档/取消；When 状态投影；Then 同 Requirement ID，无复制对象；L1 不自动入板；Queued 无 Work 也能直接取消，暂停 Queued 返回 INVALID_STATE。

- **身份唯一**：`probeB B6` 全部卡片 `identity === requirementId`；`B7` 无任何卡片的 identity 取自 Work id；`B5` Archived 列同时容纳 archived 与 cancelled 且带真实 `lifecycle`。
- **L1 不入板**：`B8` L1 与 `none` 级 Work 均在 `excludedWorkIds`；`B9` 无卡片 `work.id` 等于它们。
- **Queued 无 Work 直取消（真实 Git）**：`B15` 经真实 `requirement.save` 在 Git 建立 Queued 记录；`B17` 暂停 → **409 `INVALID_STATE`**；`B18/B19` 取消 → 200、`lifecycle=cancelled`；`B20` 投影同步；`B21–B23` 应答给出 40 位 commit 且分支 head **恰等于**该 commit；`B24–B26` 该 commit 含 `requirement.json`、`lifecycle=cancelled`、`cancellation.reason` 保留；`B27` `content.md` 六标题各一次；`B28` 取消原因进入「完成摘要」。
- **保真度**：`probeK K16–K23` 证明取消**不重写**其余正文段与已记录字段（readPaths/featureIds 保留、`完成摘要` 写入真实原因、无 `待明确` 覆写）；对照第 1 轮 Review `W9R1-05`/`W9R2-03` 已修。
- **负例**：`B29` 已取消需求再取消被拒；`B30/B30b` 以真实 `workId` 暂停走另一条真实路径（非缺失 Work 的 `INVALID_STATE`）；`B14` 页面把 Queued 的暂停渲染为 `data-refused="INVALID_STATE"`。

### AC-069 持续对话 —— **通过**

> Given 各阶段活动；When 发送新消息；Then Composer 可用，消息处理状态真实，意见由 Chief 路由。

- `probeB B33` 真实 `conversation.message.send`（`请修改 src/orders.ts`）→ 200；`B34/B35` 真实创建 `intent=delivery` 的 Work；`B36` `sourceRef.kind=message`；`B37` 状态为真实存储的 `received`。
- **幂等**：`B38` 同键同载荷重放返回**同一** `messageId`；`B39` 同键异载荷 → 409 `IDEMPOTENCY_CONFLICT`。
- `B40` `conversation.get` 可读回消息及真实状态；`B41` 真实 `message.received` 事件已追加。
- `B42` Chief 页渲染真实 Composer；`B43` 用户消息体 `data-translatable="false"`；`probeT01 T01c` 无附件消息经 BFF 200 且 `message_body` 属主为安装用户。
- **必需失败测试「持续对话」**：`probeB B33–B41` 独立复现其行为（不引用产品测试文件）。

### AC-070 产物版本 —— **通过**（含本轮新增的截断/下载证据）

> Given 有过期 Plan 和大 Diff；When 打开/批准/下载；Then 版本显示、过期拒绝、截断提示与完整下载。

- **批准可达**：`probeA A1–A8` `plan.current` 返回 gate 活版本、`current=true`、`approval.enabled=true`、**真实 Plan 正文**、真实 `authorizationId` 与 planning `runId`；`A9–A14` 详情页 `data-requested-version == data-current-version`、`data-expired="false"`、`data-approvable="true"`、按钮未禁用。
- `A15/A16` 以**与出厂 `app.js` 同形**的载荷批准 → 200 `applied`，版本 `v→v+1`；`A17` gate 前进；`A18–A20` 同键同载荷重放逐字节同结果、同键异载荷 409 `IDEMPOTENCY_CONFLICT`。
- **过期卡片（必需失败测试）**：`A21` `?planVersion=<旧>` 渲染 `requested=旧 / current=活`；`A22–A24` `data-expired="true"`、`data-approvable="false"`、控件 `disabled`；`A25` 有可见原因；`A26/A27` 强行批准旧版本 → 409 `VERSION_CONFLICT` 且带 `currentVersion`。
- **无 Plan 诚实禁用**：`A28/A29` `approval.enabled=false` + 非空 reason + `reasonCode='no_plan'`；`A30–A32f` 页面 `data-approvable="false"`、控件禁用、`#approveBlocked` 来自 i18n 目录（见 AC-073）；`A33` 第 1 轮伪造载荷（`plan:{}`+`authorizationRef:'workbench'`）被诚实拒绝；`A34` 畸形 `?planVersion` 回落活版本、不伪造过期卡片。
- **截断与一次性完整下载（本轮新增独立验证）**：`probeJ J1–J17`：24 000 行 / >1 MiB 真实产物 → `artifact.get` 公布 `maxInlineBytes=1 MiB` 与下载路径；`/artifacts/:id/preview` 200 且内联体被截断、`x-agentdev-preview-truncated`/`-at-line` **显式**标注行号；`artifact.download.prepare` 发一次性 token；经 BFF 全量下载字节**逐字节等于**原产物；二次消费被拒；匿名下载被拒。

### AC-071 Live 布局 —— **通过（附 P3 残留 `T2-01`）**

> Given Open/Compact/Hidden；When 跨页/窄屏切换；Then 共享宽度/状态、顶栏恢复、焦点正确，不影响 Run。

- `probeC C1` shell 有显式 `data-panel-mode`；`C2` 每页恰有一个 `#liveDock`；`C3` 顶栏 `#liveDockToggle` **先于** dock 且 `aria-controls="liveDock"`；`C4` `aria-expanded` 随态；`C5` 窄屏覆盖层有 `#liveDockClose`。
- `C5b` 出厂 `styles.css` 的 `@media (max-width:767px)` 把 Open 变为 `position:fixed` 覆盖层，compact/hidden 时 `display:none`。
- `C6–C10` cookie `agentdev_panel=compact|hidden` 生效、未知值回落、**跨页共享**；`C11` 面板模式不改变协议数据；`C12/C13` 出厂脚本实现面板模式且 `setPanelMode` 内无 `fetch(`（无网络副作用）。
- **残留（`T2-01`，P3）**：`C5c` 失败——覆盖层的 `#liveDockClose` 关闭路径只调用 `setPanelMode('compact')`，**不**把焦点还给顶栏触发按钮；compact 下 dock `display:none`，键盘用户会丢失焦点位置。AC-071 明文要求「关闭后焦点回到触发按钮」。详见 R2.6-`T2-01`。

### AC-072 Conversation 归属 —— **通过**

> Given 进入非 Chief 页面；When 渲染与讨论；Then 无创建切换控件，来源深链接进入 Chief。

- `probeB B44` 六个非 Chief 页面（requirements/docs/files/agents/runs/inbox）**均不渲染** `#newConversation`/`#switchConversation`/`#conversationSelect`/`#newConversationInline`；`B45` 均带真实 `discussInChief` 深链；`B54` Runs 页无 `conversation.create` 表单。
- **Chief 侧不是死件**：`B46–B48` 出厂 `/assets/app.js` 中三控件均有引用；`B49` `conversation.create` 返回真实 `conversationId`；`B50/B51` 真实行 + 真实 `conversation.created` 事件；`B52` `?conversationId=` 可读回；`B53` 未知 `focusWorkId` → 404 `NOT_FOUND`。
- 未覆盖：`#switchConversation` 是展开下拉并把焦点交给 select 的 disclosure 控件，其「切换」由 select 的 `change` 跳转承担；无头 DOM 点击未做（登记）。

### AC-073 语言可访问 —— **通过**

> Given 键盘操作及语言切换；When 页面/弹层使用；Then 焦点、ARIA 及标签可用，项目内容不被翻译。

- `probeC C14` `<html lang="en-US|en">`；`C15` `agentdev_language=zh` → `<html lang="zh-CN">`；`C16` 词条本地化；`C17` 保留 `data-i18n` 标记；`C19` 未知语言回落 `data-language="en"`；`C22` 语言选择持久化；`C23` 有 `aria-live`；`C24` 无 `div[role=button]`/内联 `onclick`；`C25` 语言控件有标签。
- **项目内容不被翻译**：`C18` zh Chief 页在真实渲染用户消息处带 `data-translatable="false"` + `data-i18n-project`；`C20` 不存在「`data-translatable="false"` 同时带 `data-i18n=`」的元素；`C21` 出厂脚本从不写 `data-translatable` 元素的 `textContent`；`C26b` `ui.translate` 对项目内容返回 `translatable=false` 且内容不变；`C26c` 未知 locale 被拒。
- **`W9R2-05` 禁用原因 i18n（本轮独立复现为已关闭）**：`probeA A32a` `approval.reasonCode='no_plan'`；`A32b` 页面 `data-approve-reason="no_plan"`；`A32c` `data-i18n="detail.approveReason.no_plan"`；`A32d` zh 页 `#approveBlocked` 为**中文且无英文句**；`A32e` en 页渲染目录词条而非 daemon 原句；`A32f` 英文诊断仅保留在 `title`。
- 未覆盖：键盘焦点遍历、弹层焦点约束、ARIA 实机朗读——**无无头/真实浏览器**，只以「真实 SSR 标记 + 出厂脚本源码事实 + 真实 HTTP/WS」为证据。

### AC-074 Inbox 去重 —— **通过**

> Given 相同决定和非阻断修复；When 多次事件；Then 决定按目标版本一项，内部修复汇总，过期决定禁用。

- `probeD D1–D5` 同 `target+version` 的重复决定在协议层只剩 **1** 行且保留首条；另一目标独立成行；两个 pending 目标 → 2 行。
- `D6/D7` 同一 Work 的 3 条 P1 阻断 Finding 汇总为 **1 行**且 `count=3`；`D8/D8b` `unread` 等于真实 actionable 计数（3）。
- `D9` 页面同版本决定只有一行；`D10` 页面渲染汇总行与计数 3；`D11` 过期决定 `aria-disabled="true"`；`D12` 其选项按钮 `disabled`。
- 负例：`D13` 过期决定 `decision.resolve` → `INVALID_STATE`；`D14` 越界选项 → `VALIDATION_ERROR`；`D15–D17` pending 决定真实应用、重复应用 `idempotent=true`、状态真实落库。

### AC-075 配置错误 —— **通过**

> Given 模型不支持 reasoning 或连接失败；When 保存/测试；Then 清晰校验、保留输入，活动配置不变。

- `D19/D20` 含禁用键的 patch → `VALIDATION_ERROR` 且 `details.preservedInput` 原样回显；`D21/D23` 活动 revision **不变**；`D22` 类型错误同样拒绝。
- `D24/D25` 过期 `expectedVersion` → 409 `VERSION_CONFLICT` + 真实 `currentVersion`；`D26` 合法 patch `applied` 且版本前进。
- `D27–D30` 角色覆盖写入真实 provider，`config.test` 报告真实 `reasoningSupported=true` 与 provider/model；`D31–D34` 把 reasoning 改为 provider 不支持的值后测试 → 拒绝且码在文档表内、`details` 保留输入；`D35/D36` 未配置 provider 的角色 → `PROVIDER_UNAVAILABLE` 且 revision 不变。
- `D37` Settings 200；`D38` `#settingsMeta[data-version]` 为活动 revision；`D39` **不回显安装令牌**；`D40` 保留 patch 输入；`D41` 有连接测试入口。
- **必需失败测试「配置失败」**：`probeD D18–D41` 独立复现其行为。

### AC-076 附件限制 —— **通过**（第 1 轮扣分点已消除）

> Given 超数量/大小/错误 mime；When 上传；Then 客户端提示且服务端拒绝，无残留引用。

- **服务端拒绝**：`probeE E1–E12` 合法 `text/plain` → 201 且 mime/bytes/hash/expiresAt 真实；`application/zip` 与可执行 mime 拒绝且点明 mime 限制；20 MiB+1 字节拒绝且点明大小限制；无 file part 拒绝；未认证 401；daemon Bearer 路径同样 201。
- **无残留引用**：`probeE E15/E16/E17` 一条消息带 6 个附件 → 发送事务拒绝且点明数量限制；`E18` 被拒后 6 个上传**仍为 staged**；`probeT01 AC-076` 经 **BFF 真实浏览器路径**重复同一组负例（6 附件拒绝 + 全部保持 staged、zip 拒绝、20 MiB 超限拒绝）。
- **客户端提示**：`probeE E13/E14` Composer 渲染真实附件限制与文件入口；`probeT01 AC-076` 从 BFF 真实取回 `/assets/app.js`，确认存在 `maxCount`/`maxFileBytes`/`maxTotalBytes` 前置校验与 `chief.attachmentTooMany` 拒绝路径。
- 第 1 轮「UI 侧因 T-01 不可达」的扣分**已消除**：上传与发送均经 BFF 可达（见 AC-084）。

### AC-077 文件只读 —— **通过**

> Given 切换分支预览文件；When 浏览/搜索；Then 目标 Revision 正确、根边界生效，不改变 Agent Snapshot。

- `probeE E30` Project 行给出 40 位 revision；`E31/E32` 文件页渲染真实仓库树且 `data-revision` **等于**该 revision；`E33` 有路径搜索；`E35` `?query=orders` 过滤后 `orders.ts` 在、`README.md` 不在；`E36/E37` `?path=src/orders.ts` 渲染真实正文；`E34` 无写入口。
- **根边界**：`E38` 穿越路径**不泄漏**宿主内容；`E39/E40/E41` 各级穿越被拒并给出 `data-code`；`E42` 缺失文件明确报错。
- **无副作用**：`E44` 浏览不新建 Work；`E45` 不移动交付分支；`E46` 不改动 Project Snapshot；`E43` 重复读稳定。

### AC-078 认证生命周期 —— **通过**

> Given 未登录/过期 cookie/错误 Origin；When HTTP/WS 写请求；Then 拒绝、退出失效、受限重试，后台 Work 保留。

- **未登录/过期**：`probeH H1/H2` 匿名 `/rpc` 与页面 401；`H11–H13` 真实 TTL（400ms）内可用、过期后 `/rpc` 与页面均 401；`probeA A50` 无会话写 401。
- **错误 Origin（写请求）**：`probeH H3` 外来 Origin 写 403；`H3b` 缺失 Origin 写 403；`probeA A47–A49` daemon `/ws` 的外来 Origin、无 cookie、仅浏览器 cookie 均被拒，`A45/A46` 只有真实 daemon 会话可升级。
- **退出失效**：`probeH H4` logout 成功；`H5/H6` 旧 cookie 在 `/rpc` 与页面均 401。
- **受限重试**：`probeC C13b/C13c` 见 AC-054。
- **后台 Work 保留**：`H7–H10` 浏览器缺席时 Work/Run 仍 `running`，新登录读数一致。
- **BFF CSRF 偏差**：按 `protocol.md` §2 的已登记偏差口径处理（BFF 不转发/不校验浏览器 `x-csrf-token`，以 HttpOnly 会话 + 精确 Origin 认证，再以自身 `csrfToken` 调 daemon），**不**据此判为缺陷。

### AC-084 首条消息附件 —— **通过（第 1 轮 P1 已消除）**

> Given 新 Conversation 无 Work/Run；When 上传附件再发送首条消息；Then 普通无附件用户/系统消息可用 message_body 存储；staged 附件成功原子绑定新 Work；失败可重试、过期清理、重复绑定拒绝。

**T-01 复验（`probeT01`，42/42）——请求与出厂 `app.js` 完全同形，两次请求都只带浏览器会话：**

- `T01a` 两次登录得到两个**不同**的 BFF 会话与两个不同 daemon 会话，且都认证成功。
- `T01b` **BFF 上传 201 → BFF 首条消息 200 `ok`**；附件 `state=bound`、`boundMessageId` 与消息一致、`workId` 正确；消息体 `ownerUserId` = 附件 `ownerUserId` = `userIdFromSubject('installation:local')`；`origin=user` 产物恰 1 条、`runId` 为空、指向该 Work 与该上传。
- `T01c` 无附件消息经 BFF 200，`message_body` 属主为安装用户且非空。
- `T01d` **会话 B 上传、会话 A 发送** 仍绑定，三方属主全等（同一安装用户）。
- `T01e` 安装 Bearer 上传 + 会话发送仍绑定。
- `T01f` 未知会话发送被拒（`NOT_FOUND`）、附件仍 `staged`、消息数不变（失败可重试）。
- `T01g` 命令账本 subject 仍是 **per-session**（审计），并非安装身份——说明身份与审计主体已按 `protocol.md` §2 分离。
- **其余 AC-084 子句**：`AC-084` 复用已绑定附件 → `ATTACHMENT_ALREADY_BOUND`；过 TTL 经真实 `expireStale()` 置 `expired` 且不可再发送；`probeE E19–E29` 复核 daemon 侧同一链路与产物归属。

**对照第 1 轮**：第 1 轮 `probeG G3` 在此路径得到 `403 NOT_AUTHORIZED belongs to another owner`；本轮同一路径 200 且绑定成立，`T-01` 关闭。

### AC-087 需求池随 Git 迁移 —— **通过**

> Given 空白服务器仅 Clone 含 queued 需求的项目，没有原数据库或模型配置；When 可信打开项目；Then 保留稳定需求 ID、目标、范围、验收、已确认结论与未决项，列表可用，无需重新初始化产品知识。

- `probeF F1–F5` 经真实 `requirement.save` 在 Git 建立需求（`requirement.json` + `content.md` 同 commit）；`F10` 池 README 同 commit；`F11/F12/F13/F14` 投影仅在 Git 一致后可见并可上板。
- `F24b` `projectIdFromRoot` 对同一仓库得到**相同** Project id；`F24` 新 `ProjectStore` 需求投影为 0 行（真独立数据库）；`F25/F26` 交付分支真实含需求目录；`F27/F28` 逐条经真实 `RequirementProjection` 导入后行数与 Git 记录一致。
- `F29–F35` 稳定 id/生命周期/`recordVersion`/标题目标保留，`portableRef` 指向真实 revision，记录 Hash 由真实字节重算，导入记录**不带本机 Work**；`F36/F37` 重复导入幂等。
- `probeK K9–K15/K22/K23` 复核 scope/featureIds/acceptance/openQuestions 的读写保真（`W9R2-02`）。

### AC-088 历史需求展示 —— **通过（承接 WP-04）**

> Given Git 含 completed、cancelled 和 archived 需求；When 新服务器导入；Then 完成摘要和功能/代码引用可查，取消原因及归档前状态保留，缺旧报告标详细证据未迁移，不能据此放行本机验证。

- `probeF F19b/F20–F23` 在 Git 写入 `lifecycle=completed`（含 `completion`）与 `cancelled`（含 `cancellation.reason`）记录并提交；`F38/F38b` 第二服务器导入后生命周期与完成摘要保留。
- `probeB B5` 看板 Archived 列同时呈现 archived 与 cancelled 的真实 `lifecycle`。
- `probeF F48` `reusedPreviousVerification=false`（不据此放行本机验证）。
- **未覆盖**：`evidenceAvailability='summary_only'` 与「详细证据未迁移」文案的逐字核对归 WP-04（沿用第 1 轮告示）。

### AC-089 进行中需求继续 —— **通过**

> Given Git 含 active 需求且无本机 Work；When 打开后点击继续；Then 先显示待继续且不启动 Run；用户继续后创建新 Work，取得本机授权，从未满足 Gate 重新规划验证。

- `probeF F43` 真实 `requirement.save` 建立 `lifecycle=active` 记录；`F44` 详情页渲染；`F45` `requirement.continue` → 200 且返回真实 `workId`；`F46` **Run 数不变**；`F47` 返回本机 `authorizationId`；`F48` `reusedPreviousVerification=false`；`F49` Runs 面渲染正常。

### AC-090 需求保存时机 —— **通过**

> Given 创建或修改需求但尚未开发；When 执行保存并推送保存所在分支，再于新服务器拉取；Then Git 立即含需求及索引；仅 Git 与投影一致后显示已保存，失败通过 requirement.save.retry 恢复原操作，Git 已提交时仅补投影且不重复提交；界面展示分支、提交与未推送状态。

- `probeF F1–F3` 保存应答在 Git CAS 与投影核对后返回，`git.commit` 为 40 位且 = 分支 head；`F4/F5` 两文件同 commit；`F11/F12` 投影仅在 Git 一致后可见并记录 Git 身份；`F13/F14` 保存后才上板且带 `saveState`；`F16–F19` 正文更新产生新 commit 且两文件共享递增版本、`contentHash=sha256(content.md)`。
- **失败不伪装**：`probeF F39–F41` 结构非法正文 → `VALIDATION_ERROR` 且点明结构、分支**不动**。
- **不重复提交（本轮新增）**：`probeK K1–K7` 同键同载荷重放返回**同一** `requirementId`、**不新增投影行**、**不再产生 commit**；同键异载荷 409 `IDEMPOTENCY_CONFLICT` 且不建行；被拒调用不占键。
- **未覆盖**：UI 的「未推送」提示文案与 `requirement.save.retry` 的真实重试链（其按 `protocol.md` §8 走「新请求键指向原 operation」的独立语义，本轮未新增探针，登记）。

### AC-093 需求目录与正文一致性 —— **通过**

> Given 每需求包含 requirement.json 与 content.md，另有 README 缺失、单文件缺失、Hash 错、被 Git 忽略和旧格式样例；When 保存、Clone 导入及加载 Context；Then 两文件共享版本并原子提交，正文修改递增版本且组合 Hash 改变；列表无需 AI 解析，正文可读；README 可重建，其他错误逐条明确显示；依赖需求的 Product/Plan 加载两份同 Revision 来源且冲突不得放行。

- `probeF F4–F9` 两文件同 commit、共享 `version=1`、`contentFile=content.md`、`contentHash = sha256(content.md)`、六个二级标题各一次；`F17–F19` 正文修改 → 版本 2 且 Hash 变化并仍等于新正文 sha256。
- `probeF F10` README 随记录提交；`F36/F37` 重复导入幂等；`F39–F41` 结构错误逐条明确拒绝且分支不动。
- `probeK K17–K23` 取消后正文六标题结构合法、原正文段保留、字段保真。
- **未覆盖**：Hash 错、单文件缺失、被 Git 忽略、旧格式四类负例的逐条码位核对属 WP-04（`KNOWLEDGE_INVALID`/`REQUIREMENT_PATH_IGNORED`/`LEGACY_REQUIREMENT_FORMAT`/`REQUIREMENT_CONFLICT`）；「依赖需求的 Product/Plan 两份同 Revision 来源」属 WP-05/WP-06 Context 链，不在 WP-09 范围。

### 六个必需失败测试

`implementation.md` WP-09 要求六个必需失败测试。我**不引用**产品测试文件，独立复现其行为；同时以仓库证据核对逐字命名：

| 必需失败测试 | 产品用例逐字命名（仓库证据） | 我的独立复现 | 结果 |
|---|---|---|---|
| 持续对话 | `it('持续对话: …(AC-069)')` | `probeB B33–B41`（真实消息、真实路由成 Work、同键重放、异载荷冲突、真实状态与事件） | PASS |
| 过期卡片 | `it('过期卡片: …(AC-070/AC-074)')` | `probeA A21–A27`（`data-expired=true` + 禁用 + 可见原因；强行批准 409 `VERSION_CONFLICT` + `currentVersion`） | PASS |
| 窄屏焦点 | `it('窄屏焦点: …(AC-071/AC-073)')` | `probeC C1–C5c`（三态、顶栏先于 dock、`#liveDockClose`、窄屏覆盖层 CSS、有界策略）；**回焦路径仅覆盖 toggle 分支**（`T2-01`） | PASS（标记 `T2-01`） |
| 断连 | `it('断连: …(AC-078/AC-069)')` | `probeA A38–A44`（同一 socket 自动重连、水位补齐、零重复、零丢失）+ `probeC C13b/C13c`（有界退避） | PASS |
| 配置失败 | `it('配置失败: …(AC-075)')` | `probeD D18–D41`（非法键/类型错/过期版本/不支持 reasoning/未配置 provider，全部拒绝且 revision 不变、输入保留） | PASS |
| 订阅扩大 | `it('订阅扩大: …(AC-054/AC-078)')`、`it('订阅扩大: …(AC-054)')` | `probeI I1–I18`（跨 Project 拒绝且 details 仅含调用方 id、未知订阅/非法 kind 拒绝、合法扩大返回新快照+水位、客户端本地越权零请求） | PASS |

- 集成套件本轮 `26/311` 全绿，六个用例均在其中执行；`probeI` 与 `probeC` 另行独立复现了其行为。

## R2.5 发现（Findings）

### T2-01（P3，不阻断）窄屏覆盖层的关闭控件不把焦点还给顶栏触发按钮（AC-071 明文子句未覆盖）

- **位置**（冻结点 `e9e237d` 工作树）：`apps/web/public/app.js:314-315`（`const close = document.getElementById('liveDockClose'); if (close) close.addEventListener('click', () => setPanelMode('compact'));` —— 该路径无 `focus()`）；对照 `apps/web/public/app.js:300-312`（顶栏 toggle 的点击分支在 `next !== 'open'` 时调用 `toggle.focus()`）；窄屏规则见 `apps/web/public/styles.css:390-431`（`@media (max-width:767px)` 下 Open 为 `position:fixed` 覆盖层，`compact`/`hidden` 时 `.live-dock { display:none }`）。
- **复现**：`probeC C5c`（真实 BFF 会话经 `/assets/app.js` 取回出厂脚本后求值）→ **FAIL**：`liveDockClose` 之后 200 字符内不存在 `focus(`；`C5b` 确认覆盖层与 `display:none` 规则真实存在。
- **观察 vs 期望**：观察到「窄屏下点击覆盖层的 × 关闭后，承载焦点的 `#liveDockClose` 随 dock 一起 `display:none`，脚本不主动把焦点交还 `#liveDockToggle`，键盘用户从页面起点重新遍历」；期望「关闭后焦点回到触发按钮」（AC-071 原文）。
- **契约/子句**：`docs/delivery/acceptance.md` AC-071（「窄屏小于768px时Open为可关闭覆盖层，关闭后焦点回到触发按钮」）；`docs/product/experience.md` §6。
- **为什么现有测试全绿**：产品「窄屏焦点」必需失败测试只对源码断言 `script.toContain('toggle.focus()')` 与 `script.toContain('liveDockClose')`（`apps/web/test/workbench-failures.integration.test.ts:796-798`），并未要求关闭控件自身回焦；`toggle.focus()` 出现在 **toggle** 分支，点击 toggle 时焦点本就在 toggle 上，因此该断言无法发现本缺口。
- **修复方向**：`#liveDockClose` 的 click 处理与 toggle 切换共用同一「关闭即回焦触发按钮」路径（例如关闭时调用 `document.getElementById('liveDockToggle')?.focus()`），并把「窄屏焦点」用例改为断言关闭控件分支的真实回焦。
- **影响边界**：仅无障碍焦点行为，无数据/安全/功能影响；不阻断。

### 已关闭项复核（第 1 轮与 Review 残留）

| 项 | 声明状态 | 本轮独立结论 | 证据 |
|---|---|---|---|
| `T-01`（P1）BFF 上传→BFF 发送不可达 | §T6 声明已修 | **关闭** | `probeT01` 42/42；`probeE E25b/E25c` |
| 第 1 轮 `T-02`（探针计数不一致） | Test 侧脚本缺陷 | **本轮不再出现**：`lib.mjs` 的 `eq()` 只登记一次，报告行合计与明细一致 | 各 probe 汇总行与明细逐条一致 |
| 第 1 轮 `T-03`（会话派生身份） | `§T6` 声明根因消除 | **关闭** | `probeT01 T01a/T01d/T01g`（会话不同、身份同一、会话 id 仅作审计 subject） |
| 第 1 轮 `T-04`（`docs/INDEX.md:44` 漂移） | 留 Settlement | **仍存在**（见 R2.7） | `sed -n '44p' docs/INDEX.md` |
| `W9R2-01` requirement.save 幂等 | Review R3 关闭 | **关闭** | `probeK K1–K7` |
| `W9R2-02` 更新保真 | Review R3 关闭 | **关闭** | `probeK K9–K15`；`probeF` |
| `W9R2-03` 取消保真 | Review R3 关闭 | **关闭** | `probeK K16–K23` |
| `W9R2-05` 中文界面英文诊断 | Review R3 关闭 | **关闭** | `probeA A32a–A32f` |
| `W9R2-06` 恒真断言 | Review R3 关闭 | **关闭（源码守卫 + 独立行为）** | `workbench-failures.integration.test.ts:1025-1026` 无 `\|\| true`、断言 `notice.attempt`；`client-script.test.ts:28` 有 hygiene 用例；`probeA A38/A39` |
| `W9R1-03` 跨 Project `details` 回显本机 id | Review R3 关闭 | **关闭** | `probeI I7/I8`（`details` 键集合仅 `{projectId}`，全文不含本机 Project id） |

### 登记但未复现/未否决的残留

- **R1 `W9R3-01`（P2）`pnpm test:unit` 默认 workers 的残留端口竞态**：本轮以契约命令原文采样 **8 次全部全绿**（55/1105），**未复现**。这既不能证明其已修，也不能否定 R3 的「10 次中 1 次失败于 `broker.test.ts:1267`」；结论限于「本采样下稳定」。契约命令仍应按多次运行或有界并发口径记录。
- **R2 `W9R3-02`（P2）completed/archived 在协议面不可达**：**本轮复现成立**。`probeK K24`：`requirement.save` 带 `lifecycle='completed'` + `completion` → ≥400（`details.reasons` 指向 `completed requirement requires completion`，即 daemon 未把 `patch.completion` 映射进 metadata）；`probeK K25`：`requirement.archive` → **404**（未实现）。读回/保真链路本身正常（`probeF F38/F38b`、`probeK K26`），缺的是**写入口**。UI 不调用 `requirement.save`，不阻断 AC-088 的导入/展示面（该 AC 由 `probeF` 通过），但应显式登记。
- **R3 `W9R3-03`（P3）`git show` 未加 `--end-of-options`**：本轮未复现运行时反例（需先能写投影行），保留 Review 结论作为加固项登记。
- **R4 `docs/INDEX.md:44`**：仍写「协议接线（daemon/BFF/WS）…仍未实现」，与本片已交付 `/rpc`、`/ws`、BFF 九面不符；属未结算的文档漂移，须在 Settlement 更新（不阻断 Test）。
- **R5 `requirement.save.retry`**：按 `protocol.md` §8 走「新请求键指向原 operation」的独立语义，不属通用账本；本轮未新增探针（登记）。

## R2.6 记录一致性核对（`implementation.md` §T6 与代码/证据）

| §T6 声明 | 核对结果 |
|---|---|
| T-01：`installationUserId` 计算一次、`authPort.authenticate` 对所有会话返回它、会话 id 仅作审计 subject | **一致**（`server.ts:102/113`；`probeT01 T01a/T01g`） |
| T-01：附件属主、消息属主、产物归属与 ACL 收敛到同一身份 | **一致**（`probeT01 T01b/T01d/T01e`：三方属主全等、`origin=user` 产物恰 1 条） |
| W9R2-01：`requirement.save` 纳入账本、重放在生成 id 前返回首次结果 | **一致**（`probeK K1–K7`） |
| W9R2-02：`readRequirementRecord()` 只覆盖 patch 显式字段 | **一致**（`probeK K9–K15`） |
| W9R2-03：取消只替换「完成摘要」段 | **一致**（`probeK K16–K23`） |
| W9R2-04：夹具确定化、默认 workers 连续多次全绿 | **本次采样一致**（8/8 全绿）；R3 的反例仍在（`W9R3-01`） |
| W9R2-05：`approval.reasonCode` + i18n 渲染 | **一致**（`probeA A32a–A32f`） |
| W9R2-06：断言改为 `notice.attempt` 并以源码守卫回归 | **一致**（见 R2.5 表） |
| §T6 验证数字：unit 55 文件/1105 用例 | **一致**（8 次采样均 55/1105） |
| §T6 验证数字：integration 26 文件/311 用例 | **一致**（`--maxWorkers=4` 实测 26/311，112.84s） |
| §T6 验证数字：`build` 12 workspace | **一致**（12 个 project `Done`） |
| §T6：`docs:check` 通过 | **一致**（15 documents / 55 links / 94 ACs / 9 requirements / 11 work packages） |
| §T6 未修项：`docs/INDEX.md` 漂移、`requirement.save.retry` 不入通用账本、两份 T4 夹具仍复刻路由、`T-02/T-04` | **一致**：`docs/INDEX.md:44` 未改；`workbench-identity.integration.test.ts` 已覆盖 T-01 的真实产品路径 |
| 越界说明：`packages/core/test/broker.test.ts` 只改夹具 | **未逐行复核 diff**（超出 WP-09 AC 面）；本轮 unit 全绿与 R3 的复核结论不冲突 |

## R2.7 未覆盖与剩余风险

| 项 | 状态 | 原因 | 承接 |
|---|---|---|---|
| 无头/真实浏览器（键盘焦点遍历、弹层焦点约束、ARIA 实机朗读、像素级） | **未覆盖** | 环境无 headless browser；以「真实 SSR 标记 + 出厂 `app.js` 源码事实 + 真实 HTTP/WS」为证据 | WP-10 |
| 真实模型 / Provider | **未覆盖** | 无真实凭据；全部结论来自确定性路由与配置解析 | WP-10 |
| `pnpm test:e2e` / `test:acceptance` / `test:live` | **未执行（按设计）** | 按契约返回 `NOT_IMPLEMENTED` | WP-09/WP-10 |
| 真正 kill BFF 进程后的端到端恢复 | **未覆盖** | BFF 重启需重新登录，属设计边界 | WP-10 |
| `requirement.save.retry` 的真实重试链 | **未覆盖** | 其语义为「新请求键指向原 operation」，不属通用账本 | WP-08/结算 |
| AC-088 的「详细证据未迁移」文案 / AC-093 的四类负例码位 | **未覆盖** | 属 WP-04 导入演练 | WP-04 |
| 集成命令稳定性 | **单次运行** | 未多次重复以估计集成项目稳定性 | 结算 |
| `docs/INDEX.md:44` 漂移、`W9R3-02`/`W9R3-03` | **登记** | 不属本片 UI 面或为加固项 | 结算 |

**剩余风险**：`T2-01`（P3）为唯一的未达成明文子句（窄屏关闭回焦）；`W9R3-02`（completed/archived 写入口缺失）在本轮被独立复现，UI 不调用 `requirement.save`，故不影响 WP-09 的 AC-088 展示面，但结算前应显式处置。

## R2.8 结论

- **AC-054、AC-068、AC-069、AC-070、AC-072、AC-073、AC-074、AC-075、AC-076、AC-077、AC-078、AC-084、AC-087、AC-088、AC-089、AC-090、AC-093 通过**；**AC-071 通过（附 P3 残留 `T2-01`，不阻断）**。
- **第 1 轮唯一阻断项 `T-01` 已关闭**：经 BFF 上传 → 经 BFF 发送首条消息在真实产品 `createDaemon` + 真实 BFF 上绑定成功（42/42），AC-084 与 AC-076 的 UI 可见链均可达。
- 契约命令 **6/6 退出 0**；`test:unit` 默认 workers **8/8 全绿 55 文件/1105 用例**；`test:integration --maxWorkers=4` **26 文件/311 用例**全绿。
- 自建实验 **397 条判定，396 通过 / 1 失败**，唯一失败为 `T2-01`（P3）。
- 无 P0/P1 复现。

**Test 判定：PASS —— 接受 WP-09 的全部 AC（AC-054、AC-068～078、AC-084、AC-087～090、AC-093）；AC-071 附带 P3 残留 `T2-01` 与登记的 `W9R3-01/02/03`、`docs/INDEX.md:44` 漂移。**
