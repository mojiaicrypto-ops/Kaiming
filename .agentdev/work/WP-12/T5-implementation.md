# WP-12 T5 实施记录：单入口多项目与项目初始化

- 状态：Developing 完成，证据已跑；Test 阶段仍待独立复核（本文件只记录开发侧真实执行结果）
- 依据：`.agentdev/work/WP-12/T5-plan.md`（含 §15 九条主管裁决）、`.agentdev/work/WP-12/api-gap-audit-2.md`、`docs/architecture/{ARCHITECTURE,protocol,reliability}.md`、`docs/product/experience.md`、`docs/delivery/acceptance.md` AC-023/025–029/034/060/082/087–089
- 工作树：`main`，未 `git add`/`git commit`

---

## 0. 交付摘要

一台安装（一个 daemon 宿主 + **一个** BFF 入口）可以打开多个真实 Git 项目；浏览器登录一次即可用同源链接切换项目；每个页面只呈现所选项目的真实数据；`project.list/open/create/clone/trust/close/initialize` 全部有真实处理器、真实集成测试与文档要求的事件；`packages/workspace/src/initialize.ts` 有了唯一的生产调用方；首次 open 自动导入交付分支上的需求池（全程不播种任何需求行）。

新增文件：

| 文件 | 作用 |
|---|---|
| `apps/daemon/src/project-directory.ts` | 安装级项目目录：注册表容错、名字、每 Git-root 锁、生命周期、初始化/导入驱动接线 |
| `apps/daemon/src/initialize-driver.ts` | `project.initialize` 生产接线 + `initialization.progress/completed` 发射点 |
| `apps/daemon/src/requirement-import.ts` | 首次 open 的需求池导入（交付分支解析 → 真实 git 读 → `RequirementProjection.import`） |
| `apps/web/src/projects.ts` | BFF 与宿主共享的 `ProjectDirectoryPort` 形状（含 `ProjectEntry`/`ProjectTarget`） |

测试（全部真实 SQLite / 真实 Git / 真实 HTTP / 真实 Chromium，**无播种需求行**）：

| 测试 | 覆盖 |
|---|---|
| `apps/daemon/test/project-lifecycle.integration.test.ts` | AC-023、AC-025、AC-034；Q2/Q3/Q5 行为 |
| `apps/daemon/test/project-initialization.integration.test.ts` | AC-026/027/028/029；Q8 模式推导 |
| `apps/daemon/test/requirement-import.integration.test.ts` | AC-087/088/089、AC-092 surface；真实 clone 到第二安装（空 SQLite） |
| `apps/web/test/multi-project.integration.test.ts` | AC-023/034/060：单 BFF 路由、切换器、跨项目 artifact/token/cursor 拒绝 |
| `apps/daemon/test/project-host.integration.test.ts` | 真实 `startRuntime` 单 BFF + 两项目 + 页面隔离 + 单项目安装 URL 兼容 |

---

## 1. T5.1 宿主项目目录与生命周期核心

**改动**

- `packages/contracts/src/runtime.ts`：`RUNTIME_FILES.locks`、`RuntimePaths.locks`、`projectLockFileName(canonicalRoot)=sha256(root).lock`；`projectRegistryEntrySchema` 增加可选 `name`（Q1）。
- `packages/core/src/runtime.ts`：
  - `readProjectRegistryReport()`：**逐条容错**（Q2）——容器级损坏仍抛 `PROJECT_REGISTRY_INVALID`，单条 schema 非法或 root/projectId 重复则跳过并上报，`readProjectRegistry()` 返回可用子集；
  - `registerProject()` 支持 `name`（省略则保留原值）；
  - 每 Git-root 锁：`acquireProjectRootLock/readProjectRootLock/releaseProjectRootLock`，文件在 `~/.agentdev/locks/<hash>.lock`（Q5），独占创建 + 死 pid 接管 + epoch 校验释放；
  - 安装级 once-Grant：`mintInstallationGrant/consumeInstallationGrant/installationGrantInputHash`，字段与语义对齐 T3 `grant` 的 `once` 作用域（operation + targets + inputHash + 过期 + 一次性消费），落在 `~/.agentdev/grants.json`（Q4；`GrantStore` 是 Work/项目内的存储，clone 时尚无项目库，故此处置见 §6 已知差异）。
- `apps/daemon/src/project-directory.ts`（新）：`list()/entryOf()/findByRoot()/targetOf()/defaultProjectId()/projectIdFor()/open()/create()/clone()/trust()/close()/initialize()/investigate()/grantClone()/deactivateAll()`；同进程并发 open 用 in-flight 表合并为一次装配；`close` 为导航级（Q3）；`stop` 释放本进程持有的全部 root 锁。

**真实命令与结果**

```
$ pnpm typecheck                # exit 0
$ pnpm -r build                 # 全部 Done（contracts/client/domain/pi-runtime/knowledge/storage/workspace/core/web/runner/cli/daemon）
$ npx vitest run --project integration apps/daemon/test/project-lifecycle.integration.test.ts
 ✓ 11 passed (11)
```

关键断言：两个真实 root → 两个不同 projectId + 两个独立 `project.sqlite`（A 写会话行，B 计数 0）；`projects.json` 两条；`locks/` 存在且用户仓库内无锁文件；同 root 二次 open 幂等；第二个目录实例对同 root 得 `PROJECT_ALREADY_OPEN`（含持有 pid/home）；损坏注册表条目被跳过并在 `list()` 里以 `unreadable` + `PROJECT_ENTRY_INVALID` 上报，健康项目照常；`trusted:false` 落库可读回；有 live Run 时 `close` 拒绝 `INVALID_STATE`。

---

## 2. T5.2 协议面：`project.*` 与三类事件

**改动（`apps/daemon/src/protocol.ts`）**

- `WorkbenchServices.projectDirectory?` + `attachProjectDirectory(port)`（与 `attachOrchestrator` 同构）。
- `GLOBAL_METHODS` 收 `project.list/open/create/clone/trust/close/initialize`（安装级，省略/不比对 projectId）；`WRITE_METHODS` 与 `LEDGER_WRAPPED_METHODS` 收 5 个写命令；`project.open` 保持既有账本包裹。
- 新增 case 与处理器：
  - `project.list`：有目录时返回安装内全部条目 + `problems`（Q2）；无目录时保持原单项目回退；
  - `project.open`：已打开 → 文档形状 `{projectId,version,trust,gitState}` 同步幂等；冷开 → `accepted` + `operationId`，失败发 `operation.failed`；
  - `project.create/clone`：`accepted` + `operationId`，成功后 `project.created` 发到**新项目自己的流**（Q9）；
  - `project.trust/close`：同步 `applied`；目标取信封 `projectId`（文档 params 无 projectId，缺失即 `VALIDATION_ERROR`，不猜）；
  - `project.initialize`：`accepted`；`budget.files/bytes` → `maxBodyFiles/maxBodyBytes`；
  - `project.snapshot.get` 补 `trust/initialization/deliveryReadiness/requirementImport`。
- 只新增 `project.created`、`initialization.progress/completed`、`operation.failed` 三个事件的发射点；不新造安装级事件流（Q9）。
- `apps/daemon/src/bootstrap.ts`：`openProject` 接受 `projectDirectory` 并 attach。

**真实命令与结果**

```
$ npx vitest run --project integration apps/daemon/test/protocol.integration.test.ts
 ✓ 24 passed (24)          # 既有 24 条协议用例未回归
$ npx vitest run --project integration apps/daemon/test/project-lifecycle.integration.test.ts
 ✓ 11 passed (11)          # 其中 project.* 6 条
```

---

## 3. T5.3 `project.initialize` 生产接线

**改动（`apps/daemon/src/initialize-driver.ts` 新）**

- `createInitializer({store: createJsonFileInitStateStore(dataDir/initialization.json), git: createNodeWorktreeGitPort(), documentRoot, branch})`；
- 模式由 root 真实状态推导（Q8）：无 Git 且空目录 = `new`，否则 `legacy`；显式 `mode:'new'` 只对**已存在 Git 仓库**拒绝（`git init` 不摧毁内容，重写历史才是破坏性动作），实际扫描事实随 `INVALID_STATE.details` 返回；
- `budget{files,bytes}` → `ScanBudget`；每相位发 `initialization.progress`，Ready 发 `initialization.completed`；
- 只自动处置两类 blocker：`git-initialization`（`project.create/clone` 或显式 `mode:'new'`）与 `confirmation-required`（命令本身即 `protocol.md` §8 的真实用户动作）；`dirty-workspace`、`design-conflict`、`investigation-budget` 原样返回；
- 提供只读 `investigateProject()`（无 Git/脏工作区/blocked 均可用）。

**真实命令与结果**

```
$ npx vitest run --project integration apps/daemon/test/project-initialization.integration.test.ts
 ✓ 5 passed (5)
```

- 旧项目：Ready，4+1 份候选文档落盘，源码与 HEAD 未变，`initialization.progress`/`initialization.completed` 出现在项目自己的流里；
- 脏工作区：`blockerKind='dirty-workspace'`，逐路径 sha256 等于真实文件哈希，未写任何候选文档，`investigateProject` 仍成功且 `wroteFiles=false`；
- 无 Git 目录（有内容）：不带 `mode` → `git-initialization` blocked，`.git` 与 `docs/agentdev` 均未创建；显式 `mode:'new'` 才允许 `git init`；
- 有 Git 仓库 + `mode:'new'` → `INVALID_STATE`（不替换历史）。

---

## 4. T5.4 首次 open 的需求池导入

**改动（`apps/daemon/src/requirement-import.ts` 新）**

- 修订解析顺序：本地 `agentdev/main` → `origin/agentdev/main` → HEAD（`requirements.md` 交付分支规则；真实 clone 通常只有远端跟踪引用）；
- `readRequirementPoolAtRevision` → 逐条 `RequirementProjection.import`；
- **逐条容错**：一条记录不合法只记 `REQUIREMENT_CONFLICT` 冲突，其余有效条继续导入并可查询（`protocol.md` §8）；
- `ProjectDirectory.open` 在装配成功后自动触发一次，摘要进 `ProjectEntry.import` 与 `project.snapshot.get`。

**真实命令与结果**

```
$ npx vitest run --project integration apps/daemon/test/requirement-import.integration.test.ts
 ✓ 3 passed (3)
```

- 源仓库在 `agentdev/main` 提交 5 条记录（queued/active/completed/cancelled/archived）；`git clone` 到第二安装（空 SQLite）后 `open`：`store.requirements.count()===5`、`store.runs.count()===0`、active 记录 `executionAvailability='needs_replan'`、`workId` 为空、`evidenceAvailability='summary_only'`、导入摘要 `source='origin-branch'`、`revision` 为真实 40 位 OID；
- 缺 `content.md` 的记录 → 4 条导入 + 冲突上报且 `writeBlocked=true`；
- 无池仓库 → 0 行，不凭空生成 `.agentdev`；
- 该文件内**没有** `store.requirements.insert`（可用 `grep` 复核）。

---

## 5. T5.5 单入口 BFF、切换器与项目范围产物 URL

**改动**

- `apps/web/src/projects.ts`（新）：`ProjectDirectoryPort`（`list/entryOf/findByRoot/targetOf/defaultProjectId/projectIdFor/open/create/clone/trust/close/initialize/problems`）。
- `apps/web/src/app.ts`：
  - `WebAppOptions.projects?`；`routeOf(projectId)` 按请求选目标，命名未服务项目 → **404 失败关闭**，不回退到别的项目；
  - `/rpc`：按 `envelope.projectId` 选目标；安装级方法或未命名 → 默认项目；Project 方法缺 `projectId` 时 BFF 注入路由到的项目 id（D-T5-6），daemon 侧 `projectId!==this.projectId` 仍是第二道墙；
  - `/ws?projectId=` 握手时绑定单个项目（D-T5-5）；`BridgeConnection` 的 `project.subscribe`/Project 方法带绑定 id；
  - 页面渲染：路径里的项目决定所有读的目标；`/projects` 列出安装内全部条目 + 注册表问题；shell 顶栏新增共享切换器；
  - 产物 URL **只接受** `/artifacts/<projectId>/…`（Q6）：`splitArtifactPath` 对缺项目段或保留字（`download`/`download.prepare`/`upload`/`uploads`）返回 `undefined` → 404；转发到 daemon 时剥掉项目段。
- `apps/web/src/{shell,pages,views,index}.ts`、`apps/web/public/app.js`：切换器、条目生命周期/初始化 chips、`previewHref`/`downloadPreparePath`/上传/下载 URL 带 `projectId`（前端无 projectId 时直接拒绝，不做隐式回退）。
- `apps/daemon/src/main.ts`：宿主建**一个** `ProjectDirectory`；项目一律 `withWeb:false`；宿主创建一个 BFF；`RunningRuntime.web/directory`；`publishedInstances()` 让每个实例的 `web` 指向该 BFF（`agentdev open/status` 仍打印可用 URL）；admin `POST /projects` 支持 `action: create/clone/grant` 并返回 `operationId`；`GET /projects` 增 `problems/bff`；`stop()` 释放全部 root 锁。
- `tests/browser/**`：`helpers.previewPath`、`ac-002-052`（下载 URL 断言 `/artifacts/<projectId>/download/<token>` 正则 + 一次性重放 403）、`ac-076`（精确匹配 `/artifacts/<projectId>/upload`，未放宽）。

**真实命令与结果**

```
$ node scripts/e2e.mjs
browser: 16 passed (10.7s)
PASS  browser.html-preview-and-download   [AC-002]
PASS  browser.html-attack-samples         [AC-052]
PASS  browser.live-layout                 [AC-071]
PASS  browser.keyboard-aria-i18n          [AC-073]
PASS  browser.attachment-client-hints     [AC-076]
e2e: 25 checks — PASS 24 / FAIL 0 / UNVERIFIED 1（provider.fact-and-unknown，离线桩零调用）
e2e: exit 0
```

```
$ npx vitest run --project integration apps/web/test/multi-project.integration.test.ts
 ✓ 6 passed (6)
$ npx vitest run --project integration apps/daemon/test/project-host.integration.test.ts
 ✓ 1 passed (1)
```

- 两个真实 daemon + 一个 BFF、登录一次：A 页只含 `ALPHA-ONLY-REQUIREMENT`，B 页只含 `BETA-ONLY-REQUIREMENT`；`/rpc` 指定未服务项目 → 404 且响应体不含任何一方字段；
- 产物：A 的 token 经 A 路由 200 且含真实字节、重放 403；同一 artifactId/新 token 经 B 路由 ≥400 且响应体不含 A 字节；`/artifacts/download/<token>`（无项目段）→ 404；
- 事件：B 的 socket 以 A 的 cursor 订阅只回放 B 自己的日志（无 A 会话 id/标题），未服务项目的 `/ws` 升级被拒；
- `startRuntime` 真实起两项目：`GET /projects`（admin）两个 instance 的 `web.port` 都等于唯一 BFF 端口，`bff.port` 一致；未服务项目页 404。

---

## 6. 验收证据升级（AC 从库级/播种 → 产品路径）

`node scripts/acceptance.mjs` 生成 `.agentdev/work/WP-12/acceptance-results.json` 后逐条核对（app 层证据由新测试提供）：

| AC | 新应用层证据 |
|---|---|
| AC-023 | `project-lifecycle`「opens two real roots…」；`multi-project`「renders each project page…」 |
| AC-025 | `project-lifecycle`「creates a project in an empty directory with Git, the delivery branch and the events」 |
| AC-026 | `project-initialization`「investigates a legacy project and reaches Ready without moving the code」 |
| AC-027 | `project-initialization`「refuses to run git init without the explicit mode and reports the request」 |
| AC-028 | `project-initialization`「blocks a dirty workspace with a per-path hash report…」 |
| AC-029 | `project-initialization`「stops on a workspace it must not overwrite and reports the real per-path hashes」 |
| AC-034 | `project-lifecycle` 跨项目读拒绝；`multi-project` 页面/rpc/token/cursor 四条 |
| AC-087/088/089 | `requirement-import`「restores every lifecycle from a real clone with an empty database」 |
| AC-092 | `requirement-import`「keeps valid records visible next to a broken one…」 |
| AC-060 | `multi-project`「binds the event socket to one project…」 |

AC-023/025/026/028 此前只有库级证据，现在各有且至少有 1 条应用层证据；AC-087/088/089 的关键断言不再依赖 `seedRequirement`。

**`node scripts/acceptance.mjs` 结果：`acceptance: 94/94 ACs accounted — PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0`，但退出码 2**，三条基础设施原因（均不在本切片）：
1. `pnpm test:live` 报告的 codeDigest 与当前树不一致（树在动，按主管说明等稳定树重跑）；
2. 「某个 Vitest 项目没有产出 JSON 报告」；
3. 失败用例 `apps/daemon/test/tool-bridge-permissions.integration.test.ts :: … (G8) refuses, records and then admits tools through the real Broker` 未映射到 AC（T3/G8 车道；该文件在本次运行后被删除/更名）。

---

## 7. 未做 / 已知差异（诚实清单）

**文档—实现差异（需产品/架构确认，未擅自改产品行为）**

1. **`project.open` 冷开返回 `accepted`**：文档 §3 只写 `{projectId,version,trust,gitState}`。装配需要绑定监听端口（Node 无法同步 await `listen`），因此未打开过的 root 返回长操作封套 `accepted`+`operationId`+`projectId`，客户端按 `project.list` 轮询到 `open`；已打开时严格按文档同步返回。`project.create/clone/initialize` 的 `accepted` 与文档一致。
2. **`project.initialize` 的 Git 初始化授权入口**：文档 params（`mode,sourceMessageId,budget?`）没有“授权”字段。实现取「显式 `mode:'new'` 即授权」+「`project.create/clone` 自身即显式动作」。无 Git 但已有内容的目录若不带任何显式模式，只能得到 blocker，`project.initialize` 之外没有第二次授权命令。AC-027 的产品路径因此由一个 driver 级测试（真实文件系统）+ `create` 覆盖。
3. **`project.close` 的 `version`**：目录对已关闭/未打开条目没有本地行可读，`projectSummaryOfEntry` 用 `version:0` 表示“未读本地行”，不是版本 0。
4. **`project.list` 条目的 `state`**：`ProjectState` 只有 `open/closed`，`missing`/`unreadable` 用新增的 `lifecycleState` + `problem` 表达（避免改 contracts 枚举）。
5. **CLI 未接新 admin action**：`action:create/clone/grant` 已实现于 admin HTTP，但 `apps/cli/**` 不在本切片车道，未加 `agentdev project create/clone` 子命令。
6. **安装级 Grant 存储**：Q4 要求“复用 T3 Grant 模型、不新造授权存储”。实现复用**模型**（operation+targets+inputHash+once+expiry，字段命名与 T3 `grant` 一致），但 T3 的 `GrantStore` 绑定“运行中的 Work + 项目库”，clone 时尚无项目库，故记录落在安装 home 的 `grants.json`。这是与裁决字面最紧的可行落点，仍属需要确认的差异。
7. **Q5 跨 home 限制**已登记：两个不同 `AGENTDEV_HOME` 的安装互相看不到对方 `locks/`，同一 root 可被两个安装同时服务；单安装内多项目/多进程竞争已被覆盖。

**已知库级缺陷（不在本切片可写范围）**

8. `packages/workspace/src/initialize.ts` 的 `writeBatchSize` 有限批写入**永不推进**：已写盘文档会计入下一批的 `processed`，批次在最后一个文档前 break，记录停在 `writing`。生产接线因此不设 `writeBatchSize`（一步一相位），并在代码注释中登记。
9. `RequirementProjection.import` 对**非法记录**抛 `RequirementRecordError`（而非返回 conflict）；`requirement-import.ts` 已逐条 catch 转为冲突，其余入口是否也应如此未逐一核。

**未完成**

10. ~~T5.6 浏览器切换规格未新增~~ → **已完成**，见 §9：`tests/browser/ac-projects-switch.spec.mjs`（真 Chromium + 真实宿主两项目，非播种数据）。
11. `scripts/lib/acceptance-registry.mjs` 的**证据重标**未做（`scripts/**` 非本切片车道）：好在注册表按测试名里的 AC 号自动归类，新测试已带上 AC 号并被聚合器采纳（见 §6 表）；旧库级/播种证据仍在同一 AC 的证据列表里，未被删除。
12. `docs/INDEX.md`、Code Map、`docs/delivery/implementation.md` §T5 的 Settlement 收口未做（属 Settlement 阶段）。
13. `recovery.report_ready`、`knowledge.updated`、`token.delta/log.delta/heartbeat` 仍无发射点（T9 车道，非 T5 范围）。

**本切片可复现的判据（`git status` 之外的注记）**

14. `pnpm lint` 在本切片文件上全绿；命令残留 1 条错误位于 `apps/daemon/test/tool-bridge-permissions.integration.test.ts`（T3/G8 车道，且该文件在最后一次运行后已从工作树删除）。
15. 根 `pnpm test:integration` 在本切片末尾的完整运行：`Test Files 2 failed | 51 passed`，两条失败均为 G8/T3 的 Runner+Provider 超时（`probe-g8turn1` / `tool-bridge-permissions`），无一条来自 `project.*`、BFF 路由、产物或初始化路径。

---

## 8. 复跑命令（当次真实）

```bash
export PATH="$HOME/.local/bin:$PATH"
pnpm typecheck                                  # exit 0
pnpm -r build                                   # 全部 Done
pnpm test:unit                                  # 76 files / 1411 tests passed
pnpm test:integration                           # 51 passed / 2 failed（均 T3/G8 parse 之外的 Runner 超时）
npx vitest run --project integration \
  apps/daemon/test/project-lifecycle.integration.test.ts \
  apps/daemon/test/project-initialization.integration.test.ts \
  apps/daemon/test/requirement-import.integration.test.ts \
  apps/daemon/test/project-host.integration.test.ts \
  apps/web/test/multi-project.integration.test.ts   # 26 passed
node scripts/e2e.mjs                            # exit 0；browser 17 passed（含 ac-projects-switch）
node scripts/acceptance.mjs                     # 94/94 accounted；退出码 2（live digest/缺报告/G8 失败未映射）
npx playwright test --config tests/browser/playwright.config.mjs ac-projects-switch   # 1 passed（18.6s，真 Chromium）
pnpm -r build                                   # 改动后复跑：全部 Done
npx vitest run --project integration apps/web/test apps/daemon/test/project-*.integration.test.ts \
  apps/daemon/test/requirement-import.integration.test.ts apps/daemon/test/runtime.integration.test.ts \
  apps/daemon/test/secret.integration.test.ts apps/daemon/test/protocol.integration.test.ts   # 13 files / 120 passed
pnpm docs:check                                 # ok — 16 documents, 65 links, 94 ACs
pnpm lint                                       # 仅 T3/G8 文件 1 条
npx prettier --check <本切片改动文件>            # 全部通过
```


---

## 9. T5 收尾（§15 裁决落地 + G5 浏览器切换证据）

### 9.1 三条产品面裁决的落地

**① `project.open` 冷开 = `accepted`（已接受并写清就绪判据）**

- `docs/architecture/protocol.md` §3 的 `project.open` 行已改：已打开同步返回 `{projectId,version,trust,gitState}`；冷开返回 `accepted {operationId,projectId,root}`；并在 §3 正文新增「project.open 的冷开就绪规则」段落，明确就绪事实**只有两个来源**、调用方不得凭时间猜测：
  1. `project.list` 中该条 `lifecycleState` 变为 `open`（`runningRuns`/`executionReady` 同时可用）；
  2. 该项目的 `project.snapshot.get`/任何 Project 读方法从 `NOT_FOUND` 变为可读。
  失败走 `operation.failed`（发到发起方所在项目的流）+ admin/CLI 的 error code + operationId。
- **调用方如何等就绪**（文档已写）：CLI `agentdev open` → 回环 admin `POST /projects`，宿主同步完成装配后返回 instance 及其 BFF 地址，**无需轮询**；浏览器/`/rpc` → 收到 `accepted` 后轮询 `project.list` 到 `lifecycleState==='open'` 再导航。
- **真实测试覆盖冷开→就绪**：`apps/daemon/test/project-host.integration.test.ts` 新增用例「publishes a cold-opened project from accepted to servable through the real BFF」——真实 `startRuntime`（1 项目）→ 经 BFF `/rpc` 对第二个真实 repo 发 `project.open` → 断言 `status==='accepted'` + `operationId`；随后**只**轮询 `project.list` 直到 `lifecycleState==='open'`；再断言同一 BFF 上该项目页 200、切换器含两个项目、`runtime.instances` 含新 id。

**② `project.initialize` 的 `mode:'new'` = Git 初始化显式授权**

- `protocol.md` §3 的 `project.initialize` 行改为 `mode?:new/legacy（提示兼授权，见下）`，并在 §3 正文写明：模式最终由 Core 依据 root 真实状态推导；`mode:'new'` 同时是**用户对在目标目录初始化 Git 的显式授权**；缺省/`legacy` 时无 Git 目录一律返回 `git-initialization` blocker，**不得静默 `git init`**；`project.create/clone` 自身即显式动作；`budget.files/bytes` → `maxBodyFiles/maxBodyBytes`。
- **负例（非空且未授权不得静默 `git init`）**：`apps/daemon/test/project-initialization.integration.test.ts` 新增「never silently re-initializes an existing repository from a bare new-mode request (AC-027)」——产品路径 `ProjectDirectory.initialize(mode:'new')` 对既有 Git 仓库被拒（`INVALID_STATE`），断言 HEAD 未变、`agentdev/main` 未建、`docs/agentdev` 未生成；无 Git 且有内容的目录仍返回 `git-initialization` blocker，`.git` 未创建、`keep.txt` 原样。
- 附带修正：`ProjectDirectory.initialize` 的同步拒绝改为**拒绝的 Promise**（`Promise.reject(Error)`），协议侧的 `.catch` 才能把失败落到 `operation.failed`；新增 `StartRuntimeOptions.webOrigins`（BFF/AuthService 的精确 Origin 白名单）供临时端口部署使用。

**③ `project.clone` 的安装级 Grant**

- `docs/architecture/reliability.md` §7 新增「安装级Grant（WP-12 T5 Q4）」段：`~/.agentdev/grants.json`（0600、原子写）；语义与项目级 `grant` 的 `once` 一致（绑定 operation + targets + inputHash、`issuedAt/expiresAt`、只能消费一次、消费写 `consumedAt/consumedByOperationId`）；拒绝未知/过期/不匹配；已消费 → `INVALID_STATE`，不重放；**与项目级 Grant 的区别**：项目级跟随 Work/Run 生命周期并被准入路径消费，安装级只服务安装级环境操作、不参与 Run 准入；授权由用户显式动作（回环 admin 面）铸造，`grantId` 即该行 id。
- 同一段还补记了每 Git-root 锁（`~/.agentdev/locks/<hash>.lock`、不写用户仓库、`PROJECT_ALREADY_OPEN`、跨 home 限制）与注册表逐条容错（单条坏记录跳过并上报，容器级损坏才拒绝启动）。

### 9.2 G5 浏览器切换证据（新增）

- `tests/browser/stack-runtime.mjs`：新增 `openSwitcherStack()`——用**真实宿主** `startRuntime` 起一个安装（一个 home、一个 BFF、每项目一个真 daemon + 真 SQLite），两个项目都经真实 `project.create`（真 `git init` + 初始提交 + `agentdev/main`）；每个项目再由真实协议命令写入一条 **Git-backed Requirement**（`requirement.create`）与一个 **user Artifact**（`/artifacts/<projectId>/upload` + `conversation.message.send` + `artifact.download.prepare`）。**全程无 `requirements.insert`/`seedRequirement`**。夹具经 `fixture.switcher` 暴露（`globalSetup` 里与单项目栈一起启动，teardown 一起关闭）。
- `tests/browser/ac-projects-switch.spec.mjs`（新，真 Chromium）断言：①登录一次后不再出现 `#loginForm`，`/projects` 同屏含两个 `data-project`；②经切换器切到 B 后 `#shell[data-project=B]`，页面只含 B 的 Requirement 标题/id/artifactId，不含 A 的，反向同理；③在 B 页点名 A 的 `/rpc` 返回 **A 自己**的数据、点名 B 返回 B 的、未服务 `projectId` → 404 且响应体无任一方标题；④Live：A 的 socket 从 0 重放含 A 的 requirement id；B 的新 socket 从 0 重放含 B 的；把 **A 的 cursor** 交给 B 的 socket 不回放 A 的事件；未服务项目的 `/ws` 升级失败关闭；⑤产物：A 自身 preview/download 200（含 A 的内容）、同 token 重放 403，A 的 artifactId 经 B 路由 ≥400、B 的 token 经 A 路由 ≥400、无项目段的 `/artifacts/download/<token>` → 404。
- 读法说明（不改断言）：因为 `/rpc` 的目标**由信封 `projectId` 决定**（§15 裁决的模型），断言③的判别点是「答案归属被点名的项目，且未服务的名字被拒」——不存在“指向 B 却隐蔽落到默认项目”的第二种目标。
- `apps/web/test/multi-project.integration.test.ts` 的 A/B 区分内容仍来自 `seedRequirement`；该用例支撑的是 **BFF 路由与隔离**（AC-023/034），**不是**导入路径（AC-087–089 由 `requirement-import.integration.test.ts` 的真实 clone 用例支撑）。G5 的浏览器证据已按裁决改为**非播种数据**。

### 9.3 G5 期间发现并修掉的真实缺陷

> Lint 收尾（本轮）：`pnpm lint` 的 ESLint 阶段全仓 exit 0（使用 `scripts/typescript-6-preload.cjs` 的 TS6 API）；本车道曾报的 4 处已全部修掉——`apps/daemon/src/project-directory.ts:717`（`prefer-promise-reject-errors`，改为 `Promise.reject(Error)`）、`apps/daemon/test/project-host.integration.test.ts:125/133`（`no-useless-assignment` / `no-base-to-string`，改为带类型收窄的 `lifecycleOf()` 轮询）、`tests/browser/stack-runtime.mjs:274`（缺 `mkdtempSync` 导入）。定点复核：`NODE_OPTIONS=--require=scripts/typescript-6-preload.cjs eslint <本切片 14 个文件>` → exit 0；`prettier --check` 本切片文件（含 `tests/browser/**`、`apps/web/public/app.js`）→ 全部通过。`pnpm lint` 剩余仅是 T2/T3 的 3 个文件 prettier warn（`apps/runner/test/read-ledger.test.ts`、`packages/core/test/gateway-http.test.ts`、`scripts/lib/live-drills.mjs`）。

**零项目安装无法登录**：宿主在项目打开前创建 BFF，`handleLogin` 却固定用构造时的 fallback daemon 目标（默认 `127.0.0.1:4318`，此时没有任何监听）。修复：`apps/web/src/app.ts` 新增 `loginTarget()`，登录/登出改为**按当前情况解析**目标（`routeOf(undefined)` → 默认项目），因此 `project.create` 之后同一 BFF 立即可登录。这条路径正是“新安装 → 建第一个项目 → 进 WebUI”的实际顺序，G5 夹具依赖它。
