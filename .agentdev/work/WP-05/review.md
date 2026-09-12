# WP-05 独立 Review 报告（Context 隔离与冷启动）

## 0. 元数据与冻结点

| 项 | 值 |
|---|---|
| 冻结点（task 指定） | `fc4072e`（`fc4072e655666a143159ab20276b8baa1f741e79`） |
| `git rev-parse HEAD` | `fc4072e655666a143159ab20276b8baa1f741e79` |
| `git rev-parse fc4072e^{tree}` | `6e6fb1946821af70debe9bd2e35b795b165756d4` |
| `git status --porcelain`（本报告写入前） | 空（工作树干净） |
| Review 写入范围 | 仅 `.agentdev/work/WP-05/review.md`；探针只在 `/tmp/wp05r/` |
| 开发/Test 聊天 | 未读取（证据全部来自仓库文件、`dist` 产物与本次独立探针） |

审查文件 Hash（`git hash-object` / `sha256`，均为冻结点上未改动内容）：

| 文件 | git blob | sha256 |
|---|---|---|
| `packages/core/src/context/types.ts` | `03fe30a916d5ff42b28ffca09c64dd62e82468d1` | `695db1c855f4218c41294a18ecf90a81d98e15b0f4d1fee6fb5c845bc98e256f` |
| `packages/core/src/context/acl.ts` | `68d5438d1127bfa4100e8735bb4df492d81714fe` | `574ad370f283b2b82a619f7af8c42c9b3f3fc0bbb8fd510200dd2ee1a1a2804b` |
| `packages/core/src/context/requirements.ts` | `f8d6f92d0576092f7b6fa0e0ae8907af56c992e4` | `707b3628b857568ca48a1346699d82431ce2626f1754b4c1c97f9fafce543c9d` |
| `packages/core/src/context/builder.ts` | `866e1f5756dc985858596d6a3dbc49cbc26b1a86` | `339b4e2199be49042135029e59f9fabd2ad6df6dceb2e4fcefda8cfe323e2e3e` |
| `packages/core/src/context/ledger.ts` | `36a60a6c891ab3cb9c2468e7bfc2002b76f0144e` | `5dad9e41994c8e1c515f3c3b926b9baa401e4d15d59ad4d062864800db775a32` |
| `packages/core/src/context/checkpoint.ts` | `90dc2a07bc826aa6c9719fc8a6bf8697cf83329c` | `de8f19c3c46993a572aa8c192fa5080dac00608cdc62872cea736f7760ce4178` |
| `packages/core/src/context/cold-start.ts` | `a85dfcafa28c4487a1f7013ad8cc483bf9e269d5` | `9ae1a64d189794fef79c40521eb8bb7ea55265a325bcea8a4dddd5102a0a99a2` |
| `packages/core/src/context/index.ts` | `eee9d50916d3f992562bdd586bd477b6fc45f18c` | `183830a25443571c4858dc79d7de08c1f7d3beb93b2b72093968a59b3ec3f79e` |
| `packages/core/src/index.ts` | `2f221d9d2c06e9770019023d3e5121327adf68a3` | `9a8e6e8c25a247ebc85ead3d05c7c02187720e6d38beb41736065c39b42f7299` |
| `packages/core/src/snapshots.ts` | `519446e82b043b2db7a14bbba64f78c5d273fa6b` | `d59ed7e223d778aaa30219df8f1a3d77a7c4f199985b1a32b1bf2e505bb9c84b` |
| `packages/core/src/orchestrator.ts` | `828dde5807722b82be6bd0a5cd526172a15f1f7c` | `052c08625dfd06301a231d2288a2a17dc2543c533a8f0c72a135d95aa4bc2e61` |
| `packages/contracts/src/entities/structures.ts` | `4a3c5f038318a25ed98bbfbf6f47df4923c357b6` | `bdd5787d15f90f7de63b5cca849a48bb968ca954e0ff06c9224adbccfa39d098` |
| `packages/contracts/src/entities/run.ts` | `13162cab083d443b5afba40c63140de704f9a4a2` | `8e3a2d3cd814105f4f94664f5c9398e9bcc2105cacd97e81fef961fa103218cb` |
| `packages/storage/src/schema.ts` | `9ec276adf79f264b4c6823fe6d265bac3607206e` | `5b7c1d436a44ea07337ab85bf604fbcafb0ebd561cb72db7d168b88302aa2506` |
| `packages/core/test/context-acl.test.ts` | `8e442cba1e8db62d569db72f8e4bf9c728790228` | `356aa6b9553883f303f486f6f149f0398fc6bd6893fc2c16b5c3135a04f0e93d` |
| `packages/core/test/context-requirements.test.ts` | `bae8eadf52cf8be8ccfe1d739713c110951e7e87` | `56f29e7423ad61e70bc13d448ba01f637d9820be085d8de63479f58d41798ef3` |
| `packages/core/test/context-builder.test.ts` | `206519697985553485c298630cd6f7fc2604318a` | `a98e2167776c1007975b04a67e602adf51dede41c7f24e6f73e59159c1c127fd` |
| `packages/core/test/context-ledger.test.ts` | `41f5f05a7f6d1e80011716853135bcb7d9584b4a` | `fc70bf44f70b010701281a842df2f2f91e8dbeda859eb4b66c1ee5ca1118b92e` |
| `packages/core/test/context-checkpoint.test.ts` | `19462683a06d5b16f02626b3f6c98db3bf643aea` | `30401b5c7757191d089cc2ddc6c7d5a9d7ffd23e841a317e6d0a28ded0ecf25e` |
| `packages/core/test/context-cold-start.test.ts` | `bfc45fb6dd06e2c3022fa2fdf14331c905ddfd6a` | `d1f2c58b4178f48394d11fe4eb48a445652c30149e6a6fa0e5fa49ed7056899c` |
| `.agentdev/work/WP-05/plan.md` | `9fc01bc31f0ede57a8a1d079afcaf31e8c825480` | `9ee3d713dcdb91564fcca56400c59c292b12cc37dff9e1a44b9e0d602f961ec6` |
| `.agentdev/work/WP-05/implementation.md` | `ba0776457f50012578e32d0887a6d4e89fab97d0` | `a5d057468f7b43191ff5629be9a66d077cb57a8853b27e253ab99ea33b3a8448` |

## 1. 结论（verdict）

**FAIL** — 在 WP-05 的包验收面（`packages/core` 的 Context 公共 API + 真实临时目录/SQLite/知识投影）上复现出 3 个 P1：

- **W5R1-01（P1）** `contextSources` 元数据层的 `version/path` 覆盖了 `ContextSelection` 声明的 revision/path，快照冻结的内容与 selection 不一致（半读、错归属），直接违反 AC-030「Snapshot 忠实记录选择」与 AC-093「同一 Revision、revision 绑定」。
- **W5R1-02（P1）** 冷启动 corpus 读取跟随符号链接，可读出项目根之外的文件；`execution.md` §3 明文要求拒绝符号链接逃逸（WP-04 的 workspace 扫描已把 `symlink-escape` 当作命名缺陷类别）。
- **W5R1-03（P1）** 角色 artifact 矩阵 `ROLE_ARTIFACT_CLASSES` 与阶段过滤 `artifactClassesFor` 自相矛盾：`decision/attachment/log/recovery` 等已声明类别对所有专业角色永远不可读，导致 Product 无法从 decision 产物取得 `confirmedSource`、Developer 无法读取所选 attachment（两个都是 `agents.md`/`execution.md` 文档化的输入）。

另有 8 个 P2、2 个 P3（非阻断但已记录，其中多个 P2 是真实 fail-open 缺口）。

**能否进入独立 Test：否。** 需返回 Develop 修复 P1（建议同时处理 P2），修复后重新走独立 Review。

## 2. 契约命令原始结果

| 命令 | 原始结果 | 结论 |
|---|---|---|
| `pnpm typecheck` | `tsc -p tsconfig.json --pretty false` → `EXIT:0` | 通过 |
| `pnpm lint` | `Checking formatting... All matched files use Prettier code style!` → `EXIT:0` | 通过 |
| `pnpm test:unit` | `Test Files 32 passed (32)` / `Tests 597 passed (597)` / Duration 14.52s → `EXIT:0` | 通过（与 implementation.md T6 的 32/597 一致） |
| `pnpm test:integration` | `Test Files 10 passed (10)` / `Tests 124 passed (124)` / Duration 47.96s → `EXIT:0`；含 `apps/cli/test/doctor.integration.test.ts (8 tests) 18244ms`、`apps/cli/test/container.integration.test.ts (9 tests) 47174ms`（只运行一次，Docker 28.4.0 可用，未超时） | 通过（Docker 用例全部真实执行） |
| `pnpm docs:check` | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` → `EXIT:0` | 通过 |
| `pnpm build` | `pnpm -r build`：contracts/domain/knowledge/pi-runtime/storage/workspace/core/cli/daemon/runner 共 10 个 workspace 全部 `Done` → `EXIT:0` | 通过（10 workspace 与 T6 声明一致） |

原始日志：`/tmp/wp05r/review-contracts.log`、`/tmp/wp05r/review-unit.log`、`/tmp/wp05r/review-integration.log`。
环境：macOS，Node v24.8.0，Docker 28.4.0（`docker info` 正常）。未出现环境阻断。

命令尾部原始输出：

```
===== pnpm typecheck =====   EXIT:0
===== pnpm lint =====        All matched files use Prettier code style!   EXIT:0
===== pnpm docs:check =====  docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages   EXIT:0
===== pnpm build =====       packages/core build: Done ... apps/runner build: Done   EXIT:0
pnpm test:unit               Test Files 32 passed (32) / Tests 597 passed (597)   EXIT:0
pnpm test:integration        Test Files 10 passed (10) / Tests 124 passed (124)   EXIT:0
```

## 3. 方法与探针清单

消费 `packages/core/dist`（`pnpm build` 产物）与 `packages/storage/dist`，不 import 任何产品测试文件（已核查：`grep -l "packages/core/test" /tmp/wp05r/*.mjs` 为空）；涉及文件的用例使用真实临时目录（`mkdtempSync`）与真实文件/符号链接。

| 脚本 | 用例数 | 说明 |
|---|---|---|
| `/tmp/wp05r/lib.mjs` | — | 端口/选择构造工具（本次补了一个缺失导出 `isDeniedSourcePath`） |
| `/tmp/wp05r/fixture.mjs` | — | 订单/支付/会话三 Feature 投影 + 20 份无关文档 + 误导聊天文本 |
| `/tmp/wp05r/ac030.mjs` | 55 | AC-030：字段完整性、reason 强制、幂等、源改动不影响已冻结内容、excluded/unknowns |
| `/tmp/wp05r/ac031.mjs` | 23 | AC-031：缺上游 ⇒ MISSING_CONTEXT 精确缺口 + 无快照 |
| `/tmp/wp05r/ac032.mjs` | 53 | AC-032：readScope 内追加（seq/path/revision/hash/reason/size）、越界拒绝、request+grant |
| `/tmp/wp05r/ac033.mjs` | 42 | AC-033：transcript 按 kind/标记/角色拒绝、返回对象无聊天正文、误导 transcript 不影响冷启动 |
| `/tmp/wp05r/ac034.mjs` | 38 | AC-034：跨 Project / 其他 Run Checkpoint-Session 拒绝且无内容 |
| `/tmp/wp05r/ac035.mjs` | 62 | AC-035：Checkpoint 往返、会话轮换保身份、Compaction 不改批准 |
| `/tmp/wp05r/ac036.mjs` | 51 | AC-036：预算耗尽点名缺口、放弃项记录、不全库注入、计费顺序 |
| `/tmp/wp05r/ac079.mjs` | 37 | AC-079：四类 bootstrap 正例 + 缺上游负例 |
| `/tmp/wp05r/ac085.mjs` | 37 | AC-085：封口、旧 seq / 错 hash 拒绝、重复 seal 幂等 |
| `/tmp/wp05r/ac093.mjs` | 39 | AC-093：需求目录两文件同 Revision、Hash 负例、Context 账本 |
| `/tmp/wp05r/falsify.mjs` | 21 契约探针 + 5 对照 = 26 | 对抗探针（覆盖层替换、legacy codeRoot、grant 去 deny、artifact 可达性、符号链接、端口抛异常、checkpoint workId、rotate 原子性、快照目录不可变、transcript 标记、预算上限） |
| `/tmp/wp05r/verify.mjs`（本次新写，独立复现） | 42 断言 + 6 预算观测 = 48 | 见下节逐项 |
| 合计 | **511 个独立断言** | AC 探针 437 + falsify 26 + verify 48 |

`verify.mjs` 复现结果（`VERIFY_BAD=15`，其中 15 条 BAD 全部对应本报告 findings；其余为对照）：AC-030 字段/源改动/幂等 **OK**；AC-031 缺口+无快照 **OK**；覆盖层替换 **BAD**；transcript kind/消息类 **OK** 而路径标记 **BAD**；符号链接 **BAD**；grant 去 deny **BAD**；artifact 可达性 **BAD**；需求表无环/全覆盖 **OK**；预算负/小数/NaN/Infinity 拒绝 **OK**，1e15/MAX_SAFE 接受 **BAD**；20 份无关文档不注入、transcript 不影响答案、四类事实召回 **OK**，0 预算仍交出正文 **BAD**；legacy `codeRoot='.'` **BAD**；ledger 预算/授权/封口 **OK**；checkpoint 往返/隔离/轮换/Compaction **OK**，`workId` 伪造 **BAD**。

## 4. 逐 AC 判定

| AC | 判定 | 依据 |
|---|---|---|
| AC-030 | **FAIL** | 常规路径 55 例通过；但 W5R1-01 复现「snapshot.selection 声明 revision-1 / agents.md，resolvedSources 却是 revision-2 / docs/OTHER.md，且冻结字节是 revision-2」——快照未忠实记录选择。 |
| AC-031 | PASS | `planning` 缺 ProductDefinition/acceptance ⇒ `MISSING_CONTEXT` 且 `inputs=['productDefinition','acceptance']`；builder 未写任何快照（`writes=0`）。 |
| AC-032 | PASS | 追加读取记录 seq/revision/hash/bytes/reason；越界 `CONTEXT_FORBIDDEN`；更广读取在 grant 前被拒、grant 后准入（verify V12.3/12.4）。 |
| AC-033 | PASS（带 P2 缺口 W5R1-05） | transcript 按 kind、message 按角色、文档化路径标记全部拒绝，返回对象无聊天正文，误导 transcript 不改变答案（逐字节相同）；但 `docs/dev-chat.md`/`docs/developer-transcript.md` 未被路径标记捕获，ACL/ledger/corpus 三处均可读。 |
| AC-034 | PASS（带 P3 说明 W5R1-13） | 跨 Project 在任何路径判断前 `CONTEXT_FORBIDDEN` 且无内容；Review/Test 角色读开发 Run 的 Checkpoint ⇒ `CONTEXT_FORBIDDEN` 且无 `checkpoint` 字段；外来 Project/Work 拒绝。load 无读者 Run 身份绑定（P3）。 |
| AC-035 | PASS | 往返携带 §5 全字段；`rotateSession` 保 role/task/stage/sources/approval 只换 session；Compaction 0/±keep 均不改 manifest/approval；`summaryOf` 结构上无 approval。 |
| AC-036 | PASS（带 P2 W5R1-06/W5R1-07） | 超限点名 dropped ref 与 token 缺口、放弃项进 excluded/unknowns、绝不自动展开（20 份无关文档 0 注入）；但 readBudget 无上限（1e15 被接受），冷启动 0 预算仍交出概览/规则正文。 |
| AC-079 | PASS | initialize（空项目/BootstrapObservation）、Product、Planning（仅 ProductDefinition）、L1 Develop（仅 CompactPlan）四正例合法；Planning 缺 ProductDefinition、L2 缺 Plan、Test 缺 Review、Settlement 缺最终验证 ⇒ `MISSING_CONTEXT` 精确点名；需求表无「要求未来产物」的行（verify V8.1）。 |
| AC-085 | PASS | 封口后 append/expansion ⇒ `INVALID_STATE`；旧 seq（0 vs 2）⇒ `STALE_ARTIFACT`；错 hash 同理；正确绑定通过；重复 seal 幂等；空账本 seq 0。 |
| AC-093 | **FAIL** | 需求目录/正文一致性部分 39 例通过；但「同一 Revision 加载、revision 绑定、绝不半读」被 W5R1-01 复现违反。 |

## 5. Findings（按严重性）

### W5R1-01 [P1] 元数据覆盖层可替换选择声明的 revision/path/version，冻结内容与 selection 不一致

- 位置：`packages/core/src/context/builder.ts:397-414`（`bondSource` 用 `contextSources` 的同 key 句柄整体覆盖 `version/path/hash`）、`:577`（按被覆盖的 ref 解析）、`:422-434`（`refFor` 取 `resolved.path/version`）。
- 复现：`node /tmp/wp05r/verify.mjs`（V3.1/V3.2）、`node /tmp/wp05r/falsify.mjs`（W5R1-01/01b/01c）。
- 观察：`selection.sourceRefs` 写 `version=revision-1 / path=docs/rules/agents.md`，`artifactRefs[0].version=1`；结果 `ok:true`，`resolvedSources.revision=revision-2`、`path=docs/OTHER.md`、冻结字节为 `# REVISION TWO BODY` / 版本 2 内容。
- 期望：解析必须绑定选择声明的 revision/path/version，冲突应拒绝（`VALIDATION_ERROR`/`CONTEXT_FORBIDDEN`）；`builder.ts` 自己的文档注释也说覆盖层「只补 ACL 分类所需的元数据」。
- 契约/AC：`context.md` §1（来源必须是 ref：Git path+revision、Artifact id/version；Snapshot 保存 selection 与 resolvedSources）、AC-030、AC-093。
- 修复方向：`bondSource` 只从覆盖层取 `sender/artifactClass/projectId/ownedRunId`，`path/hash/version` 以 `selection` 为准；或与 selection 逐字段比对不一致即拒绝。补一条「selection 与 contextSources 冲突」的负例测试。

### W5R1-02 [P1] 冷启动 corpus 读取跟随符号链接，可读出项目根之外的文件

- 位置：`packages/core/src/context/cold-start.ts:383-389`（`readCorpusFile` → `join(directory, path)` + `readFileSync`，无 realpath 校验），调用点 `:372`。
- 复现：`verify.mjs` V5.1、`falsify.mjs` W5R1-06。
- 观察：`docs/notes.md` 为指向临时目录之外文件的符号链接，`guard.read('docs/notes.md')` 返回 `HOST-SECRET-OUTSIDE-PROJECT`。
- 期望：`execution.md` §3「文件工具拒绝相对路径逃逸、符号链接逃逸、嵌套仓库逃逸；通过 open 时再校验真实路径」；同仓库 `packages/workspace/src/scan.ts:653-664` 已把 `symlink-escape` 作为显式缺陷类别，符号链接「never followed for content」。
- 契约/AC：`execution.md` §3、AC-033 证据（ACL 与隔离负例）。
- 修复方向：`realpathSync` 目标并要求仍在 `realpathSync(directory)` 之内；lstat 为符号链接时按策略拒绝；与 workspace 扫描的符号链接策略对齐，并补真实临时目录负例。

### W5R1-03 [P1] 角色 artifact 矩阵与阶段过滤自相矛盾：已声明类别永久不可读，Product/Developer 的文档化输入无产物来源

- 位置：`packages/core/src/context/acl.ts:66-141`（`ROLE_ARTIFACT_CLASSES` 声明）、`acl.ts:376-384`（`artifactClassesFor` 按 `ARTIFACT_PRODUCER_STAGE` 的 pipeline rank 过滤）、`types.ts:245-258`（`decision/attachment/log/recovery` 的生产阶段是 `assist`，而 `assist` 在 `PIPELINE_ORDER` 中排在最后）、`requirements.ts:665-678`（`ARTIFACT_KIND_INPUT.decision='confirmedSource'`）。
- 复现：`verify.mjs` V7.1/V7.2/V7.3、`falsify.mjs` W5R1-05a/b/c。
- 观察：`product:product` 可达类别只剩 `['explanation','product']`（`decision/attachment/log` 被过滤）；用 decision 产物满足 `confirmedSource` 的 Product 构建 ⇒ `CONTEXT_FORBIDDEN: 阶段 product:product 不读取 decision 产物`；Developer 读取所选 attachment ⇒ `CONTEXT_FORBIDDEN: 阶段 backend:develop-L2 不读取 attachment 产物`。不可达集合中 `decision/recovery/attachment/log`（生产阶段 `assist`）对所有专业角色恒成立——这是缺陷；而 `review:review` 过滤掉 `test` 属 AC-079「不得读未来产物」的预期行为，不计入本 finding。
- 期望：`execution.md` §3 的角色 ACL 与 `agents.md` §2「Product 需要用户确认来源」、§6「附件当作用户数据和调查来源 / Developer 读取所选资料」；包内两张表不应互相矛盾。
- 契约/AC：AC-030/AC-031 的输入补齐语义、`data.md` §3 `ArtifactKind=decision/attachment`、`execution.md` §3。
- 修复方向：把 Chief 会话阶段（`assist/coordinate`）在「生产者排序」上置于 `initialize` 之前（或在 `artifactClassesFor` 对 `decision/attachment/log/recovery` 显式豁免）；并把 `context-acl.test.ts:488` 的单向包含断言改成「ROLE_ARTIFACT_CLASSES[role] 等于该角色各阶段可达类别的并集」。

### W5R1-04 [P2] 扩展授权可丢掉 `deniedPaths`，`.git`/`node_modules` 变为可读

- 位置：`packages/core/src/context/ledger.ts:580-609`（超集校验只覆盖 `pathPrefixes/sourceKinds/artifactClasses/messageClasses`，漏 `deniedPaths`/`denied`）。
- 复现：`verify.mjs` V6.1、`falsify.mjs` W5R1-04。
- 观察：`grantExpansion({granted:true, expandedScope:{...scope, pathPrefixes:[''], deniedPaths: []}})` ⇒ `ok:true`；随后 `append('.git/config')` 与 `append('node_modules/x/index.js')` 均被准入。
- 期望：`acl.ts:313-319` 的 `DENIED_PATH_MARKERS` 是「任何角色永久不可读」；ledger 文档要求授权只能放宽、不能收窄既有约束。
- 契约/AC：AC-032（更广读取须 request+grant，且仍在合法范围）、`execution.md` §3/§4。
- 修复方向：grant 前要求 `deniedPaths`、`denied` 也满足超集（含 reason 相同），否则 `VALIDATION_ERROR`。

### W5R1-05 [P2] Transcript 路径标记漏网：`docs/dev-chat.md`、`docs/developer-transcript.md` 仍可读

- 位置：`packages/core/src/context/types.ts:226-236`（`DENIED_SOURCE_PATTERNS`）。
- 复现：`verify.mjs` V4.2/V4.3/V4.4、`falsify.mjs` W5R1-11。
- 观察：`canRead('review','review', {path:'docs/dev-chat.md'})` 允许；`ledger.append({path:'docs/dev-chat.md', content: 误导聊天})` 追加成功；corpus guard 以 `kind:'document'` 注册后能读出该文件。而 `.agentdev/work/WP-05/transcript.md`、`chat-log.md`、`transcripts/x.md`、`.agentdev/sessions/...` 均正确拒绝。
- 期望：AC-033「输入和工具均不可访问聊天」；`agents.md` §2「引用其他 Agent Transcript…返回 CONTEXT_FORBIDDEN」。
- 契约/AC：AC-033。
- 修复方向：补充 `*-chat.*`、`*-transcript.*`、`dev-chat*`、`chat[-_].*` 等标记；或在 corpus/ledger 侧对「聊天导出」做内容头识别；并把这些名字加入已提交负例（现测试只用 `chat.log`/`transcript.md`/`conversation-notes.md` 等已被覆盖的名字）。
- 备注：kind=transcript 与 message 类别的结构性拒绝仍然有效，此处只是路径网；`context-builder.test.ts:638`「by path marker」用例实际是因 `chat/` 不在 readScope 前缀而被拒，并未验证标记本身。

### W5R1-06 [P2] `readBudget` 无上限：1e15 / MAX_SAFE_INTEGER 被接受

- 位置：`builder.ts:693-705`（只校验非负整数）、`ledger.ts:787-811`、`cold-start.ts:835-848`。
- 复现：`verify.mjs` V9（`huge 1e15 → ok=true limit=1000000000000000`；`max safe → ok=true`；负数/小数/NaN/Infinity 正确拒绝）与 V9.1。
- 期望：`agents.md` §6「启动包默认最多 24000，追加读取最多 16000；限制可在 4096–2000000 内调整，仍受模型实际上限约束」；`implementation.md` T2 声称「非法预算上限 ⇒ VALIDATION_ERROR」。
- 契约/AC：AC-036。
- 修复方向：以 `min(Profile.contextLimit, 模型 contextWindow − maxOutput − 4096)` 为上界拒绝或钳制，并修正 implementation.md 的措辞。

### W5R1-07 [P2] 冷启动预算为 0 时仍把 Project 概览与固定规则正文交给调用方

- 位置：`cold-start.ts:880-947`（`admit` 只记录 excluded，tier1/tier2 忽略其返回值）、`:1156-1182`（seed 恒带 `fixedRules` 与 `projectOverview.markdown`）、`:1197-1200`（`tokenAccounting.initial.used=0`）。
- 复现：`verify.mjs` V10.6。
- 观察：`limits.startupTokens=0` ⇒ `selection=0`、`used=0`，但 `seed.projectOverview.markdown`（26 bytes）与 `seed.fixedRules`（103 bytes）仍返回。
- 期望：AC-036「报告具体缺口，不全库注入」；被预算放弃的内容不得出现在返回包内。
- 修复方向：seed 的概览/规则改为「仅在 admit 成功时携带」，否则以 `BUDGET_EXCEEDED` 点名两个固定文档；tokenAccounting 与实际交付保持一致。

### W5R1-08 [P2] `rotateSession` 失败后状态已改变（非原子）

- 位置：`checkpoint.ts:720-761`（`:746` 先 `runs.set` 新 session，`:747-750` 才发现没有 Checkpoint 而返回 `NOT_FOUND`）。
- 复现：`falsify.mjs` W5R1-09。
- 观察：`rotate.ok=false code=NOT_FOUND`，但 `runOf(runId).sessionRef` 已是 `session-2`。
- 期望：`reliability.md` §1 的单事务原子边界——被拒操作不得留下部分状态。
- 修复方向：先校验 Checkpoint 是否存在再改写 `runs`；失败路径回滚。

### W5R1-09 [P2] Checkpoint 可声称属于另一个 Work（「Checkpoint 仅来自当前 Run」未完全强制）

- 位置：`checkpoint.ts:666-712`（`save` 校验 runId/projectId/role/sessionRef，未校验 `workId`）、`:177`（`CheckpointRun.workId`）。
- 复现：`verify.mjs` V13.7、`falsify.mjs` W5R1-07。
- 观察：Run 注册 `workId=WP-05`，保存 `checkpoint.workId=WP-99` ⇒ `ok:true` 并落库；冷启动 seed 随后会把该 workId 当作当前位置（`cold-start.ts:952-979/1166-1179`）。
- 期望：`context.md` §5「Checkpoint 仅来自当前 Run」；`run.workId` 属于该身份。
- 修复方向：`draft.workId !== run.workId` ⇒ `CONTEXT_FORBIDDEN`；消费侧（冷启动）再次核对。

### W5R1-10 [P2] builder 端口抛异常时不再是「封闭失败」，异常直接外泄

- 位置：`builder.ts:736`（`gates.current`）、`:577`（`resolver.resolve`）、`:598`（`content.fetch`）均无 try/catch；模块文档 §7 与 `implementation.md` T2 声称「返回 `{ok:true,…}` 或封闭失败」。
- 复现：`falsify.mjs` W5R1-02a/b/c（三处均 `threw`）。
- 期望：失败一律收敛为 `{ok:false, code, errors}`，且不留快照（`reliability.md`/`execution.md` 的受控失败）。
- 修复方向：三处端口调用包 try/catch 并映射 `INTERNAL_ERROR`；保持「失败不落快照」。

### W5R1-11 [P2] legacy 项目 `codeRoot='.'` 时读不到任何代码

- 位置：`acl.ts:407-438`（`scopeFor` 把 `project.codeRoot` 原样加入 `pathPrefixes`）与 `types.ts:604-609`/`acl.ts:568-573`（`pathInPrefix` 把 `.` 当字面前缀）。
- 复现：`verify.mjs` V11.1、`falsify.mjs` W5R1-03。
- 观察：`scope.pathPrefixes=['.','.agentdev','.agentdev/work/WP-05','artifacts','docs/agentdev','features']`；`canRead('src/orders/cancel.ts')` ⇒ `CONTEXT_FORBIDDEN 路径不在 readScope 内`。
- 期望：`knowledge.md` §5 旧项目初始化 `code-root=.`（整仓，排除 document-root）；Developer/Review/Test 必须能读授权源码。
- 修复方向：在 `pathInPrefix`/`scopeFor` 把 `.`（及 `./`）规范化为「整仓」；补 legacy ProjectScope 回归用例。注意 `repoPathSchema` 允许 `.`（禁止 `..`/绝对路径），因此该值可达。

### W5R1-12 [P3] 冻结快照目录并非不可变：`manifest.json` 被后一次冻结改写

- 位置：`builder.ts:495-538`（内容文件按 hash 跳过，但 manifest 无条件重写并带新的 `createdAt`）。
- 复现：`verify.mjs` V1.6、`falsify.mjs` W5R1-10。
- 观察：两次同输入冻结落在同一目录，内容文件不变，但 `manifest.json` 字节不同（`createdAt` 变化）。`snapshotRef` 不变（`createdAt` 不参与身份）。
- 期望：`context.md` §1「实际内容复制进不可变快照目录」；`implementation.md` T2「换时钟结果不变」。
- 修复方向：manifest 已存在则跳过；或把 `createdAt` 移出 manifest。

### W5R1-13 [P3] Checkpoint `load` 只按目标 runId 取件，没有读者 Run 身份绑定

- 位置：`checkpoint.ts:187-202`（`LoadCheckpointInput` 无读者身份）、`:629-649`、`:600-626`。
- 复现：`falsify.mjs` W5R1-08（该探针未复现越权读取，只暴露 API 形状）。
- 观察：任何调用方只要报出目标 `runId` 且 Project/Work/role 匹配即可取件；Review/Test 角色、跨 Project、跨 Work 均被拒（见 AC-034 判定）。同 Work 同角色的「兄弟 Run」在 API 层不可区分——但没有复现出内容泄漏，因为调用方必须先自称是该 Run。
- 期望：`context.md` §5「Checkpoint 仅来自当前 Run」；真正强制需 Run capability/epoch（WP-01/WP-07 层）。
- 方向：把 `load`/`save` 的 `runId` 改为由 capability 注入并校验；本轮作为设计残留登记。

## 6. 计数与阻断表

| 严重性 | 数量 | 编号 | 是否阻断 | 说明 |
|---|---|---|---|---|
| P0 | 0 | — | — | — |
| P1 | 3 | W5R1-01, W5R1-02, W5R1-03 | **阻断** | 均在包验收面可复现；W5R1-01 直击 AC-030/AC-093 |
| P2 | 8 | W5R1-04, 05, 06, 07, 08, 09, 10, 11 | 不阻断（规则要求由 Review 说明是否影响验收） | 其中 W5R1-04/05/06/07 是 fail-open 缺口，建议与 P1 同批修复 |
| P3 | 2 | W5R1-12, W5R1-13 | 不阻断 | 记录即可 |
| 合计 | 13 | — | — | — |

验收面结论：P1 存在 ⇒ **FAIL**，不进入独立 Test。

## 7. 记录核对（implementation.md T1–T6）

- T1–T5 的用例数声明**准确**：`context-builder.test.ts` 28、`context-ledger.test.ts` 31、`context-checkpoint.test.ts` 12、`context-cold-start.test.ts` 15（与 `grep -c "^\s*it("` 一致）；ACL 44、requirements 36，合计 166 个 context 用例。
- T6 命令声明**准确**：typecheck/lint 0，unit 32 文件/597 用例，build 10 workspace，docs:check ok；本次复跑完全一致。
- **过度声明 3 处**：(a) T2「非法预算上限 ⇒ VALIDATION_ERROR」——代码只拒绝负数/非整数，1e15 与 MAX_SAFE_INTEGER 被接受（W5R1-06）；(b) T2「相同输入重复冻结幂等（换时钟结果不变）」——身份不变但目录内 `manifest.json` 被改写（W5R1-12）；(c) T4「`saveCheckpoint` 对携带其他 Run 事实的检查点 ⇒ `CONTEXT_FORBIDDEN` 且不落库」——`workId` 未校验，可声称属于其他 Work（W5R1-09）。
- T1 的路径标记声明（`.agentdev/**/chat*`、`transcript*`、`conversation*` 一律拒绝）字面成立，但不足以覆盖 AC-033 的「开发聊天」场景：`docs/dev-chat.md` 之类不入表（W5R1-05）。
- **残余清单不完整**：已登记 8 项残余（NOT_FOUND 归属、message 口径、ledger revision、计费顺序、Checkpoint 持久化、容器负例、接线、冷启动检索）均属实且未发现虚假陈述；但未登记本次复现的覆盖层替换、artifact 类不可达、预算无上限、路径标记漏网、符号链接逃逸、grant 去 deny、rotate 非原子、workId 伪造、seed 预算泄漏。
- **WP-05 四项必需失败测试确实由已提交测试覆盖**：
  1. 跨项目/Transcript 攻击：`context-builder.test.ts:607-707`（transcript、`chat/dev-chat.md`、跨 Project 句柄、外来 Artifact）+ `context-acl.test.ts` AC-033/AC-034 describe；
  2. Snapshot 失效：`context-builder.test.ts:901`（版本前进 ⇒ `STALE_ARTIFACT`）、`:922`（源文件被编辑后已冻结快照不变）、`:1015`（幂等）；
  3. 预算不足：`context-builder.test.ts:840/878`、`context-ledger.test.ts:302-380`、`context-cold-start.test.ts:481`；
  4. 冷启动关联召回：`context-cold-start.test.ts:395`（当前行为/支付约束/测试路径/已知差距）。
  覆盖属实，但 (2) 只验证「身份/内容文件不变」，未覆盖 W5R1-12 的 manifest 改写；(1) 的 path-marker 断言未真正命中标记本身。

## 8. 覆盖限制

1. 本包只验证 **API/身份边界**：AC-033/AC-034 的容器挂载级负例属 WP-07（`implementation.md` 残余 6），本报告不含容器内文件系统隔离证据。
2. `BuildContextInput`/`createReadLedger` 的端口与 scope 由 Core 注入；W5R1-04（grant 去 deny）、W5R1-10（端口抛异常）、W5R1-13（读者绑定）的可达性依赖上层接线（WP-08/09 尚未接线），本次仅在包公共 API 上复现。
3. Checkpoint 为内存 store，未验证 `attempt.checkpoint_ref`/`session_ref` 与 `snapshot(type='checkpoint')` 落库幂等（残余 5）；`save` 可覆盖同一 Run 的旧 Checkpoint，未发现 `verifyCheckpointHash` 之类的绑定校验（AC-035 未要求，未列为 finding）。
4. 冷启动检索为确定性 CJK 二元打分；本报告只验证固定样例的四类事实召回与 20 份无关文档不注入，未做大规模召回率评估。
5. `readBudget` 的有效上限来自 Profile/模型窗口，本包无该输入；W5R1-06 只证明「无上限校验」，未量化真实越权注入规模。
6. 未运行 `pnpm test:e2e`/`test:acceptance`/`test:live`（按契约返回 NOT_IMPLEMENTED，属 WP-09/WP-10）。
7. 未读取任何开发/Test 聊天或会话记录；`/tmp/wp05r/*.mjs` 探针由 dist 类型声明与正式文档编写，未 import 产品测试文件。

---

# WP-05 独立 Review 报告 · 第 2 轮（W5R1 修复验证）

## R2.0 元数据与冻结点

| 项 | 值 |
|---|---|
| 冻结点（task 指定） | `3f02b4b`（`3f02b4b61c61780797a5d3835f0d9b383b1bbb16`） |
| `git rev-parse HEAD` | `15e236880c0810a491d3e33b5e03fa7652b65381`（docs(review) 提交，仅新增第 1 轮报告 262 行） |
| `git rev-parse 3f02b4b^{tree}` | `6479db54d6b3ed0bb0664729f011f12684ec1005` |
| `git rev-parse HEAD^{tree}` | `374d4c088c8dd722509cbc9bdd7e46d587939283` |
| `git diff --stat 3f02b4b HEAD` | `.agentdev/work/WP-05/review.md \| 262 +++`（只有本轮开始前的第 1 轮报告） |
| `git status --porcelain`（本报告写入前） | 空（工作树干净） |
| Review 写入范围 | 仅 `.agentdev/work/WP-05/review.md`；探针只在 `/tmp/wp05r2/` |
| 开发/Test 聊天 | 未读取（证据来自仓库文件、`dist` 产物与本次独立探针） |

被审查文件与冻结点一致（`git hash-object` 与 `git rev-parse 3f02b4b:<path>` 全部相同）：

| 文件 | git blob |
|---|---|
| `packages/core/src/context/types.ts` | `bfd282c7279ee9035076da51f2566bb73b30ff1f` |
| `packages/core/src/context/acl.ts` | `5bc8debac1b0a59d9163e60cb401157b21a25a79` |
| `packages/core/src/context/requirements.ts` | `dd32285d2e28e5048b03947955613632d5f9d79d` |
| `packages/core/src/context/builder.ts` | `7535a5e46cd32ac8c12e2b7cad53b1c72e3a5547` |
| `packages/core/src/context/ledger.ts` | `513b6471f156c3d94290c2e515105d391192b884` |
| `packages/core/src/context/checkpoint.ts` | `ec116ee09cf665548f9922350a66376aaab54cc7` |
| `packages/core/src/context/cold-start.ts` | `b00ed7cd809684c904e5435304617d7d89564b8c` |
| `packages/core/src/context/index.ts` | `eee9d50916d3f992562bdd586bd477b6fc45f18c` |
| `packages/core/test/context-acl.test.ts` | `c63d04222f720d8104be59c2ad6c836c0f348c39` |
| `packages/core/test/context-builder.test.ts` | `79bb479506ba059c54e5c42ca5d8450191e9e63f` |
| `packages/core/test/context-checkpoint.test.ts` | `ff11c3f04158ec4c4d142094b2225d13afeaa7e9` |
| `packages/core/test/context-cold-start.test.ts` | `444559d1577ce0a7b4c5aab2d79e72fa46d012f1` |
| `packages/core/test/context-ledger.test.ts` | `c18e24f821c2c749fac3bc65156c268477c82def` |
| `.agentdev/work/WP-05/implementation.md` | `b2b9b68aa94e95176f1a3e4ef7831dc23187bc73` |

## R2.1 结论（verdict）

**FAIL** —— 第 1 轮的 3 个 P1 与 10 个 P2/P3 全部按 task 枚举的验收面独立复现为已闭（W5R1-01…12 枚举项全过；W5R1-13 已登记转交）。但同一批修复在“可被调用方声明的元数据”上留有 **2 个新的 P1**，都在包验收面可复现：

- **W5R2-01（P1）** `contextSources` 覆盖层仍可**新增** selection 未声明的 `path`（及 `hash`）：`builder.ts:426-427` 用 `source.path ?? overlay?.path`。T7 自己写明覆盖层“只允许补 `sender`/`artifactClass`/`ownedRunId`/`projectId`”，`path`/`hash` 不在其列；结果是一个声明为 `src/a.ts` 的来源被解析/冻结为 `src/b.ts` 的正文（“半读、错归属”原样复现）。
- **W5R2-02（P1）** 覆盖层声明的 `artifactClass` 从不与 Artifact blob 路径（`artifacts/<class>/…`，`data.md` §4）交叉校验：`acl.ts:500` 优先取 `source.artifactClass`，`builder.ts:438` 原样采纳覆盖层类别。于是 Product 阶段可用 `artifactClass:'explanation'` + `path:'artifacts/plan/<id>'` 读到一个 **plan（未来）产物**，绕过 AC-079 的“不得读未来产物”，也破坏 AC-030 的类别归属。

因此：**FAIL，不能进入独立 Test**；需返回 Develop 修复两个 P1（建议同时处理 P2：W5R2-03…08）。

其余 12 个新发现为 6 个 P2 + 6 个 P3，均记录、不阻断。

## R2.2 契约命令原始结果

| 命令 | 原始结果 | 结论 |
|---|---|---|
| `pnpm typecheck` | `tsc -p tsconfig.json --pretty false` → `TYPECHECK_EXIT:0` | 通过 |
| `pnpm lint` | `Checking formatting... All matched files use Prettier code style!` → `LINT_EXIT:0` | 通过 |
| `pnpm test:unit` | `Test Files 32 passed (32)` / `Tests 619 passed (619)` → `UNIT_EXIT:0` | 通过（与 T7 的 32/619 一致） |
| `pnpm test:integration` | `Test Files 10 passed (10)` / `Tests 124 passed (124)` / Duration 47.56s → `INTEGRATION_EXIT:0`；含 `apps/cli/test/doctor.integration.test.ts (8 tests) 16118ms`、`apps/cli/test/container.integration.test.ts (9 tests) 47028ms` | 通过（Docker 用例真实执行，未超时；未使用非 Docker 子集） |
| `pnpm docs:check` | `docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages` → `DOCSCHECK_EXIT:0` | 通过 |
| `pnpm build` | contracts/domain/knowledge/pi-runtime/storage/workspace/core/cli/daemon/runner 共 10 个 workspace 全部 `Done` → `BUILD_EXIT:0` | 通过 |

原始日志：`/tmp/wp05r2/contracts.log`（Docker 可用，无环境阻断）。环境：macOS，Node v24.8.0。

命令尾部原始输出：

```
===== pnpm typecheck =====   TYPECHECK_EXIT:0
===== pnpm lint =====        All matched files use Prettier code style!   LINT_EXIT:0
===== pnpm docs:check =====  docs:check ok — 15 documents, 55 internal links, 94 acceptance cases, 9 requirements, 11 work packages   DOCSCHECK_EXIT:0
===== pnpm build =====       packages/contracts build: Done ... apps/runner build: Done   BUILD_EXIT:0
pnpm test:unit               Test Files 32 passed (32) / Tests 619 passed (619)   UNIT_EXIT:0
pnpm test:integration        Test Files 10 passed (10) / Tests 124 passed (124)   INTEGRATION_EXIT:0
```

## R2.3 方法与探针清单

消费 `packages/core/dist`（`pnpm build` 产物），不 import 任何产品测试文件。第 1 轮 `/tmp/wp05r/*.mjs` 的 500/1000/50 等子 4096 预算已按 W5R1-06 的新口径失效，本轮**重写全部探针**到 `/tmp/wp05r2/`：预算只取 0 或 4096…2000000；涉及文件系统/符号链接/冻结字节的用例使用真实 `mkdtempSync` 目录与 `symlinkSync`。

| 脚本 | 用例数 | 结果 | 说明 |
|---|---|---|---|
| `/tmp/wp05r2/lib.mjs` | — | — | 端口/选择构造工具（第 1 轮基础上补 `LEGACY_PROJECT`、`expansionTokens` 默认 4096） |
| `/tmp/wp05r2/fixture.mjs` | — | — | 订单/支付/会话三 Feature 投影 + 20 份无关文档 + 误导聊天文本 |
| `/tmp/wp05r2/closure.mjs` | 218 | 218 通过 | W5R1-01…12 逐条闭合验证 + W5R1-13 登记核对 |
| `/tmp/wp05r2/ac.mjs` | 90 | 90 通过 | AC-030…036、AC-079、AC-085、AC-093 代表性矩阵 |
| `/tmp/wp05r2/fail4.mjs` | 34 | 34 通过 | 四项必需失败测试（跨项目/Transcript、Snapshot 失效、预算不足、冷启动关联召回） |
| `/tmp/wp05r2/hunt.mjs` | 25 | 13 通过 / 12 失败 | 新缺陷猎捕（内容泄漏、fail-open、预算旁路、账本/Checkpoint 伪造、需求环、T1–T7 声明核对） |
| `/tmp/wp05r2/gitvariant.mjs` | 1 | 复现 | W5R2-01 的 git 变体（声明 id `src/a.ts` → 实际读 `src/b.ts`） |
| 合计 | **368 个独立断言** | 343 通过 / 25 失败 | 失败全部对应 R2 findings |

日志：`/tmp/wp05r2/{closure,ac,fail4,hunt}.log`、`/tmp/wp05r2/contracts.log`、`/tmp/wp05r2/gitvariant.mjs`。

## R2.4 逐条闭合验证（W5R1-01…13）

| 编号 | 判定 | 本轮独立证据（closure.mjs） |
|---|---|---|
| W5R1-01 | **枚举项全闭；同条款仍有新旁路（W5R2-01）** | overlay 的 version/path/hash 冲突各返回 `VALIDATION_ERROR`、resolver 调用 0 次、无快照（01a/01b/01c）；仅补 metadata 的 overlay 成功且 `snapshot.selection` 与输入逐字节相同、resolved 保留声明 path/version、冻结字节为声明 revision（01d）；无 path 的 overlay 不丢声明 path（01d2，旧实现会解析错 blob）；resolver 返回矛盾 version/path 被拒且发生在 fetch 之前（01e/01f）；artifact overlay 改名 version 被拒（01g）。**但** selection 未声明 path/hash 时覆盖层可补入（W5R2-01）。 |
| W5R1-02 | **PASS** | 真实临时目录：根外文件符号链接 `CONTEXT_FORBIDDEN` 且无正文、根外目录符号链接同样被拒、根内普通文件可读、根内符号链接可读、缺失文件 `NOT_FOUND`、`readable()` 同步为 false。 |
| W5R1-03 | **PASS（枚举项）；新旁路 W5R2-02** | Product 用 decision 产物满足 `confirmedSource` 成功且该产物确实进入冻结包；Developer（backend develop-L2）读到所选 attachment；Product 读 plan/review/test 产物均 `CONTEXT_FORBIDDEN`；decision/attachment/log 在 product:product、recovery 在 backend:develop-L1 可读；`ROLE_ARTIFACT_CLASSES` 每个声明类别都可由某个合法阶段并集达到；`referencesFutureArtifact` 全表为空。 |
| W5R1-04 | **PASS** | 去掉 `deniedPaths`、去掉 `denied`、改 `deniedPaths` reason、改 `denied` reason 四种授权均 `VALIDATION_ERROR`，且随后 `.git/config`、`node_modules/x/index.js` 仍 `CONTEXT_FORBIDDEN`，scope 与预算均不变；对照的合法放宽授权成功且 vendor 读取准入。 |
| W5R1-05 | **PASS** | `docs/dev-chat.md`、`docs/developer-transcript.md`、`docs/dev-transcript.json`、`developer-chat-log.md`、`dev-chat/notes.md`、`docs/dev-chat/notes.md` 在 ACL（对整仓根角色）、ledger、corpus guard 三处全部拒绝；`src/developer-chat.ts`、`src/chat.ts` 三处仍可读；冷启动把这些名字按 `transcript` 记入 excluded 且不入选。 |
| W5R1-06 | **PASS** | builder 对 −1、4096.5、4095、2000001、1e15、MAX_SAFE_INTEGER、NaN、Infinity、字符串、缺 readBudget、expansion −5/1e15 全部 `VALIDATION_ERROR` 且无快照；ledger 与 cold-start limits 同口径；三处均接受 4096、2000000 与显式 0（0 在 builder/冷启动落 `BUDGET_EXCEEDED`，非 VALIDATION_ERROR）。 |
| W5R1-07 | **PASS（seed 面）** | `startupTokens:0` ⇒ `BUDGET_EXCEEDED`、无 `package`/`seed`、失败串不含固定规则正文；4096 + 重负载概览同样封闭失败且不含概览正文；对照构建 `initial.used` 恰等于入选条目 tokens 之和、固定规则为首条。**但** answer 面与 Checkpoint resume 面仍有未计费正文（W5R2-06/07）。 |
| W5R1-08 | **PASS** | 无 Checkpoint 时 `rotateSession` ⇒ `NOT_FOUND` 且 `runOf(runId).sessionRef` 仍为旧值；随后同一 Run 可正常落 Checkpoint 并轮换成功。 |
| W5R1-09 | **PASS** | `workId=WP-99` 的 Checkpoint ⇒ `VALIDATION_ERROR`，`load` 仍 `NOT_FOUND`（未落库）；同 Run 的 `WP-05` 随后正常保存。 |
| W5R1-10 | **PASS（枚举的抛异常端口）** | resolver/content/gates/tokenCounter/now/writer 六个端口抛异常均收敛 `INTERNAL_ERROR`、无快照、返回对象不含端口原始 message 与 `snapshot`/`directory`；ledger 抛异常 counter 不追加不计费、抛异常 clock 对 append/request 均封闭且不留状态；cold-start 抛异常 clock 封闭。**但** Checkpoint store 的 clock 仍未包裹（W5R2-08），端口“返回”的 INTERNAL_ERROR 原样透传（W5R2-09）。 |
| W5R1-11 | **PASS** | `codeRoot='.'` scope 无字面 `.`；`src/…`、`packages/…`、`docs/agentdev/…` 可读；`.git/config`、`node_modules`、`dist`、transcript 标记、dev-chat 标记全部仍拒；对 legacy 根的真实构建可读源码。 |
| W5R1-12 | **PASS** | 同输入、不同时钟两次冻结：`snapshotRef` 相同、目录相同、文件清单相同、每个文件 sha256 相同、manifest 保留首次 `createdAt`、`snapshot.createdAt` 各自反映本次构建、无 `.tmp-*` 残留。 |
| W5R1-13 | **登记确认 PASS** | `git show 3f02b4b:.agentdev/work/WP-05/implementation.md` 第 128 行明确“按任务要求不实现，转 WP-01/WP-07”，且 `CheckpointStore.load` 仍无 reader-Run capability 参数——与 task 的转交要求一致。 |

结论：task 枚举的 12 项闭合全部复现为已闭；第 1 轮的 3 个 P1 均已消除。阻挡项来自同批修复未覆盖的两个元数据旁路。

## R2.5 逐 AC 判定（ac.mjs 90/90，另与 closure/hunt 互证）

| AC | 判定 | 依据 |
|---|---|---|
| AC-030 | **FAIL** | 常规路径 90 例通过：字段/理由/冻结字节/幂等/空 goal/缺 reason 拒绝均正确；但 W5R2-01（覆盖层补 path 改变读取目标）、W5R2-02（类别错归属）、W5R2-03（声明 hash 不绑定）使“Snapshot 忠实记录选择”（`acceptance.md:197`）在可复现输入下不成立。 |
| AC-031 | PASS（带 P2 说明） | planning 缺 ProductDefinition/acceptance ⇒ `MISSING_CONTEXT` 精确点名 `['acceptance','productDefinition']` 且无快照；补入 product 产物后成功。W5R2-04：调用方可用 `contextInputs` 自报 artifact 类必需项绕过该负例（P2）。 |
| AC-032 | PASS（带 P2 说明） | 追加记录 seq/path/revision/hash/reason/bytes；越界 `CONTEXT_FORBIDDEN`；缺 reason `VALIDATION_ERROR`；request 有理由、重复 pending `INVALID_STATE`、收窄授权被拒、grant 后准入、`entries()` 冻结不可写、封口后 `INVALID_STATE`。W5R2-05：`extraTokens` 无上限（P2）。 |
| AC-033 | PASS（带 P3 说明） | 8 角色对 transcript 全拒；review/test 连 message 正文也拒；transcript 来源在 resolver 前被拒且结果无聊天正文；guard 拒绝 dev-chat；误导 transcript 前后答案逐字节相同。W5R2-12：路径网仍是命名式（P3）。 |
| AC-034 | PASS | 跨 Project 先于路径/类别拒绝、点名对方 projectId、不调用 resolver、无内容；`.git/config` 跨项目仍先报 Project；无主/他人 Run 的 Checkpoint 拒绝、本 Run 放行；store 对外来 Run/Project/Work/角色一律无 `checkpoint` 字段。 |
| AC-035 | PASS（带 P2/P3 说明） | 往返成功；非当前 session `INVALID_STATE`；轮换保留 work/task/stage/manifest/sources/approval 只换 session；compaction keep=4 丢 8 条且 manifest/approval/pendingDecisions 不变；`summaryOf` 结构无 approval；keep=0 亦然。W5R2-08/11 属端口与时间戳（P2/P3）。 |
| AC-036 | PASS（带 P2 说明） | 必需源超预算 ⇒ `BUDGET_EXCEEDED` 点名 input+缺口且无快照、usage.dropped 有记录；可选源超预算不阻断但进 excluded/unknowns；4095/2000001 拒绝、4096 接受；冷启动 0 预算封闭；20 份无关文档 0 注入。W5R2-05/06/07 为计费旁路（P2）。 |
| AC-079 | **PASS（矩阵）/ FAIL（ACL 可绕过）** | 四正例（initialize / Product / Planning / L1-CompactPlan）全过，四负例精确点名 `productDefinition`/`plan`/`reviewResult`/`verificationResult`，`referencesFutureArtifact` 全表为空、`oneOf` 组非空、键均在目录内；但 W5R2-02 让 product:product 读到 plan 产物，AC-079 的“不得读未来产物”在 ACL 层可被绕过。 |
| AC-085 | PASS | 空账本 seq 0 + genesis hash；seal 返回末 seq 与 hash 且重复 seal 幂等；正确绑定通过；旧 seq/错 hash ⇒ `STALE_ARTIFACT`；非整数 seq / 非法 hash / 超末 seq ⇒ `VALIDATION_ERROR`；封口后 append 与 requestExpansion ⇒ `INVALID_STATE`；`sealedBinding()` 一致。 |
| AC-093 | **FAIL** | 两文件同 Revision 冻结、resolver 版本前进 ⇒ `STALE_ARTIFACT`、篡改内容 ⇒ `STALE_ARTIFACT`、ledger 逐条 revision 记录均通过；但 W5R2-01 的“声明 id 被覆盖层换成另一文件”与 W5R2-03 的“声明 hash 不参与校验”使“两份同 Revision 来源且冲突不得放行”（`acceptance.md:575`）不成立。 |

四项必需失败测试（fail4.mjs 34/34 全过）：
1. 跨项目/Transcript 攻击：跨项目句柄 `CONTEXT_FORBIDDEN`、点名对方 Project、不解析、无 `snapshot`/正文；transcript 来源同样拒绝且 guard 二次拒绝；
2. Snapshot 失效：revision 钉住 hash、文件被就地编辑后重建 ⇒ `STALE_ARTIFACT`，已冻结目录字节不变、重冻结 manifest 逐字节不变；artifact 版本前进 ⇒ `STALE_ARTIFACT` 且无快照；
3. 预算不足：必需源超限 ⇒ `BUDGET_EXCEEDED` 点名 input+缺口且不冻结；ledger 拒绝并不追加/不计费（requiredTokens/remainingTokens 精确）；冷启动 0 预算封闭且无 seed 正文；
4. 冷启动关联召回：召回取消行为、支付约束、`tests/orders/cancel.test.ts`、`src/orders/cancel.ts`、已知差距；20 份无关文档 0 注入；误导聊天前后答案逐字节相同。

## R2.6 Findings

### W5R2-01 [P1] `contextSources` 覆盖层仍可新增 selection 未声明的 `path`/`hash`，冻结内容来自另一个文件

- 位置：`packages/core/src/context/builder.ts:426-427`（`const path = source.path ?? overlay?.path; const hash = source.hash ?? overlay?.hash;`）、`:450-462`（`overlayConflict` 只在**两侧都已给出**时比对 path/hash）、`:472-481`（`refFor` 采用该 path）。
- 复现：`node /tmp/wp05r2/hunt.mjs`（H2）；`node /tmp/wp05r2/gitvariant.mjs`。
- 观察：selection 声明 `{kind:'git', id:'src/a.ts', version:'revision-1'}`（无 path），覆盖层给 `{…, path:'src/b.ts'}` ⇒ `ok:true`，`resolvedSources` 为 `id=src/a.ts, path=src/b.ts`，冻结正文是 `src/b.ts` 的 `BODY-OF-B`；policy 变体同理把 `docs/rules/agents.md` 读成 `docs/OTHER.md`。
- 期望：覆盖层不得引入 `path`/`hash`——T7 自述“覆盖层只允许补 `sender`/`artifactClass`/`ownedRunId`/`projectId`”；`data.md:7` 的 `SourceRef.path?` 一旦缺失，读取目标应为 `id`。
- 契约/AC：`context.md:9`（Snapshot 保存 resolvedSources 的 path/ref/hash）、AC-030（`acceptance.md:197` “Snapshot忠实记录选择”）、AC-093（`acceptance.md:575` “冲突不得放行”）。
- 修复方向：`bondSource` 不再从覆盖层取 `path`/`hash`；若确需支持“覆盖层补路径”，须要求 `overlay.path === (source.path ?? source.id)`（git/policy/role_contract）且 `overlay.hash` 只能与已声明 hash 相同，否则 `VALIDATION_ERROR`；补一条“selection 无 path、覆盖层给另一 path”的负例。

### W5R2-02 [P1] 覆盖层 `artifactClass` 与 Artifact blob 路径矛盾时不拒绝，早期阶段可读未来产物

- 位置：`packages/core/src/context/acl.ts:499-515`（`const artifactClass = source.artifactClass ?? classOf(source)` 优先信任声明类别）、`packages/core/src/context/builder.ts:438`（原样采纳 `overlay.artifactClass`）；`artifactClassFromPath`（`types.ts:715-736`）从未用于一致性校验。
- 复现：`hunt.mjs` H3。
- 观察：Product:product + selection 选中 `artifactRefs=[plan@1]` + 覆盖层 `{kind:'artifact', id:<planId>, version:'1', path:'artifacts/plan/<planId>', artifactClass:'explanation'}` ⇒ `ok:true`，该 plan 产物进入 `resolvedSources`；把 `artifactClass` 老实写成 `'plan'` 的对照则 `CONTEXT_FORBIDDEN`。
- 期望：`data.md:50/84` 的 Artifact 以 `artifacts/<class>/…` 存放，声明类别与路径类别矛盾时必须拒绝（`CONTEXT_FORBIDDEN`/`VALIDATION_ERROR`），而不是由调用方一句话决定类别。
- 契约/AC：AC-079（`acceptance.md:491` 缺未来产物不形成循环 / 不读未来产物）、AC-030（类别归属）、`execution.md:27`（工具隔离）。
- 修复方向：`canRead` 在 `source.path` 可解析出 class 时，要求 `source.artifactClass` 为空或等于 `artifactClassFromPath(path)`；不一致即拒。或在 `bondSource` 拒绝与声明/路径矛盾的 `artifactClass`。补“plan 路径 + explanation 类别”负例。

### W5R2-03 [P2] selection 声明的 `hash` 不参与解析/冻结校验，快照内部自相矛盾

- 位置：`builder.ts:655-668`（只比对 resolver 的 version/path，未比对 hash）；`refFor`（`:479`）把声明 hash 写进 `ref.hash`，而 `resolvedSources[].hash` 用 resolver/内容 hash。
- 复现：`hunt.mjs` H1。
- 观察：selection 声明 `hash=16aec4ef…`（AGENTS_MD），端口在同一 revision 返回改动后的正文 ⇒ `ok:true`；`resolvedSources[0].ref.hash=16aec4ef…` 而 `.hash=1518089a…`，冻结文件是改动后的正文。
- 期望：声明了 hash 就等于钉住内容；内容 hash 不符应 `STALE_ARTIFACT`（`data.md:84` “内容需 Hash 一致…无法通过编辑报告伪造通过”），至少 `ref.hash` 与 `.hash` 不得互相矛盾。
- 契约/AC：AC-030、AC-093、`data.md:84`。
- 修复方向：`gatherSource` 在拿到内容后，若 `source.hash !== undefined && source.hash !== resolved.hash`（或与 `sha256(content)` 不符）即 `STALE_ARTIFACT`；`refFor` 只使用经校验的 hash。

### W5R2-04 [P2] `contextInputs` 可自报 artifact 类必需项，AC-031 负例可被调用方绕过

- 位置：`builder.ts:1048`（`availabilityOf(included, input.contextInputs ?? [])`）、`requirements.ts:586-588/622-632`（断言即视为 available）；`types.ts` 对 `contextInputs` 的注释只举 `bootstrapObservation` 一类初始化输入。
- 复现：`hunt.mjs` H4。
- 观察：planning 阶段不提供任何 ProductDefinition 产物，仅 `contextInputs:['productDefinition','acceptance',…]` ⇒ `ok:true`（`resolvedSources` 只有 agents.md 与 gate 角色契约）。
- 期望：AC-031 “真实缺上游输入 ⇒ MISSING_CONTEXT”；`confirmedSource`/`productDefinition`/`plan`/`reviewResult`/`testEvidence`/`frozenDiff` 等应由产物解析满足，而非调用方一句断言。
- 契约/AC：AC-031（`acceptance.md:203`）、AC-079（`acceptance.md:491` “真正缺上游输入才拒绝”）。
- 修复方向：只允许断言 `INPUT_CATALOG` 中无 `artifactClass` 且无 `pathPrefixes` 的键（初始化/元输入）；对 artifact 类键要求必须来自 resolved source，并在快照中记录断言来源。

### W5R2-05 [P2] `grantExpansion.extraTokens` 无上限，账本可越过 agents.md §6 的 2000000 上限

- 位置：`packages/core/src/context/ledger.ts:639-643`（只校验非负整数）、`:680-681`（`this.expansionLimit += extra`）。
- 复现：`hunt.mjs` H5。
- 观察：初始/扩展各 4096，`extraTokens: 3_000_000` 授权后 `usage().expansion.limit = 3_004_096`，随后一次追加 2_025_000 tokens 成功（远超 2_000_000）。
- 期望：`docs/rules/agents.md:69` “限制可以在配置范围4096–2000000内调整”；放宽只能到上限，不能无限。
- 契约/AC：AC-036（`acceptance.md:233`）、`agents.md:69`。
- 修复方向：`grantExpansion` 用 `readBudgetValueError('extraTokens', …)` 的同口径校验最终 `expansionLimit`（或 `extraTokens ≤ READ_BUDGET_MAX_TOKENS`）；T7 残余 10 已承认该缺口，应改为本轮修复。

### W5R2-06 [P2] 冷启动 answer 会给出被预算排除的 Feature 正文，`tokenAccounting` 少计

- 位置：`packages/core/src/context/cold-start.ts:1414-1466`（answer 由 `options.projection.features` 直接派生，与 tier-5 `role_bodies` 是否入选无关）；对照 `:1179-1213` 已把该正文记入 excluded（kind=budget）。
- 复现：`hunt.mjs` H7。
- 观察：payments 正文 100 000 字符（25 000 tokens）、`startupTokens:4096` ⇒ `role_bodies` 未入选（`paidBodyCharged=false`、excluded 有 budget 项），但 `answer.currentBehaviour` 仍带 100 000 字符，`used=134`。
- 期望：W5R1-07 已定“被预算放弃的内容不得交付”；冷启动 answer 与 seed 应同口径（或显式把未计费正文标为不交付/仅给摘要）。
- 契约/AC：AC-036（`acceptance.md:233` “报告具体缺口…不全库注入”）、`context.md:73`。
- 修复方向：只对已入选（或明确按引用可重建）的 Feature 输出事实；未入选者只在 `unknowns`/`excluded` 点名缺口，必要时提供非正文的结构化索引。

### W5R2-07 [P2] 冷启动 seed 仍交付被预算拒绝的 Checkpoint resume 位置（未计费）

- 位置：`cold-start.ts:1060-1088`（`admit(...)` 的返回值被忽略）、`:1274-1287`（`seed.domain.resume` 无条件构造）。
- 复现：`hunt.mjs` H6。
- 观察：`startupTokens:4096`、规则+概览已占 4091 tokens、Checkpoint 位置未入选（`chargedCurrentWork=false`、excluded 有 budget 项），但 `seed.domain.resume.nextAction` 仍返回 1026 字符。
- 期望：与 W5R1-07 同一原则——“未入选的 seed 内容不交付”；resume 位置同属 seed 正文。
- 契约/AC：AC-036、`context.md:73`（Checkpoint 用于恢复，但恢复位置也应计费或明确降级）。
- 修复方向：`seed.domain.resume` 仅在 `current_work` 入选时携带；否则在 `unknowns` 点名缺口（与固定规则/概览一致），或把 resume 事实计入预算后再交付。

### W5R2-08 [P2] Checkpoint store 注入时钟未包裹，异常带原始 message 逃出公共 API

- 位置：`packages/core/src/context/checkpoint.ts:710`（`save` 的 `clock()`）、`:771`（`rotateSession` 的 `clock()`）。
- 复现：`hunt.mjs` H8。
- 观察：`createCheckpointStore({now:()=>{throw new Error('CHECKPOINT-CLOCK-EXPLODED')}})` 后 `save` 直接抛出，消息即端口原始文本（`{"threw":true,"leaked":true}`）。
- 期望：W5R1-10 的封闭失败口径应覆盖所有注入端口（builder/ledger/cold-start 已包裹，唯独 checkpoint 没有）。
- 契约/AC：`reliability.md:1` 受控失败；AC-035（Checkpoint 往返不应以未捕获异常终止）。
- 修复方向：`save`/`rotateSession` 用 `safeClock` 同类包裹，失败返回 `{ok:false,errors:[{code:'INTERNAL_ERROR'}]}` 且不回传原始 message。

### W5R2-09 [P3] “返回”的 INTERNAL_ERROR 原样透传端口 message

- 位置：`builder.ts:650`（`fatal(code, resolution.message, …)`）、`:700-702`（fetch 返回 INTERNAL_ERROR 时透传）、`:855-857`（gates 返回失败透传）。
- 复现：`hunt.mjs` H9。
- 观察：resolver 返回 `{ok:false, code:'INTERNAL_ERROR', message:'LEAKED-PORT-MESSAGE-abc'}` ⇒ 结果 `errors[0].message` 原样包含该串；fetch 同理。抛异常路径已脱敏。
- 期望：T7 自述“错误信息不回传端口原始 message”；`INTERNAL_ERROR` 属内部错误，应统一脱敏（`NOT_FOUND`/`STALE_ARTIFACT` 的业务 message 可保留）。
- 契约/AC：`reliability.md:1`、AC-033/034 的“拒绝不带内容”精神。
- 修复方向：仅在 `code==='INTERNAL_ERROR'` 时替换为固定文案；业务 code 保留原 message。

### W5R2-10 [P3] inline 解析（`fetch.kind='none'`）内容不与声明 hash 校验

- 位置：`builder.ts:670-671`（`content = resolved.content ?? ''`，不校验 `sha256(content)===resolved.hash`）。
- 复现：`hunt.mjs` H10。
- 观察：resolver 返回 `hash=sha256('DECLARED-BODY')`、`content:'TAMPERED-INLINE-BODY'`、`fetch.kind='none'` ⇒ 内存 writer 下 `ok:true` 且按声明 hash 记地址；换成 `createSnapshotDirectoryWriter` 会在写文件时发现 hash 不符并返回封闭 `INTERNAL_ERROR`（默认路径仍安全）。
- 期望：builder 自身即应校验，而非依赖 writer 兜底。
- 契约/AC：`data.md:84`（写 Hash 路径前内容一致）。
- 修复方向：inline 分支同样 `sha256(content) !== resolved.hash ⇒ STALE_ARTIFACT/INTERNAL_ERROR`。

### W5R2-11 [P3] `rotateSession` 接受未校验的 `at` 时间戳

- 位置：`checkpoint.ts:771`（`updatedAt: input.at ?? clock()`，未过 `isTime`）。
- 复现：`hunt.mjs` H12。
- 观察：`at:'NOT-A-TIME'` ⇒ `ok:true` 且 `checkpoint.updatedAt='NOT-A-TIME'`（违反 `data.md:1` 的 UTC ISO8601 毫秒）。
- 契约/AC：`data.md:1`、AC-035。
- 修复方向：`at` 先 `isTime` 校验，非法即 `VALIDATION_ERROR`。

### W5R2-12 [P3] Transcript 路径网仍是命名式，改名/非前缀文件不在表内

- 位置：`packages/core/src/context/types.ts:226-235`（`DENIED_SOURCE_PATTERNS`）。
- 复现：`hunt.mjs` H15。
- 观察：`docs/dev-chat.md`、`docs/DEVELOPER_TRANSCRIPT.md`、`docs/devchat.md` 被拒，但 `docs/my-dev-chat.md`、`docs/session-transcript.md` 可读。
- 期望/说明：task 枚举的名字已全部覆盖；这是命名式净的天然上限，结构性防线（`kind=transcript` 全角色拒绝、corpus allow-list）仍然有效。
- 契约/AC：AC-033。
- 修复方向：如需更严，可在 corpus/ledger 侧对“聊天导出”做内容头识别，或对 `*-chat*`、`*-transcript*` 做更宽的后缀匹配（注意勿误伤 `src/chat.ts`）。

### W5R2-13 [P3] 冷启动 tier-5 预算缺口重复登记 excluded

- 位置：`cold-start.ts:1202-1213`（`admit` 已 push 一次 budget excluded，此处再 push 一次）。
- 复现：`hunt.mjs` H6 输出 `excludedBudget=7`（含重复项）。
- 期望：每条被放弃来源只登记一次，避免 usage/报告重复计数。
- 修复方向：删除 tier-5 的二次 push。

### W5R2-14 [P3] 重复 `contextSources` 同键条目静默取最后一条

- 位置：`builder.ts:890-892`（`fullSources.set(key, entry)` 覆盖先前条目）。
- 复现：`hunt.mjs` H13（两条同 `kind:id` 的 overlay，sender 不同 ⇒ 取后者且 `ok:true`）。
- 期望：同键重复元数据应 `VALIDATION_ERROR`，避免顺序决定身份。
- 修复方向：`fullSources` 构建时检测重复键（或重复且字段不一致）即拒。

## R2.7 记录核对（implementation.md T1–T7）

- T7 用例数声明**准确**：实测 `context-acl.test.ts` 49、`context-builder.test.ts` 34、`context-checkpoint.test.ts` 14、`context-cold-start.test.ts` 20、`context-ledger.test.ts` 35、`context-requirements.test.ts` 36，合计 188。
- T7 命令声明**准确**：typecheck/lint 0、unit 32 文件/619 用例、build 10 workspace、docs:check ok，本轮复跑完全一致。
- T7 的“只改 `packages/core/src/context/**` 与 `context-*.test.ts`（另加本记录）”与 `git show 3f02b4b --stat` 一致（13 个文件：7 源文件 + 5 测试 + implementation.md）。
- **未兑现/不完整的声明 2 处**：(a) W5R1-01 段“覆盖层只允许补 sender/artifactClass/ownedRunId/projectId”——代码实际还从覆盖层补 `path`/`hash`（W5R2-01）；(b) W5R1-10 段“端口抛异常…不回传原始 message”的封闭口径未覆盖 Checkpoint store 的时钟（W5R2-08），且“返回”型 INTERNAL_ERROR 仍透传（W5R2-09）。
- W5R1-13 转交 WP-01/WP-07 的记录**存在且为唯一处理方式**（T7 第 128 行）。
- 第 1 轮“四项必需失败测试”的已提交测试仍在（`context-builder.test.ts` 的跨项目/Transcript、Snapshot 失效、预算、冷启动召回块），本轮以独立探针再次全过。

## R2.8 计数与阻断表

| 严重性 | 数量 | 编号 | 是否阻断 | 说明 |
|---|---|---|---|---|
| P0 | 0 | — | — | — |
| P1 | 2 | W5R2-01, W5R2-02 | **阻断** | 均在包验收面复现；W5R2-01 让声明 id 指向另一文件，W5R2-02 让早期阶段读到未来 plan 产物 |
| P2 | 6 | W5R2-03…08 | 不阻断（已记录） | 声明 hash 不绑定、断言旁路、extraTokens 无上限、answer/seed 未计费正文、Checkpoint 时钟未包裹 |
| P3 | 6 | W5R2-09…14 | 不阻断 | 透传 message、inline hash、rotateSession 时间戳、命名网、重复 excluded、重复 overlay 键 |
| 合计 | 14 | — | — | 第 1 轮 3×P1 + 8×P2 + 2×P3 已全部关闭 |

## R2.9 能否进入独立 Test

**否。** 冻结点 `3f02b4b` 上第 1 轮全部 findings 已独立验证关闭，但新发现 2 个 P1（W5R2-01/02）仍属 AC-030/AC-079/AC-093 的验收面缺陷，按规则“存在 P0/P1 ⇒ FAIL”。建议返回 Develop 修复 W5R2-01/02（并顺带 W5R2-03…08），修复后重新走独立 Review；Review 通过后再进入独立 Test。

## R2.10 覆盖限制

1. 本包只验证 **API/身份边界**：AC-033/AC-034 的容器挂载级负例属 WP-07；本轮 Docker 集成测试虽通过（doctor/container 全绿），但不含挂载级越权探针。
2. 端口与 scope 由 Core 注入，W5R2-01/02 的可达性依赖上层把 `contextSources` 完整句柄传入（WP-08/09 未接线）；本轮在包公共 API 上复现，未做端到端 HTTP 复现。
3. W5R2-06/07 采用合成投影（重负载正文字段）制造预算排除，未评估真实两轮交付后的正文规模分布。
4. `readBudget` 的最终上界仍来自 Profile/模型窗口（本包无该输入）；W5R2-05 只证明账本侧无上限校验，未量化真实越权注入规模。
5. 冷启动检索为确定性 CJK 二元打分；本轮只验证固定样例的四类事实召回与 20 份无关文档不注入，未做大规模召回率评估。
6. Checkpoint 为内存 store，未验证 `attempt.checkpoint_ref`/`session_ref` 与 `snapshot(type='checkpoint')` 的落库幂等（T7 残余 5）。
7. 未运行 `pnpm test:e2e`/`test:acceptance`/`test:live`（按契约返回 NOT_IMPLEMENTED，属 WP-09/WP-10）。
8. 未读取任何开发/Test 聊天或会话记录；`/tmp/wp05r2/*.mjs` 探针由 `dist` 类型声明与正式文档编写，未 import 产品测试文件。
