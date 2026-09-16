# WP-12 信任落地：未信任 = 只读在生产路径真的成立

- 状态：Developing（证据段在门禁跑完后填写；本文件为本切片的唯一交付记录）
- 上级依据：`.agentdev/work/WP-12/project-ux.md` §3/§5、`docs/architecture/execution.md` §2/§3/§7、`docs/architecture/protocol.md` §3/§6、`docs/rules/agents.md` §1、`docs/product/experience.md` §1/§2。
- 范围：`apps/daemon/src/{prepare-run,runner-spawn,project-directory,protocol,tool-handler,main}.ts`、`packages/core/src/{permissions,broker,execution,orchestrator}.ts`、`packages/pi-runtime/src/**`（信任/资源加载只读引用）、`apps/web/src/**`、`apps/web/test/**`、`tests/browser/**`、`docs/architecture/protocol.md`、`.agentdev/work/WP-12/project-ux.md`、测试。
- 无新增运行时依赖、无迁移、无 `git commit`。未改 `packages/workspace/**`、`packages/core/src/{integrate,settlement,task-candidate,read-ledger}.ts`、`docs/delivery/**`、`docs/product/**`；`scripts/lib/drill-acs.mjs` 未追加，`docs/delivery/acceptance.md` 未编辑。

## 1. 接在哪（把已有的语义连到生产路径）

产品保留了「打开文件夹只问一次是否信任」的提示，所以未信任必须**可执行地**意味着只看不改。原先只有 `packages/pi-runtime` 的 `loadTrustedExtensions`/`createExplicitResources` 具备「未信任不加载仓库自带指令与扩展资源」的语义，但生产路径既没把真实信任状态告诉 Runner，也没有任何写准入闸门。本切片接了三段：

| 位置 | 做了什么 |
|---|---|
| 信任事实 | `store.projects.trust`（schema 既有列，`project.trust` 已会写它）。新增的唯一规则函数是 `packages/core/src/permissions.ts` 的 `decideTrustAdmission({trust, operation, toolName})`：trusted 全放行；untrusted 只放 `read`/`search`/`network`/`secret`，其余（`write`/`edit`/`bash`/`git`/`artifact_write`/未知名字）返回 `NOT_AUTHORIZED` + 原因文本 + `howToChange='project.trust {trusted:true}'`。 |
| 传进运行路径 | `apps/daemon/src/prepare-run.ts` 从项目行解析信任，写每 Attempt 的 `trust.json`（`runId`/`attemptId`/`trust`/`at`，0600，落在该 Attempt 目录、`models.json` 旁），未信任时在 prompt 里加一句「本机只看不改」。`apps/daemon/src/runner-spawn.ts` 的 `createChildRunnerSpawnPort` 新增 `trust: () => TrustState`（缺省 `untrusted`），仅 trusted 时给子进程加 `--trusted`；`main.ts` 注入读项目行的 live reader。Runner 自己早就支持 `--trusted`（`apps/runner/src/cli.ts` → `AttemptRunner` → `createExplicitResources({trusted})`），所以信任门现在是活的。**诚实边界**：生产路径目前**不向 Runner 传任何技能/指令文件**（`createPrepareRun` 只传 prompt/tools/catalog，没有资源选择面），所以「未信任不加载仓库自带指令/扩展资源」在今天是对所有项目都成立的结构性事实，而非未信任与信任的差异；本切片让这个门第一次拿到真实信任值（`--trusted` 仅 trusted 出现，`runner-spawn.test.ts` 直接断言），一旦将来出现资源选择面，未信任方向已由 `createExplicitResources` 的 `UNTRUSTED_RESOURCE`/`loadTrustedExtensions` 兜住（`AC-053` 的库级证据不变）。 |
| 写准入 | `apps/daemon/src/tool-handler.ts` 的 `execute` 在**解析 workspace 之前**（因此早于 Task worktree 租约、Plan gate、单写者 lease、Broker）对 `BROKER_TOOLS` 里的 mutating 工具调用 `decideTrustAdmission`，拒绝时写一条带 `trust` 的 `tool.refused`（`layer:'admission'`）再抛 `ProtocolError(NOT_AUTHORIZED, details:{trust,approvable:false,howToChange,...})`。`request`（`permission.request`）同样早拒，未信任项目不会铸出任何可批准路径。`packages/core/src/broker.ts` 的 `Broker.invoke` 在 Grant 之前复检同一规则（拒绝写带 `trust` 的 `tool.refused`），`runDeclaredTestCommand` 从 Work 所属项目行派生信任并拒绝项目声明的验收命令（它不经 `tool.execute`）。接纳的调用也会记录状态：`tool.invoked` 的 data 带 `trust`（unknown 时不写），所以一个 Run 的工具历史里既有「这次以何信任状态被拒」也有「这次以何信任状态被放行」。 |

`project.trust`（协议/界面/CLI）改的是同一个项目行，所以**撤销信任对新准入立即生效**：正在运行的 Run 的下一次 mutating 工具调用会被拒；`--trusted`（仓库自带指令/扩展资源的加载）只在下次 Attempt 启动时按新状态决定。界面文案把这两句都写清楚了（`projects.trustEffect`）。

## 2. 拒绝为什么被证明是无副作用的

规则函数是纯函数（`packages/core/test/trust-admission.test.ts` 4 例直接钉住放行/拒绝集合与拒绝文的四要素），生产路径的落点保证「拒绝发生在一切副作用之前」：

1. `tool-handler.execute` 的顺序是：解析 Run/Work → **信任闸门** → `workspace.resolve`（Task worktree 租约）→ `planToolCall` → 网络预检 → Plan gate → read/ledger → 单写者 `assertWriter` → `broker.invoke`。拒绝点在最前，因此**没有 worktree 租约、没有 `workspace:<project>:<work>` 单写者租约、没有 Plan gate 评估、没有 Grant 消耗、没有 `tool_operation` 行**。
2. 拒绝发生在任何文件内容存在之前：`planToolCall` 都还没跑，更没有任何 `readFile`/`writeFile`。
3. `Broker.invoke` 的复检在 `validateInvocation` 之后、Grant 之前，拒绝只写审计，`consumeOnceAsync`（唯一的 Grant/结果落库点）从未被调用。
4. `runDeclaredTestCommand` 的拒绝在 `runCommandAsync` 之前，进程从未 `spawn`。

真实演练（§4）逐条断言了这些：文件字节不变、`git status` 对该文件为空、`tool_operation` 无 `write` 行、单写者租约不存在（读被 gate 住，先观察拒绝后的状态再放行读）、Task 无 `latestManifestId`（无候选提交）。

## 3. 真实证据（同一棵冻结树、串行）

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0（ESLint type-aware + Prettier `--check .`） |
| `pnpm test:unit` | 81 文件 / 1500 用例，0 失败，exit 0（新增 6 例：`packages/core/test/trust-admission.test.ts` 4、`apps/daemon/test/runner-spawn.test.ts` 1、`apps/web/test/pages.test.ts` 1） |
| `pnpm test:integration` | 63 通过 + 1 跳过（64 文件）；565 通过 + 6 跳过（571 用例），0 失败，exit 0 |
| `pnpm test:e2e` | 31 checks — PASS 30 / FAIL 0 / UNVERIFIED 1（`provider.fact-and-unknown`，离线演练的既有 UNVERIFIED），35 ACs，exit 0；内嵌真 Chromium 23 passed |
| `node scripts/live.mjs --no-write`（真 Provider） | 轻载下连续 4 次：`live: 7 passed / 0 failed / 0 unverified`，各 13 次调用、HTTP 全 200，约 37–46s，exit 0（负载下另见 §6 的既有竞态复跑记录；验收内部 `pnpm test:live` 同树 exit 0） |
| `node scripts/acceptance.mjs` | **`94/94 ACs accounted — PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0`**，`acceptance: OK`，exit 0；binding `sha256:303bee4eac8f…`（HEAD `a27b196`，370 code files）；内部 `unit` exit=0（1500 用例 0 失败）、`integration` exit=0（571 用例 0 失败）、`pnpm test:e2e` exit=0、`pnpm test:live` exit=0 |

## 4. 真实双向演练

`apps/daemon/test/trust-enforcement.integration.test.ts`（1 例，真 daemon 装配 + 真 `apps/runner/dist/cli.js` 子进程 + 真控制端点 + 真 Broker/Grant/read-ledger + 真文件系统；**唯一桩是 Provider**（脚本化 `tool_calls`），外加宿主 `ProjectDirectory` 只缩小到它真实执行的 `trust` 写入那一步）。流程与断言：

1. `openProject({trust:'untrusted'})` → 真消息 → 真 Chief Run 提交 assessment → 真 `plan.approve` 物化 Task 并排队 backend Run（Plan 给了它文件 Grant 与 Plan gate 依据）。
2. backend 第 0 轮 `write`：被拒。断言 `tool.refused`（`layer='admission'`、`trust='untrusted'`、`code='NOT_AUTHORIZED'`、`operation='write'`）且原因文本含 `只看不改`、`project.trust {trusted:true}`、`do not retry`；`src/notes.md` 字节不变；无 `write` 的 `tool_operation`；`store.leases.find(workWriterLeaseResource(...))` 为 `undefined`；`git status --porcelain -- src/notes.md` 为空；Task 无 `latestManifestId`（无候选提交）。
3. 该 Attempt 的 `attempts/<id>/trust.json` 为 `trust:'untrusted'`，spawn 诊断行含 `trust=untrusted`——「这个 Run 以何信任状态运行」有落库记录。
4. 同一 Attempt 第 1 轮 `read`：**通过**（`tool_operation` finished、真内容进 read ledger、`tool.invoked` 有 `read`）。
5. 真 `project.trust {trusted:true}`（协议处理器 → 宿主目录端口 → 项目行）；同一 Run 第 2 轮同一个 `write`：**执行**（`tool_operation` finished、`src/notes.md` 变为新内容）。
6. 第 3 轮 `stage_yield success`：`stage_result` accepted，且真候选提交产生（`task-candidate` 日志 + Task 的 `latestManifestId` 落库）——证明可信方向真的走到交付，而拒绝方向没有。
7. 全程对 `write` 的 admission 拒绝恰好 1 条。

```
 ✓ |integration| apps/daemon/test/trust-enforcement.integration.test.ts (1 test) 2412ms
   ✓ an untrusted project is read-only and a trusted one is writable (WP-12 trust) (1)
     ✓ refuses the mutating call while untrusted, keeps reads working, then admits the same call after trust
```

各层真实性：真 daemon 装配（`openProject` + `createProjectExecution` + 真 `createControlHandlers`，含候选提交所需的 worktrees/snapshots/policyHash）；真 Runner 子进程（`apps/runner/dist/cli.js`）；真控制 HTTP 端点与 capability；真 Broker/Grant/read-ledger/Plan gate；真 Git 仓库与真 `git`（含候选提交与 `rev-parse`）。脚本化的只有 Provider 与那个只实现一次 `trust` 写入的宿主目录端口（协议层、校验、审计都是真的）。

## 5. 产品负责人刚刚记录的两条决定

两条都记在 `.agentdev/work/WP-12/project-ux.md` §5（第 1、2 条），此处摘要：

1. **选择器不加拒绝清单**：它是一次只读、只由登录的人触发、逐次审计的目录名列举，不是 Agent 可达面（不是协议方法、不是工具、需要浏览器会话、无内容可读，`project-ux.md` §2.1）；诚实边界是宿主 shell 与用户共享同一文件系统，加清单只制造安全错觉。日后若仍要最小暴露面，应作为独立策略位（可配置根范围）另行裁决。
2. **空安装窗口由 BFF 代答安装级项目命令是有意为之**：否则首个文件夹永远打不开。约束沿用现状——同一 `AuthService`、同一 Origin/CSRF 规则、只代答安装级方法、宿主目录始终是唯一写者；第一个项目打开后命令立即转发给 daemon。

本切片遵守该裁决：**没有**新增拒绝清单或任何范围策略。

## 6. 仍未决 / 已知边界

1. **只读 Run 不能落自己的 Artifact**：按交付要求，`artifact_write` 属于被拒的 mutating 工具，所以未信任项目里的 Run 连自己的报告 Artifact 也存不了（`ArtifactService` 写的是项目数据目录、不是仓库）。`docs/rules/agents.md` §1 允许只读调查「写自己的 Artifact」——若产品希望未信任调查仍能留下自己的报告产物，这是唯一需要再裁决的一点（本切片按任务列举执行，未自行放宽）。
2. **未信任项目的 `test` 角色**：Core 代表 Test Run 执行的 `policy.testCommands` 也被拒（同一条规则），因此未信任项目的 Test stage 只能记 `blocked`，不会执行项目声明的命令。
3. **信任是项目级、非 Run 级冻结**：准入读的是**当前**项目行（撤销立即生效），`trust.json` 记录的是该 Attempt 准备时的状态；用户在一次 Run 中途改信任时，Run 的后续调用按新状态准入，而它在启动时加载的资源集不变。界面上已如实说明。
4. **未做**：`git` 引用变更、工作区外删除、敏感文件等既有硬拦不变（未受本切片影响）；没有新增协议方法或事件名（`tool.refused` 复用既有事件，`data` 增加 `trust`/`layer` 字段）。
5. **`--no-write` live 的负载敏感复跑记录（如实登记，未以“偶发”掩盖）**：本轮先跑的一条长串行门禁里，`node scripts/live.mjs --no-write` 第 1 次 7/0/0 通过，第 2、3 次在 `drill.message-to-stage` 失败，原因文本是 **load 下的 writer-lease 争用**（`BUSY: Work … is being written by attempt …; this Attempt holds no writer lease`，后端 develop 因此交 `needs_input`）；随后同一棵树再跑一次仍红，但那次是 `review/review` 判定 stub 未被改动（开发阶段没交付 edit）。**机器空载后连续 4 次 7/0/0 / exit 0**，验收内部的 `pnpm test:live` 也在同一棵树上 exit 0。该 drill 的租约/竞态是 WP-12 已登记的负载敏感项（`docs/INDEX.md` 记 `tool-permission-runner` 竞态；`.agentdev/work/WP-12/w4-implementation.md` §137 记过 `message-to-stage` 的租约收敛，仓库内亦有本会话之前（Sep 16 05–06，非本轮产生）的 `live-message-to-stage-failure.log`）。本切片对 trusted 项目的准入是**早退无操作**（`decideTrustAdmission` 立即 `ok`），未改租约获取/释放顺序；但把“负载下 live 可能红、空载复跑绿”如实记在此，供后续 Test 复算。

## 7. 改动文件

- `packages/core/src/permissions.ts`：`decideTrustAdmission`/`trustReadOnlyOperation`/`TRUST_READ_ONLY_OPERATIONS`（唯一规则）。
- `packages/core/src/broker.ts`：`ToolInvocation.trust`、`invoke` 的信任复检、`recordRefusal` 带 `trust`、`runDeclaredTestCommand` 的项目级拒绝与审计。
- `apps/daemon/src/tool-handler.ts`：`execute`/`request` 的准入前信任闸门（带 `tool.refused` 审计与 `details.trust`/`howToChange`）。
- `apps/daemon/src/prepare-run.ts`：从项目行解析信任、写每 Attempt `trust.json`、未信任 prompt 提示、日志带 `trust`。
- `apps/daemon/src/runner-spawn.ts`：`ChildRunnerSpawnOptions.trust`、`runnerSpawnArgs(script,input,trust)`（仅 trusted 传 `--trusted`）、`writeAttemptTrust`。
- `apps/daemon/src/main.ts`：给 spawn 注入项目行的 live trust reader。
- `apps/web/src/i18n.ts`、`apps/web/src/pages.ts`、`apps/daemon/src/protocol.ts`：`projects.untrusted` 中文改「只看不改（未信任）」、新增 `projects.trustEffect`、`trustApplied`/`trustPromptBody` 说明生效范围，`/projects` 渲染该说明；daemon 与 web 两套目录逐字一致（`ui-catalogue.test.ts` 守着）。
- `docs/architecture/protocol.md` §3：`project.open` 行加 `trust?:bool`，并补「`trust` 参数与只读准入」一段。（说明：`project.open`/`project.trust` 的方法表本就位于 §3「Project与Conversation」；任务书写的「§4」应是章节错位，故按文档实际结构补在 §3。）
- `.agentdev/work/WP-12/project-ux.md`：§3 更新「准入已接通」、§5 记录两条决定与文档已补、§6.1 列本切片文件。
- 测试：`apps/daemon/test/trust-enforcement.integration.test.ts`（新）、`packages/core/test/trust-admission.test.ts`（新）、`apps/daemon/test/runner-spawn.test.ts`、`apps/web/test/pages.test.ts`；`apps/daemon/test/{tool-bridge,tool-permission-runner}.integration.test.ts` 的夹具显式 `trust:'trusted'`（它们演练的本来就是可写项目的正常路径）。
