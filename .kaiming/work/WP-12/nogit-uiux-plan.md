# Plan：无 Git 项目可打开 + WebUI 专业化重构

日期：2026-09-18。两个独立可交付改动，按下列顺序实施。

## 改动 A：无 Git 项目可打开，Git 由 Chief/Agent 自行组装

### 事实（调查证据）

- 两道打开阻断：`apps/daemon/src/project-directory.ts:318-324`（`ProjectDirectoryError('NOT_A_REPOSITORY')`）、`apps/daemon/src/bootstrap.ts:189-194`（`ProjectOpenError('NOT_A_REPOSITORY')`）。
- `AssembledProject.gitRoot: string`（bootstrap.ts:105、project-directory.ts:82）非空契约。
- Storage `project.git_root TEXT` 可空（schema.ts:88）；contracts `gitRoot` 已 optional（entities/project.ts:42）。
- GitPort `resolveRoot` 对非仓库返回 `{ok:true, value:null}`（git-port.ts:269-284）——不抛错。
- 需求导入已天然降级：`resolveImportRevision` 返回 `{revision:null, source:'none'}` 跳过（requirement-import.ts:59-73）。
- 既有 user-facing Git 依赖全部走 `gitRoot ?? root` 回退（protocol.ts 7 处、messages.ts:93、settlement.ts:1132、recovery.ts 多处）——gitRoot 为空时落到 project.root，readHead/save 在无仓库时报 INVALID_STATE「交付仓库不可用」。
- Chief 工具集 = `READ_ONLY_TOOLS`（tool-protocol.ts:96），无 `bash`/`git`。
- `git` 工具全链守卫：planToolCall 只放行 `GIT_READ_ONLY_SUBCOMMANDS`（tools.ts:428-436）；bash 守卫 `isRefMutatingGitShellCommand`。
- 初始化状态机已有 git-initialization 门禁（initialize.ts:519-534、1226-1250）：无 Git 时 blocked(NOT_AUTHORIZED)，授权后走 `git.initRepository` + 交付分支（1255）。
- `project.initialize {mode:'new'}` 已是显式 git init 授权通道（project-directory.ts:707、protocol.ts:2004-2052）；`project.create` 空 dir 同样（project-directory.ts:445）。
- 信任门禁：未信任项目连 `git`/`bash` 工具都拒（permissions.ts:918-950）——信任后可放行。

### 设计决策

1. **打开不再被 Git 阻断**：project.open 允许 `gitRoot === undefined`。project 行 `git_root` 置 NULL，`head` 缺省。
2. **Git 组装走既有授权通道**：不放宽 git 工具的 ref-mutating 禁令（CAS 单写者是正确不变量）。无 Git 项目用户点「初始化」（`project.initialize {mode:'new'}`）即完成 `git init` + initial commit + agentdev/main——这条链已完整存在，只需保证打开不被阻断后可达。UI 上把该按钮在无 Git 项目呈现为「初始化仓库」。
3. **需求保存降级**：gitRoot 为 null 或仓库不可用时，`requirement.save` 不再报 INVALID_STATE，而是仅写 SQLite 投影（`RequirementProjection.import`，portableRef.revision='working-tree'，recordCommitted:false），返回 `saveState:'degraded'`、git:null。Git 初始化后首次保存将投影与 Git 对齐（同 recordVersion 继续递增；若 hash 相同视为 unchanged）。UI 显示「已保存（本机）」。
4. **Chief 无需新工具**：仓库组装是用户点初始化授权、Core 执行的领域命令（符合"Git ref修改只由Workspace服务完成"契约）；Chief 在无 Git 项目中正常问答/调查/派发只读任务，初始化动作出现在 UI/Inbox 引导。

### 改动面

1. `project-directory.ts`：删 318-324 阻断；`AssembledProject.gitRoot: string | null`；`runFirstOpenImport` 传 `gitRoot ?? root`（import 已自降级）。
2. `bootstrap.ts`：删 189-194 阻断；`gitRoot: identity.gitRoot ?? null` 两处（insert 222、返回 357）；`OpenedProject.gitRoot: string | null`。
3. `main.ts`：480 `repoRoot: project.gitRoot ?? project.root`（worktree resolver 对无 Git 项目只在 Chief Run（无 taskId）被调用，Chief 返回 project.root 不触 git）；749 直接透传 null。
4. `protocol.ts`：`projectGitRoot()` 增加无仓库语义——file.list/file.read 等在无 Git 时返回 NOT_FOUND（无 revision 可言），保持诚实；`gitContext()` 已回退 root，需确认 resolveRevision 对非仓库安全（返回 ok:false → upstreamRevision null，安全）。
5. `requirement-save.ts`：saveUnderLock 在 readHead 前探测 `resolveRoot(root)`；null → 走 `saveProjectionOnly` 分支（复用 refreshProjection 的投影事务，recordCommitted:false，revision 'working-tree'），返回 outcome 带 saveState。
6. `protocol.ts` requirementSaveResult/saveRequirement：透传 degraded 状态与提示；`requirement.retry` 对 degraded 保存提示「初始化仓库后重试可入 Git」。
7. 测试：daemon 集成测试改「非 Git root 拒绝」用例 → 改为「非 Git root 可打开且 state open、gitRoot null」；新增 requirement.save 无 Git 降级用例；新增 open→initialize(mode new)→gitRoot 出现→保存入 Git 的链路用例。
8. 文档：`docs/product/requirements.md` §3 增「无 Git 项目保存降级」小节；`docs/rules/workflow.md` §8 同步；INDEX.md WP-12 行为登记。

## 改动 B：WebUI 专业化（对齐 webui/index.html 设计语言）

### 事实

- 技术形态：零依赖 SSR 字符串模板 + vanilla JS（app.js 2506 行）+ 单 CSS（styles.css 576 行）。**不引入框架**，保留架构。
- 当前 `:root` 已有 11 个变量；mock 有 16+（缺 surface-soft/console/line-strong/dim/accent-soft/blue-soft/cyan/purple/--status）。
- 缺组件：底部状态栏、Toast、命令面板、阶段条（stage-strip）、avatar、data-list 规范、卡片进度条、对话框样式统一、kbd。
- Mock 尺寸：mock 用 8-11px 极小字号（展示密度优先）；实际工作台采用其色彩/骨架/组件形态，但字号按可读性放宽（11-13px），保持现有 ARIA/焦点合规。

### 改动面

1. **styles.css 重写设计令牌**：对齐 mock 全套变量（surface-soft、console、line-strong、dim、accent-soft、blue-soft、cyan、purple、--status）；`body` 加 antialiased；focus-visible 统一 blue 轮廓。
2. **布局骨架**：`.app` 改 `grid-template-rows: var(--header) minmax(0,1fr) var(--status)`；新增 `.statusbar`（连接状态、当前项目/分支、Live 计数、语言）；topbar 对齐 mock 三列网格。
3. **组件化**（shell.ts/pages.ts 增类名 + CSS）：
   - `.data-list/.data-row/.data-id/.data-main/.data-status` 统一 Runs/Inbox/Docs 列表；
   - `.board-card` 升级：card-facts 双列、card-progress 进度条、card-footer；
   - `.stage-strip/.stage`（Chief 顶部阶段条：Product→Plan→Develop→Review→Test→Done，来自现有 work.phase 数据）；
   - `.message` avatar（角色缩写、chief 绿色边框）；
   - `dialog` 统一样式（picker/信任/profile 共用 dialog-head/body/actions）；
   - `.toast` 右下角通知；
   - `.repo-chip`（switcher 项目缩写徽标）。
4. **app.js**：Toast 管理器（success/error，3s 自动消失，替代部分内联 status）；连接状态点呼吸动画；Live Dock 终端化（console 底色、log-line 三列网格、tag 着色——复用现有事件流数据）。
5. **pages.ts**：Runs/Inbox 行改 data-list 结构；看板卡片加进度/事实区；Projects 行加 repo-chip 与状态 LED；无 Git 项目行显示「未初始化仓库」chip + 初始化按钮文案区分。
6. **shell.ts**：顶栏项目切换器升级（repo-chip、分支/状态副标题、运行数徽标）；底部状态栏渲染。
7. **i18n.ts**：新增状态栏、Toast、初始化仓库、degraded 保存等键（中英）。
8. **无障碍不回退**：aria-live、焦点回归、键盘遍历全保留；颜色均配文字（现有契约）。

### 验证

- `pnpm typecheck`、`pnpm lint`、`pnpm test:unit`、`pnpm test:integration` 全绿。
- `pnpm test:e2e`（含真实 Chromium）通过；AC-071/073/076 相关浏览器用例不回归。
- 真实浏览器截图验证：/projects、Chief、看板、Runs、无 Git 项目打开流。
- 端到端演练：临时目录无 git → open 成功 → initialize(mode new) → gitRoot 出现 → requirement.save 入 Git。
