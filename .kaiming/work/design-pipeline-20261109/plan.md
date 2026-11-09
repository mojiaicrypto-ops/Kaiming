# 设计流水线与项目看板 — 整体开发计划

状态：**Awaiting Plan Confirmation**
日期：2026-11-09
依据：`docs/productnew/`（BL-04、BL-07～BL-09、D-01、D-04、D-09）、`docs/technicalnew/`（G2 task、G3、S6/S7、U6）以及本轮对代码的复核。

## 1. 目标

用户在项目页能直接看到一条可追溯的交付链，而不是“所有 Task 都在进行中”：

```text
想法 → 设计中 → 用户确认切片 → 就绪 → 实施中 → 完成
```

同时满足：

- **设计是显式工作**：有独立完成链、独立 Review、切片确认和结算，不把设计混进实施阶段。
- **实施仍是主路径**：Plan → 开发 → 独立 Review → 独立 Test（按验证档）→ 结算。
- **设计产出的切片可追溯**：切片指向产生它的设计 Task；原待办关闭为“已拆分”；未完成设计产出的切片不能被实施。
- **程序只做事实门禁**：阶段合法性、产物存在、待办状态、Review 绑定、返工计数由程序核对；设计好坏、切片质量、验收含义由 Agent/用户判断。
- **旧任务不被打断**：新流程只约束新 Task；迁移后的旧 Task 保持原行为。

## 2. 代码复核结论

### 2.1 已有能力

- `TaskPhase`、`TaskStatus`、`task_sessions`、`results` 已能表达设计阶段、设计报告、Review、Test、结算。
- `design` 已是合法阶段；`designer` 角色已挂载 `backlog add/edit`；`agent_report` 有 `design` 报告种类。
- `requiresTest=false` 的写 Task 已能只要求 Review + 结算，不强制 Test。
- `backlogIds` 已在 `createTask` 事务内领取；`scopeCheck`、独立 Review/Test、结算报告、Git 完成核对已存在。
- 项目页已有待办文件读取、问题提示、待确认问题、模块和早期文件。

### 2.2 关键缺口

| 缺口 | 证据 | 影响 |
|---|---|---|
| 没有 `workKind` | `TaskRow` 只有 `type`/`requiresTest`；`createTask` 固定 `phase='plan'` | 设计与实施共用一套阶段提示，项目页无法稳定分列 |
| 阶段不校验 | `updateTask` 接受任意 `TaskPhase`；`ROLE_PHASE` 只限制角色 | 设计 Task 可进 `develop/test`；实施 Task 的阶段链可任意跳 |
| 没有返工计数 | 阶段可回退，但没有记录 | 看板无法显示返工，预算只能靠人记 |
| 设计 Review 没有绑定设计产物 | `deliverable.ts` 的 `SKIP_DIRS` 含 `.dev`；Review 的 `deliveryState.paths` 对设计任务为空 | Review 后改写规格不会被发现 |
| 设计结算不核对切片 | `taskCompletionGaps` 只核对 Review/Test/结算报告；不读待办文件 | 设计可以“报告说完成”，但原待办没关、切片没引用规格 |
| 切片没有产生者 | `backlog.add` 不写 `Task`；`backlogItemView` 只按 `task.backlogIds` 找 Task | 切片无法回指设计；项目页无法展示“已拆分”链 |
| 切片可提前实施 | 创建实施 Task 只检查待办 open，不检查产生它的设计是否结束 | 用户还没确认切片，实施已经能开工 |
| 项目页没有设计列 | `ProjectPage` 只有“进行中 + 待办 + 模块” | 设计阶段不可见，正是本轮问题的表面 |
| Task 列表顺序不利于看板 | `store.listTasks` 按 `createdAt` 升序；`task.list` 直接切页 | 长项目第一页可能是最旧 Task，最近/未结束 Task 可能不出现 |
| 计划尾部缺少 kind 语义 | `plannedTail` 只有 Review/Test/Settle；从 `plan` 开始不会显示 `develop` | Task 条/项目卡片阶段链与实际流程不一致 |
| 缺少代码级验收 | 现有测试覆盖设计阶段和设计角色，但没有 workKind、看板列、设计门禁、设计产物绑定 | 新行为没有回归保护 |

### 2.3 与 J-10 的关系

`docs/productnew/journeys.md` 的 J-10 要求：实施中发现依据不足时，**在原 Task 内**委派设计 Session 补齐规格或接口，修订 Plan 后继续。因此：

- `implement` 的阶段图必须允许 `design` 作为“补充设计”阶段；
- 主设计（用户明确说“先设计”）才是 `workKind=design` 的独立 Task；
- 不能把所有出现 `design` 阶段的 Task 都当作设计 Task。

## 3. 设计决定

### 3.1 workKind

`type` 仍只有 `read`/`write`，这是用户可理解的 Task 类型；`workKind` 是**完成链选择**，不是新增用户任务类型。

| workKind | type | 初始 phase | 允许阶段 | requiresTest | 用途 |
|---|---|---|---|---|---|
| `design` | write | `design` | clarify/analyze/design/review/settle | 必须 false | 用户明确委托的主设计 |
| `implement` | write | `plan` | plan/design/develop/review/test/settle | 必须显式 boolean | 代码或行为实施；`design` 只用于 J-10 补充设计 |
| `document` | write | `plan` | plan/design/review/settle | 必须 false | 正式文档维护 |
| `investigate` | read | `plan` | clarify/analyze/design/plan/settle | 必须 false | 只读调查/恢复核实 |

- `implement` 的 `test` 只在 `requiresTest=true` 时合法；`visual` 可 `requiresTest=false`，但仍要 Review。
- `design`/`document`/`investigate` 不得声明 `requiresTest=true`。
- `workKind` 创建后不可改，和 `type` 一样。
- 新 Task 使用 `flowVersion=1`；迁移后的旧 Task 使用 `flowVersion=0`，阶段图不强制，避免在途工作被新规则卡住。

### 3.2 阶段图与返工

- 允许集合内的阶段可以移动；不在集合内的阶段由程序拒绝（`INVALID_ARGUMENT`，返回当前 kind、允许阶段和下一步）。
- 目标阶段在允许序列中位于当前阶段之前时，`reworkCount + 1`；前进不计数。
- `reworkCount` 只记录事实，不在首版自动硬停；`task.get`/看板显示，提示词在超过约定轮次时要求用户决定。
- 旧 Task（`flowVersion=0`）不校验、不计数。

### 3.3 设计门禁

- 不新增审批对象、不新增 `waiting_approval` 状态。主设计 Task 在 Review 通过后，由主管用现有 `question` 向用户确认切片清单。
- 问题未回答时 `question` 工具不返回，主管无法在同一输入里继续调用 `task.end`；若另起输入，项目页仍显示 pending question，提示词/Review 要求先取得答复。程序不新增审批对象，因此这是流程门禁，不是新的硬状态。
- 用户选择“修改”时，主管把阶段退回 `design`，`reworkCount+1`；选择“确认”才进入 `settle`。
- 设计结算后，程序核对：
  - `task.backlogIds` 指向的原待办已 `done`；
  - 由该设计 Task 产生的切片（`Task` 字段指向它）保持 open，且每条都有 `规格` 引用；
  - 设计 Review 覆盖的设计产物没有在 Review 后改变。
- 用户确认的**内容**由 Review/主管判断，程序不解析自然语言。

### 3.4 切片的产生者

复用现有待办格式的 `Task` 多值字段，不新增格式键：

- `backlog.add` 由 designer/settler 调用时，宿主自动把当前 Task id 写入 `Task`；
- 主设计产生的切片因此指向设计 Task；
- `backlog.close` 已会把交付 Task 追加到 `Task`，实施完成后切片同时保留“设计 Task + 实施 Task”；
- 原待办的关闭说明仍写“拆分为 B-x/B-y”，但结构化关系以 `Task` 字段为准，不解析说明文本。

### 3.5 设计产物的 Review 绑定

新增 `snapshotDesignDelivery(cwd)`，覆盖：

- `.dev/product/**`
- `.dev/technical/**`

项目知识入口（`AGENTS.md`、`.dev/INDEX.md`、`.dev/PROJECT.md`）由结算保存，不进入 Review 绑定，避免结算写导航导致重新审阅。另排除 `.dev/backlog.md`、`.dev/work/**`、`.dev/requirements/**`、`.dev/issues.md`。设计 Review 记录这份快照；`task.end` 重新计算并比较完整 digest，因此 Review 后新增/修改/删除规格都会要求重新 Review，而结算关闭待办不会误伤。

### 3.6 非目标

- 不引入 Requirement 实体、SOP 图编辑器、子 SOP、Docker 沙箱或多租户。
- 不做拖拽看板；状态仍是派生显示。
- 不改变 `backlog.md` 的格式和状态集合。
- 不改变“一个主管 Session 同时只推进一个未结束 Task”。
- 不强制并行实施；默认仍按顺序。
- 不把“设计完成”写成“已实现”；规格实现状态仍由实施结算更新。

## 4. 工作包

### WP-1 文档与验收（先做）

**改动**

- `docs/productnew/modules/backlog-and-specs.md`
  - BL-04：项目页从“进行中 + 待办”改为“流程带 + 想法/设计中/就绪/实施中/已完成 + 直接工作”；设计卡显示阶段链、切片、等待确认、返工；完成卡显示拆分去向。
  - BL-07：实施 Task、设计 Task 的进入条件；切片未确认不得开工。
  - BL-08：切片确认门与“原待办关闭为已拆分”的结构化关系。
- `docs/productnew/modules/delivery.md`
  - D-01：说明 `workKind` 是完成链选择，不改变 read/write 两类用户任务。
  - D-04：设计/文档/实施/调查的完成过程表与 `requiresTest` 规则。
  - D-09：设计结算必须记录切片与原待办关系；设计 Review 覆盖设计产物。
- `docs/productnew/acceptance.md`
  - 改写 AC-55 为四列看板 + 直接工作 + 等你决定。
  - 新增 AC-59：设计 Task 可见、切片确认前不可实施、原待办关闭为已拆分、切片引用规格。
  - 新增 AC-60：阶段合法性（设计不进 develop/test；实施 test 只在 requiresTest=true；J-10 补充设计合法）与返工计数。
  - 新增 AC-61：设计 Review 后修改规格必须重新 Review；关闭待办不算设计内容变化。
- `docs/productnew/journeys.md`
  - J-09：设计 Task 在项目页“设计中”的可见结果；切片确认门。
  - J-10：明确补充设计仍在原实施 Task 内，阶段为 `design`，不创建第二个竞争 Task。
- `docs/technicalnew/agents-and-tools.md`
  - G2 task create/update/dispatch/end 的 `workKind`、初始阶段、阶段集合、设计完成核对、切片产生者。
  - question 仍不新增业务确认类型。
- `docs/technicalnew/storage-and-recovery.md`
  - v17→v18 迁移与字段说明；新 Task `flowVersion=1`，旧 Task 0。
- `docs/technicalnew/backlog-format.md`
  - `Task` 字段语义扩展为“产生或交付该条目的 Task”；设计切片保留设计 Task，实施完成再追加实施 Task。
- `docs/technicalnew/ui-design.md`
  - U6 项目页新结构、四列、卡片、直接工作、抽屉链路、数据来源。
- `docs/technicalnew/architecture.md`
  - Task 完成链字段与项目页投影的关系（只补必要段落，不重写）。
- 提示词：`docs/technicalnew/prompts/{base,chief,designer,developer,reviewer,tester,settler,specialists}.md`
  - 主管：创建 Task 时选 `workKind`；主设计 → Review → 用户确认 → 结算；J-10 补充设计。
  - designer：主设计产出、切片通过 `backlog.add`、等待用户确认、不改实现状态。
  - developer：实施中发现依据不足时停下，交给主管在原 Task 安排补充设计。
  - reviewer/tester/settler：按 kind 判断是否需要 Test；设计结算核对切片与原待办。
- `docs/INDEX.md` 当前状态在结算阶段更新，不在本 WP 提前宣称完成。

**验证**

- `npm run check:prompts`：链接、英文、边界。
- 文档链接与 `grep` 检查：不残留旧“只分进行中”表述；AC 编号引用有效。

### WP-2 数据与 Task 契约

**改动**

- `kaiming/src/store/store.ts`
  - 新增 `WorkKind`、`WORK_KINDS`、`phasesFor(workKind, requiresTest)`、`phaseIndex`。
  - `TaskRow`/`CreateTaskParams`/`UpdateTaskParams` 增加 `workKind`、`flowVersion`、`reworkCount`；`CreateTaskParams` 增加 `initialPhase`。
  - `tasks` DDL 增加 `workKind TEXT NOT NULL DEFAULT 'implement'`、`flowVersion INTEGER NOT NULL DEFAULT 0`、`reworkCount INTEGER NOT NULL DEFAULT 0`。
  - `SCHEMA_VERSION=18`；`migrateV17ToV18()`：加列、按 `type` 回填（read→investigate，write→implement）、旧行 `flowVersion=0`。
  - `createTask`：使用 `initialPhase`；写入 `workKind`/`flowVersion`；默认值兼容直接 store 调用（`workKind` 按 type，`flowVersion=0`）。
  - `updateTask`：`flowVersion>=1` 时校验目标阶段在 `phasesFor` 内；向后移动递增 `reworkCount`。`workKind`/`type` 不可改。
  - `toTaskRow` 解析新字段。
  - 不改 `listTasks` 的既有升序（供内部稳定使用）。
- `kaiming/src/tools/task-tools.ts`
  - create 参数 `workKind`：write 必填；read 省略默认 `investigate`；type 与 kind 一致性校验。
  - `requiresTest`：implement 必填 boolean；design/document/investigate 必须 false 或省略。
  - create 按 kind 设置 `initialPhase` 与响应。
  - update 的非法阶段错误返回当前 kind、允许阶段、下一步。
  - `taskSummaryJson` 增加 `workKind`、`flowVersion`、`reworkCount`。
  - `end` 前调用设计完成核对（WP-3）。
- `kaiming/src/server/read-methods.ts`
  - `taskSummary` 增加 `workKind`、`flowVersion`、`reworkCount`。
  - `task.list` 输出按 `createdAt` 倒序（不改 store 内部顺序），cursor 逻辑同步；长项目第一页是新 Task。
- `kaiming/src/runtime/task-progress.ts` 与 `kaiming/webapp/src/chat/task-flow.ts`
  - `plannedTail` 接受 `workKind`：design → design/review/settle；document → plan/design/review/settle；implement 从 plan 时包含 develop；investigate 不强行列 Review/Test。
  - 保持现有 Task 条/TaskTodo 的轮次语义；新增的差异只来自完成链。
- `kaiming/test-fixtures/task-progress.json`、对应两侧测试
  - 增加 design、implement（requiresTest true/false）、document、investigate 用例。
- `kaiming/test/store.test.ts`
  - v17→v18 迁移：read→investigate、write→implement、flowVersion=0、reworkCount=0、旧行为可更新任意阶段。
  - phase 矩阵：design 不能 develop/test；implement test 仅在 requiresTest；document 不能 develop/test；investigate 不能 review/test。
  - rework 计数：review→develop、test→develop、develop→design 递增；向前不递增；flowVersion=0 不变。
- `kaiming/test/task-tools.test.ts`、`test/delegation.test.ts`、`test/runtime.test.ts`
  - create 参数新契约、初始阶段、错误码。
  - 既有写入 Task 的测试补 `workKind`/初始阶段预期。
- `kaiming/test/server-read.test.ts`
  - task.list 顺序、字段、cursor。

### WP-3 设计执行、切片链路与门禁

**改动**

- `kaiming/src/runtime/backlog-store.ts` / `src/tools/backlog-tools.ts`
  - `BacklogDraft` 增加 `taskIds?`；`addItem` 在元数据中写 `Task`（多值）。
  - `backlog.add` 不新增模型参数；designer/settler 由宿主用 `currentTaskId` 自动填入，chief/UI 新增不填。
  - 测试：设计切片带设计 Task；chief 新增不带；settler 遗留带结算 Task。
- `kaiming/src/runtime/runner.ts`
  - backlog 工具上下文的 `tasksOf` 同时认 `backlogIds` 与条目 `Task` 引用，保证工具读回与界面一致。
- `kaiming/src/tools/task-tools.ts` + 新 `kaiming/src/runtime/design-completion.ts`
  - 创建 implement/document Task 前检查每个待办条目的 `Task` 引用：若有未结束的 `design` Task，拒绝（`DESIGN_NOT_READY`），提示先确认并结算设计。
  - 设计完成核对：
    - 原 `backlogIds` 条目必须存在且 state=done；
    - 由该设计 Task 产生的切片必须 open，且 `specRefs` 非空；
    - 设计 Review 的 `deliveryState` 必须非空；
    - 重新计算设计产物快照，digest 必须与 Review 一致；
    - 错误并入 `COMPLETION_INCOMPLETE.gaps`。
- `kaiming/src/runtime/deliverable.ts`
  - 新增 `snapshotDesignDelivery(cwd)`（显式路径，排除 backlog/work/requirements/issues）。
- `kaiming/src/tools/report-tools.ts`
  - `observeDelivery` 对 `workKind=design && flowVersion>=1` 使用设计快照；Review/Test 绑定设计产物。
- `kaiming/src/server/read-methods.ts`
  - `backlogItemView` 改为一次读取项目 Tasks，返回：
    - `relatedTasks`: 既包含 `backlogIds` 关联，也包含条目 `Task` 引用；
    - `openTasks`: 当前领取该条目的未结束 Task（含 workKind/phase）；
    - `producerTasks`: 条目 `Task` 引用的 Task（用于“来自设计”）；
    - `splitInto`: 由相关 design Task 产生的条目 id 列表（去重）；
    - 原 `lastClosedTask` 保留。
  - `taskSummary` 已有字段（WP-2）供直接工作区使用。
- `kaiming/src/tools/guidance.ts` / 提示词
  - 设计阶段下一步提示：设计交付 → Review → 用户确认 → 结算；实施 Task 的 design 阶段提示为“补充设计，不改实现验收”。
- 测试：
  - `test/backlog-tools.test.ts`：add 写入 Task；chief 不写；settler 写。
  - `test/task-tools.test.ts`：设计完成缺原待办关闭、切片无规格、Review 后改规格均拒绝；切片在设计中时建实施 Task 拒绝，设计结算后允许。
  - `test/report-tools`/`test/server-read`：设计 Review 的 deliveryState 含 `.dev` 产物；改 backlog 不失效，改规格失效。
  - `test/backlog-store.test.ts`：`Task` 多值往返不变。
  - 定向负向控制：去掉设计快照比较，Review 后改规格用例必须失败；去掉 producer 检查，提前实施用例必须失败。

### WP-4 项目页看板

**改动**

- `kaiming/webapp/src/project/project-model.ts`
  - `BacklogItemView` 增加 `relatedTasks`、`producerTasks`、`splitInto`；`BacklogTaskRef` 增加 `workKind`、`phase`、`goal`。
  - 新增 `boardOf(items, tasks)`：`ideas/designing/ready/implementing/completed`；切片有未结束设计 producer 时归 `ready` 并标 `awaitingDesign`。
  - 新增 `flowChain(workKind, requiresTest, phase)`：静态链 + 当前阶段 + 返工标记。
  - 新增 `directTasks`：`backlogIds` 为空的未结束 Task。
  - 新增 `orphanTasks`：未结束 Task 的 backlog id 在文件中不存在/有问题（BL-03 的待核对）。
- `kaiming/webapp/src/project/ProjectPage.tsx`
  - 页头/流程带：想法、设计中、就绪、实施中、已完成、待确认。
  - 注意力带保留：问题、设计确认、待办问题、孤儿 Task；点击问题跳来源会话，问题行跳文件行。
  - 四列看板；卡片显示编号/标题/kind、阶段链、返工、切片数、等待确认、直接工作标签；已完成折叠。
  - “直接工作”区只列无 backlog 关联的未结束 Task；保留“全部 Task”折叠入口以免丢失历史入口。
  - 模块/早期文件保持不变。
- `kaiming/webapp/src/project/BacklogDrawer.tsx`
  - 增加“来源设计/已拆分”区：相关 Task（kind/状态/打开会话）、切片链接；原待办显示拆分去向。
  - 「实施」在 open 且非 awaitingDesign 时可点；否则禁用并显示原因；仍只预填不发送。
  - 保留正文/规格/来源/关闭说明/完成/放弃/重开。
- `kaiming/webapp/src/i18n/catalog.ts`
  - 新增 `project.*`、`task.kind.*`、`task.rework`、`project.awaitingDesign`、`project.splitInto`、`project.directWork` 等中英文键；清理不再使用的旧键。
- `kaiming/webapp/src/theme/base.css`
  - 四列网格、窄屏横向滚动、卡片、阶段链 chip、等待/返工标记；复用现有 `pp-*` 与令牌，不引入第二套样式系统。
- 测试：
  - `webapp/test/project-model.test.ts`：四列分组、awaitingDesign、direct、orphan、splitInto、flowChain、返工。
  - `browser/project.spec.ts`：
    - 用脚本化模型创建 `workKind=design` + B-1，页面 B-1 出现在“设计中”而不是“进行中”；
    - 创建 `workKind=implement` + B-2，B-2 出现在“实施中”；
    - 直接 Task 出现在“直接工作”；
    - 抽屉显示“实施”预填不发送；完成后切片/来源链接可见（能造出数据时）。
  - `browser/acceptance.spec.ts`：更新现有 project board 用例，覆盖新看板和 `等你决定` 跳转；不引入拖拽。
  - 负向控制：把 `awaitingDesign` 判断去掉，切片提前显示为可实施，用例必须失败。

### WP-5 验证、结算与提交

- 运行：
  - `cd kaiming && npm run typecheck && npm test`
  - `cd kaiming/webapp && npm run typecheck && npm test && npm run build`
  - `cd kaiming && npx playwright test browser/project.spec.ts browser/acceptance.spec.ts`（build 后；必要时全量）
  - `npm run check:prompts`
  - `npm run check:backlog`、`npm run check:workflow`（真实模型；模型/环境不可用则如实记 blocked/未覆盖）
- 独立 Review：重点看迁移兼容、阶段图是否与 J-10 冲突、设计 Review digest 的误伤/漏检、切片 producer 检查、看板派生是否重复状态。
- 独立 Test：设计 Task 端到端、实施 Task 端到端、旧 Task 迁移、看板真实浏览器、负向控制。
- 结算：更新 `docs/technicalnew/validation.md`、`docs/INDEX.md` 当前状态、必要时 `gap-register`；写结算报告；提交本轮全部改动。

## 5. 交付顺序与依赖

```text
WP-1 文档/验收
   ↓
WP-2 数据/契约（workKind、flowVersion、阶段图、Task 摘要）
   ↓
WP-3 设计执行/切片链路/Review 绑定/完成核对
   ↓
WP-4 项目页看板
   ↓
WP-5 验证/结算/提交
```

- WP-1 必须先行，否则代码没有实现依据。
- WP-2 的 `workKind`/阶段图是 WP-3、WP-4 的共享契约。
- WP-3 的 backlog 投影字段是 WP-4 的数据来源。
- WP-4 不新增业务状态；只消费 WP-2/3 的事实。
- 每个 WP 仍按 Plan → Develop → Independent Review → Test → Settlement 执行；本文是总体 Plan，WP 内可再写实现摘要与审查报告。

## 6. 验证矩阵（最低要求）

| # | 场景 | 期望 |
|---|---|---|
| 1 | 新建设计 Task（workKind=design，关联 B-6） | 初始 phase=design；requiresTest 不可 true；项目页 B-6 在“设计中” |
| 2 | design Task 尝试 develop/test | `INVALID_ARGUMENT`，返回允许阶段 |
| 3 | implement Task 尝试 test 但 requiresTest=false | 拒绝；requiresTest=true 时允许 |
| 4 | document/investigate 尝试 test | 拒绝 |
| 5 | implement 在 develop 后回 design（J-10） | 允许，reworkCount+1；不创建第二个 Task |
| 6 | 设计 Review 通过后修改 `.dev/product` | `end` 拒绝，要求重新 Review |
| 7 | 设计 Review 通过后关闭 B-6（只改 backlog） | 不使 Review 失效 |
| 8 | 设计结算但 B-6 仍 open | `COMPLETION_INCOMPLETE` |
| 9 | 设计产生的切片无 `规格` 引用 | `COMPLETION_INCOMPLETE` |
| 10 | 设计未结束时对切片建 implement Task | `DESIGN_NOT_READY`；设计结算后允许 |
| 11 | 原待办 B-6 关闭、切片 B-7/B-8 打开 | 项目页 B-6 显示“已拆分 → B-7/B-8”；切片显示“来自设计” |
| 12 | 旧 v17 Task 迁移 | workKind 按 type 回填；flowVersion=0；仍可更新原阶段；reworkCount=0 |
| 13 | task.list 长项目 | 第一页是新 Task；cursor 下一页不重复 |
| 14 | 看板四列 | 想法/设计中/就绪/实施中/已完成计数与文件、Task 事实一致 |
| 15 | 直接说“实现 X” | 无 backlog 的 Task 出现在“直接工作”或实施中，不强行建待办 |
| 16 | 所有未回答问题/设计确认 | 注意力带显示并可跳到来源会话；未回答时不能完成设计 |

## 7. 迁移、兼容与回退

### 迁移

- v17→v18 只加列，不改旧值；默认 `workKind='implement'`、`flowVersion=0`、`reworkCount=0`，随后把 read Task 回填 `investigate`。
- 旧 Task 不强制阶段图、不计数；新 Task 创建时 `flowVersion=1`。
- 旧 Task 在项目页仍显示；`flowVersion=0` 可标“旧流程”，但不阻塞使用。
- 不迁移旧 `.dev/requirements` 和 `issues.md`。

### 回退

- 代码按 WP 逻辑提交，可 `git revert` 对应提交。
- SQLite 迁移只能前进；回退代码后新列被旧代码忽略，旧 Task 仍可读（需确认旧版本 select * 不因多列报错——当前读取按列名，安全）。
- 若阶段图误伤新 Task，可通过 `flowVersion`/允许集合修订后重新 Review/Test，不手工改库。

## 8. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| workKind 被误解为新用户任务类型 | 产品语义漂移 | 文档明确 type 仍是 read/write；workKind 只是完成链 |
| 阶段图误伤 J-10 | 实施中补设计被拒 | implement 明确允许 design 阶段；用真实模型场景验证 |
| 设计 Review digest 误伤结算 | 结算改规格导致无法完成 | 排除 backlog/work；settler 不改设计正文；真实改动重新 Review |
| 设计 Review 仍漏检新增文件 | Review 后新增规格不失效 | 设计完成时比较完整快照 digest，不只比较路径列表 |
| 切片 producer 字段被误用 | chief 新增想法被归到当前 Task | 仅 designer/settler 自动填；chief/UI 不填；测试覆盖 |
| 看板投影开销 | 项目页每次轮询读全部 Task/结果 | 一次 `listTasks` + 一次 backlog 读取；只投影 compact 字段；不在前端逐条 RPC |
| 旧 Task 分列错误 | 旧设计 Task 标成实施 | 明确已知限制；flowVersion=0 标旧流程；不伪造历史 kind |
| 用户确认门仍靠提示词 | 模型跳过确认 | 现有 question 输入阻挡 + Review 检查 + prompt；如需硬门禁另立工作包 |
| 浏览器测试难以稳定造 Task | 看板回归不足 | 用脚本化模型创建真实 Task；纯投影逻辑用 webapp 单测覆盖；必要时加测试专用 seed API，但不改生产语义 |

## 9. 停止条件

出现以下情况，停止当前 WP，回到讨论，不继续写代码：

- 阶段图与 J-10 或既有 Task 迁移冲突，无法用 flowVersion 兼容。
- 设计 Review digest 无法区分“结算关闭待办”和“设计正文改变”，导致正常结算被阻断。
- 必须新增审批类型/状态或第二个状态机才能表达设计确认。
- 看板需要新增 RPC/新持久状态才能显示，而现有 backlog/task 投影不足。
- 真实模型无法按 `workKind`/设计门禁稳定工作，提示词无法约束。
- 迁移会破坏在途 Task 或用户项目文件。

## 10. 审批

本计划只写文档与计划记录，未改代码。等待用户确认后再从 WP-1 开始；WP-1 完成后仍需按工作包分别 Develop → Independent Review → Test → Settlement。
