# WP-10 实现记录（发布整体验收）

- planVersion: 1（`.agentdev/work/WP-10/plan.md`，含 D1/D2/D3 三项已确认决定与 T1–T5）
- 依赖：WP-00～WP-09（全部已结算，末包 WP-09 结算 `508bfaf`，代码树 `e9e237d`）
- 关联验收：AC-001～AC-094 全部
- **产品决定（用户确认）**：D1 不引入 Playwright/浏览器下载，`test:e2e` 以真实 Core + 真实 BFF + 真实 HTTP/WS 的无头端到端实现；D2 真实 Provider 由用户提供，未提供时显式 UNVERIFIED 且零网络调用；D3 未执行的 AC 只有登记且条件成立才算 ACCEPTED，`test:acceptance` 只采用本次运行产生的演练证据。
- 本轮（Review 第 1 轮修复后）结果：`pnpm test:acceptance` → **94/94 ACs accounted — PASS 83 / ACCEPTED 11 / FAIL 0 / MISSING 0**，退出 0（详见 `.agentdev/work/WP-10/acceptance.md`）。

## T1 验收聚合运行器（`pnpm test:acceptance`）

- `scripts/acceptance.mjs` + `scripts/lib/{acceptance-registry,acceptance-evidence,acceptance-report,acceptance-binding,acceptance-drills,drill-acs}.mjs`：
  - 从 `docs/delivery/acceptance.md` 解析 AC-001～AC-094 精确注册表（重复/缺口/越界即失败）。
  - 通过 pnpm 的 `node_modules/.bin/vitest` shim 运行真实 unit/integration 项目，逐用例映射证据：
    - `test-name`：用例名（含 describe 链）直接含 AC 编号；
    - `curated`：`CURATED_EVIDENCE` 逐条登记 `{file, title, rationale, wpRecord}`，每条必须解析到已执行用例，缺一条即 FAIL；
    - **不存在文件级映射**（Review W10R1-04 的攻击面）。
  - **本次运行内真实执行演练**：`scripts/acceptance.mjs` 自己 spawn `scripts/e2e.mjs` 与 `scripts/live.mjs`，写入本进程刚创建的临时目录（`--drill-out`），并带上本次运行生成的 `AGENTDEV_DRILL_NONCE`；报告必须同时满足「路径来自本次运行」「nonce 一致」「`binding`（gitHead/gitTree/codeDigest）与当前代码树一致」才会被采用。仓库内的任何 `*-results.json` 都不再作为证据（Review W10R1-01 的伪造路径已关闭）。
  - **最弱一环胜出**（FAIL > UNVERIFIED > PASS）：演练 UNVERIFIED 会把同一 AC 的套件 PASS 降级，因为该 AC 的完整 Given/When/Then 并未全部执行；报告列出该 AC 的全部来源而非最后一份（Review W10R1-03/05）。
  - **已登记豁免（ACCEPTED）**：`drill-acs.mjs` 的 `RESIDUAL_GAPS` 为每个未执行 AC 登记缺口、豁免条件与决定记录；聚合器每次运行复核条件（`provider-absent` / `review-model-absent` / `browser-absent`）。未登记，或条件已失效（例如 Provider 已配置却仍未 PASS），一律按 FAIL 处置（Review W10R1-02/08）。
  - **失败闭合**：Vitest 项目无 JSON 报告、含 AC 证据的测试文件零用例执行、失败用例未映射到任何 AC、演练命令非预期退出、演练报告缺失/不可解析、证据绑定不符 —— 全部非 0（exit 2）。
  - 产出 `.agentdev/work/WP-10/acceptance.md`（逐 AC 表、原始套件与演练输出、ACCEPTED 明细、fail-closed 问题、映射审计、机器可读段）与 `acceptance-results.json`（供发布就绪门禁消费）。
- 本轮结果：unit **55 文件 / 1105 用例**、integration **26 文件 / 311 用例**（Docker 容器用例真实执行）、e2e 20 检查（PASS 16 / UNVERIFIED 4）、live 未配置 Provider → exit 3；聚合 **PASS 83 / ACCEPTED 11 / FAIL 0 / MISSING 0**，退出 0。

### ACCEPTED 的 11 个 AC（缺口均已登记、条件均成立）

| 类别 | AC | 缺口（未执行部分） |
|---|---|---|
| 真实 Provider（条件 `provider-absent`） | AC-001、AC-007、AC-010、AC-037、AC-041 | 真实模型纵向执行（HTML 说明、L1 全链、L2+结算、知识补丁与冷启动）；由 `pnpm test:live` 在配置 Provider 后关闭 |
| 独立 Review/Test 模型（`review-model-absent`） | AC-043 | `AGENTDEV_PROVIDER_REVIEW_MODEL` 未配置，多模型前提未执行 |
| 浏览器（`browser-absent`，D1 决定） | AC-002、AC-052、AC-071、AC-073、AC-076 | 真实浏览器中的隔离/攻击样例、viewport 与焦点、键盘与 ARIA、客户端上传提示 |

## T2 无头端到端运行器（`pnpm test:e2e`）

- `scripts/e2e.mjs` + `scripts/lib/{e2e-runtime,e2e-checks}.mjs`：同一进程内启动**真实栈**（真实临时 Git 项目 + 真实 SQLite `ProjectStore` + 真实 Core + 真实 `createDaemon`(HTTP `/rpc`、`/ws`) + 真实 `createWebApp` BFF，回环随机端口），用 Node 内建客户端（`node:http` + 手写 RFC6455 + multipart）驱动；`e2e-runtime` 用 Node 24 原生类型剥离把 `@agentdev/*` 解析到**当前源码**，不依赖 `dist`。
- 20 项检查（首个失败即带原始证据非 0）：登录/Cookie/Origin、需求保存到 Git、看板规则、Chief 路由、Plan 批准与过期卡片、Inbox 去重、配置校验保留输入、经 BFF 上传 + 首条消息绑定、分支预览边界、九面真实读数与 Live 面板、事件水位重连、L2 交付链（真实 `StageGate.submit` + 产品自身 `evaluateStageChain`）、结算（CompletionManifest 冻结 + CAS + 完成事件 + Requirement completed）、知识补丁与冷启动、Provider 桩零调用。
- 结果：**20 检查 — PASS 16 / FAIL 0 / UNVERIFIED 4；覆盖 23 个 AC**，退出 0；写 `.agentdev/work/WP-10/{e2e-results.json,e2e.md}`（`--drill-out` 模式下只写聚合器指定的临时路径，不动仓库记录）。
- `e2e-checks.mjs` 本轮修正：AC 合并改为最弱一环（`UNVERIFIED` 不再被同 AC 的 PASS 覆盖）；`check()` 返回空证据即 FAIL；`unverified()` 必须给出缺失输入；drill 报告新增 `binding`、`nonce` 与逐 AC 的 `checks` 来源。

## T3 真实 Provider 纵向与发布演练（`pnpm test:live`）

- `scripts/live.mjs` + `scripts/lib/{live-transport,live-harness,live-drills,live-report,live-release}.mjs`：读取 `AGENTDEV_PROVIDER_BASE_URL/MODEL/SECRET`（可选 `_REVIEW_MODEL` 等）；任一缺失 ⇒ 打印并写入 `UNVERIFIED: real Provider not configured (set …)`、**零网络调用**、退出 3；齐备 ⇒ 运行 HTML / L1 / L2+结算三条纵向演练，仅全通过退出 0。传输为 Node 内建 OpenAI 兼容 HTTP 并实现 Gateway 的 `GatewayTransport`；凭证在所有失败信息中遮蔽。
- `--release` 运行文档中的十条命令并记录退出码/耗时/尾部，读取**本次运行**的 `acceptance-results.json`（校验生成时间、`codeDigest`、`drillsExecuted`），跑 `pnpm doctor` 生成部署说明，并给出就绪判定：任一命令失败或任何 FAIL/MISSING/未登记 UNVERIFIED ⇒ `NOT READY`（非 0）；全部命令通过且只剩已登记豁免 ⇒ `READY (ACCEPTED RISK n)` 并逐条列出豁免；否则 `READY`。
- 本轮结果（未配置 Provider）：`pnpm test:live` 退出 **3**（明确 UNVERIFIED，零调用）；`--release` 退出 1 ⇒ **NOT READY**，原因如实列出 `pnpm test:live` 的 Provider 缺口（已登记 AC-001/007/010/037/041）与任何真实失败命令；`pnpm doctor` 退出 0（`executionReady=true`）。

## T4 契约命令与记录

| 命令 | 本轮结果 |
|---|---|
| `pnpm install --frozen-lockfile` | 0（锁文件一致） |
| `pnpm typecheck` | 0（strict 无错误） |
| `pnpm lint` | 0（ESLint + Prettier） |
| `pnpm test:unit` | 0（55 文件 / 1105 用例） |
| `pnpm test:integration` | 0（26 文件 / 311 用例，含真实 Docker 容器只读用例） |
| `pnpm test:e2e` | 0（20 检查；23 个 AC） |
| `pnpm test:acceptance` | 0（94/94；PASS 83 / ACCEPTED 11 / FAIL 0 / MISSING 0） |
| `pnpm test:live` | 3（诚实 UNVERIFIED：未配置 `AGENTDEV_PROVIDER_*`） |
| `pnpm docs:check` | 0（15 文档 / 55 链接 / 94 AC / 9 REQ / 11 WP） |
| `pnpm build` | 0（12 workspace） |
| `pnpm doctor` | 0（`executionReady=true`） |

## T5 独立 Review 第 1 轮（`review.md`）后的修复

Review 冻结在 `0aff531`，判定 **FAIL**（3×P1 / 6×P2 / 3×P3）。逐条处置：

| 发现 | 严重度 | 处置 |
|---|---|---|
| W10R1-01 已提交的演练报告可被改写并把 UNVERIFIED/FAIL 抬成 PASS | P1 | `test:acceptance` 不再读取任何仓库演练报告：本次运行自己 spawn e2e/live，要求 run nonce 一致 + `binding`（gitHead/gitTree/codeDigest）一致；`--drill-report`/`AGENTDEV_DRILL_REPORTS`/`drills/*.json` 自动发现全部删除（不保留「外部报告可信」的开关）。复现回归：把 `live-results.json` 的 AC-001 改成 PASS 后聚合输出不再变化；把它作为外部输入传入会因缺 binding 被拒并非 0 |
| W10R1-02 缺失/零用例的测试文件只降级为 UNVERIFIED 且仍 exit 0 | P1 | 含 AC 证据的测试文件零用例执行 ⇒ fail-closed 问题（exit 2）；映射到该 AC 的用例消失 ⇒ `MISSING`/stale ⇒ 非 0，除非登记豁免。复现回归：把所有映射用例置空后 AC-026/028/065/092/004 全部 FAIL |
| W10R1-03 演练自身 UNVERIFIED 的 6 个 AC 被聚合为 PASS | P1 | 合并改为**最弱一环**（FAIL > UNVERIFIED > PASS），逐 AC 保留全部来源；11 个未执行 AC 显式登记为 ACCEPTED 并逐条给出缺口与决定记录；PASS 的口径在报告 §0 明确 |
| W10R1-04 `file` 映射过粗 | P2 | 删除文件级映射，改为逐用例 `CURATED_EVIDENCE`（AC-011/026/027/028/065/066/092 等），解析失败即 FAIL |
| W10R1-05 演练报告按文件名覆盖、只显示最后来源 | P2 | 保留全部演练行并在报告 §6.6 逐条列出，合并规则改为最弱一环 |
| W10R1-06 冻结版证据生成于父提交、无 HEAD 绑定 | P2 | 报告携带 `binding`（gitHead + gitTree + codeDigest）并被校验；权威证据一律由本次运行产生，记录文件只是记录 |
| W10R1-07 就绪门禁读磁盘旧 `acceptance.md` | P2 | 改为只消费本次运行的 `acceptance-results.json`，并校验生成时间 ≥ 演练开始时间、`codeDigest` 一致、`drillsExecuted=true` |
| W10R1-08 就绪判定把 UNVERIFIED 视为非阻断 | P2 | FAIL/MISSING/未登记 UNVERIFIED 阻断；只剩已登记豁免时输出 `READY (ACCEPTED RISK n)` 并逐条列出，不折叠成 READY |
| W10R1-09 `plan.md` 未纳入冻结提交 | P3 | 本包 `plan.md` 已纳入提交（含 D1/D2/D3 与 T1–T5） |
| W10R1-10 `DRILL_ACS` 与 `DRILL_DEPENDENCIES` 漂移 | P3 | 新增 `scripts/lib/drill-acs.mjs` 作为唯一来源，`e2e`/`live`/聚合器/报告/就绪门禁共用；AC-007/010/037/041 的 Provider 缺口现在出现在验收汇总的 ACCEPTED 表中 |
| W10R1-11 `check()` 空证据仍记 PASS | P3 | 空证据即 FAIL；`unverified()` 空原因即抛错；演练行无证据文本即拒绝该行 |
| W10R1-12 注释与实现矛盾 | P3 | 重写 `live-report.mjs`、`e2e-checks.mjs`、`acceptance-evidence.mjs`、`acceptance-binding.mjs` 的契约注释，明确「最弱一环」与「演练证据只来自本次运行」 |

附带清理与同步：

- 删除 `scripts/not-implemented.mjs`（三个命令均已真实实现，保留该脚本只会留下伪造 `NOT_IMPLEMENTED` 的入口；根 `package.json` 早已不引用它）。
- 把 D1 偏差写回权威命令表 `docs/delivery/implementation.md` §3（`test:e2e`/`test:acceptance`/`test:live` 三行）。
- 记录文件（`acceptance.md`、`acceptance-results.json`、`e2e.md`、`e2e-results.json`、`live.md`、`live-results.json`、`release.md`）全部由本轮真实运行重新生成。

## 未验证 / 已登记残余（不冒充完成）

1. **真实 Provider 纵向演练**（AC-001/007/010/037/041 的模型侧，以及 AC-043 的独立 Review/Test 模型）：本环境无 `AGENTDEV_PROVIDER_*`，已登记为 ACCEPTED；提供三项凭证后重跑 `pnpm test:live` 与 `pnpm test:acceptance` 即可关闭（`provider-absent` 条件随之失效，未跑通即 FAIL）。
2. **浏览器级证据**（AC-002/052/071/073/076 的客户端半边）：按产品决定 D1 不引入浏览器，永久登记为 ACCEPTED；服务端 CSP/sandbox/一次性下载/上传限制已由套件与演练执行。
3. AC-066（SDK 契约）由锁定版本的真实 SDK 适配测试（事件映射含流式增量、会话创建/订阅/abort/压缩/resume/资源释放）逐用例证明；真实模型侧的纵向执行由 `pnpm test:live` 的 L1/L2 演练覆盖（配置 Provider 后为 PASS，当前计入 AC-001/007/010/037/041 的同一缺口）。
4. AC-011 的「真实迁移/回退/恢复演练」由真实 SQLite 迁移回滚、备份恢复与 L3 Gate 用例逐条证明（不再作为未验证项）。
5. 演练输入面：L2 的 Task 行、需求→Work 绑定、stage payload 由演练直接落真实 row 后交给真实 Gate；`e2e.md`/`live.md` 已登记，属「真实规则 + 合成输入」。
6. CAS journal 在演练中使用内存实现；崩溃/恢复注入不在本切片。
7. 部署说明中 `agentdev start/stop/status/open/backup/restore/relocate` 未实现（apps/cli 仅 doctor/version），已在 `release.md` 标 UNVERIFIED 并给出真实程序化/RPC 入口。
8. 沿用前序包已登记的残余（不影响本包判定）：WP-09 T2-01（dock 关闭不归还焦点）、W9R3-01（第二个端口分配的竞态）、W9R3-02（`completed`/`archive` 尚未在协议面上可达）、W9R3-03（`git show` 缺 `--end-of-options`）。
9. e2e 观察（未修复，属 WP-06/WP-09 车道）：`requirement.save` 仅更新元数据时会在 `content.md` 追加版本标记（版本配对与组合 Hash 仍有效）。
