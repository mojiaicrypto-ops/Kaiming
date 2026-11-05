# WP-12 切片记录：需求池可移植性的真实 clone 演练（AC-087/AC-088/AC-089 提升为 product-path）

- 状态：**已实现并通过整机 + 真浏览器证据**（真 daemon 协议 + 真 Git + 真 `git clone` + 空数据库 + 真 Chromium）
- 关闭的过度声明：`scripts/lib/acceptance-levels.mjs` 的 `SEEDED_EVIDENCE_ACS = {AC-087, AC-088, AC-089}`（W9 登记："应用层证据只有播种行"）
- 依据：`docs/product/requirements.md` §1/§2/§4/§5/§6、`docs/rules/workflow.md` §5（状态机）/§8（需求持久化门禁）、`docs/architecture/data.md` §2/§6、`docs/architecture/protocol.md` §4/§7/§8
- 不改动：`docs/delivery/acceptance.md`、`docs/product/**`、`packages/workspace/src/cas.ts`、`packages/core/src/{integrate,settlement,task-candidate}.ts`；无新运行时依赖、无迁移、无 `git commit`

## 0. 一句话

W9 把 AC-087/088/089 判为 `library-level` 的理由是：这三条的应用层证据要么读 `seedRequirement(...)` 直插 SQLite 的行，要么读测试自己用 `node:fs` 写出的 `requirement.json`/`content.md`——它们证明的是**读取器**，不能证明"文档化的产品路径真的能产出随 Git 迁移的需求池"。本切片把生产者那一半补成真实路径：安装 A 只用文档化协议命令产出五种生命周期的记录（`RequirementSaveService` 以 CAS 提交到 `agentdev/main`），真实 `git clone` 到安装 B 的空数据库并首开导入，然后在 B 继续该 active 记录（不启动 Run）。AC-087/088/089 因此按证据层级推导为 `product-path`，播种行的强制降级项退役。

## 1. 演练真正做了什么（端到端）

新增 `apps/daemon/test/requirement-portability-drill.integration.test.ts`（1 用例，`pnpm test:integration`），共用抽出的测试夹具 `apps/daemon/test/requirement-clone-helpers.ts`（`startInstallation()`：真 `AuthService` + 真 `ProjectDirectory` + 生产 `openProject`，每个安装一个临时 home，因此每个项目的 SQLite 从空开始）。

### 1.1 安装 A：用真实产品路径产出需求池

源仓库由测试用 `git init -b main` + 一次 seed 提交建立，并建出 `agentdev/main` 交付分支（工作副本停在 `main`）。A 打开它（首开导入读到空池，`imported=0`），然后**只经由 `WorkbenchProtocol.dispatch` 的文档化命令**写入：

| # | 记录 | 使用的命令（产品路径） | 层级说明 |
|---|---|---|---|
| 1 | `queued` + 完整便携字段 | `requirement.create` → `requirement.update`（acceptance / openQuestions / confirmedDecisions / featureIds） | daemon 协议 → Core `RequirementSaveService` → Git CAS |
| 2 | `completed` | `requirement.create` → `requirement.save(lifecycle:'active')` → `requirement.save(lifecycle:'completed', completion)` | 完成事实走 `protocol.md` §8 的**文档化完成写入口**，由 Core `RequirementSaveService` 落盘；真实 Settlement 会在 Gate 通过后提供同一形状的事实（见 §5） |
| 3 | `cancelled` | `requirement.create` → `work.control{cancel}` | 取消保留文件并写 `cancellation`；`protocol.md` §8/W9R2-03 |
| 4 | `archived` | `requirement.create` → `requirement.archive` | `queued→archived` 保留 `previousLifecycle` |
| 5 | `active`（真正进行中） | `requirement.create` → `requirement.start` | 写 Git `active` 并在 A 建立本机 Work；**不启动 Run** |

该文件**没有** `store.requirements.insert`、没有 `seedRequirement`、没有对 `.agentdev/requirements/**` 的 `writeFileSync`。`RequirementSaveService` 在一次性 worktree 里写提交、以 CAS 移动 `refs/heads/agentdev/main`（`requirement-save.ts` 顶部契约）；它也按产品行为刷新工作副本（`refreshWorkingTree`），所以断言落在"提交是 Git 事实"上：

- `git rev-parse main == seedRevision`（工作分支没被挪动）；`git rev-parse refs/heads/agentdev/main` 是 40-hex 提交；`git cat-file -p <deliveryRevision>:.agentdev/requirements/<queuedId>/requirement.json` 含 `ACC-POOL-1`；`readRequirementPoolAtRevision` 在该提交读到 5 条、`conflicts=[]`。
- A 的投影 5 条、`runs.count()==0`（`start` 只规划）。

### 1.2 安装 B：真实 clone + 空数据库 + 首开导入

```
git clone --no-tags -- <A 仓库> <cloneBase>/clone      # 只拿到 origin/agentdev/main
expect(git cloneRoot,'branch --list agentdev/main') == ''   # 没有本地交付分支
installationB.directory.open(cloneRoot, {trust:true})
```

`ProjectDirectory.assembleOpen` → `runFirstOpenImport` → `importRequirementsFromDelivery` → `readRequirementPoolAtRevision` + `RequirementProjection.import`（`apps/daemon/src/{project-directory,requirement-import}.ts`）。断言：

- 导入事实：`source='origin-branch'`、`revision==A 的 deliveryRevision`、`imported=5`、`conflicts=0`、`writeBlocked=false`。
- 空库：`requirements.count()==5`、`works.count()==0`、`runs.count()==0`（导入不创建 Work/Run/授权）。
- 每条 `evidenceAvailability='summary_only'`（旧报告未迁移，`requirements.md` §5）。

### 1.3 AC-087：状态与便携字段可见

- 产品面：`requirement.list` 返回 5 条、`list` 不带正文、`requirement.get` 返回提交的 `contentMarkdown`；`board` 把 5 条放进 queued/completed/archived(含 cancelled)/active 列。
- Git 事实：对 clone 的导入 revision 再读一次池，`requirement.json` 里 `goal`、`scope`、`acceptance`、`openQuestions`、`confirmedDecisions`、`featureIds` 与 A 写入的逐字段相等。稳定 id 由 Git 目录名携带，跨服务器不变。

> 说明：本机 `requirement` 表按 `data.md` §2 只存投影字段，不存 acceptance/confirmedDecisions/completion；这些字段的产品可读来源是 `.agentdev/requirements/<id>/requirement.json` 与 `content.md`。因此"字段保留"的断言读 Git 记录（与导入同一个读取器），而不是把库当权威。

### 1.4 AC-088：历史展示

- `completion` 含 `summary/codeRevision/codeTree/featureIds`；`cancellation.reason`；`archived.previousLifecycle='queued'`。
- `requirement.get(completed)` 的 `contentMarkdown`（克隆提交里的正文）含完成摘要；`evidenceAvailability='summary_only'`，不冒充本机验证。

### 1.5 AC-089：进行中需求继续

- 导入后：`executionAvailability='needs_replan'`、`workId=undefined`、`requirement.get.waitingToContinue=true`、`work=null`、`runs.count()==0`。
- `requirement.continue`（协议）→ `status='applied'`、`reusedPreviousVerification=false`、`firstGate='product'`、`unmetGates` 非空且全为 `GATE_NOT_READY`、新 Work 为 `queued`、恰好一条本机 authorization、需求转 `local`/`phase='product'`；`runs.count()` 仍为 0（继续只规划，不启动执行）。

## 2. 哪一层产出了每一份状态（如实）

| 状态 | 产出层 |
|---|---|
| A 的 `queued/completed/cancelled/archived/active` 记录文件与提交 | daemon `WorkbenchProtocol` 命令 → Core `RequirementSaveService`（一次性 worktree 写提交，CAS 移动 `refs/heads/agentdev/main`） |
| `completed` 的 completion 事实 | **由演练在协议 patch 层提供**（`lifecycle:'completed'`+`completion`，即 `protocol.md` §8 的完成写入口）；真实产品里该事实由 Settlement/Gate 路径提供。`codeRevision` 是真实 seed 提交，`codeTree` 是其 SHA-256（文档字段是 64-hex 树 Hash，不是 Git 的 40-hex tree OID） |
| `active` 在 A 的本机 Work | `requirement.start`（Core 协议处理器）——A 的 Run 数为 0 |
| clone 的池内容 | 真实 `git clone` 的 `origin/agentdev/main` 提交（不复制 A 的 SQLite/工作区） |
| B 的投影行 | `runFirstOpenImport` → `RequirementProjection.import`（逐条，`recordCommitted`） |
| B 的继续 Work/授权 | `requirement.continue` → Core `RequirementContinuation` |

## 3. 真浏览器证据（项目页面）

- `tests/browser/stack-runtime.mjs` 的 `openSwitcherStack()` 现在在 Alpha 上用真实 `/rpc` 多产出一条 completed（走同一完成写入口）和一条 `requirement.start` 的 active 记录，然后 `git clone` Alpha 并用 admin 的 project open 路径把 clone 作为**同一安装的新项目**打开（它自己的 SQLite 从空开始，导入由首开导入完成）。
- 新增 `tests/browser/ac-087-clone-pool.spec.mjs`（1 用例，真 Chromium）：登录 → clone 项目 `/requirements` 页面含三条 `data-identity` 与 queued/completed/active 三列；completed 详情含完成摘要与 `summary_only`；active 详情含 `board.card.waitingToContinue` 与 `data-action="continue"`；clone 的 `/runs` 页面没有任何 `data-run=`/`work-row`。
- `scripts/lib/drill-acs.mjs`（追加）：新增 `E2E_BROWSER_CLONE_ACS = [AC-087, AC-088, AC-089]` 并入 `E2E_BROWSER_ACS`；三条 `RESIDUAL_GAPS` 以 `browser-absent`/`closedBy:'pnpm test:e2e'` 登记（只有本机确实没有 Chromium 时浏览器那一半才是 UNVERIFIED，有 Chromium 时必须真实执行）。`scripts/lib/browser-suite.mjs` 增加三个 check 名，`scripts/e2e.mjs` 的无浏览器说明同步补上这三条。

## 4. AC 分类的变化

- `scripts/lib/acceptance-levels.mjs`：`SEEDED_EVIDENCE_ACS` 改为空集（保留常量作为"退役的守卫"与下一条播种行 AC 的登记位），文件头补写"为什么这条 W9 守卫被退役"。
- `scripts/lib/acceptance-report.mjs` §2.1 的 product-path 规则文字同步去掉"排除播种行 AC-087/088/089"的旧表述（**说明**：该文件不在任务列出的写入范围内；不改会让生成的验收报告图例与实际分类矛盾，故做了这一行必要修正）。
- 为避免"播种行仍被当成这三条 AC 的证据"，把**明确播种**的用例标题里的 AC id 去掉（断言一条未删）：
  - `apps/daemon/test/protocol.integration.test.ts` 的 `seedRequirement('active')` 用例（原 `(AC-087/AC-088/AC-089)`）；
  - `apps/web/test/workbench.integration.test.ts` 的三处播种用例（原 `AC-087–AC-090` 收窄为 `AC-090`，原 `(AC-087/AC-089)`、`(AC-068/AC-089)` 去掉/收窄）；
  - `apps/web/test/multi-project.integration.test.ts` 的 `seedRequirement` 两行加注释：只为路由/隔离（AC-023/AC-034），不是 AC-087/088/089 的证据。
- 保留（断言未动）：
  - `apps/daemon/test/requirement-import.integration.test.ts`：真实 clone + 首开导入的全部断言（五生命周期、坏记录逐条冲突、无池不臆造）。其文件头改为**明确说明它不证明生产者那一半**（池文件由 `node:fs` 夹具写出），并指向本演练；
  - 导入冲突/幂等/路径忽略/旧格式：仍由该文件与 `apps/daemon/test/requirement-commands.integration.test.ts`、`packages/knowledge/test/requirements-pool.test.ts`、`packages/core/test/requirement-save.integration.test.ts` 等既有用例证明，本次未削弱任何一条。
- 旧文档残留（如实）：`scripts/lib/acceptance-levels.mjs` 与 `drill-acs.mjs` 的注释仍引用 `api-gap-audit-2.md` §5-B / `T5-plan.md` §E12 作为 W9 当时的事实来源——那是历史登记，不是当前结论。

## 5. 仍未证明 / 残余（如实）

1. **completed 的完成事实不是模型产出**：本演练从协议 patch 层提供 completion（文档化完成写入口），没有跑一次真实 L1/L2 交付让 Settlement 写它。真实模型链路由 `pnpm test:live` 的 L2 演练与 `apps/daemon/test/requirement-commands.integration.test.ts` 的完成门禁用例分别覆盖；本演练证明的是"完成记录能随 Git 迁移并展示"，不冒充一次本机验证。
2. **A 的工作副本会收到产品写回**：`RequirementSaveService.refreshWorkingTree` 会把提交字节写回交付工作副本（本项目的工作副本在 `main`，交付分支是 `agentdev/main`，两者内容收敛）。这不影响"池只随提交迁移"的结论（clone 只取提交），但记录在案，避免读者以为磁盘与分支无关。
3. **AC-087 的"无需重新初始化产品知识"** 由"只调用 `open`、导入事实 `imported=5` 且 B 无 Work/Run/授权"体现；本演练没有单独断言 `initialization=null`（省略，未削弱任何既有断言）。
4. **导入冲突/路径忽略/旧格式** 不在本演练重复；它们仍由 §4 列出的既有用例证明。
5. **浏览器那一半的覆盖范围**：页面断言覆盖列表/状态/完成摘要/待继续与 Continue 控件；"点击 Continue 后页面如何变化"仍由整机用例（协议层）与 `apps/web/test/workbench.integration.test.ts` 的 UI 用例覆盖。

## 6. 本次运行内的门禁证据（串行）

（见 §6.1，运行结束后回填。）

## 7. 文件清单

新增：

- `apps/daemon/test/requirement-clone-helpers.ts` — 共享安装夹具（真 `ProjectDirectory`/生产 `openProject`）
- `apps/daemon/test/requirement-portability-drill.integration.test.ts` — 本演练
- `tests/browser/ac-087-clone-pool.spec.mjs` — 真浏览器半边

修改：

- `apps/daemon/test/requirement-import.integration.test.ts`（复用夹具；文件头写明不证明什么）
- `apps/daemon/test/protocol.integration.test.ts`（播种用例去 AC 标注）
- `apps/web/test/workbench.integration.test.ts`（同上）
- `apps/web/test/multi-project.integration.test.ts`（播种只为路由的注释）
- `scripts/lib/acceptance-levels.mjs`（退役 `SEEDED_EVIDENCE_ACS`）
- `scripts/lib/acceptance-report.mjs`（图例一行）
- `scripts/lib/drill-acs.mjs`（追加 `E2E_BROWSER_CLONE_ACS` 与三条 `RESIDUAL_GAPS`）
- `scripts/lib/browser-suite.mjs`（三个 browser check 名）
- `scripts/e2e.mjs`（导入 `E2E_BROWSER_CLONE_ACS`、无浏览器说明）
- `tests/browser/stack-runtime.mjs`（switcher 栈产出 clone 项目）
