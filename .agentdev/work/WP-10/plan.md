# WP-10 Plan（发布整体验收）

- 责任：Test + Review；本 Plan 由 Developer 在实现前拟定（T0），T4 依实际证据回填「已实施」列。
- 依赖：WP-00～WP-09 全部结算（末包 WP-09 结算 `508bfaf`，代码树 `e9e237d`）。
- 权威依据：`docs/delivery/implementation.md` §WP-10 与 §3 工程检查命令、`docs/delivery/acceptance.md`（AC-001～AC-094）、`docs/architecture/*`、`docs/rules/{workflow,agents}.md`、`AGENTS.md`。
- 关联验收：AC-001～AC-094 全部（发布回归：所有包的关联 AC 在本包复验完整 Given/When/Then）。
- 产品行为/范围变更：**无**。需要用户裁决的两点已在本 Plan 的「已确认决定」中登记。

## 1. 目标

把「契约命令真实可运行」升级为「发布验收真实可判定」：每个 AC 有可审计证据来源，无证据的 AC 必须显式 UNVERIFIED 并说明缺什么，失败必须导致退出非 0；并产出运行/部署说明与发布就绪判定。

## 2. 已确认决定（用户裁决，属产品决定，不擅自变更）

| # | 决定 | 影响 |
|---|---|---|
| D1 | `test:e2e` **不引入 Playwright**，改为真实 Core + 真实 BFF + 真实 loopback HTTP/WS 的无头端到端（Node 内建） | 与 `docs/delivery/implementation.md` §3 表格「Playwright+真实Core+Provider桩」字面不一致，属**已批准偏差**；浏览器像素/焦点类证据登记 UNVERIFIED。该偏差已同步写回 `docs/delivery/implementation.md` §3 的命令表 |
| D2 | `test:live` 使用用户提供的真实 Provider（`baseUrl`/`model`/`secret`）；未配置时必须诚实 UNVERIFIED 且不得发起网络调用 | AC-001 在配置前保持 UNVERIFIED |
| D3 | 未被执行的 AC 只有**登记在 `scripts/lib/drill-acs.mjs` 的缺口表且豁免条件在本次运行成立**时才计为 ACCEPTED；未登记、或条件已失效（例如 Provider 已配置却仍未跑通）一律按 FAIL 处置；`pnpm test:acceptance` 不再读取仓库内任何演练报告，演练证据一律由本次运行产生（run nonce + codeDigest 绑定） | 发布门禁不承认「文件里写着 PASS」；PASS 的含义收紧为「该 AC 的全部已映射证据通过且没有未验证的登记缺口」 |

## 3. 工作分解

| Task | 内容 | 退出条件 | 已实施 |
|---|---|---|---|
| T1 | 验收聚合运行器 `pnpm test:acceptance`：AC-001～AC-094 注册表、真实套件结果映射（逐用例）、本次运行内真实执行 `test:e2e`/`test:live` 并校验 run nonce + codeDigest、已登记豁免条件复核、失败闭合、报告落盘 | 94/94 计账；PASS / 已登记豁免 / FAIL / MISSING 分明；任一 FAIL、MISSING、未登记或条件失效的 UNVERIFIED、未执行的映射测试文件、未映射失败用例、证据绑定不符 ⇒ 非 0 | 是（`scripts/acceptance.mjs`、`scripts/lib/acceptance-{binding,drills,evidence,registry,report}.mjs`、`scripts/lib/drill-acs.mjs`） |
| T2 | 无头端到端 `pnpm test:e2e`：真实 Git + 真实 SQLite + 真实 Core + 真实 daemon（`/rpc`、`/ws`）+ 真实 BFF，浏览器形态客户端驱动 | 覆盖 HTML/L1/L2/结算/冷启动/恢复/上传/水位等真实路径；任一检查失败 ⇒ 非 0 | 是（`scripts/e2e.mjs`、`scripts/lib/e2e-*.mjs`） |
| T3 | 真实 Provider 纵向 `pnpm test:live`：HTML / L1 / L2+结算三路径 + `--release` 十条命令演练与就绪门禁（只采用本次运行的 `acceptance-results.json`） | 未配置 ⇒ UNVERIFIED 且零调用、非 0；配置后三路径全过才 0 | 是（`scripts/live.mjs`、`scripts/lib/live-*.mjs`） |
| T4 | 验证 + 记录：全契约命令、证据表、UNVERIFIED 与残余清单 | 见 §4 | 是（`implementation.md`、`acceptance.md`、`acceptance-results.json`、`e2e.md`、`live.md`、`release.md`） |
| T5 | 独立 Review 第 1 轮（`review.md`，FAIL：3×P1 / 6×P2 / 3×P3）后的修复轮：证据绑定与 run nonce、逐用例映射、最弱一环合并、豁免登记与条件复核、失败闭合、就绪门禁重写、`plan.md` 入库、`scripts/not-implemented.mjs` 删除 | 独立复现的每条 P1/P2/P3 都有对应修复与复现回归；AC-001～AC-094 重新判定 | 是（见 `implementation.md` §T5） |

## 4. 本包必验范围与通过条件

1. 全部 AC 完整 Given/When/Then：**不得**以组件局部通过替代整体行为；不可达的 AC 必须 UNVERIFIED 并写明缺失环境/Provider/浏览器。
2. 真实 Provider 纵向任务 ≥3（HTML / L1 / L2+结算）——**依赖用户提供 Provider**，未提供时本包无法判 PASS。
3. 冷启动、备份/恢复、故障演练：以真实 Git/SQLite/工作树证据为准。
4. 契约命令全部真实执行：`install --frozen-lockfile`、`typecheck`、`lint`、`test:unit`、`test:integration`、`test:e2e`、`test:acceptance`、`test:live`、`docs:check`、`build`。
5. 运行/部署说明与发布就绪判定（`doctor` 真实运行 + `release.md`）。

## 5. 门禁与失败路由

Plan（本文件）→ Develop（T1–T4，已实施）→ **Independent Review（独立上下文，不读开发聊天）** → 修复轮 → **Independent Test** → Settlement（`settlement.md` + `docs/INDEX.md`）。

阻断性 Review 发现 ⇒ 回 Develop ⇒ 重新独立 Review。Test 期间任何代码改动 ⇒ 回 Develop ⇒ 重新 Review ⇒ 重新 Test。Provider 未配置 ⇒ 状态为 `Test 阻塞（等待真实 Provider 凭证）`，**不得**以 UNVERIFIED 冒充 Completed。

## 6. 明确非目标（本包不做）

- 不实现 `docs/architecture/operations.md` 中的 CLI 生命周期命令（`agentdev start/stop/status/open/backup/restore/relocate`），除非其被列入验收；现状登记 UNVERIFIED。
- 不引入浏览器运行时、不下载浏览器二进制。
- 不新增对外契约/权限/门禁语义；发布验收不得放宽既有规则。
