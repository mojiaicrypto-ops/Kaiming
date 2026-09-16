# WP-12 Settlement（可用版本补全：凭证 / 主链 / 工具桥 / WebUI / 多项目 / 运维）

- 状态：**功能已交付并可用；发布验收在冻结树上通过（94/94 全 PASS，见 §3），仍有两条已登记的负载敏感用例**；W8 四条产品裁决与 W9 证据层级诚实化已落地（见 §2 D13–D17、§4 第 8 条、`.agentdev/work/WP-12/w8-w9.md`）
- 依据：`.agentdev/work/WP-12/plan.md`（目标与 DoD）、`acceptance.md`/`e2e.md`/`live.md`（本次运行内生成的证据）、各切片 `*-implementation.md`、`test.md`（独立 Test）、`api-gap-audit-2.md`（文档面差额）
- 证据绑定：验收报告以 `runNonce` + `gitHead/gitTree` + 代码文件内容哈希（`codeDigest`）校验后才被采纳；非本次运行内执行、或绑定不符的报告一律拒收（该机制在开发期真实拦下过一次被并发编辑污染的报告，使 7 条 AC 归零）

## 1. 交付范围（切片）

| 切片 | 交付 | 记录 |
|---|---|---|
| T1 | 凭证入口：0600 加密文件后端（默认，跨平台）+ 可选 macOS Keychain、协议 `secret.set/list/delete`、admin `POST/DELETE /secret`、`agentdev secret set|list|delete`（值只从 stdin 读）、设置页 API Key 输入（不回显） | `T1-implementation.md`、`T1.2b-implementation.md` |
| T2 | 消息 → Chief 评估 → DispatchSpec → 需求/Plan → queued Run → Supervisor → 真实 Runner 子进程 → 阶段结果回看板（零播种）；`provider.upsert/provider.test`；Work `queued→running`；`plan.approve` 恢复点；gateway 双向 `tool_calls` 转发与 SSE 收尾 | `T2-implementation.md`、`T2-plan.md`、`T2-fix-delivery.md` |
| T3 | 工具桥：角色工具注册表、`tool.execute`/`permission.request` 控制端点、Broker 路径/符号链接/网络/角色门、Grant（含环境操作的批准链）、读账本封口（AC-085）、容器执行、`environmentRef` | `T3-implementation.md`（含附录 A 第一期权限规格） |
| T4/T4c | WebUI 补全：AC-071 三处真实缺陷、AC-090 分支/提交/未推送、需求生命周期动作、Inbox 决策与权限处理、语言 cookie | `T4-implementation.md`、`T4c-implementation.md` |
| T5 | 多项目：`project.*` 全套、`ProjectDirectory`（每 root 锁、注册表逐条容错、导航级 close、安装级 clone Grant）、初始化驱动、首次 open 需求池导入、单入口 BFF（按 `projectId` 路由 `/rpc`、`/ws`、项目范围产物 URL） | `T5-implementation.md`、`T5-plan.md` |
| T6 | 运维：`agentdev backup/restore/relocate/secret rotate`、配置侧车（含 Provider 定义、禁明文）、安装文档、launchd 真机演练 | `T6-implementation.md` |
| T7a | Playwright（dev-only）+ `tests/browser/**`，`pnpm test:e2e` 内运行；AC-002/052/071/073/076 真实 Chromium 证据 | `T7a-implementation.md` |
| T8a/T8b | 遗留缺陷：Run 在 `ready` 前不得 `running`、spawn 失败可恢复、`resumeTx` fail-closed、锁 epoch 单调、损坏 `runtime.json` 类型化错误 | `T8a-implementation.md`、`T8a-review.md` |
| T9 | 文档化事件 `knowledge.updated`、`recovery.report_ready` 的真实发射点（同事务、恰一次） | `T9-implementation.md` |
| T4b/T4b3 | daemon 文档面补齐（需求生命周期、正文、git 只读字段、`task.list/get`、`work.retry`、`recovery.inspect/resolve`、`context.preview`、`ui.translate`、T8c 的 `work.control`）；L2 集成 CAS + 结算绑定需求池同次候选提交 | `T4b-implementation.md`、`T4b3-implementation.md` |

## 2. 关键决定

- D1 引入 Playwright 作为 dev-only 依赖（撤销 WP-10 D1），浏览器类 AC 由真实 Chromium 关闭。
- D2 Secret 落盘默认 0600 AES-256-GCM；Keychain 为 opt-in（其 `security` argv 暴露是已知平台限制）。
- D3 注册 ≠ 授权：Provider 凭证只对 `gateway` audience 生效，`tool` 仍须显式 Grant；`SecretStore.resolve` 策略未动。
- D4/D5 不新增第 11 条契约命令、不改 AC 基线；契约以文档为准（缺失实现补齐、未文档化的实现补文档）。
- D6 验收聚合允许 `test:e2e` 返回 1（逐 AC FAIL）但必须与报告一致并逐条列出。
- D8–D12：文档化命令必须实现；§7 事件必须发射；Plan 的 Task 必须落表；AC-043 用真实第二模型关闭；`secret rotate` 进 `reliability.md`。
- 用户裁决：明确的自然语言执行指令即 scope 授权（Q1=B）；环境操作仍须显式批准；`project.open` 冷开返回 `accepted` + 就绪规则；`mode:'new'` 即 Git 初始化授权；安装级 Grant 独立存放。
- 第一期权限规格已冻结但**未实施**（见 `T3-implementation.md` 附录 A：范围内自动放行 + 只硬拦删除/密钥/私网 + 退掉逐次审批；`configPolicy: strict|test`）。
- D13（W8-1）`checkResult.checks[].environmentRef` 与 `VerificationManifest.environmentRef` 统一为同一个 Runner `attempt.ready` 描述串（`host:…`/`container:…`）：契约 `checkEntry`/`verificationManifest` 的该字段由 `idSchema` 放宽为 `environmentRefSchema`（非空描述串），生产者改用 Attempt 报的环境描述串，`data.md`/`execution.md` 同步；新增"同一 Test Run 两处一致"的用例。
- D14（W8-2）`token.delta`/`log.delta`/`heartbeat` 明确为**连接内临时流**，不在 `protocol.md` §7 持久事件清单内、不占 cursor、不参与回放；无行为变更。
- D15（W8-3）扩展白名单刻意留空（WP-00 决定）：`extension.list` 诚实返回空清单、`extension.set` 对未知 id `NOT_FOUND`；`execution.md` §7 写明新增一个内置扩展所需的四步，本切片不实现。
- D16（W8-4）AC-011 的 L3 显式确认交互登记为**已知产品缺口**（§4 第 8 条 + `drill-acs.mjs` `KNOWN_PRODUCT_GAPS` + 验收报告 §8），本切片不实现、不改 AC 文本。
- D17（W9）验收报告逐 AC 输出证据层级（`product-path / library-level / environment-limited / unclassified`）并在 §0 显式给出计数；层级由本次运行证据推导，不改变任何 PASS/FAIL 判定。

## 3. 证据（本次运行内执行）

在冻结树（`1bbd5ef`）上由独立 Test 代理串行执行：`pnpm install --frozen-lockfile` 0、`typecheck` 0、`lint` 0、`test:unit`（77 文件/1432 用例）0、`test:integration`（54 文件/519 用例）0、`test:e2e`（26 checks，PASS 25/FAIL 0/UNVERIFIED 1，浏览器 17 passed）0、`docs:check` 0、`build` 0、`doctor` 0、`test:live`（真实 DeepSeek，7 passed/0 failed/0 unverified，13 次 HTTP 200）0。

`acceptance.mjs`：独立 Test 在负载下曾复跑为 `exit 2 — PASS 92 / FAIL 2`，唯一根因是 `tool-permission-runner.integration.test.ts` 的**测试侧时序假设**（单次读取 IPC 行，而该行必然晚于数据库行；产品侧的结算/记录顺序正确）。已改为有界 `waitFor` 等待真实 IPC 条件（断言未放宽、未加隐藏重试），修复后单跑 9/9（含负载 96/115/135），全量 integration 54 文件/520 用例 exit 0，`node scripts/acceptance.mjs` 在冻结树 `1bbd5ef` 上 **exit 0 — 94/94，PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0**（同一次修复还关闭了两处非阻塞缺口：验收报文按项目给出真实失败原因、`requirement.archive/restore/start` 真正强制文档化的 `expectedVersion`）。

独立 Test 另外确认 10 条声明为真（批准绑定、读账本封口、集成拒绝无 manifest 的 Task、跨项目产物 token 被拒、`contentMarkdown`、浏览器隔离攻击、完成记录绑定最终 revision、游标不串项目等），并做了路径边界与密钥泄漏的证伪尝试（未发现漏洞）。

**W8/W9 收口运行（本次，工作树在 `76fb642` 之上含 W8/W9 改动）**：`pnpm typecheck` 0、`pnpm lint` 0、`pnpm test:unit`（79 文件/1480 用例）0、`pnpm test:integration`（57 文件/542 用例）0、`pnpm test:e2e`（27 checks，PASS 26/FAIL 0/UNVERIFIED 1，真实 Chromium 18 passed）0、`pnpm docs:check` 0、`node scripts/acceptance.mjs`（真实 Provider + 真实浏览器，本次运行内执行 e2e/live 演练）**exit 0 — 94/94，PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0**，`codeDigest sha256:2dec5b70…`、`gitHead 76fb642`（工作区含本次未提交改动，`gitDirty:true`）；同一报告新增 **证据层级计数 product-path 53 / library-level 41 / environment-limited 0 / unclassified 0**（详见 `w8-w9.md` §W9）。本轮 live 演练 7 passed / 0 failed / 0 unverified（13 次 HTTP 200）。

## 4. 如实登记的残余（不阻断试用，但未关闭）

1. **49/94 条 AC 没有 `apps/*` 应用层证据**（40 条纯库级、8 条库级+演练、1 条仅演练）——**W9 已按证据层级披露**：验收报告 §0/§2/§2.1 现在逐 AC 标注 `product-path / library-level / environment-limited / unclassified` 并给出计数，播种行与"仅演练"两类可争议判定在 §2 备注里写明依据；判定本身（PASS/FAIL/UNVERIFIED）未改。
2. **容器只覆盖工具执行**：Runner 仍在宿主、工具读写项目根而非每 Task 独立工作区，多任务并发靠单写者租约（`T3-implementation.md`）。
3. **模型没有"申请使用某个密钥"的入口**，密钥注入只在不经过模型的路径上验证过。
4. **AC-046（并行子任务失败）/AC-047（口头完成、两次不合规）只有库级证据**，缺整机演练；`drill-acs.mjs` 未为其登记残差。W9 的分类把它们如实标为 `library-level`。
5. **L2 演练交付的是 `needs_input`**：真实 Chief 直接把实现角色派出去，该 Work 无 Plan/Task 因而无 Grant——链路交付成立，但 L2 应走 Product→Plan→Develop 的路由仍是产品缺口。
6. **两条既有集成用例仍对负载敏感**（`packages/core/test/broker.integration.test.ts:505` 的 Docker 容器读取、`protocol.integration.test.ts` 的 AC-054 事件重放抖动）；冻结树上的验收运行未翻转，但它们是发布门禁的已知不稳定源。
7. 观察到一次 `BUSY` 写租约拒绝（已完成的 Chief Attempt 仍持写租约）。
8. **AC-011 L3 高风险交付缺少显式确认交互（W8-4 新登记的产品缺口，未实现）**：库级 L3 门禁规则已实现并有证据（`packages/core/test/delivery.integration.test.ts` 的授权/回滚/逐项审计/恢复演练四条前置），但产品**没有**"请你确认这是一次 L3 高风险交付"的显式用户交互——Inbox 无该待办、无对应 `decision`、无"未确认则不得实施"的路径；当前授权来自 Plan 门禁 + Work 信封。**实现它需要**：① Core 在 L3 路由判定后铸一条 `kind=decision`（`targetRef` 指向 Plan/风险说明 Artifact，`choices=[confirm,decline,revise]`）并发 `decision.created`，确认前 Run 不得 `running`；② daemon 面复用既有 `decision.resolve` 把它渲染成 Inbox 待办（不新增解析入口）；③ decline/revise 走既有 product-behaviour 分支（AC-015/016）；④ 一条真机 e2e 覆盖"出现→处理→消失"与"未确认不得实施 L3"负例；⑤ 同步 `protocol.md`/`experience.md` 与 AC-011 证据映射。本切片**只登记、不实现**；`drill-acs.mjs` 的 `KNOWN_PRODUCT_GAPS` 与验收报告 §8 同时记录该缺口（不改 AC 判定、不改 `docs/delivery/acceptance.md` 的 AC 文本）。

## 5. 下一步

- 先关掉第 6 条里的竞态（进行中），使发布验收在负载下也稳定；随后复跑一次并以其结果更新第 3 节。
- 第 2 期（已冻结规格，未实施）：第一期权限规格（附录 A）+ `configPolicy` 两档；容器化 Runner 与每 Task 工作区；模型侧密钥申请入口；AC-046/047 整机负例；L2 路由（Product→Plan→Develop）。

> **执行模型修订（本轮，见 `.agentdev/work/WP-12/docs-simplification.md`）**：产品负责人决定**不再把隔离当作强制**。本节与 §2 中"容器化 Runner 与每 Task 工作区""缺 Docker 即阻断独立验证"等**不再作为目标**；目标改为宿主优先（默认在用户仓库或该 Task 的 worktree 内直接执行），容器仅作为项目可选的运行环境（测试/服务/数据库/依赖校验），审批只用于不可逆操作（推送交付分支/部署/删除数据）。以上文字保留为历史记录、不改写；现行契约以 `docs/architecture/execution.md` 等修订后的文档为准。
