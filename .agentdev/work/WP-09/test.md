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
