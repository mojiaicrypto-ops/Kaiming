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
