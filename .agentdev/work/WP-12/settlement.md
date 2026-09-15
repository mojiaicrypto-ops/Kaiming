# WP-12 Settlement（可用版本补全：凭证 / 主链 / 工具桥 / WebUI / 多项目 / 运维）

- 状态：**功能已交付并可用；发布验收在冻结树上通过（94/94 全 PASS，见 §3），仍有两条已登记的负载敏感用例**
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

## 3. 证据（本次运行内执行）

在冻结树（`1bbd5ef`）上由独立 Test 代理串行执行：`pnpm install --frozen-lockfile` 0、`typecheck` 0、`lint` 0、`test:unit`（77 文件/1432 用例）0、`test:integration`（54 文件/519 用例）0、`test:e2e`（26 checks，PASS 25/FAIL 0/UNVERIFIED 1，浏览器 17 passed）0、`docs:check` 0、`build` 0、`doctor` 0、`test:live`（真实 DeepSeek，7 passed/0 failed/0 unverified，13 次 HTTP 200）0。

`acceptance.mjs`：独立 Test 在负载下曾复跑为 `exit 2 — PASS 92 / FAIL 2`，唯一根因是 `tool-permission-runner.integration.test.ts` 的**测试侧时序假设**（单次读取 IPC 行，而该行必然晚于数据库行；产品侧的结算/记录顺序正确）。已改为有界 `waitFor` 等待真实 IPC 条件（断言未放宽、未加隐藏重试），修复后单跑 9/9（含负载 96/115/135），全量 integration 54 文件/520 用例 exit 0，`node scripts/acceptance.mjs` 在冻结树 `1bbd5ef` 上 **exit 0 — 94/94，PASS 94 / ACCEPTED 0 / FAIL 0 / MISSING 0**（同一次修复还关闭了两处非阻塞缺口：验收报文按项目给出真实失败原因、`requirement.archive/restore/start` 真正强制文档化的 `expectedVersion`）。

独立 Test 另外确认 10 条声明为真（批准绑定、读账本封口、集成拒绝无 manifest 的 Task、跨项目产物 token 被拒、`contentMarkdown`、浏览器隔离攻击、完成记录绑定最终 revision、游标不串项目等），并做了路径边界与密钥泄漏的证伪尝试（未发现漏洞）。

## 4. 如实登记的残余（不阻断试用，但未关闭）

1. **49/94 条 AC 目前没有 `apps/*` 应用层证据**（40 条纯库级、8 条库级+演练、1 条仅演练）；验收报告未在正文显式披露这一点——已由独立 Test 指出，需在下一版报告中逐条标注证据层级。
2. **容器只覆盖工具执行**：Runner 仍在宿主、工具读写项目根而非每 Task 独立工作区，多任务并发靠单写者租约（`T3-implementation.md`）。
3. **模型没有"申请使用某个密钥"的入口**，密钥注入只在不经过模型的路径上验证过。
4. **AC-046（并行子任务失败）/AC-047（口头完成、两次不合规）只有库级证据**，缺整机演练；`drill-acs.mjs` 未为其登记残差。
5. **L2 演练交付的是 `needs_input`**：真实 Chief 直接把实现角色派出去，该 Work 无 Plan/Task 因而无 Grant——链路交付成立，但 L2 应走 Product→Plan→Develop 的路由仍是产品缺口。
6. **两条既有集成用例仍对负载敏感**（`packages/core/test/broker.integration.test.ts:505` 的 Docker 容器读取、`protocol.integration.test.ts` 的 AC-054 事件重放抖动）；冻结树上的验收运行未翻转，但它们是发布门禁的已知不稳定源。
7. 观察到一次 `BUSY` 写租约拒绝（已完成的 Chief Attempt 仍持写租约）。

## 5. 下一步

- 先关掉第 6 条里的竞态（进行中），使发布验收在负载下也稳定；随后复跑一次并以其结果更新第 3 节。
- 第 2 期（已冻结规格，未实施）：第一期权限规格（附录 A）+ `configPolicy` 两档；容器化 Runner 与每 Task 工作区；模型侧密钥申请入口；AC-046/047 整机负例；L2 路由（Product→Plan→Develop）。
