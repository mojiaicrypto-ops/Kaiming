# Plan · 缺口补齐（后端读形状、任务推送、交接与阅读器）

```yaml
plan:
  task: workbench-gaps-20261022
  date: 2026-10-22
  status: Awaiting Plan Confirmation
  basis:
    - docs/technicalnew/gap-register.md（本计划逐条对应其编号）
    - docs/productnew/modules/project-workspace.md（P-03、P-05、AC-01/02/04/27）
    - docs/productnew/modules/delivery.md:76（打开报告与证据）
    - docs/technicalnew/runtime-contract.md（R1 方法表）
    - docs/technicalnew/ui-design.md（布局、组件、门禁）
  goal: >
    先让界面显示的都是真实状态（会话/项目列表、任务变化、当前配置、停止中），
    再补齐产品要求但没有入口的读取面（知识入口、文件、报告与证据），
    最后修正两处会写错/中断交接的交互。不新增存储列，不引入新抽象层。
```

## 0. 非目标

- 不新增 `sessions.title` 列；标题由首条 user 输入派生（C1）。
- 不引入状态管理库、请求缓存层、虚拟滚动。
- 不实现多用户权限、移动端手势。
- 不改 RPC 信封、错误码集合、WAL/恢复语义。
- 不实现 U4/U5 的界面形态（产品未定义交互），本轮只提交待确认问题。

## 1. 阶段与验收

| 阶段 | 内容 | 对应缺口 | 可观察验收 |
|---|---|---|---|
| A | 服务端读形状：`session.list`、`session.get` 增 `stopping`/`config`、`project.get` 去掉 `tasks`、`session.input.get` 白名单字段 | S2、S4、C1、C2、C3、C4 | 方法表与实际一致；会话列一次请求；`project.get` 不再随任务数增长 |
| B | `project.list` + 项目菜单接真实列表 | S1 | 清空浏览器存储后，已登记项目仍在菜单 |
| C | 任务推送 + 轮询只在可见时运行 | S3、D4 | 建 Task 后任务条立即出现（无 2 秒空白）；隐藏标签页 0 请求 |
| D | 写对与交接：模型设置范围、需求抽屉跳转预填 | D1、D2 | 项目范围写项目级覆盖；抽屉按钮打开会话并预填，未代发 |
| E | 阅读器：知识入口、项目文件、报告与证据、更早历史 | U7、U1、U2、U10 | 从项目对话框与转录结果都能打开正文；二进制/截断说清楚；上滚能加载更早消息且不跳位 |
| F | 重绑定与任务列表 | U3、U6 | 目录移动后可重绑定；任务列表分页可读 |
| G | 交互质量：焦点、Toast 通知、错误文案 | D3、D6、P3 | Tab 不出遮罩；读屏能听到 Toast；错误码对应本地文案 |
| H | 待确认问题（不实现） | U4、U5 | 列出问题与建议形态，等确认 |
| I | 验证与结算 | — | 见 §5 |

阶段顺序固定：A→B→C→D→E→F→G→I。H 与实现并行产出文档。

## 2. 文件级改动

### A 服务端读形状

| 文件 | 改动 |
|---|---|
| `src/server/read-methods.ts` | 新增 `session.list`：`{projectId, limit?, cursor?}` → `{sessions:[{sessionId, roleId, title, activity, lastActivityAt, currentTaskId, queuedInputs}], nextCursor}`；按 `lastActivityAt` 降序（空会话排最后），cursor=`<lastActivityAt>\|<sessionId>`。**不得**调用 `hub.prepare`、**不得**读历史文件。`session.get` 增 `stopping` 与 `config:{providerId,modelId,source}\|null`（只回白名单字段，不带 `agentDir`/`promptDir`）；`session.input.get` 的 `effectiveConfig` 同样只回白名单；`project.get` 移除 `tasks` |
| `src/store/store.ts` | 新增 `firstUserInputText(sessionId)`（`session_inputs` 中 `kind='user'` 最小 `seq` 的 `payload`，取首个 text block）；`listProjects()`（按 `updatedAt` 降序） |
| `src/runtime/requirement-store.ts` | 不改；标题截断常量放 read-methods |
| `test/server-read.test.ts` | 新增：`session.list` 排序/分页/cursor 失效/无输入标题为 null/标题截断；`session.get` 的 `stopping`（有 stopRequested 的 processing 输入）与 `config` 取当前输入；`project.get` 不含 `tasks` |
| `webapp/src/state/useWorkspace.ts` | 删除 `ProjectSummary.tasks` 字段（服务端不再返回；任务一律走 `task.list`） |
| `docs/technicalnew/runtime-contract.md` | R1 表：`session.create` 去 `title?`、`session.list` 新增、`session.get` 字段与 activity 枚举改写、`project.get` 去 tasks |
| `docs/technicalnew/gap-register.md` | S2/S4/C1/C2/C3/C4 标已关闭并附提交 |

标题规则（写进合同）：首条 user 输入的首个文本块，取首个非空行，按码点截断 60，超长加省略号；无输入为 `null`（界面显示「新会话」）。

### B 项目列表

| 文件 | 改动 |
|---|---|
| `src/server/read-methods.ts` | 新增 `project.list`：`{limit?, cursor?}` → `{projects:[{projectId, realPath, directoryExists, sessionCount, taskCount, lastActivityAt, updatedAt}], nextCursor}`；cursor=`<updatedAt>\|<projectId>` |
| `webapp/src/state/useWorkspace.ts` | 项目菜单来源改为 `project.list` ∪ 本地最近（标记「已登记/最近」）；删除 `titleCache` 与 `loadTitles`，会话列改用 `session.list` |
| `webapp/src/app/ProjectDialog.tsx` | 菜单项显示路径、目录是否存在；目录缺失时给出「重新绑定」入口（F 阶段接上） |
| `test/server-read.test.ts` | `project.list` 空库、排序、分页、目录删除后 `directoryExists=false`、会话/任务计数 |
| `devagent/browser/smoke.spec.ts` | 现有「项目从真实数据渲染」用例改为断言菜单来自 `project.list`（拦截请求计数） |

### C 任务推送

| 文件 | 改动 |
|---|---|
| `src/tools/task-tools.ts` | `TaskToolContext` 增 `onTaskChange?: (taskId: string) => void`；`create`/`update`/`dispatch`/`control`/`end` 成功后调用一次（同一属性变更只调一次） |
| `src/runtime/runner.ts` | `RunnerOptions` 增 `onTaskChange?: (sessionId: string, taskId: string) => void`；注入到 chief 的 Task 工具 |
| `webapp/src/state/useSession.ts` | 收到 `invalidate{task}` 立即 `refreshTask`；删除 2 秒发现循环；3 秒轮询保留为兜底，且仅在 `document.visibilityState === 'visible'` 时运行，`visibilitychange` 恢复时立即读一次 |
| `test/task-tools.test.ts` | create/update/dispatch 各调用一次推送；失败路径不推送 |
| `devagent/browser/smoke.spec.ts` | 「运行中出现的 Task」用例改为断言推送到达后立即出现（不等 2 秒） |

### D 写对与交接

| 文件 | 改动 |
|---|---|
| `webapp/src/settings/ModelsPage.tsx` | 范围切换改变**编辑对象**：全局＝每角色一行（`{roleId}`）；本项目＝一行「本项目」（`{projectId}`）。保存后重读对应范围；错误文案走 P3 |
| `webapp/src/requirements/RequirementDrawer.tsx` | 底部动作改为 `onHandOff(text)`：切到会话屏，把「实施 \<id\>」/「按提案 \<id\> 设计」填入 composer 并聚焦；不发送。无会话时先 `session.create` |
| `webapp/src/app/App.tsx` | 增 `pendingInput`（一次性草稿）与路由参数传递；消费后清空 |
| `webapp/src/chat/Composer.tsx` | 接受外部草稿（只在为空或同一草稿时覆盖，避免冲掉用户已输入内容） |
| `devagent/browser/acceptance.spec.ts` | 新增：项目范围保存后 `config.get({projectId})` 的来源为 project；抽屉按钮跳转后 composer 文本匹配且无新输入（`session.input.submit` 计数为 0） |

### E 阅读器

| 文件 | 改动 |
|---|---|
| `webapp/src/files/FileDrawer.tsx`（新） | 一个抽屉两种来源：`project.files.list/read` 与 `task.report.get`；面包屑 + 目录列表 + 文本视图；`binary`/`truncated`/超限各有说明；带 `version` 显示，不做编辑 |
| `webapp/src/app/ProjectDialog.tsx` | 四个知识入口（AGENTS.md、.dev/INDEX.md、.dev/PROJECT.md、初始化记录）显示存在与否，点击进阅读器 |
| `webapp/src/chat/ToolTask.tsx`、`ToolBusiness.tsx` | 结果与证据引用变成可点击（`resultId` → 报告；项目相对路径 → 文件） |
| `webapp/src/chat/Transcript.tsx` | 上滚到顶加载更早历史（`session.messages.list` + `nextCursor` 反向前插，保持 `scrollTop` 不跳）；顶部显示「已到最早」或加载中 |
| `webapp/src/i18n/catalog.ts` | 新增键（两语），`web-i18n-keys` 自动校验 |
| `devagent/browser/acceptance.spec.ts` | 打开 AGENTS.md 读到正文；打开任务结果报告读到正文；打开二进制文件显示说明而非乱码；101 条以上的会话上滚后看到第 1 条且视口不跳 |

### F 重绑定与任务列表

| 文件 | 改动 |
|---|---|
| `webapp/src/app/ProjectDialog.tsx` | 「重新绑定」：选目录 → `project.rebind`（带 `expectedRevision`）；`WORKSPACE_BUSY` 列出仍需停止的工作；成功后重读项目 |
| `webapp/src/requirements/RequirementsPage.tsx` | 第三段「任务」：`task.list` 分页，行显示 type/phase/status/成员数；点击进会话并聚焦任务条 |
| `test/server-read.test.ts` | `task.list` 分页与 cursor（已存在，补一条越界 cursor 报错断言） |
| `devagent/browser/acceptance.spec.ts` | 目录移走 → 重绑定成功；有运行中工作 → 拒绝并说明 |

### G 交互质量

| 文件 | 改动 |
|---|---|
| `webapp/src/app/Drawer.tsx`、`ProjectDialog.tsx` | 焦点陷阱（Tab 循环）、关闭归还到触发元素；`FileDrawer` 复用同一实现 |
| `webapp/src/components/ToastHost.tsx` | `role="status"` + `aria-live="polite"`；错误 Toast 用 `role="alert"` |
| `webapp/src/api/rpc.ts` 与各页 | 错误码 → 本地文案映射（`settings.error.*`、`req.error.*`），服务端 detail 作为第二行 |
| `webapp/src/chat/Banner.tsx` | 阻断码 → `blocked.config/role/project` 本地文案，detail 作次行（D6） |
| `webapp/src/i18n/catalog.ts` | 两语新增阻断码与错误码键 |
| `devagent/browser/smoke.spec.ts` | Tab 键在抽屉内循环；Toast 有 `aria-live`；错误码出现本地文案 |

### H 待确认（只写文档，不实现）

| 问题 | 建议形态 | 需确认 |
|---|---|---|
| U4 恢复核实 | 会话屏横幅 + 单条「核实并关闭」（`recovery.inspect` 取候选，`resolve` 需 `evidenceRefs`） | 首版是否需要独立界面？证据由谁选？ |
| U5 会话清理 | 会话列行内「清理」，被引用时列出原因 | 是否允许用户手动清理，还是只由主管工具执行？ |

写入 `docs/technicalnew/gap-register.md` 的 U4/U5 行与 `.agentdev/work/workbench-gaps-20261022/questions.md`。

## 3. 步骤（每步结束即可验证）

1. A1 `session.list` + store 助手 + 测试。
2. A2 `session.get` 的 `stopping`/`config`，`project.get` 去 `tasks`，`input.get` 白名单 + 测试。
3. A3 合同表与缺口登记状态更新。
4. B1 `project.list` + 测试；B2 界面接入 + 浏览器用例。
5. C1 工具/Runner/Server 推送链 + 测试；C2 界面收推送、删发现循环、可见性轮询 + 浏览器用例。
6. D1 模型范围；D2 交接预填；各一浏览器用例。
7. E1 阅读器 + 知识入口；E2 报告/证据链接；E3 更早历史分页；各一浏览器用例。
8. F1 重绑定；F2 任务列表；各一浏览器用例。
9. G 焦点、Toast、错误文案。
10. H 问题文档。
11. I 全量验证、审阅、结算、提交。

每步的「完成」= 类型检查通过 + 该步新增测试通过 + 界面可观察行为符合验收。禁止一次改完再补测试。

## 4. 合同与文档同步（随代码提交，不另起一轮）

| 文档 | 触发 |
|---|---|
| `runtime-contract.md` R1 表 | 任何方法增删/字段变化 |
| `ui-design.md` | 新界面元素（阅读器、任务段、重绑定）与「方法消费」表（P5） |
| `architecture.md` A7 | 数据来源变化（会话列、项目菜单） |
| `gap-register.md` | 每项关闭/新增 |
| `validation.md` | 本轮证据与未覆盖项 |
| `docs/INDEX.md` | 入口状态变化 |

## 5. 验证

| 项 | 命令 | 判据 |
|---|---|---|
| 类型 | `npx tsc -p tsconfig.json --noEmit`；`npm --prefix webapp run typecheck` | 无输出 |
| 单测 | `npm test`；`npm --prefix webapp test` | 全绿，且新增用例覆盖 §2 每行断言 |
| 构建 | `npm run build` | 产物生成 |
| 浏览器 | `npm run test:browser` | 现有 15 条 + 新增（项目菜单、会话列单请求、推送、模型范围、交接、阅读器、重绑定、任务列表、焦点、Toast） |
| 真实服务冒烟 | 手动开一次工作台：登录 → 项目菜单 → 会话 → 打开 AGENTS.md → 打开任务报告 | 每步看到真实数据；无 500、无裸键 |
| 回归 | 上一轮 15 条浏览器用例不得变慢或变灰 | 全绿 |

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| `session.list` 标题派生与 Pi 历史不一致（历史含用户编辑/重放） | 只取首条 user 输入的 payload，与 `session.messages.list` 的 inputId 关联可核对；不一致时以输入行为准并在合同写明 |
| 推送与轮询并存导致重复刷新 | 推送后 1 秒内的兜底 tick 跳过（记录最后推送时间） |
| `project.list` 与本地最近合并出现重复/幽灵项 | 以 realPath 去重；目录不存在的最近项单独标注「不可用」，不自动删除记录 |
| 阅读器读到超大文件 | 服务端已限 1 MiB + `truncated` 标记；界面必须显示截断，不静默 |
| 焦点陷阱破坏快捷键（1/2/3） | 遮罩打开时快捷键不响应（与问题面板同一守卫） |
| 交接预填冲掉用户已输入的草稿 | Composer 只在为空或等于同一草稿时接受外部文本，否则提示「输入框已有内容」 |

## 7. 交付物

- 代码与测试（按 §2）
- `docs/technicalnew/`：`runtime-contract.md`、`ui-design.md`、`architecture.md`、`gap-register.md`、`validation.md` 更新
- `.agentdev/work/workbench-gaps-20261022/`：`plan.md`、`implementation.md`、`review.md`、`test.md`、`settlement.md`、`questions.md`
- 独立 Review 两轮（新上下文、只读）；blocking 发现必须在结算前关闭

## 8. 待确认（开始前需要答复）

1. 阶段 A–G 是否全做，还是先做 A–D（真实状态与交接）与 E（阅读器）？
2. U4/U5 是否进入本轮范围（当前按「只写问题」处理）。
3. 阶段 E 的阅读器是否需要编辑能力（当前按只读设计）。
