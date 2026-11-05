# WP-12 Plan（可用版本补全：功能完备 + WebUI 端到端可用）

- 状态：Planning（待用户确认后立即开工，不再逐任务停顿）
- 目标一句话：**在一个真实 Git 项目上，用户打开 WebUI 就能配置模型凭证、发一句话、看到 Chief 评估与真实模型执行、工具真实改工作区、结果回到看板**；94 条 AC 全部有真实证据，无豁免或在 UAT 中关闭。
- 依赖：WP-00…WP-11（已完成并结算，HEAD `7c723ec`）。
- 范围：不新增产品行为、不新增契约命令；只把已实现的部件**接起来**并补齐 UI/运维缺口。

## 1. 现状与差距证据（为什么现在不可用）

现有仓库把「领域 + 服务 + 协议 + 运行时 + Runner + BFF + 页面」都实现了，但关键接缝没接上。逐条给证据：

| # | 差距 | 证据 |
|---|---|---|
| G1 | **没有任何注册 Secret 的入口**：`SecretStore` 启动时为空，协议只回报 `secretConfigured`，CLI 无 secret 命令 | `apps/daemon/src/main.ts:157` `const secrets = new SecretStore();`；`apps/daemon/src/protocol.ts:1465-1489` 仅输出 `secretConfigured: provider.secretRef !== undefined`；`apps/cli/src/cli.ts` 命令只有 `doctor/version/start/stop/status/open`。→ 任何模型调用都无法鉴权，AI 一律失败 |
| G2 | **Chief 模型评估没有调用方**：消息走本地确定性路由，`Orchestrator.assess()` 在 `apps/*` 无任何调用；没有「消息 → Chief Run → DispatchSpec → queued Run → Runner」的真实链路 | `packages/core/src/orchestrator.ts:245` `assess()` 仅被测试引用（`grep -rn "orchestrat" apps/*/src` 无命中）；`packages/core/src/messages.ts:416` 注释自认「intent comes from the Chief's assessment (or the explicit work item)」，实际来自本地路由 |
| G3 | **Tool Broker 没接进 Runner**：`packages/core/src/broker.ts` 只被 `index.ts` 再导出，无 HTTP/会话侧调用；Runner 把 `toolSubset` 名字直接交给 Pi 会话，工具调用不经 Broker/grants/审计 | `packages/core/src/broker.ts` 全仓非测试引用仅 `packages/core/src/index.ts:43` 与 `test-environment.ts` 的类型导入；`apps/runner/src/attempt.ts:95,178` 直接把 `toolNames` 传给 session |
| G4 | **WebUI 功能不全**：无「分支/提交/未推送」展示（AC-090 已登记缺口）；需求卡缺少 complete/archive 等动作入口；dock 焦点/ARIA/键盘证据未在真实浏览器执行（AC-071/073） | `grep -rn "unpushed" apps/web/src` 无命中；`apps/web/src/views.ts:49` 有 `BOARD_COLUMNS=['queued','active','completed','archived']` 但无对应动作 UI |
| G5 | **无真实浏览器验证**：5 条 AC 以 `browser-absent` 永久豁免（AC-002/052/071/073/076） | `scripts/lib/drill-acs.mjs:109-145` |
| G6 | **多项目只在 daemon 侧**：`main.ts` 可为多项目各开一对端口，但 BFF/UI 只连一个 daemon origin，界面内无项目切换 | `apps/daemon/src/main.ts:255-305`（每项目 `daemon`/`web` 端口）；`apps/web/src/app.ts` 无项目切换路由 |
| G7 | **运维/安装未在真实安装上演练**：`backup.run`/`restore.run` 协议命令存在，但没有 CLI 入口与安装文档验证 | `grep -n "backup.run" apps/daemon/src/protocol.ts` 有；`apps/cli/src/cli.ts` 无 backup/restore |
| G8 | **WP-11 遗留缺陷**（`test.md` 4 条）：锁 epoch 跨干净重启非单调、损坏 `runtime.json` 使 `agentdev start` 无 operationId 崩溃、`stage_result` 持久化、Run 在 Runner ready 前即 running | `.agentdev/work/WP-11/test.md` |

结论：**当前版本不可用**——不是缺页面，而是「凭证进不去、模型评估不触发、工具不过闸」这三条主链断了。

## 2. 「可用版本」定义（DoD，可演示、可复验）

在**本仓库之外的一个真实 Git 项目**上，按下列脚本一次通过：

1. `agentdev start` → `agentdev open` 打印 URL → 浏览器登录（installation token）成功（AC-078）。
2. WebUI **设置页配置 Provider**（type/baseUrl/model/API Key），`config.test` 通过；重启后仍生效（AC-075 等）。
3. **L1**：Chief 会话发一句只读问答 → 流式返回真实模型答复，不建 Requirement、不授权（AC-001/005/006）。
4. **L2**：发一句交付类需求 → **Chief 模型评估产出 DispatchSpec** → Requirement 入池 → 生成 Work/Plan → 用户确认 Plan → **queued Run → Supervisor spawn 真实 Runner 子进程** → Runner 经 Tool Broker（grants 生效、只读角色不可写）真实读写工作区 → 阶段结果/交付物/证据回写看板与详情页 → Settlement 更新知识（AC-003/007/010/033/037/041/057）。
5. WebUI 各页有真实数据：看板四列、需求详情（Plan/Tasks/Runs/Artifacts/分支·提交·未推送）、Inbox、Runs、Files 只读预览、Agents、Settings（AC-068/069/070/074/077/090）。
6. 同机多项目：一台 daemon 管多个项目，WebUI 内切换并保持各自隔离（AC-023/024/034/087）。
7. 运维：`agentdev secret set`、`agentdev backup/restore/relocate` 在真实安装上演练成功，安装文档按步骤可复现，launchd/systemd 模板在真机加载（AC-064/065）。
8. `pnpm install --frozen-lockfile|typecheck|lint|test:unit|test:integration|test:e2e|test:live|test:acceptance|docs:check|build` 全绿；94 条 AC 全部 VERIFIED 或由用户 UAT 记录关闭，**无 `browser-absent` / `recorded-gap` 永久豁免**。

## 3. 已确认决定 / 待用户确认

| # | 决定 | 影响 |
|---|---|---|
| D1 | **引入 Playwright 作为 dev-only 依赖（用户 2026-XX 决定，推翻 WP-10 D1）**：AC-002/052/071/073/076 由真实无头浏览器自动化验证并关闭；`browser-absent` 豁免条件改为「Playwright 不可用时才成立」，安装后自动失效 | 十条契约命令名称不变，浏览器套件并入 `pnpm test:e2e`；`docs/delivery/implementation.md` §3 的「不引入 Playwright」括注同时更新 |
| D1b | **明确的自然语言执行指令即授权（用户决定，选项 B）**：Chief 评估派生 scope，Plan/L3 门禁照旧；bash/网络/secret/push/deploy/delete_data 等环境操作仍须显式批准；派生授权记录来源为消息并展示在需求/授权记录中 | 新增产品行为落地在 T2；`messages.ts` 现有「必须点名路径」的路由保留为显式授权路径，派生授权走受限白名单 |
| D2 | Secret 落盘：契约实现为 **`~/.agentdev/secrets/` 下 0600 的 AES-256-GCM 文件 + 0600 主密钥**（跨平台、可单测）；macOS 额外提供 Keychain 后端（`security` CLI），默认经 `AGENTDEV_SECRET_BACKEND` 选择，darwin 默认 `keychain`、测试默认 `file` | 两条后端都有真实测试；CI/测试不依赖 Keychain |
| D3 | **注册 ≠ 授权**：Provider secret 只对 `gateway` audience 生效；`tool` audience 仍需显式 grant。WP-07 的授权语义不变 | 不改变安全模型，只补入口 |
| D4 | **不新增第 11 条契约命令**（沿用 WP-11 D1）：证据并入既有 `test:e2e` / `test:live` / `test:integration` | `docs/delivery/implementation.md` §3 不变 |
| D5 | 不新增/修改 AC 与产品行为。若实现中发现文档与代码冲突，先出变更建议再改 | 保持验收基线稳定 |
| D6 | `pnpm test:e2e` 退出码 1（存在逐 AC FAIL）仍被验收聚合接受，但必须同时校验报告与进程退出码一致，并把 FAIL 逐条写进验收表；目标状态仍是退出码 0 | 浏览器/运行时 FAIL 不会被「证据不可信」掩盖，也不会因一条 FAIL 让整表失去意义 |
| D7 | 语言切换覆盖缺口（daemon `ui.translate` 目录缺 `aria.*`/`detail.*`/`settings.*` 键）单开小切片，T4 只做客户端 cookie 与客户端自有字符串；目录补键在 T2 释放 `apps/daemon/src/protocol.ts` 后进行 | 避免与 T2 争用同一文件 |
| D8 | **契约以文档为准**（调研审计 `api-gap-audit.md`）：文档化的细粒度命令（`requirement.start/pause/resume/cancel/archive/restore` 等）必须实现；实现里已有的 `work.control`/`requirement.save`/`requirement.continue` 保留为合法入口并**补文档**，不做删改 | 「文档有实现无」靠实现补齐，「实现有文档无」靠文档补齐，二者都不许长期漂移 |
| D9 | **§7 事件以文档为准补齐实现**：持久事件（`operation.failed`、`permission.resolved`、`recovery.report_ready`、`initialization.*`、`knowledge.updated`、`project.created`）一律补发射点；`token.delta`/`log.delta`/心跳属临时流，按文档语义实现或在文档中明确标注为内部 IPC 通道 | 避免「事件表里有的东西永远不会出现」 |
| D10 | **Plan 的 Task 必须落 `task` 表**（`task.list/get`、看板 Task 比例、AC-081 都依赖它）；专业 Run 绑定 `taskId` | 没有 Task 实体就不能声称 Plan→Task→Run 链存在 |
| D11 | AC-043（独立 Review 模型）在 T10 用真实 Provider 的第二个模型关闭；若提供方不支持第二个模型，则保留已登记豁免并写明原因 | 只有真跑过才算关闭 |
| D12 | `secret rotate` 正式写进 `reliability.md` §7 的凭证生命周期（T6 实现 + 文档同步）；`relocate` 的项目身份持久化在 T5/T6b 落地前保持 fail-closed 并登记缺口 | 文档与实现同步，未完成的能力不假装可用 |

## 4. 工作分解与退出条件

八块，顺序执行；T4/T5 在 T2 定义完数据结构后可并行。每块内部仍走 Plan→Develop→独立Review→Test→Settlement，但**报告只在块完成或需要决策时出现**。

| Task | 内容 | 退出条件（真实证据） |
|---|---|---|
| **T1 凭证与 Provider 配置入口** | ① `packages/core/src/secrets.ts` 增加持久化后端（file 0600 AES-256-GCM + 主密钥；darwin Keychain 适配器）与启动时装载；② 协议 `secret.set` / `secret.delete` / `secret.list`（只回元数据，不回值）；③ CLI `agentdev secret set <ref> [--stdin]`、`secret list/delete`；④ WebUI 设置页新增 API Key 输入（值不回显）与「测试连接」；⑤ `config.save` provider 的 `secretRef` 与 secret 注册联动校验 | 单测：写入/读取/轮换/删除、0600 权限、错误主密钥拒绝、Keychain 适配器契约测试；集成测试：真实 daemon 启动装载 → gateway 取到 secret → 桩 Provider 200；e2e：UI 提交 -> `secretConfigured=true` -> 模型调用成功；CLI 冒烟：secret 从 stdin 写入且不出现在任何日志/进程参数中 |
| **T2 消息→Chief→Run 端到端（无播种）** | ⓪ 补 `provider.upsert`（含 secret 注册）/`provider.test`（真实连通 + `provider.test_completed`）——`protocol.md` §5 已定义但未实现；① **内部能力方法面**（`protocol.md` §6）：Runner→daemon 的 attempt-capability 通道 + Pi 工具 `assessment_submit`/`stage_yield`（+Chief 的 `agent_dispatch`），纯文本结束无 stage 结果 → 一次纠正提示后 `contract_violation`；② `conversation.message.send` 的 L1/L2/L3 分支在事务内入队 Chief 评估 Run（同步命令不阻塞）；③ `assessment.submit` → 校验/冻结 DispatchSpec → Requirement/Work/Plan 落库并广播；④ `plan.approve` 通过 Gate 后由 Core 依已批准 Plan 建专业 queued Run（返回 `runId`）→ spawn → `stage.submit` 落 `stage_result` + `stage.completed/failed`；⑤ **Q1=B 的派生授权**：明确自然语言执行指令 → Chief 派生 scope 生成授权（环境操作仍须显式批准，Plan/L3 门禁不变）；⑥ 消息 `received→processing→processed/failed` | 集成测试：真实 daemon+supervisor+桩 Runner 走完 L2 全链，断言 Run 由消息触发、无任何播种行；e2e 新增检查：消息→Chief→Plan→Run→终态；`pnpm test:live`：真实 Provider 下 L1/L2 两条真实纵向演练通过 |
| **T3 Runner 工具桥（Broker + grants + 审计）** | ① daemon/Core 侧 Tool Broker 端点（回环 + attempt capability，与 gateway 同构）；② Runner 侧工具调用改经 Broker：路径根限定、只读角色禁写、网络策略、每次调用审计与 `TOOL_EVENTS`；③ 拒绝路径返回结构化错误给模型而不是崩溃 | 安全测试：越根路径、符号链接逃逸、只读角色 bash 写、私网/字面量 IP(NAT64/IPv4-mapped) 全部被拒且有审计；集成：真实 Runner 子进程经 Broker 完成 read/edit/write/bash/git；e2e：grants 撤销后调用立即被拒 |
| **T4 WebUI 功能补全** | ① 需求卡动作：complete / archive / continue / cancel（含权限与状态机校验）；② 需求详情展示分支、提交、未推送状态（关 AC-090）；③ Inbox/Runs/Files/Agents/Settings 均接真实数据；④ dock 焦点管理、ARIA、键盘遍历、i18n 不翻译项目内容 | UI 快照/视图单测；e2e 断言上述页面渲染真实字段（含 `git.unpushed`）；真实浏览器 UAT 清单执行通过 |
| **T4b daemon 文档面补齐** | 依据 `.agentdev/work/WP-12/api-gap-audit.md`：实现文档定义但缺失的 `requirement.create/update/import/start/pause/resume/cancel/archive/restore`；`requirement.get` 返回 `contentMarkdown`（§8 L149）；board/requirement.get 暴露 `git`（branch/commit/unpushed，关 AC-090 数据源）；`work.retry`/`work.budget.update`/`run.pause|resume|cancel`/`recovery.inspect|resolve`/`command.get`/`context.preview`/`file.list|read`/`extension.list|set`；`ui.translate` 目录与 UI 实际键位对齐 | 每个命令有真实 handler + 集成测试；WebUI 的归档/完成/正文/未推送按钮全部真实生效（不再有 NOT_FOUND 死按钮）；逐条对照审计表销项 |
| **T9 文档化事件补齐** | 发出文档 §7 已定义但从未发出的事件：`operation.failed`、`permission.resolved`、`recovery.report_ready`、`initialization.*`、`knowledge.updated`、`project.created` 等；`value`/形状与 `protocol.md` §7 一致；流式通道（`token.delta`/`log.delta`/heartbeat）按文档语义实现或明确降级并在文档中标注 | 每个持久事件有真实发射点 + 顺序断言（写库先于发事件、恰好一次）；审计表 «文档事件从未发出 10» 清零或逐条有裁决记录 |
| **T10 真实 Provider 收口** | 用真实 Provider（用户提供）跑无播种 L1/L2 纵向演练关闭 5 条 `provider-absent` 豁免；配置独立 Review 模型关闭 AC-043；用真实 Pi SDK 会话（流式增量 + 历史恢复）关闭 AC-066 | `pnpm test:live` 全 PASS；ACCEPTED 条目仅剩经用户确认的、无法在本环境验证的项 |
| **T5 单入口多项目与项目初始化** | ① BFF 增加项目选择与切换（含 CSRF/Origin 校验不变）；② UI 项目切换器与「未注册项目发现」；③ 补齐文档化的 `project.create/clone/trust/close/initialize` 并把 `workspace/src/initialize.ts` 接到生产路径 | 集成/e2e：一台 daemon 两项目切换后数据不串、写入落到正确 SQLite；AC-023/025–029 由库级测试升级为真实产品路径证据 |
| **T6 运维与安装** | ① CLI `agentdev backup/restore/relocate`、`agentdev secret rotate`；② 安装文档按真实步骤重写并执行；③ launchd/systemd 模板在真机 load/unload 演练 | 演练记录：真实备份→损坏→恢复后数据与 Run 状态一致（AC-064/065）；文档步骤逐条可复现；真机服务启停 |
| **T7 真实浏览器验证（Playwright，dev-only）** | 安装 Playwright + chromium，建真实无头浏览器套件驱动真实 daemon+BFF：AC-002/052 预览隔离与攻击样例、AC-071 Live 布局与焦点、AC-073 键盘/ARIA/语言、AC-076 附件限制提示；`browser-absent` 条件改为「Playwright 不可用时才成立」；AC-090 的分支/提交/未推送由 T4 实现后加入浏览器断言 | 浏览器套件并入 `pnpm test:e2e` 真实运行；上述 AC 由 UNVERIFIED-豁免转为 PASS；`docs/delivery/implementation.md` §3 括注更新；用户仍可在自己的浏览器复验 |
| **T8 遗留缺陷收口** | WP-11 四条遗留（锁 epoch 单调、损坏 `runtime.json` 有 operationId 错误码、`stage_result` 持久化、Run 在 ready 前不置 running）；WP-11 review 的 3 条 P2；WP-10 已登记缺口 AC-066（真实 Pi SDK 会话流式/历史恢复，需真实 Provider 驱动） | 每条有失败复现测试 → 修复 → 独立 Review → 测试；AC-066 由 `test:live` 的 Runner 真实会话检查关闭 |

## 5. 必验范围与通过条件

- 每块：`pnpm typecheck`、`pnpm lint`、受影响单测/集成测试；涉及 UI/运行时：`pnpm test:e2e`；涉及模型：`pnpm test:live`。
- 收口：`pnpm install --frozen-lockfile`、`pnpm test:acceptance`、`pnpm docs:check`、`pnpm build`、`node apps/cli/dist/cli.js doctor` 全绿。
- 发布判定：以 94 条 AC 矩阵为准；**PASS 必须有本次运行内的真实执行证据**，未执行的一律 UNVERIFIED/FAIL，不许把「已登记豁免」当通过。

## 6. 门禁与失败路由

- 每块：Plan（本文件 + 块内 compact plan）→ Develop → **独立 Review（新上下文，不读开发聊天）** → 修复轮 → 独立 Test → Settlement（`settlement.md` + 更新 `docs/INDEX.md`/Code Map）。
- Review 有 Blocking → 回到 Develop；Test 失败或有代码改动 → 回独立 Review 再测。
- 只有「需要新的用户决策」（改产品行为/验收/风险接受）才停下问；其余连续执行。

## 7. 明确非目标

- 不新增第 11 条契约命令；不改产品文档定义的 AC。
- 不引入 Playwright/浏览器二进制（D1）。
- 不改模型网关/协议既有契约形状（只在既有面上补入口）。
- 不做多用户/远程部署、云端同步（产品定位是单用户自托管）。

## 8. 里程碑

| 里程碑 | 含 | 用户可见结果 |
|---|---|---|
| M1 | T1 | WebUI 里能填 API Key，模型能连通 |
| M2 | T2+T3 | 一句话 → 真实 Chief 评估 → 真实 Runner 改代码 → 看板有结果 |
| M3 | T4+T5 | 界面功能完整、多项目可切换 |
| M4 | T6+T7+T8 | 运维/安装可复现，浏览器 UAT 关闭全部豁免，94 AC 全绿 = **可用版本** |
