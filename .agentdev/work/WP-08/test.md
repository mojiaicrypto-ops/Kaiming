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
