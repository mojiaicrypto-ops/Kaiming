# WP-10 结算（Settlement）

- 工作包：WP-10 发布整体验收（`docs/delivery/implementation.md`）
- 等级：L2；Plan `.agentdev/work/WP-10/plan.md`（planVersion 1，决定 D1–D5）
- 关联验收：AC-001～AC-094 全部（发布回归）
- 基线提交：`508bfaf`（WP-09 结算）
- **验证代码树：commit `9f154c3`，tree `ed48e2d61ad577cc405fe71308b81013c59fbf02`**
- 证据提交：本结算提交（新增 `.agentdev/work/WP-10/{review.md,review-round2.md,review-round3.md,review-round4.md,test.md,settlement.md}` 与 `docs/INDEX.md`、`docs/architecture/ARCHITECTURE.md`、`docs/delivery/acceptance.md` 的同步；**代码树未变**）
- 独立验证：Review 第 1 轮 FAIL（3×P1/6×P2/3×P3）→ 第 2 轮 FAIL（2×P1/2×P2/3×P3）→ 第 3 轮 PASS（1×P2/3×P3）→ 第 4 轮（增量）PASS（2×P3）；独立 Test **PASS**（33 个 AC 抽样逐条核对、无阻断性 AC 失败、13 项 P3 残余已登记）
- 发布结论：`node scripts/live.mjs --release` → 十条文档化命令全部退出 0 → **READY (ACCEPTED RISK 8)**；`pnpm test:acceptance` → 94/94，**PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0**（真实 Provider 已配置）

## 1. 交付内容

| 类别 | 内容 |
|---|---|
| 验收聚合 | `scripts/acceptance.mjs` + `scripts/lib/acceptance-{binding,drills,evidence,registry,report}.mjs`、`scripts/lib/drill-acs.mjs`：AC-001～094 注册表、逐用例映射（test-name / curated）、本次运行内真实执行 e2e+live（run nonce + codeDigest 绑定）、最弱一环合并、已登记豁免条件复核、fail-closed 退出（exit 2 基础设施 / exit 1 验收失败）、`acceptance.md` + `acceptance-results.json` |
| 无头端到端 | `scripts/e2e.mjs` + `scripts/lib/{e2e-runtime,e2e-checks}.mjs`：真实临时 Git + 真实 SQLite + 真实 Core + 真实 `createDaemon`（`/rpc`、`/ws`）+ 真实 BFF，20 项检查覆盖 23 个 AC（含 L2 交付链、结算、知识补丁与冷启动、事件水位重连） |
| 真实 Provider 纵向 | `scripts/live.mjs` + `scripts/lib/{live-transport,live-harness,live-drills,live-report,live-release}.mjs`：HTML / L1 / L2+结算三条纵向真实演练、未配置时显式 UNVERIFIED 且零调用、`--release` 十条命令与就绪门禁 |
| 产品修复 | `packages/core/src/model-gateway.ts` 输出预算改用模型配置（移除 4096 硬上限）与探针预算；`packages/core/test/model-gateway.test.ts` 两条回归用例；三处误导性用例名改标真实 AC（AC-054→AC-055/AC-078、AC-068 标题）；`scripts/not-implemented.mjs` 删除 |
| 记录与同步 | `.agentdev/work/WP-10/**`（plan / implementation T1–T7 / 四轮 Review / Test / settlement）；`docs/delivery/implementation.md` §3 命令表偏差、`docs/delivery/acceptance.md` §3 测试层、`docs/architecture/ARCHITECTURE.md` §3 工具链基线、`docs/INDEX.md` 状态 |

## 2. 工程命令结果（验证代码树 `9f154c3`）

| 命令 | 退出 | 结果 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | 锁文件一致 |
| `pnpm typecheck` | 0 | strict 无错误 |
| `pnpm lint` | 0 | ESLint + Prettier |
| `pnpm test:unit` | 0 | 55 文件 / 1107 用例 |
| `pnpm test:integration` | 0 | 26 文件 / 311 用例（真实 SQLite/Git/HTTP/WS + 真实 Docker 容器用例） |
| `pnpm test:e2e` | 0 | 20 检查（PASS 16 / UNVERIFIED 4），覆盖 23 个 AC |
| `pnpm test:acceptance` | 0 | 94/94 — PASS 86 / ACCEPTED 8 / FAIL 0 / MISSING 0 |
| `pnpm test:live` | 0 | HTML / L1 / L2+结算 三路径真实通过（未配置 Provider 时为 3/UNVERIFIED，零网络调用） |
| `pnpm docs:check` | 0 | 15 文档 / 55 链接 / 94 AC / 9 REQ / 11 WP |
| `pnpm build` | 0 | 12 workspace |
| `pnpm doctor` | 0 | `executionReady=true` |
| `node scripts/live.mjs --release` | 0 | 10/10 命令 + doctor → **READY (ACCEPTED RISK 8)** |

## 3. 验收矩阵结论

- 94 个 AC：**86 PASS**、**8 已登记豁免**、0 FAIL、0 MISSING（真实 Provider 配置下）。
- 已登记豁免（逐条在 `acceptance.md` §3 与 `release.md` §2 列出，均不计入 PASS）：
  - `browser-absent`（产品决定 D1）：AC-002、AC-052、AC-071、AC-073、AC-076 —— 浏览器侧子句（隔离/攻击样例、viewport 与焦点、键盘与 ARIA、客户端上传提示）未执行；服务端与协议侧已执行。
  - `review-model-absent`（D2）：AC-043 —— 未配置 `AGENTDEV_PROVIDER_REVIEW_MODEL`，多模型前提未执行；专业 Run 独立与冻结快照已验证。
  - `recorded-gap`（D4）：AC-066（真实 Pi SDK 会话语流/历史恢复）、AC-090（界面未渲染分支/提交/未推送状态）。
- 真实 Provider 缺口（AC-001/007/010/037/041）已由用户提供的 DeepSeek 凭证真实跑通并转为 PASS；`provider-absent` 条件在配置后自动失效，未跑通即 FAIL。

## 4. 独立验证与门禁

- Review 第 1 轮（`review.md`，FAIL 3×P1）关闭了「已提交演练报告可被改写」「零用例文件降级」「演练 UNVERIFIED 被聚合为 PASS」；第 2 轮（`review-round2.md`，FAIL 2×P1）关闭了「AC-066 不可证」「Vitest 零用例/退出码不闭合」；第 3 轮 PASS（P2 1/P3 3）、第 4 轮增量 PASS（P3 2）。
- 独立 Test（`test.md`，冻结 `9f154c3` / `ed48e2d` / codeDigest `8ca1e58c…`）：**PASS**。契约命令全部由其本人执行（unit 55/1107、integration 26/311 含真实 Docker、e2e 20 检查、acceptance 94/94、live exit 0×3、docs:check、build 12、doctor）；真实 Provider 三路径三次运行全通过（每次 11 次真实 HTTP 200、无凭据泄漏）；用 HTTPS 抓包独立确认 L1 Review prompt 含真实冻结字节与判据；33 个 AC 抽样（含全部 8 条豁免、全部 curated 映射 AC）无阻断性失败；8 条豁免缺口文本实质准确。Test 同时纠正：AC-007 并非仅由 live 证据，`packages/core/test/delivery.integration.test.ts` 有 test-name 证据；**AC-001 才是唯一 `mapping=none`、只由 live 演练关闭的 AC**。
- 失败闭合（Test 复现）：未登记 UNVERIFIED ⇒ exit 2；条件失效（Provider 已配置 + `--no-drills`）⇒ 相关 AC 非 0；伪造已提交演练报告不改变聚合；就绪门禁拒绝无本次 run nonce 的 sidecar。
- 真实演练暴露并修复的三处缺陷已在 T6 记录（reasoning 模型传输、网关 4096 硬上限、L1/L2 演练任务与冻结内容不完整）。

## 5. 残余与后续

1. 已登记豁免 8 项（上文 §3），其中 AC-066/AC-090 为实现残余：实现后必须删除对应登记，否则聚合会因条件/登记不匹配而失败。
2. W10R4-01（P3，先于本增量存在）：单元/集成测试脚手架曾在 `$TMPDIR` 遗留 `agentdev-*` 目录；本轮清理后为 0，WP-10 自身运行器不遗留。
3. W10R4-02（P3）：L1 演练记录保存候选 revision/tree/numstat，但未保存交给 Review 的冻结字节哈希（临时仓库已删除）；后续可在证据串中补哈希。
4. 独立 Test 登记的 13 项 P3 残余（均不阻断，逐条见 `test.md`）：R-01 AC-004「可调查并建议」正向仅 HTTP 202；R-02 AC-026「无开发 Requirement」无断言；R-03 AC-027 一条 curated 条目与 Given 不匹配；R-04 AC-065「不运行 Agent」无启动路径断言；R-05 AC-084 失败重试/系统消息未执行；R-06 AC-087 无真实 git clone 断言；R-07 AC-037「两次需求修改」前提未演绎；R-08 AC-013 的 Broker 半句在生产代码无调用方；R-09 AC-071 缺口文本措辞（共享的是面板状态而非「共享宽度标记」）；R-10 AC-001 read ledger 子句（已披露，由 AC-032/036 覆盖）；R-11 AC-092 导入尚未接入 UI；R-12 AC-094 缺归档专项用例；R-13 AC-040「缺字段」仅在解析器层。这些是本包**已知但未在本次验收中断言**的细节，不得视为已验证。
5. WP-09 已登记残余沿用：T2-01（dock 关闭不归还焦点）、W9R3-01（端口分配竞态）、W9R3-02（`completed`/`archive` 未在协议面可达）、W9R3-03（`git show` 缺 `--end-of-options`）。
6. 部署面：`agentdev start/stop/status/open/backup/restore/relocate` 未实现，`release.md` §5 逐条标 UNVERIFIED 并给出真实程序化/RPC 入口。

## 6. 复盘（流程改进）

- **证据来源必须与消费同源**：验收聚合早期信任仓库内演练 JSON，导致伪造即可改变结论；本包改为「本次运行内执行 + run nonce + 代码内容绑定」，这是本包最重要的机制性改进。
- **最弱一环胜出**：任何来源的 UNVERIFIED 都不应被另一来源的 PASS 掩盖；只有明确登记、条件成立且由指定演练关闭的缺口才允许存在。
- **真实环境才能暴露真实缺陷**：三处产品/演练缺陷（reasoning 模型、4096 上限、演练任务描述）都只在真实 Provider 运行时出现，桩测试全绿也不能替代。
- **记录数值要随运行刷新**：Review 反复指出记录与真实运行不一致（W10R3-01）；记录应由运行器生成、并在冻结前重跑刷新。

## 7. 知识入口更新

- `docs/INDEX.md`：新增 WP-10 状态段，删除「三条命令返回 NOT_IMPLEMENTED」的过期描述。
- `docs/delivery/implementation.md` §3：命令表按已批准偏差更新（e2e 为真实栈无头端到端、acceptance 本次运行内执行演练并校验绑定、live 未配置时显式 UNVERIFIED）。
- `docs/delivery/acceptance.md` §3：测试层说明补充已批准偏差与浏览器侧 UNVERIFIED 的 AC 清单。
- `docs/architecture/ARCHITECTURE.md` §3：工具链基线记录「不引入 Playwright」的已批准偏差。
