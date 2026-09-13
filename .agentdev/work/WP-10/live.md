# WP-10 T3 真实 Provider 纵向演练记录（自动生成）

本文件由 `node scripts/live.mjs`（`pnpm test:live`）在真实运行后写出，请勿手工编辑。

## 0. 运行元数据

- 生成时间：2026-09-13T13:33:09.313Z
- 命令：`pnpm test:live`（实际执行 `node scripts/live.mjs`）
- Node：`v24.8.0`
- 仓库：`/Users/huyaohua/huyh/work/aigrouptool`
- Git HEAD：`508bfaf70cdf4368205382200fc82584d78977fd`
- 装载方式：Node 原生类型擦除 + 模块解析钩子直接执行 `packages/*/src`；真实 Provider HTTP（Node 内建 `node:http`/`node:https`），无新依赖、无浏览器。
- 真实栈：未启动（未配置 Provider，演练在任何网络调用前退出）。
- Provider：未配置。
- 未验证原因：UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET)
- 检查：PASS 0 / FAIL 0 / UNVERIFIED 4（共 4）
- 退出码：3

## 1. 逐项检查（原始证据）

| 检查 | 状态 | 关联 AC | 证据 |
|---|---|---|---|
| `provider.configuration` | **UNVERIFIED** | — | UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET) |
| `drill.html-explanation` | **UNVERIFIED** | AC-001 | UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET) |
| `drill.l1-typo` | **UNVERIFIED** | AC-007 | UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET) |
| `drill.l2-delivery` | **UNVERIFIED** | AC-010, AC-037, AC-041 | UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET) |

## 2. AC 聚合（供 `pnpm test:acceptance` 合并）

| AC | 状态 | 证据 |
|---|---|---|
| AC-001 | **UNVERIFIED** | drill.html-explanation: UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET) |
| AC-007 | **UNVERIFIED** | drill.l1-typo: UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET) |
| AC-010 | **UNVERIFIED** | drill.l2-delivery: UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET) |
| AC-037 | **UNVERIFIED** | drill.l2-delivery: UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET) |
| AC-041 | **UNVERIFIED** | drill.l2-delivery: UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET) |

## 3. UNVERIFIED 与残余

- `provider.configuration`（—）：UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET)
- `drill.html-explanation`（AC-001）：UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET)
- `drill.l1-typo`（AC-007）：UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET)
- `drill.l2-delivery`（AC-010, AC-037, AC-041）：UNVERIFIED: real Provider not configured (set AGENTDEV_PROVIDER_BASE_URL, AGENTDEV_PROVIDER_MODEL, AGENTDEV_PROVIDER_SECRET)

- 真实浏览器未执行（焦点遍历、像素级布局、脚本隔离攻击样例）：产品决定不引入 Playwright 或浏览器下载；浏览器级 AC-002/AC-052/AC-071/AC-073/AC-076 的浏览器侧证据仍为 UNVERIFIED（本演练只验证服务端 CSP/sandbox/一次性下载行为）。
- L1 等级来源：`workflow.md` §2.4 的 L1 条件属于 Chief 评估，而当前协议面 `AssessmentPayload` 不携带 L1 判据、`orchestrator.routingFloor` 又会把“声明写路径的 delivery”抬到 L2（DC-62），因此没有真实协议路径能产生 L1 Work；live 演练按 WP-06/AC-068 的既有做法直接落 Work/Authorization/Assessment 行，再由真实 Gate 执行写入与结算。
- L1 的 Plan 产物由 Gate 的 `planningRun(...)` 以 planning 角色登记（`packages/core/src/gates.ts`）：L1 CompactPlan 目前仍走同一 Plan 产物通道，没有独立的 CompactPlan API；演练断言的是 L1 链只有 Develop/Review/Settlement 三个阶段 Run。
- L2 的 Requirement 投影由演练直接落行（与 e2e 的 L2 演练一致）；需求保存本身由 `pnpm test:e2e` 的 requirement.save-git 覆盖。L2 的 Plan 由真实 Plan Gate 批准（无 productRef），ContextBuilder 的 ProductDefinition 必需项由 WP-05 的提交测试覆盖，不在本演练内。
- AC-001 的“读取记录”未由本演练产生：演练直接把真实 Git 内容作为 Chief 选择来源注入 prompt，没有经过 ContextBuilder/read ledger（那由 WP-05 的提交测试覆盖）；本演练覆盖的是真实模型答复区分事实/未知、Work 无 Requirement 且交付分支不变。
- CAS journal 使用 @agentdev/workspace 的 createMemoryCasJournal（与 e2e 一致）；崩溃/恢复注入不在本演练范围。
- AC-043 仅在环境提供 AGENTDEV_PROVIDER_REVIEW_MODEL（Review/Test 使用另一模型）时按 PASS 记录；否则演练仍验证各专业 Run 独立且各自冻结 config 快照，但“不同 Provider/模型”前提未执行，该 AC 记 UNVERIFIED。
- 真实 Provider 演练只在三个环境变量齐备时执行；缺失时本文件记录 UNVERIFIED 并以非 0 退出，不伪造成通过。本次配置路径仅以本机回环 OpenAI-compatible 替身做过 `--no-write` 开发冒烟（不写报告、不作为发布证据）。

## 4. 失败原始输出

无检查失败；退出码非 0 由配置缺失或演练未执行导致，原因见 §3。

