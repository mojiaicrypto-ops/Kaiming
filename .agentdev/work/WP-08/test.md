# WP-08 独立 Test 报告（集成、结算与恢复）

## 0. 元数据

| 项 | 值 |
|---|---|
| 工作包 | WP-08 集成、结算与恢复 |
| Test 角色 | 独立 Test（独立上下文；未读取任何开发/Test 聊天或会话） |
| 冻结提交 | `dbfa9af`（task-issued freeze point） |
| `git rev-parse HEAD` | `dbfa9aff6624df717e61e0da64aedca372ef5e47` |
| `git rev-parse dbfa9af^{tree}` | `6c8f6c915a42192061b2edea7c111d23d3c17a9b` |
| `git status --porcelain` | ` M .agentdev/work/WP-08/review.md`（Review 第二轮报告尾部追加，未提交；`dbfa9af` 的代码树未被改动。本报告写入后为第二条未跟踪变更） |
| 平台 | macOS arm64（Darwin），Node v24.8.0，pnpm 12.3.4，git 2.39.3 (Apple Git-146)，`node:sqlite` 可用；未使用 Docker |
| 探针目录 | `/tmp/wp08t/`（**本轮未创建任何脚本**，见 §1） |
| 判定 | **FAIL —— Abort（未执行测试）**，原因：独立 Review 第二轮判定为 FAIL 且含 P1 阻断 finding（W8R2-01），Review 门禁未满足 |
| 报告写入 | `.agentdev/work/WP-08/test.md`（本轮唯一写入，仓库内） |

### 冻结提交事实

```text
$ git rev-parse HEAD
dbfa9aff6624df717e61e0da64aedca372ef5e47
$ git rev-parse dbfa9af^{tree}
6c8f6c915a42192061b2edea7c111d23d3c17a9b
$ git status --porcelain
 M .agentdev/work/WP-08/review.md
$ git show --stat --oneline dbfa9af
dbfa9af fix(workspace,core): close WP-08 review round-1 findings
 17 files changed, 1268 insertions(+), 159 deletions(-)
```

`dbfa9af` 是 WP-08 的 Review 第一轮（W8R1-01..08）修复提交，涉及
`packages/workspace/src/{worktree,cas}.ts`、`packages/core/src/{requirement-save,recovery,settlement,run-lifecycle,findings}.ts`
及 8 个测试文件与 `implementation.md`。工作树的唯一未提交变更是 Review 第二轮报告的追加内容（`.agentdev/work/WP-08/review.md`），
不含任何源码改动，故冻结代码树 = `6c8f6c9…`。

---

## 1. Abort 判定（本报告的核心结论）

任务书规定：**先读 `.agentdev/work/WP-08/review.md` 的第二轮判定；若为 FAIL 且含 P0/P1，则不测试，写明因 Review 门禁未满足而中止。**

实际读取结果（`review.md` 第 293–552 行，第二轮 R2-0…R2-9）：

| 项 | 值 |
|---|---|
| 轮次 | 第二轮（复核 round 1 的 8 条 finding + 回归搜寻） |
| R2-9 判定原文 | **「判定 FAIL，不允许进入独立 Test；须 `Develop → 新独立 Review → Test`」** |
| P0 | 0 |
| P1 | **1 —— W8R2-01（阻断）** |
| P2 | 3（W8R2-02、W8R2-03、W8R2-05） |
| P3 | 2（W8R2-04、W8R2-06） |
| 阻断 finding | 1（W8R2-01，P1） |

**门禁条件成立 ⇒ 本轮中止测试。** 依据：

- `docs/rules/workflow.md:51`：「L2/L3代码 **review 通过进入 test**。……Review或Test失败返回develop；修复后重新独立Review。」WP-08 为 L2/L3 代码工作包，Review 未通过即不得进入 Test。
- `docs/rules/workflow.md:65`：「Finding严重性：P0数据/安全或关键不可用，**P1错误行为/需求缺失**，P2局部质量/维护问题，P3建议。**P0/P1阻断**。」
- 本会话任务书门禁条款（review 为 FAIL 且含 P0/P1 时不得测试）。

### 门禁的独立确认（只读核对，非测试）

为排除「Review 记错导致误中止」，我在不执行任何 WP-08 行为实验的前提下，只读核对了该项 P1 的代码位置，确认缺陷真实存在：

| W8R2-01 声称 | 我的只读核对结果 |
|---|---|
| `cas.integrate()` 不校验候选是否为 `expectedRevision` 的后代 | **成立**：`grep -n "isAncestor\|merge-base" packages/workspace/src/cas.ts` 仅命中 `658: const result = git.isAncestor(...)`，位于 `prepareDependencies`；`integrate()` 主体（`cas.ts:1550-1602`）只把 `request.candidateRevision` 交给 `git update-ref <ref> <new> <old>`，无任何祖先/后代校验 |
| `prepareWorktree` 复用路径相同的残留 worktree 而不校验基点 | **成立**：`requirement-save.ts:1911-1916` 中 `if (existing !== undefined) { … return { ok: true }; }`，注释以「its previous attempt committed nothing … same frozen baseline」**断言**基点，代码未做任何校验 |
| `keepWorktree` 默认保留残留 worktree | **成立**：`requirement-save.ts:1093` `this.keepWorktree = options.keepWorktree ?? true;` |
| 交付路径不取集成锁（W8R2-02，P2） | **成立**：`grep -rn "ProjectIntegrationLock\|integrationLockResource" packages/*/src apps/*/src` 仅命中 `requirement-save.ts`（定义与 `save()` 使用），`cas.ts`/`settlement.ts` 零命中 |

结论：Review 第二轮的 FAIL/P1 判定**不是记账错误**，门禁确实未满足。因此本报告**不运行契约命令、不构建夹具、不产生任何独立断言**。

> 说明：任务书第 1 项（运行 6 条契约命令）与第 2 项（自建夹具逐 AC 验证）均被置于「Otherwise continue」之下；门禁条款优先，二者本轮**一律未执行**。为避免「未经执行的证据被当成已执行」，本报告不引用 Review 的契约命令数字作为我的测试结果（仅作为 Review 记录转述并在 §3 显式标注「未由 Test 复跑」）。

---

## 2. 逐 AC 结论表

本轮**未对任何 AC 做出测试结论**：所有 AC 均为 `blocked（未测试 / 门禁未满足）`。
「Review 记录」列仅为 Review 第二轮的转述，**未经 Test 独立复验**，不构成本报告的验收结论。

| AC | 题目 | 本轮结论 | Review R2 记录（未由 Test 复验） |
|---|---|---|---|
| AC-020 | 暂停/恢复（集成后） | **未测试（门禁阻断）** | passed |
| AC-021 | 取消需求（未知副作用） | **未测试（门禁阻断）** | passed |
| AC-022 | 预算止损原子拒绝 | **未测试（门禁阻断）** | passed |
| AC-029 | 初始化中断恢复/冲突 | **未测试（门禁阻断）** | passed |
| AC-041 | 知识补丁 + 冷启动 | **未测试（门禁阻断）** | passed |
| AC-057 | Runner 失联/租约轮转 | **未测试（门禁阻断）** | passed（本包必验面）；残余 W8R2-03 |
| AC-058 | 过期结果拒绝 | **未测试（门禁阻断）** | passed |
| AC-061 | 启动恢复（真实进程状态） | **未测试（门禁阻断）** | passed |
| AC-062 | 两 Task 冲突 → 修复 Task，HEAD 不动 | **未测试（门禁阻断）** | passed |
| AC-063 | ref 后崩溃复用提交 + 一次事件 | **未测试（门禁阻断）** | passed |
| AC-064 | 备份/恢复/迁移一致性 | **未测试（门禁阻断）** | passed |
| AC-081 | 依赖 revision / manifestRefs / 祖先失效 | **未测试（门禁阻断）** | passed |
| AC-082 | 重启保留窄 Scope | **未测试（门禁阻断）** | passed |
| AC-083 | 组合与文档 Finding | **未测试（门禁阻断）** | 仅间接覆盖 |
| AC-090 | 保存状态/重试/仅修投影 | **未测试（门禁阻断）** | passed；残余 W8R2-05 |
| AC-091 | 共享锁/并发交付/最新池/仅元数据拒绝 | **未测试（门禁阻断）** | partial（W8R2-02） |
| AC-093 | 目录与正文一致性（共享版本/组合 hash） | **未测试（门禁阻断）** | passed；残余 W8R2-06 |
| AC-094 | 正文保存与并发（陈旧写者拒绝） | **未测试（门禁阻断）** | passed（读取源）/ P1 于崩溃重试 |

计数：**0 个 AC 通过 / 0 个 AC 不通过 / 18 个 AC 未测试（blocked）**。
「不通过」为 0 系因本轮未产生任何断言，**不代表 AC 已通过**；`blocked` 按 `docs/rules/workflow.md:67` 保持等待。

### 五项必需失败测试

`Task 合并冲突`、`CAS 失败`、`ref 后崩溃`、`取消未知副作用`、`备份演练`（位于 `packages/core/test/wp08-failures.test.ts`）：
**本轮未独立复跑**。Review R2-1 记录其 5/5 通过，属 Review 证据，Test 未复验。

---

## 3. 契约命令原始结果与仓库状态

| # | 命令 | 本轮退出码 | 说明 |
|---|---|---|---|
| 1 | `pnpm typecheck` | **未执行** | 门禁未满足，未进入 Test |
| 2 | `pnpm lint` | **未执行** | 同上 |
| 3 | `pnpm test:unit` | **未执行** | 同上 |
| 4 | `pnpm test:integration` | **未执行** | 同上 |
| 5 | `pnpm docs:check` | **未执行** | 同上 |
| 6 | `pnpm build` | **未执行** | 同上 |
| — | `pnpm test:e2e` / `test:acceptance` / `test:live` | **未执行（按契约本就 NOT_IMPLEMENTED）** | 指向 `scripts/not-implemented.mjs` |

**本轮实际执行的命令（全部只读，构成仓库状态证据）：**

```text
$ export PATH="$HOME/.local/bin:$PATH"
$ git rev-parse HEAD
dbfa9aff6624df717e61e0da64aedca372ef5e47
$ git rev-parse dbfa9af^{tree}
6c8f6c915a42192061b2edea7c111d23d3c17a9b
$ git status --porcelain
 M .agentdev/work/WP-08/review.md
$ git show --stat --oneline dbfa9af
dbfa9af fix(workspace,core): close WP-08 review round-1 findings
 17 files changed, 1268 insertions(+), 159 deletions(-)
$ grep -n "isAncestor\|merge-base" packages/workspace/src/cas.ts
658:    const result = git.isAncestor(request.repoRoot, revision, request.targetRevision);
$ grep -rn "ProjectIntegrationLock\|integrationLockResource" packages/*/src apps/*/src
packages/core/src/requirement-save.ts:12,121,176,193,1007,1073,1086,1097,2202   # 仅 requirement-save.ts
$ grep -rn "backupProject\|restoreProject\|relocateProject\|recoverAfterRestart" apps/
(无输出)
$ grep -rn "createRepairTask" packages/*/src
packages/workspace/src/cas.ts:892,1122
$ grep -rn "createMemoryCasJournal\|createCasJournal" packages/*/src apps/*/src
packages/workspace/src/cas.ts:78
$ grep -n "agentdev" packages/core/package.json
  "@agentdev/contracts": "workspace:*" / "@agentdev/domain" / "@agentdev/knowledge" /
  "@agentdev/storage" / "@agentdev/workspace"
```

环境：`node v24.8.0`、`pnpm 12.3.4`、`git 2.39.3 (Apple Git-146)`、`node:sqlite` 可用、`date` 2026-09-13 09:57:04 +07。

Review R2 记录的契约命令为 6/6 退出 0（unit 48 文件/971 用例、integration 20 文件/215 用例、build 10 workspace、docs:check ok）。
**该组数字未经本轮 Test 复跑确认。**

---

## 4. 逐 AC 证据

**无。** 本轮未执行任何正向或负向实验，故不为任何 AC 提供证据。任务书要求的正/负向验证项（AC-062 冲突修复、AC-081 血缘、AC-090 保存状态机、AC-091 共享锁与并发交付、AC-093/094 组合 hash 与陈旧写者、AC-057/058/061 租约与 epoch、AC-063 ref 后崩溃、AC-064 备份/恢复/迁移、AC-082 窄 Scope、AC-041 知识补丁与冷启动、AC-020/021/022/029 集成后恢复）与五项必需失败测试，**全部留待门禁满足后的下一轮 Test**。

`/tmp/wp08t/` 本轮未创建（任务书允许创建，但因中止而无需创建）：**无脚本、无日志、无断言**。本报告由此不声称任何 `checks/failures` 计数。

---

## 5. Findings（T-xx）

### 本轮不新增 T-xx

本轮未执行测试，**没有产生任何新的独立缺陷发现**。特别声明：以下均**不是**本轮 Test 的发现，而是**承接 Review 第二轮的阻断项**，仅说明其对本判定的作用。

### 承接项 G-01（P1，阻断；来源 Review R2 的 W8R2-01，非本轮新发现）

- **问题**：崩溃重试复用停在旧基点的 save worktree，且 `cas.integrate()` 不校验候选是否为 `expectedRevision` 的后代 → 交付 ref 被静默回退到旧基线、已集成提交被丢弃，调用方仍收到 `status:'saved'`。
- **位置**：`packages/core/src/requirement-save.ts:1911-1916`（worktree 路径复用无基点校验）、`requirement-save.ts:1093`（`keepWorktree` 默认 `true`）、`packages/workspace/src/cas.ts:1550-1602`（`integrate()` 无候选基点校验）。
- **我的只读核对**：三项均**成立**（见 §1 表）。
- **严重性**：P1（错误行为/静默数据丢失）。
- **受影响 AC / 条款**：AC-090、AC-091、AC-094、AC-062；`docs/architecture/reliability.md` §2/§4（候选须由 `expectedRevision` 生成、ref 仅按 expected-old 移动）。
- **门禁作用**：**这是本报告判 FAIL/Abort 的直接依据。** 必须在 Develop 修复后经**新的独立 Review** 才能进入 Test。

### 承接项 G-02…G-06（非阻断，来源 Review R2；供修复批次参考）

| 编号 | 严重性 | 承接内容 | 受影响 AC / 条款 |
|---|---|---|---|
| G-02 | P2 | 代码交付路径不取得 `integration:<projectId>` 共享集成锁（只有需求保存取锁） | AC-091；`implementation.md` T2 |
| G-03 | P2 | 新 Attempt 准入是「Work 级决策」而非「Run/判定级」，写给同 Work 另一 Run 的 resume 决策会解除本 Run 的活进程阻断 | AC-057；`reliability.md` §2 |
| G-04 | P2 | CAS journal 已记 target、ref 尚未交换的崩溃窗口无法用同一 operationId 恢复（「Git commit 存在则复用」未实现） | AC-063、AC-090、AC-091；`reliability.md` §5 |
| G-05 | P3 | `createCasService().integrate()` 在候选 tree 不可读时抛 `WorkspaceError` 而非结构化拒绝（`settle()` 无 catch） | 结果联合契约 |
| G-06 | P3 | 保存路径无条件把提交字节写回交付工作树，未提交的本地编辑被静默替换（无脏检查） | AC-028 |

**对判定的作用**：G-02…G-06 自身不构成本轮 Abort 的理由（其中 P2 在 Test 中不得被忽略，G-04 与阻断项 G-01 同源），但因门禁已由 G-01 判 FAIL，本轮不为其另立 Test 结论。

---

## 6. 记录一致性检查（implementation.md T5/T6 与 review 轮次）

任务书要求确认「T5/T6 与各 Review 轮次承接项已登记，并说明本判定如何计入它们」。逐项核对（只读）：

| 承接项（任务书列举） | 登记位置 | 只读核对结果 | 本轮判定如何计入 |
|---|---|---|---|
| ① `WorktreeLeaseStore` 未落到 storage `lease` 表 | `implementation.md` T5 残余 1；T6 末尾重申 | **属实**：`WorktreeLeaseStore` 仅有 Port（`worktree.ts:568`）与内存实现（`:593`），`worktreeLeaseResource`（`:981`）在 product 源码中无消费者 | 已登记，非本轮 Abort 依据；Test 未验证，AC-057 的持久化租约面仍为残余 |
| ② CAS 事件/`operation` 行接线（`CasEventPort`/`CasJournal` 仅 Port） | T5 残余 2；T6 末尾重申 | **属实**：`grep createMemoryCasJournal\|createCasJournal` 仅 `cas.ts:78`（内存实现），无生产 SQLite journal/事件端口 | 同上；AC-063/AC-090 的事件与 operation 行接线面未覆盖 |
| ③ 冲突产物未落 `artifact`、修复 Task 未派发 | T5 残余 3 | **属实**：`createRepairTask` 仅 `cas.ts:892`（内部使用）与 `:1122`（定义），无 Artifact 落库与派发 | 同上；AC-062 的「派发」环节未覆盖 |
| ④ 备份只存 secret 标识，无加密导出 | T5 残余 4 | 登记明确（Review R1/R2 均确认清单不含值） | 同上；AC-064 的 secret 加密导出/导入未覆盖 |
| ⑤ `apps/cli` 的 backup/restore/relocate 与 `apps/daemon` 的 `recoverAfterRestart` 未接线 | T5 残余 5；T6 末尾重申 | **属实**：`grep -rn "backupProject\|restoreProject\|relocateProject\|recoverAfterRestart" apps/` 无输出 | 同上；AC-064/AC-061 的 CLI/daemon 端到端面未覆盖 |
| ⑥ `packages/core/package.json` 新增依赖 | T5 正文「本轮附带变更（必须登记）」 | **属实**：`packages/core/package.json:23-25` 含 `@agentdev/knowledge`、`@agentdev/workspace`；`git show --stat dbfa9af` 含 `pnpm-lock.yaml` | 属已登记的实现附带变更，不构成缺陷；Test 未复跑构建 |
| ⑦ `packages/workspace/src/backup.ts` 未归位 | T5 残余 6 | 登记明确；Review R2-7 确认该文件不存在，实现全在 `core/recovery.ts` | 同上；属结构/维护残余（纯搬移） |
| ⑧ 进程身份仅宿主数字 PID | T5 残余 7 | 登记明确（`parseRunnerPid` 容器/远端返回 `null` 并按不可确认 fail-closed） | 同上；AC-061 的身份识别边界未覆盖 |
| ⑨ AC-054 属 WP-09，本包未覆盖 | T5 残余 9（`implementation.md` 明确声明） | **属实且未夸大**：WP-08 的必验范围不含 AC-054；Review R2-8 亦记为 `not_covered` | **本报告不把 AC-054 计入 WP-08 验收**（与任务书一致）；另注意 `plan.md` T4 的 `acceptanceIds` 曾把 AC-054 列入，属 plan 层过度映射，建议结算时标为承接项 |
| ⑩ T6 两条新增边界（解除阻断需一条 recovery decision；`interrupted` 不在 `RESUMABLE_STATUSES`） | `implementation.md` T6 末尾 | 登记明确，且 R2-7 认定其为**已如实披露的 fail-closed 代价** | 已登记，不计为本轮新 finding；但 W8R2-03（G-03）指出其准入范围过宽 |

**记录一致性结论**：任务书列举的全部承接项**均已登记**，无「未登记即被当作已完成」的情形。但 `implementation.md` 的 **T2「需求保存与代码交付同一把锁」与代码不符**（G-02），且 **T1 的 CAS 描述虽已更正为「安装调用方提供的候选提交」，仍缺少候选基点的后代校验**（G-01）——两项已在 Review R2-7 记为「不准确/未登记的部分」。本报告据此不认可「WP-08 声明与代码完全一致」。

---

## 7. 未覆盖与剩余风险

| 项 | 状态 | 原因 |
|---|---|---|
| 全部 18 个 AC（AC-020/021/022/029/041/057/058/061/062/063/064/081/082/083/090/091/093/094） | **未测试（blocked）** | Review 第二轮 FAIL + P1（W8R2-01）门禁未满足 |
| 五项必需失败测试的独立复跑 | **未执行** | 同上 |
| 6 条契约命令的独立复跑 | **未执行** | 同上（Review 记录 6/6 退 0，未经 Test 确认） |
| 正向/负向夹具、故障注入、真实 Git 竞态 | **未构建** | 同上（`/tmp/wp08t/` 为空） |
| AC-054（BFF/浏览器断开继续） | **不属本包** | 归 WP-09（`implementation.md` T5 残余 9） |
| AC-083 的直接探针（Finding 目标绑定/`manifestId` 约束） | **未覆盖** | 门禁阻断；且 Review R2-8 记其此前仅间接覆盖 |
| `test:e2e` / `test:acceptance` / `test:live` | **未执行（按契约 NOT_IMPLEMENTED）** | 指向 `scripts/not-implemented.mjs`，分别归 WP-09/WP-10 |

**剩余风险（本轮判定的直接后果）**：WP-08 当前**没有任何来自 Test 的证据**。Review 第二轮的「21/18 项 AC 行为已由独立探针复现」是 Review 证据，不能替代 Test；在 G-01 修复并由**新的独立 Review** 判 PASS 之前，WP-08 不得进入 Test、不得结算、不得视为 Completed。若强行以 Review 证据放行，将违反 `docs/rules/workflow.md:51`（review 通过才进入 test）与 `:65`（P0/P1 阻断）。

**关于我未做的事**：我**不**对 G-01 的修复方案、优先级或 Review R2 的技术判断作评价；那是 Develop 与下一轮 Review 的职责。我仅确认门禁条件真实成立，并据此中止。

---

## 8. 结论

- 冻结提交核对：`HEAD = dbfa9aff6624df717e61e0da64aedca372ef5e47`，`dbfa9af^{tree} = 6c8f6c915a42192061b2edea7c111d23d3c17a9b`，工作树唯一未提交变更为 Review 第二轮报告追加；**代码树未被本轮改动**。
- 门禁：`.agentdev/work/WP-08/review.md` 第二轮 R2-9 明载 **FAIL**，含 **1 项 P1 阻断 finding（W8R2-01）**；我用只读核对确认该 P1 的三处代码位置均真实成立，门禁未满足。
- 依 `docs/rules/workflow.md:51`（review 通过才进入 test）与 `:65`（P0/P1 阻断），**本轮中止测试**：未运行契约命令、未构建夹具、未产生任何断言，`/tmp/wp08t/` 为空。
- 18 个 AC 全部为 **未测试（blocked）**；0 通过、0 不通过、0 证据；五项必需失败测试未复跑。
- 不新增 T-xx；承接 Review 的阻断项 G-01（P1）与 G-02…G-06（P2×3、P3×2）；任务书列举的 T5/T6 与 Review 承接项均已登记、无夸大，但 T2 与代码不符（G-02）已在 Review R2-7 记录。
- 路由：**Blocking Test Finding → Develop → 独立 Review → Test**（本轮为门禁 Abort，非断言失败路由；下一步应为 Develop 修复 G-01/G-04 等同源项，再由新的独立 Review 复核，之后重启 Test）。

**Test 判定：FAIL —— 不接受 WP-08 的 AC-020/021/022/029/041/057/058/061/062/063/064/081/082/083/090/091/093/094（本轮为门禁 Abort：Review 第二轮 FAIL 且含 P1/W8R2-01，未执行测试，故不构成任何 AC 的通过）。**

---

# WP-08 独立 Test 报告（第二轮：冻结 7b0fd20 的完整验收矩阵）

## R2-0. 元数据（round 2）

| 项 | 值 |
|---|---|
| 工作包 | WP-08 集成、结算与恢复 |
| Test 角色 | 独立 Test（独立上下文；未读取任何开发/Review 聊天或会话） |
| 轮次 | 第二轮（round 1 因 Review 门禁 Abort；本轮在 Review 第三轮 PASS 后执行完整矩阵） |
| 冻结提交 | `7b0fd20`（task-issued freeze point） |
| `git rev-parse HEAD` | `7b0fd200a1cdbc8bc637126d5a7df8a55a95ebdc` |
| `git rev-parse 7b0fd20^{tree}` | `cc350c5232c63e669eda24c0e52eb7f39ec3344d` |
| 报告写入前 `git status --porcelain` | ` M .agentdev/work/WP-08/review.md`（Review 第三轮报告追加，未提交；代码树未被改动） |
| 平台 | macOS arm64（Darwin），Node v24.8.0，pnpm 12.3.4，git 2.39.3 (Apple Git-146)，真实 `node:sqlite`（经 `ProjectStore`）；未使用 Docker |
| 探针目录 | `/tmp/wp08t2/`（13 个探针脚本 + `lib.mjs` 夹具库 + 若干一次性 probe；**不 import 任何产品测试文件**，只消费 `packages/*/dist`） |
| 判定 | **PASS**（0 × P0、0 × P1；2 项失败断言全部归属 1 条 P2 + 1 条 P3 观察，见 R2-5） |
| round 1 保留 | 第 1–246 行（原 20341 字节，SHA256 `ca7466dd…aeb9c`）逐字保留；本轮仅追加，`git diff --numstat` 删除计数为 0（见 R2-1） |
| 一次性工具副作用 | 本轮未使用任何子代理；仓库内唯一写入为本报告追加，全部脚本与日志位于 `/tmp/wp08t2/` |

### 门禁前提（Review 第三轮）

`.agentdev/work/WP-08/review.md` 的 R3-9 判定为 **PASS**：`P0=0`、`P1=0`、`P2=3`（W8R3-01/02/03）、`P3=3`（W8R3-04/05/06），并明确「允许进入独立 Test」。门禁满足，故本轮执行完整矩阵。

### 独立读取的依据

`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{execution,reliability,data}.md`、`docs/product/{knowledge,requirements}.md`、`docs/delivery/acceptance.md`（AC-020/021/022/029/041/054/057/058/061/062/063/064/081/082/083/090/091/093/094 全文）、`docs/delivery/implementation.md`（WP-08）、`.agentdev/work/WP-08/{plan,implementation,review}.md`，以及 `7b0fd20` 的受测源码。
刻意排除：任何开发/Test 聊天或会话、`webui/`、历史任务记录。

---

## R2-1. 契约命令原始结果（`7b0fd20` 工作树根目录，顺序执行）

日志全文 `/tmp/wp08t2/contract.log`；每行 `EXIT_CODE` 为真实退出码，`pnpm build` 的 10 个 workspace 逐行 `Done` 均在同一日志内。

| # | 命令 | 退出码 | 原始结果（关键行） |
|---|---|---|---|
| 1 | `pnpm typecheck` | 0 | `$ tsc -p tsconfig.json --pretty false`，无输出（real 1s） |
| 2 | `pnpm lint` | 0 | `$ node scripts/lint.mjs` / `Checking formatting...` / `All matched files use Prettier code style!`（real 16s） |
| 3 | `pnpm test:unit` | 0 | `Test Files  48 passed (48)` / `Tests  973 passed (973)`，Duration 12.24s |
| 4 | `pnpm test:integration` | 0 | `Test Files  20 passed (20)` / `Tests  222 passed (222)`，Duration 78.92s（含真实容器用例） |
| 5 | `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| 6 | `pnpm build` | 0 | `Done` ×10：contracts、cli、pi-runtime、knowledge、domain、storage、workspace、core、daemon、runner（real 4s） |

**WP-08 切片独立复跑**（`pnpm vitest run --project integration <6 文件>`，日志 `/tmp/wp08t2/slice.log`，`EXIT=0`，`Test Files 5 passed`、`Tests 65 passed`）：

| 文件 | 用例数 | 文件 | 用例数 |
|---|---|---|---|
| `workspace/test/cas.integration.test.ts` | 17 | `core/test/settlement.integration.test.ts` | 11 |
| `core/test/requirement-save.integration.test.ts` | 19 | `core/test/backup.integration.test.ts` | 6 |
| `core/test/wp08.integration.test.ts` | 12 | | |

注：`packages/core/test/wp08-failures.test.ts` **不属于** integration project（`vitest.config.ts` 的 integration include 为 `**/*.integration.test.ts`），它由 unit project 收集；单独复跑见下。

**五项必需失败测试**（`pnpm vitest run --project unit packages/core/test/wp08-failures.test.ts`，`Tests 5 passed (5)`，Duration 4.29s —— 本轮 Test 独立复跑，非转述 Review 记录）：

```text
✓ required WP-08 failure tests (5)
  ✓ Task 合并冲突: two passed Tasks conflict, the repair Task is independent and CAS protects HEAD (AC-062) 1196ms
  ✓ CAS 失败: a moved baseline refuses the writer and leaves the branch untouched 641ms
  ✓ ref 后崩溃: the restart reuses the commit, completes the state and emits one event (AC-063) 504ms
  ✓ 取消未知副作用: cancel stops at blocked(recovery), keeps the Requirement active and integrates nothing (AC-021) 363ms
  ✓ 备份演练: backup → restore keeps hashes/knowledge/evidence and blocks a missing Secret (AC-064) 761ms
```

**round 1 逐字保留校验**：追加前 `.agentdev/work/WP-08/test.md` 为 20341 字节、SHA256 `ca7466dd3b2b9b0f9e2eecd7ed01273a47b3810a659be720b8e6239ae38aeb9c`；追加后 `git diff --numstat -- .agentdev/work/WP-08/test.md` 删除计数为 0。

---

## R2-2. 方法与夹具

13 个脚本位于 `/tmp/wp08t2/`，全部通过 `packages/*/dist/index.js`（`@agentdev/storage|knowledge|workspace|core` 的**构建产物**）消费产品公共 API；真实临时 Git 仓库（真实 `git` 二进制：`init`/`worktree add`/`commit`/`update-ref`/`cherry`/`cherry-pick`/`clone`/`reset --hard`/`show`）与真实 SQLite（`ProjectStore`，含 `cas_operation` 表由 `node:sqlite` 建表）承载全部集成状态。脚本自实现断言，**从不 import 产品测试文件**；夹具库 `lib.mjs` 只从 `dist` 取 API。

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `01-fail-task-merge-conflict.mjs` | **必需失败测试 #1**（AC-062/AC-081）：两已通过 Task 冲突、修复 Task 独立性、HEAD 保护、修复回路 | checks=29，failures=2（R2-5 的 T-01/T-02） |
| `02-fail-cas-conflict.mjs` | **必需失败测试 #2**（AC-062/AC-094）：竞争移动基线、`actualRevision`、无事件、重放复用、缺失 ref/候选 | checks=28，failures=0 |
| `03-fail-crash-after-ref.mjs` | **必需失败测试 #3**（AC-063）：ref 后崩溃复用提交、恰一次事件、重放、CAS 前崩溃安装、无关修订拒绝 | checks=36，failures=0 |
| `04-fail-cancel-unknown-side-effects.mjs` | **必需失败测试 #4**（AC-021）：未知副作用 `blocked(recovery)`、Requirement 保持 active、已交付不回滚、resume/accept_cancel | checks=34，failures=0 |
| `05-fail-backup-drill.mjs` | **必需失败测试 #5**（AC-064）：backup/restore/租约回收/缺 Secret/篡改/不完整/relocate | checks=38，failures=0 |
| `06-ac-save.mjs` | AC-090、AC-094：保存状态、Git 状态、投影、重试只补投影、陈旧写者拒绝、组合 hash 复算 | checks=48，failures=0 |
| `07-ac-lock-lineage.mjs` | AC-091、AC-081、AC-062：共享锁、交付含最新需求池、metadata-only/空变更集、依赖血缘、祖先失效、跳过已合并祖先、注入退出重试 | checks=59，failures=0 |
| `08-ac-093-record-consistency.mjs` | AC-093：共享版本、组合 hash、半对结构拒绝、缺文件/Hash 不符读取行为 | checks=28，failures=0 |
| `09-ac-029-initialize.mjs` | AC-029：写入中断、按 Hash 续写、ref 不动、冲突不覆盖、Ready 门禁 | checks=29，failures=0 |
| `10-ac-020-021-022.mjs` | AC-020、AC-021、AC-022 | checks=34，failures=0 |
| `11-ac-041-knowledge.mjs` | AC-041：知识补丁、冷启动、非法知识 | checks=28，failures=0 |
| `12-ac-057-058-061-082.mjs` | AC-057、AC-058、AC-061、AC-082 | checks=58，failures=0 |
| `13-ac-064-backup-083-findings.mjs` | AC-064 独立演练、AC-083 | checks=49，failures=0 |

合计 **498 项断言，2 项失败**（均归属 R2-5 的 T-01 与 T-02）。原始输出 `/tmp/wp08t2/runall.log` 与逐脚本输出。

反证手法：
- **真实 Git 竞态**：竞争者用真实 `update-ref` 在比较之后移动交付 ref；第三方服务抢先安装同一候选提交。
- **崩溃注入**：`Object.create(port)` 包装真实端口让 `update-ref` 失败一次（journal 已记 target、ref 未交换）；写中断注入到 `FileSystemPort.writeFile` 第 3 次调用；投影/写回故障。
- **陈旧工作树**：另一服务器提交并 `update-ref` 而不 checkout（fetch/远端提交形态）；detached worktree 停在旧基点。
- **状态机反证**：在恢复判定 `newAttemptAllowed:false` 之后，直接走产品自身的 `RunLifecycle.beginAttempt` / `newAttemptAdmission` 尝试开新 Attempt；兄弟 Run 的决策不解除阻断。
- **备份篡改**：改动备份目录内的真实 payload 而不改清单，验证 restore 的逐文件 Hash 校验；`complete:false` 与缺清单。
- **relocate 复检**：空目录（非仓库）应拒绝且根映射不变；随后对 `git clone --no-local` 的真实副本应成功。

---

## R2-3. 逐 AC 结论表

| AC | 题目 | 本轮结论 | 证据要点（脚本） |
|---|---|---|---|
| AC-020 | 暂停恢复 | **passed** | `10`：暂停关闭 live Attempt（`attemptsClosed=1`）并冻结写准入；恢复恰开 1 个新 Attempt，ready 前不放开写，ready 后放开；已交付 ref 未被回滚 |
| AC-021 | 取消需求 | **passed** | `04`、`10`：未知副作用 → `blocked`+`recoveryRequired`+`integrated:false`、Requirement 保持 active、候选 Artifact 保留、Run/Attempt 停止；`resume` 回到 running 且保持 active；`accept_cancel` → Work/Requirement cancelled 且此前交付不动；无未知副作用时直接 cancelled |
| AC-022 | 预算止损 | **passed** | `10`：`requestedTokens=150` 超限 → `BUDGET_EXCEEDED`、`tokensReserved` 仍 0、Artifact 数不变；限额内 60 通过并预留 60；第二次超限再拒且预留不变；真实集成之后同一拒绝仍成立（无静默加额） |
| AC-029 | 初始化冲突中断 | **passed** | `09`：第 3 次写入中断 → `failed/interrupted`、`recoverable:true`、已写 2 份、交付 ref 仍为 null；新进程 `resume` 到 done、4 个入口文档按 receipt Hash 逐字节核对、二次 resume 幂等；用户自维护 `PROJECT.md` → `content-conflict`、路径点名、字节原样保留、后续文档不写、`resume` 拒绝；未知初始化 `not-found` |
| AC-041 | 知识结算 | **passed** | `11`：补丁更新正文/关系/入口/失效说明，只经 `applyKnowledgePatch` 发布；冷启动 `queryFeatureView(view=delivered)` 找到新行为、新入口、失效说明与约束，索引更新 implementation/verification；非法知识 `KNOWLEDGE_INVALID`、不发布、保留最后有效并标 stale |
| AC-054 | UI 断开 | **not_covered** | 属 WP-09（`implementation.md` T5 残余 9；WP-08 无 BFF/WS 接线） |
| AC-057 | Runner 失联 | **passed** | `12`：活租约不共享、旧持有者不能释放他人租约；`starting`+活进程 → park `interrupted`、`newAttemptAllowed:false`、`beginAttempt` 抛错、Attempt 仍 1 条、worktree 租约 0 行；Run 级 resume 决策才放行（Attempt #2/epoch 1）；兄弟 Run 仍被阻断；确认已死 → `lost` 且直接开新 Attempt；容器身份不可确认按 fail-closed |
| AC-058 | 过期结果 | **passed** | `12`：旧 epoch 成功被拒（`STALE_ARTIFACT`、`supersededBy=newer_attempt`），`stage.result_rejected` 诊断事件持久保留摘要，Run 状态未改写、无 `stage_result` 行；当前 epoch 正常接受 |
| AC-061 | 启动恢复 | **passed** | `12`：新心跳+进程已死仍 park `interrupted`（`processAlive:false`）；等值/更旧 daemon epoch 被 `VERSION_CONFLICT` 围栏，新 epoch 接受且已 park 者不重复处理；持久 `running` 但探针存活 → `recovery_required` 且不开新 Attempt；`parseRunnerPid` 对容器标识返回 null |
| AC-062 | 集成冲突 | **passed（主体）** | `01`、`07`：两已通过 Task 冲突 → `TASK_MERGE_CONFLICT`、HEAD 不动且提交数不变、独立修复 Task（依赖双方、`requiresFreshVerification`、`committed:false`、冲突产物 SHA256、确定性 UUIDv7、重试同 id）；`07` 最终集成跳过已合并祖先且祖先只出现一次。残余：T-01（修复回路不收敛）与 T-02（缺修订分类），均非阻断 |
| AC-063 | 部分结算 | **passed** | `03`：ref 后崩溃 → `recover` 复用同一提交、`refUpdated:false`、恰一条 `settlement.completed`、Work/Requirement completed、`phase` 清空、operation 行 completed；重放零新增；CAS 前崩溃 → 安装 journal 记录的提交、恰一条事件；无关修订被拒且分支不动 |
| AC-064 | 备份恢复 | **passed** | `13`：backup 清单 complete、记录 revision/tree/knowledge.treeHash/证据 Hash、只存 secret 标识；restore 到新目录逐文件与证据校验一致、tree/knowledge 匹配、活动 Run park `interrupted`、租约撤销、缺 Secret → `blocked`+`executionReady:false`，凭据可用 → `ready`；篡改 payload / `complete:false` / 缺清单分别被拒；relocate 对非仓库拒绝且根映射不变，对真实 `clone` 成功并改写根 |
| AC-081 | Task 依赖输入 | **passed** | `07`：`dependencyRevision`/`dependencyManifestRefs` 精确、无环拓扑序；未记录冻结输入或缺 manifest ref → `GATE_NOT_READY`；精确输入放行；祖先 revision 变化 → `STALE_ARTIFACT`+`invalidated:true`；祖先消失 → `STALE_ARTIFACT`；最终集成跳过已合并祖先且祖先在 applied 中仅一次 |
| AC-082 | 重启保留窄范围 | **passed** | `12`：冻结窄 Scope 在恢复后可读、`workScopeIgnored:true` 且仍报告 Work 宽范围；快照内 read/edit 允许、仅 Work 范围内的路径与未授权操作（`bash`）拒绝；快照缺失 → `STALE_ARTIFACT` |
| AC-083 | 组合与文档 Finding | **partial（服务层正例 + 关闭路径未收敛）** | `13`：`document` 目标 Finding 可提交、`taskId` 为空、绑定 Review Manifest、P1 阻断；`integration` 目标同样不需要 taskId；缺 taskId 的 `task` 目标被拒；reporting Run 不能自验。残余：见 R2-5 T-04（我未走通独立 Review 关闭）与 R2-7（闭包需 fixing Run 冻结修订与 Work 当前修订一致） |
| AC-090 | 需求保存时机 | **passed** | `06`：`saved` 报告 branch/ref/commit/previousCommit/tree/createdCommit/refUpdated/unpushed/upstreamRevision；组合 `recordHash` 由提交字节独立复算吻合、两文件共享版本；已提交后重试 → `projection_repaired`、复用提交、零新增提交与事件；正常更新前移；陈旧期望被拒且分支不动 |
| AC-091 | 崩溃与交付竞争 | **passed** | `07`：保存与交付共享 `integration:<projectId>`（持锁时保存与 `runIntegration` 双双 `BUSY` 且分支不动，释放后放行并归还锁）；交付后最新需求池仍在分支且无重复 `requirement.saved`；metadata-only / 空变更集 / 起点等于终点的范围均 `GATE_NOT_READY`，真实代码变更通过并回报 `codeStartRevision`；`update-ref` 注入失败后同 operationId 重试安装 journal 提交、恰一条事件，改正文精确冲突 |
| AC-093 | 目录与正文一致性 | **passed（一致性）** | `08`：两文件同版本、body marker 一致、组合 `recordHash` 由提交字节复算吻合、正文修改递增版本且 hash 改变；结构非法半对（非 `content.md`、越出需求池、路径逃逸）在 CAS 前被拒且分支不动；跨修订读取按交付 ref 的提交字节。残余：T-03（读取器无逐条冲突通道）与 T-04（半对仅结构校验） |
| AC-094 | 正文保存与并发 | **passed** | `06`：另一服务器推进 ref 后，带旧 `recordVersion/recordHash` 的保存被 `REQUIREMENT_CONFLICT` 拒绝、分支停在对方提交、对方正文未被覆盖、本机投影未前移；工作树与 ref 一致时正常更新前移。残余：见 R2-5 T-05（ref 领先工作树时旧投影保存落到 `RECOVERY_REQUIRED`） |

计数：**16 个 AC passed、1 个 partial（AC-083）、1 个 not_covered（AC-054，属 WP-09）**；0 个 failed 验收项。

---

## R2-4. 逐 AC 证据（关键断言原文摘录）

以下为脚本输出的代表性断言（完整输出见 `/tmp/wp08t2/runall.log`）。

**AC-020** `10-ac-020-021-022.mjs`
```text
ok   the Work is paused / exactly one Run was paused / exactly one Attempt was closed
ok   write admission is frozen
ok   resume succeeds / exactly one new Attempt
ok   writes stay frozen until the new Attempt is ready
ok   writes reopen once the new Attempt is ready
ok   pause/resume never moved the branch
```

**AC-021** `04/10`
```text
ok   unknown side effects park the Work blocked / recovery is required / nothing was integrated
ok   the candidate artifact is preserved / the child Run was cancelled / the live Attempt was stopped
ok   Requirement stays active / the delivered revision is untouched
ok   resume is accepted -> Work returns to running, Requirement stays active
ok   accept_cancel resolves -> Work/Requirement cancelled, the earlier delivery is preserved
ok   clean cancel reaches cancelled / clean cancel did not move the branch
```

**AC-022** `10`
```text
ok   the over-limit Plan is refused   DBG {"code":"BUDGET_EXCEEDED","message":"used 0 + reserved 0 + 150 exceeds 100"}
ok   no reservation was written / no artifact was created
ok   a Plan within the budget is approved / the reservation is recorded (=60)
ok   the over-limit refusal survives the integration / the reservation is still 60
```

**AC-029** `09`
```text
ok   two documents were written before the crash / initialization never moved the delivery ref
ok   resume reaches done / the Ready gate passes / all four entry documents exist
ok   every receipt names a content hash / the written bytes match the receipt hash
ok   the failure kind is content-conflict / the failure names the user document
ok   the user document is byte-preserved / no later document was written
ok   the resume is refused while the conflict is open
```

**AC-041** `11`
```text
ok   the patch changes the entry list / the patch changes the invalidation notes
ok   the durable cache row is valid / a cold start rebuilds the projection
ok   the new behaviour is found / the new entry is found / the invalidation note is exposed as a gap
ok   the relation becomes a constraint / the index records implementation=implemented verification=passed
ok   invalid knowledge is refused (KNOWLEDGE_INVALID) / the retained projection is stale
ok   the cache row is now stale, never current
```

**AC-057** `12`
```text
ok   a live lease is never shared / the old holder cannot release a lease it does not own
ok   the Run parks interrupted ... / a new Attempt is withheld / the stale process is not declared lost
ok   the lease was revoked from the old attempt / no second owner took the worktree lease
ok   beginAttempt is refused while the old process is alive / still exactly one Attempt row
ok   the Run-bound decision opens Attempt #2 / the new Attempt has a new epoch
ok   the sibling Run is also withheld
ok   a confirmed-dead process is resumable / the dead execution is marked lost
```

**AC-058** `12`
```text
ok   the old-epoch result is refused (STALE_ARTIFACT, supersededBy=newer_attempt)
ok   diagnostics are kept / the diagnostic event is persisted / the diagnostic keeps the summary
ok   the Run status was not overwritten / no stage_result row was written
ok   the current epoch is accepted
```

**AC-061** `12`
```text
ok   the restart parks the live Run / the report carries the host epoch
ok   an equal daemon epoch is fenced / an older daemon epoch is fenced / a newer epoch is accepted
ok   an already-parked Run is not reprocessed / the Run stays interrupted
ok   a live process parks recovery_required / a recovery decision is required / the live attempt is not declared lost
ok   a container identity is unconfirmable / an unconfirmable execution withholds a new Attempt
ok   parseRunnerPid rejects a container id / parseRunnerPid accepts a host pid
```

**AC-062** `01`（失败项见 R2-5）
```text
ok   conflict is reported, not absorbed / failure code = TASK_MERGE_CONFLICT
ok   conflict names the offending path / conflict kind = task-merge-conflict
ok   HEAD was untouched by the failed integration / the conflicting integration added no commit
ok   repair role is a code role / repair depends on both Tasks / repair requires fresh verification
ok   repair is not committed / repair carries the conflict paths / conflict artifact sha256
ok   repair task id is a lowercase UUIDv7 / retrying the same conflict yields the same repair Task id
ok   resolution shape converges / final content is the resolution / Task A integration is still an ancestor
FAIL repair Task can be folded into a converged integration :: TASK_MERGE_CONFLICT ["src/shared.ts"]
FAIL runIntegration surfaces the modelled conflict reason :: actual="INTERNAL_ERROR" expected="TASK_MERGE_CONFLICT"
```

**AC-063** `03`
```text
ok   settlement intent is persisted before the ref moves / operation starts in running state
ok   the CAS installed the candidate / ref points at the candidate
ok   no settlement.completed event yet (the crash step emitted only the CAS completion event)
ok   recovery reports the reuse / recovery did not move the ref again / recovery emitted the one event
ok   commitTree is the Git tree OID / codeTreeHash is the SHA256 code tree / they differ
ok   no duplicate commit / exactly one settlement.completed event / operation row completed
ok   replay emits no second event / replay creates no commit
ok   recovery from before the swap installs the commit / exactly one commit added / exactly one event
ok   recovery refuses an unrelated revision / branch left at the unrelated commit
```

**AC-064** `13`
```text
ok   the manifest is marked complete / the delivery revision is recorded
ok   the knowledge tree hash is the hash of the copied files / the evidence blob is hashed
ok   the manifest stores only the secret identifier / the manifest never stores a secret value
ok   a missing Provider Secret blocks execution / the blocked project reports not-ready execution
ok   the restored tree matches the manifest / the restored knowledge tree matches
ok   every manifest file was verified / the evidence blob was verified
ok   the active Run is parked for recovery / the old leases were revoked
ok   the restored knowledge document is byte-identical
ok   with the secret available the project is ready / executionReady
ok   a tampered backup is refused / an incomplete backup is refused / a backup without a manifest is refused
ok   relocate onto a non-repository directory is refused / the project root is unchanged
ok   relocate onto a real copy of the repository succeeds / the project root is rewritten
```

**AC-081** `07`
```text
ok   the dependent Task resolution carries the ancestor revision / the resolution carries the ancestor manifest ref
ok   plan order is dependencies first
ok   a Task with no recorded dependency input cannot start (GATE_NOT_READY)
ok   a missing manifest ref blocks the start (GATE_NOT_READY)
ok   the exact frozen input starts
ok   an ancestor change invalidates the dependent Task (STALE_ARTIFACT, invalidated=true)
ok   a vanished ancestor revision is stale
ok   the ancestor Task is skipped / the ancestor appears once in the applied list
ok   the ancestor revision is an ancestor of the final delivery
```

**AC-082** `12`
```text
ok   the frozen scope is readable after a restart / the effective scope is the narrow one
ok   the wider Work scope is reported as ignored / the Work scope is still reported for diagnosis
ok   a file inside the snapshot read scope is allowed / a file only inside the Work scope is refused
ok   an operation outside the snapshot is refused / a write outside the snapshot writePaths is refused
ok   a write inside the snapshot writePaths is allowed
ok   a missing snapshot fails closed (STALE_ARTIFACT)
```

**AC-083** `13`
```text
ok   the document Finding is submitted / the binding target kind is document / no taskId is fabricated
ok   the Review manifest is bound / the Finding blocks as P1 / the Finding is open
ok   the reporting Run cannot verify its own Finding
note closure refused: the addressed Finding needs a new independent Review of the fixing revision
ok   an integration Finding is accepted / an integration Finding needs no taskId
ok   a task target without a taskId is refused
```

**AC-090** `06`
```text
ok   reported status is saved / branch=agentdev/main / ref=refs/heads/agentdev/main
ok   commit is the branch head / previousCommit is the baseline / createdCommit / refUpdated / unpushed
ok   recordPath/recordVersion/recordHash / projection verdict = new
ok   exactly one requirement.saved event
ok   the two files share the record version / the combined record hash matches the committed bytes
ok   the retry reports projection_repaired / the retry reuses the commit / no second commit / no second event
ok   the update succeeds / previousCommit is the first save / the record hash changed with the body
ok   a stale expectation is refused (VERSION_CONFLICT) / branch untouched
```

**AC-091** `07`
```text
ok   the save lock resource is integration:<projectId>
ok   the delivery is refused while the save holds the lock (BUSY, heldBy=save-holder) / branch did not move
ok   a second save is refused while the lock is held (BUSY) / the holder releases the lock
ok   the delivery succeeds after the release / the latest requirement record is still on the branch
ok   the delivery took and released the lock
ok   a metadata-only change set is refused (GATE_NOT_READY) / an empty change set is refused
ok   a range starting at the final revision is refused / a missing codeStartRevision is refused
ok   a real code change set is accepted / the accepted range is reported
ok   the injected crash refuses the save / the branch stayed at the baseline
ok   the journal recorded the target commit before the swap / the retry installs the journaled commit
ok   exactly one requirement.saved event / the branch holds the record
ok   a changed body is refused with a precise conflict / the branch never moved on the conflict
```

**AC-093** `08`
```text
ok   the two files were committed together / the JSON carries the same version as the body marker
ok   the JSON contentHash matches the body bytes / the JSON does not repeat the body
ok   the combined recordHash recomputes from the committed bytes
ok   the version incremented / the combined hash changed / the new combined hash also recomputes from the bytes
ok   a content path that is not content.md is rejected / outside the pool is rejected / escaping path is rejected
ok   the CAS refuses a structurally invalid pair (VALIDATION_ERROR) / branch never moved / no event
ok   the parsed record carries the content at the same revision
```

**AC-094** `06`
```text
ok   the stale writer is refused (REQUIREMENT_CONFLICT) / branch is at the other server commit
ok   the other server content is not overwritten / the refusal names the record path
ok   the local projection was not advanced
```

---

## R2-5. Findings（T-xx，本轮 Test 独立发现）

严重性口径（`docs/rules/workflow.md` §6）：P0 数据/安全或关键不可用；P1 错误行为/需求缺失；P2 局部质量/维护；P3 建议。**本轮无 P0/P1，故 Test 判定 PASS**；以下 2 条为可复现的非阻断项，另 3 条为记录型观察（供结算登记或后续加固）。

### T-01（P2，非阻断）— 修复 Task 的重新集成回路不收敛：两份冲突路线的修复结果无法作为最终组合被集成

- **位置**：`packages/workspace/src/cas.ts:1047-1168`（`integrateTasks` 始终按**全部 Task 列表**重放：`planIntegration` 只跳过已包含在 `targetRevision` 中的提交，`cherry` 逐个回放其余提交；没有任何“该 Task 已被修复结果取代”的路径）。
- **复现**：`node /tmp/wp08t2/01-fail-task-merge-conflict.mjs`（“修复 Task 重新集成”段，另见 `/tmp/wp08t2/probe-repair2.mjs` 的 B/C 两例，均零注入）。
- **观测**：两 Task（task-a、task-b）各自修改 `src/shared.ts` 的同一行并各自通过；task-a 先集成到交付 ref（`afterA`），再集成两者 → `TASK_MERGE_CONFLICT` 并给出修复 Task。随后按 `createRepairTask` 的契约把“修复 Task 与两条路线一起重新集成”（修复提交以冻结的 `afterA` 为基点、`dependencyRevision=afterA`、`conflictPaths` 已解决为 `mode="A+B"`）→ 仍然 `TASK_MERGE_CONFLICT ["src/shared.ts"]`；HEAD 保持不动（好），但最终组合无法通过该路径落地。把 task-b 换成基于其修订的修复提交、或让修复依赖双方，都同样冲突。
- **期望**：AC-062「独立修复任务并重新验证最终组合」；`reliability.md` §4 步骤 3「有冲突保存 Conflict Artifact，Chief 派修复 Task，其结果按对应路线重新验证」。修复后应存在一条能把修复结果合入最终组合的集成路径（例如修复提交替换被取代路线、或按 `dependencyRevision` 只回放未包含的增量）。
- **影响面**：冲突修复是 AC-062 的**下游**环节；本轮必需失败测试 #1 本身通过（冲突识别、独立性、HEAD 保护均正确），故不阻断本包验收，但修复回路在服务 API 层不可复现成功。另注意：`createRepairTask` 产出的 `dependsOn=[task-a,task-b]` 若按原样传给 `runIntegration`（任务列表中缺少其中一个 Task）会抛 `INVALID_STATE: Task … 依赖不存在的 Task …`（`orderTasks` 校验），说明该修复 Task 还需要一条“把双方一起纳入”的调用约定。
- **AC/条款**：AC-062；`reliability.md` §4。

### T-02（P3，非阻断）— `runIntegration` 不消费 `planIntegration` 已建模的 `reason:'revision'` 冲突，未知 Task 修订被报成 `INTERNAL_ERROR`

- **位置**：`packages/workspace/src/cas.ts:1047-1086`（`integrateTasks` 拿到 `plan` 后只使用 `plan.order`/`plan.skippedTaskIds`，从不检查 `plan.conflict`，直接在循环里调用 `git.cherry`）。
- **复现**：`/tmp/wp08t2/01-fail-task-merge-conflict.mjs` 末段（也见 `probe-repair2.mjs`）。
- **观测**：任务列表含一个仓库中不存在的 revision 时，`planIntegration` 正确产出 `conflict.reason='revision'`（另有独立断言证明）；但 `runIntegration` 返回 `{ok:false, code:'INTERNAL_ERROR', message:'git cherry 失败：Task task-ghost'}` —— 报的是内部错误而不是 AC-062 需要的「独立修复 Task + HEAD 保护」冲突形态，调用方拿不到 `repair`。
- **期望**：同一函数内已建模的冲突应被一致地返回（`TASK_MERGE_CONFLICT` + repair），或至少把「修订缺失」归类为可处置的 Gate 失败而非 `INTERNAL_ERROR`。
- **AC/条款**：AC-062；`reliability.md` §4/§5（崩溃/失败应给出可核对的分类）。

### T-03（P3，观察）— 需求池读取器没有「逐条冲突」通道：缺 `content.md` 的记录被静默丢弃

- **位置**：`packages/core/src/requirement-save.ts:600-639`（`readRequirementPoolAtRevision` 在 `!present.has(contentPath)` 时 `continue`；返回类型 `RequirementPoolAtRevision` 只有 `records`，没有冲突列表）。
- **复现**：`/tmp/wp08t2/08-ac-093-record-consistency.mjs`（“缺文件的记录同样逐条冲突”段）。
- **观测**：提交一个只含 `.agentdev/requirements/<id>/requirement.json` 的记录修订，`readRequirementPoolAtRevision` 返回 `records.length = 0`，没有任何冲突/诊断项；`metadata.contentHash` 与正文不符时同样被「就地重算」为真实内容 Hash（本机保存路径会因此把冲突期望判成 `VERSION_CONFLICT`，但读取器本身不报冲突）。
- **期望**：`docs/product/requirements.md` §4「缺任一文件、Hash 不一致、重复 ID 或未知 Schema 标该条冲突，展示路径及可读原文，不静默补空正文」；AC-093「其他错误逐条明确显示」。导入路径（WP-04 的 Clone 导入）是否有该通道未在本轮验证，故按观察登记、不判 AC 失败。
- **AC/条款**：AC-093、AC-092；`requirements.md` §4。

### T-04（P3，观察）— CAS 的「半对记录」检查是路径形状检查，不核对候选提交里是否真有 `content.md`

- **位置**：`packages/workspace/src/cas.ts:1364-1409`（`requirementPoolPaths` 只校验路径名/位置），调用点 `1531-1548`。
- **复现**：`/tmp/wp08t2/08-ac-093-record-consistency.mjs`（末段）。
- **观测**：候选提交物理上只含 `requirement.json`、不含 `content.md` 时，只要 `requirementPool` 声明的路径对，`integrate()` 仍 `ok:true` 并移动 ref。结构非法（`contentPath` 非 `content.md`、目录越出需求池、路径逃逸）则确实被 `VALIDATION_ERROR` 拒绝且分支不动。
- **期望**：AC-094「恢复不会暴露半对文件」在**服务 API** 层最好由内容核对兜底（例如校验候选 tree 同时含两文件）；产品自身的保存路径通过 `prepareRequirementSave` 保证成对，故不判 AC 失败。
- **AC/条款**：AC-093/AC-094。

### T-05（P3，观察）— ref 领先工作树时，一份旧投影保存会以 `RECOVERY_REQUIRED`（而非冲突/成功）结束，且分支持续领先本机工作树

- **位置**：`packages/core/src/requirement-save.ts` 的脏写回判定（`dirtyWorktreeRefusal`/`refreshWorkingTree`，`2280-2360` 附近）。
- **复现**：`/tmp/wp08t2/06-ac-save.mjs` 与 `07-ac-lock-lineage.mjs` 的陈旧工作树变体：另一服务器提交并移动 ref（不 checkout），随后本机对同一条记录以 `explicitRepair:true` 保存。
- **观测**：返回 `ok:false, code:'RECOVERY_REQUIRED'`，消息列出 `content.md`、`requirement.json` 为「未提交的本地修改」（实际工作树停在更旧的**已提交**修订），本机投影不刷新；保存已经在分支上产生了提交。收敛方式是把工作树 `checkout/reset` 到交付 ref 后重试，或后续只读导入刷新投影。
- **期望**：AC-090「Git 已提交时仅补投影」与 AC-028 的脏工作区判定应区分「本地未提交编辑」与「命中另一提交的干净检出」（与 Review R3 的 W8R3-03 同族）；至少错误码应提示为投影修复而非本地修改。
- **AC/条款**：AC-090/AC-094、AC-028。

### 与 Review 第三轮的对照（不重复计分）

- Review R3 的 W8R3-01/02/03/04/05/06 为**非阻断**登记项。本轮未逐条重测（见 R2-8），但 T-01/T-02/T-03/T-04/T-05 均为**新的独立复现**，与 R3 六条不重叠。
- 本轮没有发现任何 P0/P1；不要求退回 Develop。

---

## R2-6. 五项必需失败测试的独立复现

| 必需测试 | 产品套件（unit） | 我的独立探针 | 关键正/负证据 |
|---|---|---|---|
| Task 合并冲突 | 通过（`wp08-failures.test.ts`） | `01-fail-task-merge-conflict.mjs`（29 断言，2 项为 T-01/T-02） | 冲突识别、修复 Task 独立性/确定性、HEAD 与提交数不动、无完成事件；T-01 修复回路失败 |
| CAS 失败 | 通过 | `02-fail-cas-conflict.mjs`（28，0） | 竞争移动 → `VERSION_CONFLICT`+`actualRevision`+分支不动+无事件；重放复用；缺失 ref/candidate 分类 |
| ref 后崩溃 | 通过 | `03-fail-crash-after-ref.mjs`（36，0） | 复用提交、恰一次 `settlement.completed`、重放零新增、CAS 前崩溃安装、无关修订拒绝 |
| 取消未知副作用 | 通过 | `04-fail-cancel-unknown-side-effects.mjs`（34，0） | `blocked(recovery)`、Requirement active、已交付不回滚、resume/accept_cancel 两条处置 |
| 备份演练 | 通过 | `05-fail-backup-drill.mjs`（38，0） | backup→新目录 restore 一致、活动 Run park、租约撤销、缺 Secret 阻断、篡改/不完整拒绝、relocate 拒绝非仓库 |

---

## R2-7. 记录一致性检查（`implementation.md` T5/T6/T7 与代码）

任务书要求确认的承接项逐条只读核对（本轮在 `7b0fd20` 上重新取证）：

| 承接项 | 登记位置 | 我的核对（`7b0fd20`） | 结论 |
|---|---|---|---|
| ① `WorktreeLeaseStore` 未落到 storage `lease` 表 | T5 残余 1；T6/T7 重申 | `worktreeLeaseResource`（`worktree.ts:1039`）在 `packages/*/src`、`apps/*/src` 中除 `worktree.ts`/`index.ts` 注释外**零消费者**；只有内存实现 `createMemoryWorktreeLeaseStore` | **属实**，已登记 |
| ② 运行期恢复决策 wiring gap（run-bound recovery decision 无生产入口） | T6 末条、T7 末条 | core 侧唯一 recovery 决策生产者是 `findings.ts:2532 openRecoveryDecision`，其 `targetRef.id = work.id`（**Work 级**）；按 W8R2-03 的绑定规则它无法解除任何 Run 的活进程阻断，`apps/` 无 Run 级入口 | **属实且本轮复核**：`newAttemptAdmission` 已被 `run-lifecycle.ts:120` 与 `findings.ts:1697` 消费（执行侧闸门存在），缺的是 Run 级决策入口 |
| ③ CAS 事件/`operation` 行接线 | T5 残余 2；T6/T7 重申 | `CasJournal`/`CasEventPort` 仅 Port（`createMemoryCasJournal`/`createMemoryCasEvents`）；无生产 SQLite journal/事件实现，`operation` 行由 `SettlementService` 写而 CAS journal 由调用方注入 | **属实**，已登记 |
| ④ 冲突产物/修复 Task 派发 | T5 残余 3 | `createRepairTask` 仅被 `cas.ts:1015`（`integrateTasks` 内部）调用；无 `artifact` 落库、无派发调用点 | **属实**，已登记（与 T-01/T-02 相关） |
| ⑤ 加密 secret 导出 | T5 残余 4 | 备份清单只写 `secretRefs` 标识（本轮 `13` 断言清单不含值）；`core/secrets.ts` 无加密导出/导入函数，备份不含值 | **属实**，已登记 |
| ⑥ `apps/cli`+`daemon` 接线 | T5 残余 5；T6/T7 重申 | `grep -rn "backupProject\|restoreProject\|relocateProject\|recoverAfterRestart" apps/` **无输出** | **属实**，已登记 |
| ⑦ `package.json` 依赖新增 | T5 正文 | `packages/core/package.json:23-25` 含 `@agentdev/knowledge`、`@agentdev/workspace`（`contracts`/`domain`/`storage` 亦在） | **属实**，已登记 |
| ⑧ `packages/workspace/src/backup.ts` 未归位 | T5 残余 6 | 该文件不存在；备份/恢复/迁移全在 `core/recovery.ts` | **属实**，已登记 |
| ⑨ AC-054 属 WP-09 | T5 残余 9 | `implementation.md` WP-08 与 `plan.md` 都把 AC-054 列在关联验收（主线清单），而 T5 残余 9 明确「本包未覆盖」 | **登记存在**，但本报告按门禁把它记为 `not_covered`，不计入 WP-08 验收 |
| ⑩ T6/T7 的两条边界（解除阻断需一条 recovery 决策；`interrupted` 不在 `RESUMABLE_STATUSES`） | T6 末、T7 末 | 与 `recovery.ts` 的 `RESUMABLE_STATUSES` 与绑定规则一致 | **属实**，已登记 |

**记录与代码一致性的其他核对**

- T5/T6/T7 的命令数字与本轮独立复跑**逐项吻合**：unit 48 文件/973 用例、integration 20 文件/222 用例、build 10 workspace、docs:check ok；`wp08-failures.test.ts` 5 例通过。
- T7 的“把修复临时还原为旧行为后回归用例由通过转失败”声明未由本轮复现（属 Review 证据）；本轮改为对修复后的行为独立取证。
- `implementation.md` T7 末条「Work 级 `targetRef` 无法解除 Run 阻断」的表述，本轮核对为**core 侧缺少 Run 级决策入口**，而非仅是 CLI/BFF 接线问题（与 Review R3-7 的判定一致）。

**未登记的水平缺口（本轮新增）**：T-01（修复 Task 重新集成不收敛）、T-02（未知修订分类）、T-03（池读取无逐条冲突通道）、T-04（半对仅结构校验）、T-05（陈旧检出被误判为本地修改）。前两条建议随 `createRepairTask`/`runIntegration` 一起收口，后三条建议与 W8R3-01/02/03 同批处理。

---

## R2-8. 未覆盖与剩余风险

| 项 | 状态 | 原因 |
|---|---|---|
| AC-054（BFF/浏览器断开继续） | **not_covered** | 属 WP-09；WP-08 无 HTTP/WS 接线（`implementation.md` T5 残余 9） |
| AC-083 的独立 Review 关闭正例 | **partial** | 本轮在服务层走通了提交与绑定（document/integration 目标、无 taskId、reporting Run 不能自验），但闭包还要求「fixing Run 冻结的修订 = Work 当前修订」且验证 Run 绑定该修订，我没有构造出满足全部条件的正例；产品自身的 document 路线用例覆盖该正例 |
| Review R3 的 W8R3-01..06 | **未逐条重测** | 本轮聚焦任务书要求的 AC 矩阵与五项必需失败测试；R3 六条为非阻断登记项，未在本报告重复取证（其状态仍以 Review 报告为准） |
| AC-092（导入冲突与幂等） | **不在本包清单** | 属 WP-04/WP-09 关联；本轮未验证（T-03 提到其读取通道） |
| CLI/daemon/BFF/UI 端到端 | **未覆盖** | T5 残余 5 属实（`apps/` 零引用）；本报告全部结论为**服务 API 层**行为 |
| Secret 加密导出/导入演练 | **未覆盖** | T5 残余 4；本轮只验证「缺 Secret 阻断」与「清单不含值」 |
| 多进程真实并发 | **未覆盖** | 本轮并发/竞态在单进程内以真实 SQLite + 真实 Git 状态观测（含真实 `update-ref` 竞态与独立锁实例）；未做多进程压测 |
| 真实 `SIGKILL` | **未覆盖** | 崩溃点用端口抛错模拟（与真实崩溃的可观测残留状态等价）；`03` 覆盖了 ref 前/后两个窗口 |
| AC-064 的 `.agentdev/work` 等本机过程目录 | **未覆盖** | 备份只包含 DB、`blobs`、`documentRoot` 知识树与 git bundle（代码如此，非缺陷） |
| `planIntegration`/`runIntegration` 对集成 worktree 的 HEAD 前置 | **操作约定** | 我的一次性探针发现：若把停在**旧基点**的 worktree 交给 `runIntegration`，`cherry` 会从该基点回放并在 `targetRevision` 的提交中产生冲突/多出提交。产品自身的两个调用点都会新建 worktree 并 `addWorktree(baseRevision=targetRevision)`，故这不是既有调用路径的缺陷；我的正式脚本改为先 `resetHard(targetRevision)` 以复现文档化前置 |

**剩余风险**：T-01 使「冲突修复后重新验证最终组合」缺少一条在服务 API 层可复现的成功路径，若下游（daemon/CLI 集成命令）按 `createRepairTask` 的产物直接调用 `runIntegration`，会停在 `TASK_MERGE_CONFLICT` 或 `INVALID_STATE`。这不影响本包已验收的行为（冲突识别、独立性、HEAD 保护、修复验证要求都是真的），但应在接线阶段明确调用约定或补齐替换式集成。

---

## R2-9. 结论

- **冻结核对**：`HEAD = 7b0fd200a1cdbc8bc637126d5a7df8a55a95ebdc`，`7b0fd20^{tree} = cc350c5232c63e669eda24c0e52eb7f39ec3344d`；代码树未被本轮改动，报告写入前 `git status --porcelain` 仅含 Review 第三轮报告的未提交追加。
- **契约命令**：6/6 退出码 0（typecheck / lint / unit 48 文件 973 用例 / integration 20 文件 222 用例 / docs:check / build 10 workspace）；WP-08 六个测试文件 65 用例独立复跑通过；五项必需失败测试 5/5 通过。
- **AC 矩阵**：用 13 个自建探针（真实临时 Git 仓库 + 真实 SQLite，498 项断言）独立验证了 AC-020/021/022/029/041/057/058/061/062/063/064/081/082/090/091/093/094 的**正向与负向**行为；AC-083 在服务层部分覆盖；AC-054 `not_covered`（属 WP-09）。
- **Findings**：本轮新增 5 条，均非阻断：T-01（P2，修复回路不收敛）、T-02（P3，未知修订分类）、T-03/T-04/T-05（P3，观察/加固）。**无 P0/P1**。
- **记录一致性**：`implementation.md` T5/T6/T7 的承接项（①–⑦、⑨、⑩）全部登记且与 `7b0fd20` 代码一致；⑤ 与 R3-7 的判定一致（core 侧缺 Run 级决策入口）。T5–T7 的命令数字与逐文件用例数与我的独立复跑逐项吻合。
- **路由**：无阻断 finding ⇒ 不需返回 Develop。建议把 T-01/T-02 与 T-03/T-04/T-05 作为结算时的残余登记，并在接线阶段（WP-09/WP-10）或下一轮加固中处理。

**Test 判定：PASS —— 接受 WP-08 的 AC-020、AC-021、AC-022、AC-029、AC-041、AC-057、AC-058、AC-061、AC-062、AC-063、AC-064、AC-081、AC-082、AC-090、AC-091、AC-093、AC-094；AC-083 记 partial（服务层正例/绑定通过，独立 Review 关闭正例未在本轮构造）；AC-054 记 not_covered（属 WP-09）。**

---

# WP-08 独立 Test 报告（第三轮：冻结 7422646 的完整验收矩阵）

## R3-0. 元数据（round 3）

| 项 | 值 |
|---|---|
| 工作包 | WP-08 集成、结算与恢复 |
| Test 角色 | 独立 Test（独立上下文；未读取任何开发/Review 聊天或会话） |
| 轮次 | 第三轮（round 1 门禁 Abort、round 2 冻结 `7b0fd20`；本轮在 Review 第四轮 PASS 后执行完整矩阵） |
| 冻结提交 | `7422646`（task-issued freeze point） |
| `git rev-parse HEAD` | `7422646e27b13144e429ccb5906919122b65a6b3` |
| `git rev-parse 7422646^{tree}` | `fda94c51771ba5dd572df93c872ca8e6bc3eb221` |
| 报告写入前 `git status --porcelain` | ` M .agentdev/work/WP-08/review.md`、` M .agentdev/work/WP-08/test.md`（Review 第四轮与本报告 round-2 的未提交追加；**代码树与冻结提交一致，无源码改动**） |
| 平台 | macOS arm64（Darwin），Node v24.8.0，pnpm 12.3.4，Git 2.39.3（真实 `git`），真实 SQLite（`node:sqlite`，经 `ProjectStore`） |
| 探针目录 | `/tmp/wp08t3/`（10 个探针脚本 + `lib.mjs` 夹具库；只消费 `packages/*/dist` 构建产物，**从不 import 任何产品测试文件**） |
| 判定 | **PASS**（0 × P0、0 × P1；1 条本轮新 P3 + 2 条 Review 已登记 P3 的独立复核） |
| round 1–2 保留 | 追加前 `.agentdev/work/WP-08/test.md` 为 64870 字节、SHA256 `6e8a780051145188bab19310fc4e2276af26eb4a6f28eb77fb115bc4a885f64a`；追加后 `git diff --numstat` 删除计数为 0（见 R3-8） |
| 一次性工具副作用 | 本轮未使用任何子代理；仓库内唯一写入为本报告追加，全部脚本与日志位于 `/tmp/wp08t3/` |

### 门禁前提（Review 第四轮）

`.agentdev/work/WP-08/review.md` 的 R4-6/R4-9 判定为 **PASS**：`P0=0`、`P1=0`、`P2=0`、`P3=2`（W8R4-01、W8R4-02），并明确「允许进入独立 Test/结算」。门禁满足，故本轮执行完整矩阵（未 Abort）。

### 独立读取的依据

`AGENTS.md`、`docs/INDEX.md`、`docs/rules/{workflow,agents}.md`、`docs/architecture/{execution,reliability,data}.md`、`docs/product/{knowledge,requirements}.md`、`docs/delivery/acceptance.md`（AC-020/021/022/029/041/054/057/058/061/062/063/064/081/082/083/090/091/093/094 全文）、`docs/delivery/implementation.md`（WP-08）、`.agentdev/work/WP-08/{plan,implementation,review}.md`，以及 `7422646` 的受测源码与 `7b0fd20..7422646` 的完整 Diff。
刻意排除：任何开发/Test 聊天或会话、`webui/`、历史任务记录。

---

## R3-1. 契约命令原始结果（`7422646` 工作树根目录，顺序执行）

日志全文 `/tmp/wp08t3/contract.log`；`EXIT_CODE` 为真实退出码。

| # | 命令 | 退出码 | 原始结果（关键行） |
|---|---|---|---|
| 1 | `pnpm typecheck` | 0 | `$ tsc -p tsconfig.json --pretty false`，无输出 |
| 2 | `pnpm lint` | 0 | `$ node scripts/lint.mjs` / `Checking formatting...` / `All matched files use Prettier code style!` |
| 3 | `pnpm test:unit` | 0 | `Test Files  48 passed (48)` / `Tests  975 passed (975)`，Duration 11.56s |
| 4 | `pnpm test:integration` | 0 | `Test Files  20 passed (20)` / `Tests  233 passed (233)`，Duration 99.03s（含真实临时 Git 仓库与容器用例） |
| 5 | `pnpm docs:check` | 0 | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` |
| 6 | `pnpm build` | 0 | `Done` ×10：contracts、cli、pi-runtime、knowledge、domain、storage、workspace、core、daemon、runner |

**与 `implementation.md` T8 声明的对账**：unit 48/975、integration 20/233、docs:check 同数字、build 10 × `Done` —— 逐项吻合。

**五项必需失败测试**（`pnpm vitest run --project unit packages/core/test/wp08-failures.test.ts`，日志 `/tmp/wp08t3/failure-tests.log`，`EXIT_CODE=0`）：

```text
✓ |unit| packages/core/test/wp08-failures.test.ts (6 tests) 4864ms
  ✓ required WP-08 failure tests (6)
    ✓ Task 合并冲突: two passed Tasks conflict, the repair Task is independent and CAS protects HEAD (AC-062) 1244ms
    ✓ T-01: the repair revision converges and is what the final manifest records (AC-062) 1381ms
    ✓ CAS 失败: a moved baseline refuses the writer and leaves the branch untouched 622ms
    ✓ ref 后崩溃: the restart reuses the commit, completes the state and emits one event (AC-063) 510ms
    ✓ 取消未知副作用: cancel stops at blocked(recovery), keeps the Requirement active and integrates nothing (AC-021) 362ms
    ✓ 备份演练: backup → restore keeps hashes/knowledge/evidence and blocks a missing Secret (AC-064) 744ms
Test Files  1 passed (1)
     Tests  6 passed (6)
```

**代表性 AC 切片**（`/tmp/wp08t3/slice.log`，两次调用均 `EXIT_CODE=0`）：

| 文件 | 用例数 | 文件 | 用例数 |
|---|---|---|---|
| `workspace/test/cas.integration.test.ts` | 22 | `core/test/settlement.integration.test.ts` | 11 |
| `core/test/requirement-save.integration.test.ts` | 25 | `core/test/recovery.test.ts`（unit） | 20 |
| `core/test/wp08.integration.test.ts` | 12 | 合计 | `Tests 70 passed` + `Tests 20 passed` |

---

## R3-2. 方法与夹具（`/tmp/wp08t3/`）

10 个脚本全部通过 `packages/*/dist/index.js` 消费**构建产物**；真实临时 Git 仓库（`init`/`worktree add`/`commit`/`update-ref`/`cherry-pick`/`checkout --detach`/`clone --no-local`/真实脏状态）与真实 SQLite（`ProjectStore`、`lease`/`decision`/`stage_result`/`feature_projection` 行）承载全部集成状态。脚本自实现断言与故障注入，**从不 import 产品测试文件**。

| 脚本 | 覆盖 | 结果（`/tmp/wp08t3/*.out`） |
|---|---|---|
| `p01-repair-convergence.mjs` | **必需失败测试 #1**（Task 合并冲突）、T-01 修复回路收敛、T-02 缺失 revision、T-04 候选成对核对、AC-062/081/093/094 | checks=74，failures=0 |
| `p02-cas-lock.mjs` | **必需失败测试 #2**（CAS 失败）、AC-091 共享锁、W8R3-05 owner 前缀、W8R3-06 锁身份、AC-094 | checks=49，failures=0 |
| `p03-crash-after-ref.mjs` | **必需失败测试 #3**（ref 后崩溃）、AC-063 部分结算（含 CAS 前崩溃与无关修订拒绝） | checks=42，failures=0 |
| `p04-pause-cancel-budget.mjs` | **必需失败测试 #4**（取消未知副作用）、AC-020 暂停/恢复、AC-021 取消、AC-022 预算止损 | checks=56，failures=0 |
| `p05-backup-drill.mjs` | **必需失败测试 #5**（备份演练）、AC-064 backup/restore/relocate | checks=61，failures=0 |
| `p06-save-path.mjs` | AC-090/093/094、W8R3-01/02/03、T-03、T-05、AC-028 脏工作区回归 | checks=118，failures=0 |
| `p07-recovery.mjs` | AC-057/058/061/082、W8R3-04 准入决策窗口 | checks=97，failures=0 |
| `p08-init-knowledge.mjs` | AC-029 初始化中断/冲突、AC-041 知识结算与冷启动 | checks=56，failures=0 |
| `p09-findings.mjs` | AC-083 文档/集成 Finding 的绑定、修复与独立 Review 关闭正例 | checks=47，failures=0 |
| `p10-empty-commit.mjs` | 对 p01 观察到的「空包装提交」做定向确认（R3-5 T-01） | checks=8，failures=0 |

合计 **608 项断言，0 项失败**。

反证与故障注入手法：

- **真实 Git 竞态**：包装真实 CAS 端口，在 compare 之后、swap 之前用真实 `git update-ref` 移动交付基线；第三方提交形态亦同。
- **崩溃窗口（零 mock 语义）**：包装 `WorktreeGitPort.updateRef` 在真实 `git update-ref` 前抛异常（得到「journal pending + target、ref 未动」的真实残留），以及先驱动产品自身的 `prepareSettlement` + `cas.integrate` 再模拟「ref 已动、状态未写」。
- **真实文件系统失败**：把写回目标 `content.md` 预建成目录，触发真实 `EISDIR`。
- **真实脏状态**：手工改写 `content.md` 得到 ` M`；`git checkout --force --detach` 得到「干净但停在另一修订」。
- **陈旧工作树**：另一服务器提交并 `update-ref` 而不 checkout（真实「ref 领先工作树」形态）。
- **准入反证**：真实 SQLite + 真实进程探针把 Run park 成 `interrupted`/`recovery_required`，再写 Work 级 / 兄弟 Run / Run 级 / verdict 事件级恢复决策，并在 **200 条后续无关决策**压力下重读 `newAttemptAdmission` 与 `RunLifecycle.beginAttempt`。
- **真实进程探针**：AC-061 用 `createNodeProcessProbe()` 对当前 `process.pid` 取证（活进程 → `park_recovery_required` 且不开新 Attempt）。
- **备份篡改**：改写备份目录内的真实 payload 而不改清单；另把证据 blob 改坏触发 `ARTIFACT_MISSING`。
- **真实仓库克隆**：`git clone --no-local` 后做 relocate 正例；空目录做负例。

---

## R3-3. 逐 AC 结论表

| AC | 题目 | 本轮结论 | 证据要点 |
|---|---|---|---|
| AC-020 | 暂停恢复 | **passed** | `p04`：`pauseWork` 关闭 live Attempt（`attemptsClosed=1`）、写准入冻结、暂停屏障绑 Work 版本；`expectedWorkVersion` 不符 → `VERSION_CONFLICT` 且不开 Attempt；`resumeWork` 恰开 1 个新 Attempt（number=2、`starting`），ready 前不放写、置 `running` 后放写；已交付 ref 未回滚 |
| AC-021 | 取消需求 | **passed** | `p04`：未知副作用 → `blocked` + `recoveryRequired` + `integrated:false`、pending `recovery` 决策、Requirement 保持 active、候选 Artifact 保留、Run/Attempt 停止、提交数不变；`accept_cancel` 才 → Work/Requirement cancelled 且此前交付不动；无未知副作用直接 cancelled；产品必需失败测试 6/6 通过 |
| AC-022 | 预算止损 | **passed** | `p04`：`requestedTokens=150` 超限 → `BUDGET_EXCEEDED`、`tokensReserved` 仍 0、Artifact 数不变；限额内 60 通过并预留 60；第二次超限再拒且不静默加额；此后发生真实交付，拒绝仍成立 |
| AC-029 | 初始化冲突中断 | **passed** | `p08`：第 3 次写入注入异常 → `interrupted` + `recoverable:true`、已写 2 份带 receipt Hash、交付 ref 仍为 null；新进程 `resume` 到 done、4 个入口文档就位、逐字节核对 receipt Hash、二次 resume 幂等；用户自维护 `PROJECT.md` → `content-conflict`、点名路径、字节原样保留、后续文档不写、`resume` 拒绝；未知初始化 `not-found` |
| AC-041 | 知识结算 | **passed** | `p08`：`buildKnowledgePatch` 更新 implementation/verification/正文/入口并附失效说明，`applyKnowledgePatch` 是唯一发布路径；冷启动 `queryFeatureView(view=delivered)` 找到新行为、新入口 `src/cancel.ts`、失效说明与验证证据；索引与 CODE_MAP 同步；非法知识（未知 implementation 状态）→ `KNOWLEDGE_INVALID`、不发布、保留上一有效并标 `stale`、rev-3 零行、rev-2 行标 stale |
| AC-054 | UI 断开 | **not_covered** | 属 WP-09（`implementation.md` WP-08 无 BFF/WS 接线；与 T5/T7/T8 残余一致） |
| AC-057 | Runner 失联/双写者 | **passed** | `p07`：活租约不共享、旧持有者不能释放他人租约；`running`+活进程 → park `recovery_required`、`starting`+活进程 → park `interrupted`，两者均 `requiresRecoveryDecision:true`、`newAttemptAllowed:false`；`beginAttempt` 抛 `RECOVERY_REQUIRED`（Attempt 仍 1 条）；Work 级与兄弟 Run 决策都不放行、**判定之前**的决策不放行、Run 级且晚于判定的决策才放行；**200 条后续无关决策压力下仍放行**并开出 Attempt #2/epoch 1；确认已死直接放行；容器身份不可确认按 fail-closed |
| AC-058 | 过期结果 | **passed** | `p07`：旧 epoch 成功被拒（`STALE_ARTIFACT`、`supersededBy='newer_attempt'`、`currentEpoch=1`），`stage.result_rejected` 事件持久保留 summary 与提交 epoch，Run 状态未改写、零 `stage_result` 行；当前 epoch 正常接受；取消后的迟到结果归因 `cancellation` |
| AC-061 | 启动恢复 | **passed** | `p07`：`recoverAfterRestart` 先建报告后 park；epoch-1 接受、等值与更旧 epoch 均被 `VERSION_CONFLICT` 围栏、epoch-2 接受且已 park 者不重复处理；报告含 sha256、`processAlive:false`、gitHeads；真实探针对活进程（本机 pid）返回 `true` 且心跳仍新，仍 park 为 `recovery_required` 并不开新 Attempt；`parseRunnerPid` 对容器标识返回 null |
| AC-062 | 集成冲突 | **passed** | `p01`：两真实 Task 冲突 → `TASK_MERGE_CONFLICT`、reason=git、点名 `src/orders.ts`、ref 与提交数不变、无提交可达交付 ref；独立修复 Task（依赖双方、`requiresFreshVerification`、`committed:false`、冲突产物 sha256 自洽、重试同 id）；**T-01 收敛**：仅传 `repairIntegrationTask` → `ok:true`、`supersededTaskIds=[task-a,task-c]`、`appliedTaskIds=[repair]`、outcome `integrated`、最终 revision 含解决结果、两条路线 revision 均非最终 revision 的祖先、恰 1 条完成事件；把修复 Task 与两路线**一起**重新集成仍不冲突且解决结果保留；`buildFinalManifest` 记录修复后 revision 且修复前 revision 报 `STALE_ARTIFACT`；必需失败测试通过 |
| AC-063 | 部分结算 | **passed** | `p03`：`prepareSettlement` 先写 operation 行；`cas.integrate` 后模拟崩溃 → ref 已动、零事件、operation 仍 `running`、Work 仍 `running`；`recover` 复用同一提交（`refUpdated:false`、`reusedCommit:true`）、恰一条 `settlement.completed`、Work/Requirement completed、`phase` 清空、`finalManifestId` 记录；重放零新增；CAS 前崩溃 → pending journal 记录 target，重试安装该提交并恰一条事件；无关修订被 `VERSION_CONFLICT` 拒绝且分支停在对方提交；未知 operationId `NOT_FOUND`；必需失败测试通过 |
| AC-064 | 备份恢复 | **passed** | `p05`：备份清单 `complete:true`、记录 revision/tree/knowledge.treeHash/evidence Hash、只存 secret 标识（无值）；restore 到新目录后 treeMatches/knowledgeMatchesTree 均 true、证据 1/1 校验、全部文件与清单一致、活动 Run park `interrupted`（还原库中确认）、旧租约与旧 Grant 撤销；缺 Secret → `blocked` + `executionReady:false` + 点名缺失 ref；篡改 payload → `STALE_ARTIFACT` 且目标目录无产物；`complete:false` → `INVALID_STATE`；缺清单 → `NOT_FOUND`；非空目标无 replace → `INVALID_STATE` 且既有文件不动；证据 blob 损坏 → `ARTIFACT_MISSING` 且不写清单；relocate 对非仓库拒绝且根映射不变、对真实 `clone --no-local` 成功并回报新旧根；必需失败测试通过 |
| AC-081 | Task 依赖输入 | **passed** | `p01`：`orderTasks` 依赖优先；`prepareDependencies` 的 `dependencyRevision` 即祖先 revision、`dependencyManifestRefs` 携带祖先 Manifest、`ancestorTaskIds` 正确；精确输入放行；祖先 revision 改变 → `STALE_ARTIFACT` + `invalidated:true`；祖先 revision 消失 → `STALE_ARTIFACT`；缺 Manifest → `GATE_NOT_READY`；最终集成对已并入交付分支的 Task 记 `skippedTaskIds` 且 `applied` 中仅一次、无新提交、ref 不动（祖先不重复应用） |
| AC-082 | 重启保留窄范围 | **passed** | `p07`：恢复后 `recoveryScope` 从 Run 自己的 DispatchSnapshot 取 narrow scope（`source='dispatch_snapshot'`、readPaths 仅 `src/orders.ts`）、`workScopeIgnored:true` 且仍报告 Work 宽范围；快照内 `edit` 允许、仅 Work 宽范围含的路径被 `NOT_AUTHORIZED` 拒绝、快照外操作（`bash`）被拒；快照缺失 → `STALE_ARTIFACT`；`recoverAfterRestart` 路径后 scope 仍为窄 |
| AC-083 | 组合及文档 Finding | **passed（本轮补齐 R2 的 partial）** | `p09`：`document`/`integration` 目标 Finding 无需 `taskId` 即可提交并绑定 Review Run + Manifest（`targetKind`/`manifestId` 落库、绑定记录冻结为 verification snapshot）；缺 `taskId` 的 `task` 目标被拒；非 Review/Test Run 不能提 Finding；P1 默认 blocking、开放状态自动 `return_to_development` 并使报告方 Artifact 失效；`markAddressed` 要求修复 Run 冻结**新** revision 且推进 Work revision（用旧 revision 修复 → `GATE_NOT_READY`）；只有独立 Review **加**该修复 revision 上的 passed Test 才关闭（自带 Finding 的 Review 不能自验、只有 Review 不关闭、Test 绑错 revision 不关闭）→ `verified` + 冻结 verification snapshot + `finding.verified` 事件；重复验证 `INVALID_STATE` |
| AC-090 | 需求保存时机 | **passed** | `p06`：创建即返回 `branch/ref/commit/previousCommit/tree/createdCommit/refUpdated/unpushed/upstreamRevision`；组合 `recordHash` 由提交字节独立复算吻合、两文件共享 record version、`metadata.contentHash` 等于正文 Hash；投影行与提交 revision 一致、磁盘字节等于提交字节、恰 1 条 `requirement.saved`；已提交后同 operationId 重试 → `projection_repaired`、复用提交、零新增提交与事件；正文改版递增版本且组合 Hash 改变 |
| AC-091 | 保存崩溃与交付竞争 | **passed** | `p02`+`p06`：保存/交付/结算共享 `integration:<projectId>`（真实 `lease` 行；持锁时交付 `BUSY` 且回报 save owner、分支不动、无事件；释放后放行；交付失败也释放）；W8R3-05 owner 前缀 `save:`/`integrate:`/`settle:` 使同 raw id 不再互相重入；W8R3-06 传外来锁 → `INVALID_STATE` 且点名期望资源；W8R3-01 跨记录的 journaled 安装被 `IDEMPOTENCY_CONFLICT` 拒绝且原记录仍可安装；`p01` 的 CAS 前后崩溃矩阵与 `p02` 的基线竞争拒绝 |
| AC-093 | 目录与正文一致性 | **passed** | `p06`：两文件同版本、组合 `recordHash` 由提交字节复算、正文修改递增版本且 Hash 改变；池读取器对半对/缺元数据/Hash 不符**逐条**给冲突（`missing-content`/`missing-metadata`/`hash-mismatch`）且不伪造空正文，保存路径把本记录冲突升级为 `REQUIREMENT_CONFLICT` 点名路径、分支不动；`p01` 的 T-04 证明候选提交必须真含两文件（缺 `content.md` → `VALIDATION_ERROR`，正例通过） |
| AC-094 | 正文保存与并发 | **passed** | `p06`：另一服务器在同 recordVersion 下改正文并移动 ref，本机带旧 `recordVersion/recordHash` 的保存被 `REQUIREMENT_CONFLICT` 拒绝（分支停在对方提交、对方正文保留、本机投影未前移），刷新期望后可在对方提交之上保存 v3；`explicitRepair` 对「ref 领先工作树」给出 `saved` 而非 `RECOVERY_REQUIRED`，磁盘等于提交字节；`p01` T-04 负例证明半对候选不能移动 ref |

计数：**17 个 AC passed、1 个 not_covered（AC-054，属 WP-09）、0 个 failed**。

---

## R3-4. 逐 AC 证据（关键断言原文摘录）

**AC-062 / T-01 收敛（`p01`，74/74）**

```text
  ok   conflict: code
  ok   conflict: ref unchanged
  ok   conflict: commit count unchanged
  ok   repair: requiresFreshVerification
  ok   repair: retried conflict yields the same repair Task id
  ok   convergence: supersededTaskIds
  ok   convergence: appliedTaskIds is only the repair Task
  ok   convergence: neither conflicting route revision is an ancestor of the final revision
  ok   convergence: delivery branch holds exactly 3 commits
  ok   convergence: exactly one completion event
  ok   convergence: re-integrating the repair Task together with the two routes does not reproduce the conflict
  ok   manifest: the pre-repair revision is STALE_ARTIFACT
  ok   ghost task: code is GATE_NOT_READY
  ok   ghost task: no fabricated repair Task
  ok   half pair: VALIDATION_ERROR
  ok   half pair: message names the missing content.md
  ok   full pair (positive control): accepted
  ok   ancestor: already-merged Task is skipped
  ok   ancestor: no new commit is created for it
```

**AC-057 准入（`p07`，97/97，节选）**

```text
  ok   live process: a `running` Run is parked as recovery_required
  ok   live process: a new Attempt is withheld
  ok   live process: admission is refused
  ok   live process: RunLifecycle.beginAttempt refuses
  ok   decision scope: a Work-level resume decision does not lift the Run
  ok   decision scope: a decision written for the sibling Run does not lift this Run
  ok   admission: the Run-bound resume decision lifts the block
  ok   admission: 200 newer unrelated decisions do not re-block the Run
  ok   admission: the released Run opens Attempt #2
  ok   admission: a decision older than the verdict does not lift the block
  ok   confirmed dead: a new Attempt opens
  ok   container identity: a new Attempt is withheld
  ok   restart: reusing the same epoch is fenced
  ok   narrow scope: the snapshot survives the restart path
```

**AC-063（`p03`，42/42，节选）**

```text
  ok   crash: the database still has no completion event (the crash window)
  ok   crash: the operation row is still running (state not written)
  ok   recover: the commit was reused, not recreated
  ok   recover: exactly one completion event is emitted
  ok   recover: the requirement phase is cleared
  ok   recover: replay emits no second event
  ok   pre-crash: the CAS journal records a pending target
  ok   retry: the settlement installs the journaled commit
  ok   unrelated: recover refuses with VERSION_CONFLICT
```

**AC-064（`p05`，61/61，节选）**

```text
  ok   backup: the knowledge tree hash matches the copied documents
  ok   backup: only the secret identifier is stored
  ok   restore: the knowledge tree is clean against the checkout
  ok   restore: the previously active Run is parked
  ok   restore: old leases were revoked
  ok   blocked: the status is blocked
  ok   blocked: executionReady is false
  ok   tamper: the failure is STALE_ARTIFACT
  ok   missing evidence: a corrupted blob refuses the backup
  ok   relocate: a real clone of the same repository is accepted
```

**AC-090/093/094 保存路径（`p06`，118/118，节选）**

```text
  ok   save: the combined recordHash matches the committed bytes
  ok   retry: the status is projection_repaired
  ok   update: the combined hash changed
  ok   stale writer: the refusal is REQUIREMENT_CONFLICT
  ok   stale writer: the other server content is preserved
  ok   stale writer: the local projection did not advance
  ok   T-03: the conflict reason is missing-content
  ok   T-03: saving over a half pair is refused
  ok   W8R3-01: the refusal is IDEMPOTENCY_CONFLICT
  ok   W8R3-01: a healthy retry still installs the journaled commit
  ok   W8R3-02: the operation is repair-only
  ok   W8R3-02: the repair path emits requirement.save_repaired, not requirement.saved
  ok   rewind: the worktree HEAD was reset to the new revision
  ok   T-05: the status is saved, not RECOVERY_REQUIRED
  ok   dirty: the local bytes are preserved verbatim
```

**AC-083 关闭正例（`p09`，47/47，节选）**

```text
  ok   findings: the binding has no taskId
  ok   findings: the stored row keeps the Manifest id
  ok   findings: the reporting Review artifact was invalidated by the return
  ok   closure: addressing with the pre-fix revision is refused
  ok   closure: the Work revision advanced to the fix
  ok   closure: the reporting Review cannot verify its own Finding
  ok   closure: a Review alone does not close a code/document Finding
  ok   closure: a Test bound to another revision cannot close it
  ok   closure: an independent Review plus a passed Test of the fixing revision closes it
  ok   closure: a second verification is INVALID_STATE
```

---

## R3-5. Findings（T-xx，本轮 Test 独立发现）

严重性口径（`docs/rules/workflow.md` §6）：P0 数据/安全或关键不可用；P1 错误行为/需求缺失；P2 局部质量/维护；P3 建议。**本轮无 P0/P1/P2。**

### T-01（P3，本轮新发现）— 每回放一个 Task 就在交付分支落一个**空包装提交**

- **位置**：`packages/workspace/src/cas.ts:1246-1250`（`runIntegration` 回放循环中，`git cherry-pick <rev>` **已经**创建提交之后，再调用 `git.commitPaths(options.worktreePath, 'feat: integrate …', [])`；`packages/workspace/src/worktree.ts:434-438` 对空 `paths` 使用 `git commit --allow-empty`）。
- **复现**：`node /tmp/wp08t3/p10-empty-commit.mjs`（真实临时 Git 仓库 + 真实 CAS）。一次 `runIntegration` 回放 1 个 Task 后，交付分支为 3 个提交：

```text
{"subject":"feat: integrate task-one (155359933453)","tree":"92d82f73…","empty":true}
{"subject":"feat: real task change",               "tree":"92d82f73…","empty":false}
{"subject":"chore: seed",                          "tree":"5836a21a…","empty":false}
```

- **观测 vs 期望**：观测为每个被回放的 Task 产生 **2 个**提交——一个携带真实改动的 cherry-pick 提交，外加一个树完全相同的空提交。期望为每个 Task 只产生 1 个提交（`reliability.md` §4 步骤 2「按Task拓扑顺序应用每Task相对其dependencyRevision的自身提交/Diff」并不要求包装提交），或至少有注释说明该空提交的用途。
- **AC/条款**：AC-062/AC-081 —— **不构成违反**：`applied` 的 `commit` 指向的是包装提交、内容正确、祖先只回放一次、最终 Manifest 与 CAS 均正确，所以本轮逐 AC 结论不受影响。属交付历史质量（no-op 提交随 Task 数线性增长）的 P3 建议。
- **修复方向**：`cherryPick` 成功即代表提交已落，`commitPaths(…, [])` 应改为读取 `headRevision` 而不创建提交；若原意是「cherry-pick 未提交时补提交」，则应使用 `git cherry-pick --no-commit` 或先检测 worktree 是否干净。

### T-02（P3，独立复核 Review W8R4-01，结论一致）

- **复现**：`node /tmp/wp08t3/p01.mjs` 的 ghost 段。T-01 的**正常收敛路径**（只传 `repairIntegrationTask`）下，`supersededTaskIds` 里的 `task-a`/`task-c` 不在 `options.tasks` 中，`integrateTasks` 仍为它们生成 `applied` 条目且 `revision:""`（实测 2 条）。自取代 `supersedes:['task-self']` 被静默接受为 `ok:true, outcome:'noop'` 且**仍发出 1 条完成事件**（实测 `events=1`）。
- **观测 vs 期望**：期望 `supersedes` 的每个 id 都必须属于本次请求且不得自指，违反时以结构化 `VALIDATION_ERROR` 在任何回放前拒绝，且「什么都没集成」时不得写空 revision 的 applied 记录或发完成事件。
- **AC/条款**：AC-062；`reliability.md` §5（完成事件必须对应真实集成）。**不阻断**：`supersedes` 是 T8 新增 API 面，当前唯一生产者 `repairIntegrationTask` 只写合法的 `dependsOn`，生产侧无调用点（T8 残余 1）。
- **建议**：与 T8 残余 1（`createRepairTask`/`integrateTasks` 的生产接线）一并收口时补输入校验，并把 applied 条目限制为请求中确实存在的 id。

### T-03（P3，独立复核 Review W8R4-02，结论一致）

- **复现**：读 `packages/workspace/src/cas.ts:671`（`dependsOn: task.dependsOn.filter((taskId) => activeIds.has(taskId))`）。被取代路线的第三方依赖边被**删除**而非改指取代者；`p01` 中以真实 `runIntegration` 同时传「取代者 + 依赖被取代路线的第三方 Task」时，回放顺序退化为输入顺序。
- **AC/条款**：AC-062；`reliability.md` §4（按依赖顺序重放）。**不阻断**：需调用方同时传入第三方依赖方，当前无生产调用点。
- **建议**：建立 `supersededId → supersedingTaskId` 映射，把命中的 `dependsOn` 条目替换为取代者 id，仅删除既不在 `activeIds`、也不在映射里的条目。

### 观察（不计为 finding）

- **`runIntegration` 的「同 operationId 重放」返回 `IDEMPOTENCY_CONFLICT`**（`p01`）：交付路径每次都重新 cherry-pick 生成新候选提交，与 journal 记录的 target 不同即被候选一致性检查拒绝；ref 不动、零新增事件，属 fail-closed。与 Review R4-8.7 观察一致，非缺陷。
- **CAS 首次成功 swap 也报 `reused:true`**（`p02`）：`complete()` 的 `reused` 语义是「本服务未创建提交」，而候选提交恒在集成 worktree 中预先创建，故 `reused:true` + `refUpdated:true` 是自洽的；已按此语义取证，非缺陷。

---

## R3-6. 计数与阻断表

| 项 | 数量 |
|---|---|
| 独立探针脚本 | 10 |
| 独立探针断言 | 608 |
| 失败断言 | 0 |
| P0 | 0 |
| P1 | 0 |
| P2 | 0 |
| P3 | 1 新增（T-01）+ 2 复核确认（T-02/T-03） |
| 阻断 finding | 0 |
| 五项必需失败测试 | 5/5 有独立探针（`p01`–`p05`）+ 产品套件 6/6 |
| 契约命令 | 6/6 退出码 0 |

| 门禁问题 | 结果 |
|---|---|
| Review 门禁是否满足 | 满足：R4-6/R4-9 判定 PASS、无 P0/P1（round 1 曾因 Review FAIL Abort，本轮不适用） |
| 契约命令是否全绿 | 是（typecheck / lint / unit 975 / integration 233 / docs:check / build 10） |
| 冻结代码树是否与 Review 一致 | 是（HEAD `7422646…`，tree `fda94c51…`，`git status` 仅含报告追加） |
| 是否存在未登记的水平缺口 | 1 条新 P3（T-01），加上 Review 已登记的 W8R4-01/02（本轮独立复核成立） |
| 是否存在阻塞缺陷 | 否（无 P0/P1） |

---

## R3-7. 记录一致性检查（`implementation.md` T8 与代码/实测）

**准确的部分**

- T8 声明的命令数字与本次独立复跑**逐项吻合**：unit 48/975、integration 20/233、build 10 × `Done`、docs:check ok（15/55/94/9/11）。
- T8 声明的逐文件增量与实测吻合：`cas.integration` 22（+5）、`requirement-save.integration` 25（+6）、`recovery.test` 20（+1）、`wp08-failures` 6（5 项必需 + T-01 收敛）、`wp08.integration` 12；unit 975 = 973 + 2、integration 233 = 222 + 11。
- 「无旧期望被更正」属实：`7b0fd20..7422646` 对五个 WP-08 测试文件的 Diff 为 `790 insertions(+), 1 deletion(-)`，唯一删除是把 `createMemoryIntegrationLock('018f…4000')` 的字面量提取为具名常量 `PROJECT_ID`（`cas.integration.test.ts`），不涉及任何断言；`wp08.integration.test.ts` 仅 +3 行（补必填 `projectId`）。
- T8 的修复描述与代码位置一一对应，本轮独立取证：`cas.ts` 的 `planIntegration` 取代式剔除（`652-755`）、`supersededTaskIds` 从不回放（`1159-1170`）、`repairIntegrationTask`（`1438-1456`）；`T-02` 的 `GATE_NOT_READY` 分类（`1135-1147`）；`T-04` 的 `pathAtRevision` 成对核对（`1736-1761`）；`requirement-save.ts` 的池读取器逐条冲突（`615-760`）、`dirtyDeliveryPaths`/`rewindCleanCheckout`（`2472-2600`）、`worktreeRefreshRefusal`（`2599`）；`recovery.ts` 的准入查询下推（`281-315`）；`cas.ts` 的 `integration:<projectId>` 断言（`1026-1040`）与 owner 前缀（`1043`）、`requirement-save.ts:1252-1256`、`settlement.ts:1050-1052`。
- T8 的残余登记与代码状态一致，未见夸大：修复 Task 调用约定无产品接线、缺失 revision 选择 Gate 失败而非修复 Task、锁端口无 `purpose` 维度、T-03 冲突列表的导入/Clone 路径未接线、`apps/cli`/`apps/daemon` 及 Run 级 recovery 决策入口仍未接线（本轮全部结论均为**服务 API 层**行为，与之一致）。

**不准确/未登记的部分**

- 未登记：T-01（空包装提交）。T8 正文未提及每个回放 Task 会额外产生一个 no-op 提交。
- T8 的「逐条把修复临时还原为旧行为 → 对应回归用例失败」属开发侧反证，本轮未复现该手法；本轮以修复后行为的独立阳性证据（608 项断言）替代，不构成失实声明。
- T8 未登记 Review W8R4-01/02（两者由 Review 第四轮登记，见 R3-5 T-02/T-03）。

---

## R3-8. round 1–2 逐字保留校验

- 追加前 `.agentdev/work/WP-08/test.md`：64870 字节，SHA256 `6e8a780051145188bab19310fc4e2276af26eb4a6f28eb77fb115bc4a885f64a`（即 round 2 追加后的内容，含 round 1 第 1–246 行原样）。
- 追加方式为纯尾部追加；追加后 `git diff --numstat -- .agentdev/work/WP-08/test.md` 的**删除计数为 0**。
- 本轮未修改 round 1/2 的任何字节、标题或结论；round 1/2 的「Test 判定」行保持原样，最终判定以本报告的 R3-10 为准。

---

## R3-9. 未覆盖与剩余风险

| 项 | 状态 | 说明 |
|---|---|---|
| AC-054（BFF/浏览器断开继续） | **not_covered** | 属 WP-09；WP-08 无 HTTP/WS 接线，无法在本包取证 |
| AC-064 的接线层（`apps/cli backup/restore/relocate`、daemon 入口） | **未覆盖** | 本轮全部结论为服务 API 层；CLI 命令契约（`reliability.md` §7）未接线（T5/T7/T8 残余） |
| AC-083 的完成门禁端到端（`completeWork` 读到已验证 Finding 后放行） | **未覆盖** | 本轮取证到 Finding 的服务层关闭正例（`verified` + snapshot + 事件）与阻塞路由，未搭出 document 路线的完整 `completeWork` 通过链 |
| 并发为单进程观测 | **未覆盖** | 锁竞争、CAS 竞态与准入判定均在单进程内以真实 SQLite + 真实 Git 状态观测，未做两个 OS 进程的真实竞争压测 |
| 崩溃注入是异常模拟 | **限制** | `update-ref` 前/后抛异常制造与真实 `SIGKILL` 等价的残留状态，未使用真实 `SIGKILL`；栈展开可能比真实崩溃多一步，故崩溃后状态以磁盘/内存端口读数为准 |
| `supersedes` 的生产接线 | **未覆盖** | 该 API 面当前无生产调用点（T8 残余 1），本轮只验证服务 API 层行为；T-02/T-03 的影响面因此受限 |
| `resetHard` 的多分支极限 | **未覆盖** | W8R3-03 只验证「完全干净 + detached/交付分支」；「干净 + 其他分支」被代码显式跳过，未构造真实多分支工作树 |
| 多需求/多 Project 并发保存 | **未覆盖** | `p06` 用单 Project 的「另一服务器」形态构造陈旧写者；未做多 Project 并行压测 |
| 产品套件的 6 项失败测试 | **转述限制** | 本轮独立复跑（`EXIT_CODE=0`、6/6）但在 `p01`–`p05` 中另写了等价探针，未逐行审阅产品测试实现 |
| Docker/容器身份 | **未覆盖** | 容器内 runner 身份、挂载级隔离属 WP-07 承接面，本轮只验证 `parseRunnerPid` 对容器标识返回 null 的 fail-closed 判定 |

---

## R3-10. 结论

冻结代码树 `7422646`（tree `fda94c51…`）上，WP-08 的 18 个关联 AC 中 **17 个通过**、1 个属 WP-09（AC-054，`not_covered`）、**0 个失败**。

- **契约命令 6/6 全绿**（unit 975、integration 233、docs:check、build 10），与 `implementation.md` T8 的声明数字逐项吻合。
- **五项必需失败测试 5/5 各有独立探针**（Task 合并冲突 / CAS 失败 / ref 后崩溃 / 取消未知副作用 / 备份演练），产品套件 6/6 独立复跑亦通过。
- **T8 的 11 条收口在服务 API 层独立成立**：本轮尤其确认了**修复回路收敛（T-01）**——两冲突 Task 经独立修复 Task 的 `supersedes` 收敛为单一最终组合，最终 Manifest 记录修复 revision、修复前 revision 报 `STALE_ARTIFACT`；以及 T-02/T-03/T-04/T-05、W8R3-01/02/03/04/05/06 的正负例配对。
- 本轮新登记 **1 条 P3**（T-01：每回放一个 Task 多落一个空提交，属交付历史质量，不违反任何 AC），并独立复核确认 Review 已登记的 **2 条 P3**（T-02/T-03）。三者均为加固性建议，不改变已验收行为。
- 记录一致性：T8 的命令数字、逐文件增量、修复描述与残余登记与代码/实测一致；唯一未登记者为本轮 T-01。

**Test 判定：PASS —— 接受 WP-08 的 AC-020、AC-021、AC-022、AC-029、AC-041、AC-057、AC-058、AC-061、AC-062、AC-063、AC-064、AC-081、AC-082、AC-083、AC-090、AC-091、AC-093、AC-094；AC-054 记 not_covered（属 WP-09）。建议结算时登记 T-01（空包装提交）与 Review 的 W8R4-01/W8R4-02/T8 残余，随 `createRepairTask`/`runIntegration` 的生产接线一并收口。**
