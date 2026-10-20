# UI 前端整体重构 · Plan

状态:待授权。依据:`docs/productnew/`(产品行为)、`docs/technicalnew/`(M4 快照/事件、M5 交互)、
`devagent/webapp/`(已在迁移中的 React 外壳)、`devagent/web/`(在用旧外壳)。

## 0. 先纠正一个前提

本轮之前判断"前端零构建、应保持 vanilla"是错的。事实:

| 项 | 事实 | 证据 |
|---|---|---|
| 构建工具 | 已使用 **Vite 7 + React 19**(`@vitejs/plugin-react`) | `devagent/webapp/package.json`、`vite.config.ts` |
| 产物 | `webapp` → `../web-static/app`,`base=/app/` | `vite.config.ts` |
| 服务 | `/app/*` 由服务端托管并带 SPA 回退 | `src/server/http.ts:70-79` |
| 旧外壳 | `/` 仍由 `devagent/web/`(vanilla, 5.6k 行)提供 | `src/server/main.ts:259` |
| 迁移状态 | React 只覆盖主管会话(transcript/task/interaction/drawer),其余 7 个视图仍在旧外壳 | `webapp/src/components/`、`web/views/` |
| 产物入库 | `devagent/web-static/` 在 `.gitignore`,属本地构建产物 | `devagent/.gitignore:1` |

所以"整体重构"= **把 React 外壳做成产品级界面并完成迁移收口**,不是另起一套。

## 1. 目标与不做

目标:
1. 视觉与交互达到可直接交付的产品水准,不再是原型的逐字节复制。
2. 信息架构以主管会话为中心,当前工作(任务/计划/证据/待决定)在右侧工作栏。
3. 完成旧外壳到 React 的迁移,单一入口、单一代码库,删除旧外壳。
4. 保持既有行为契约:M4 快照/边界/重连、M5 交互答复、WAL/恢复、i18n、可访问性。

不做:
- 不改服务端业务语义(除缺口:项目/会话列表、必要时的事件字段)。
- 不引入 Tailwind/组件库/CSS-in-JS;不加测试框架;不加服务端渲染。
- 不在本期重做 Agent 提示词、存储、调度。

## 2. 设计契约(作为实现依据,决定后写入 `docs/technicalnew/ui-design.md`)

### 2.1 布局(三区)

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ topbar 52  项目切换 · 会话切换 · ⌘K · 连接状态(用户语言)                │
├──────────────┬───────────────────────────────────┬───────────────────────┤
│ 侧栏 248     │ 主区(会话 / 视图)                  │ 工作栏 320(可折叠)     │
│ 会话列表     │ 内容 max-width 820,居中            │ 当前 Task / 计划步骤    │
│ 需求 任务    │ 会话:transcript 滚动 + 输入框吸附   │ 参与 Agent / 待决定     │
│ 文件 文档    │ 其他视图:统一 page-header + 内容    │ 证据与产物              │
│ 设置        │                                    │                        │
├──────────────┴───────────────────────────────────┴───────────────────────┤
│ statusbar 26:连接 · 项目分支 · 运行摘要(单行,不重叠)                    │
└──────────────────────────────────────────────────────────────────────────┘
```

规则:
- 视图内部不得再渲染与 `page-header` 重复的标题(修掉现在"标题出现两次")。
- 工作栏随路由上下文切换内容;无内容时整栏隐藏,让主区得到宽度。
- `<1280px` 工作栏默认折叠;`<1024px` 侧栏改为抽屉;`<768px` 单列 + 顶部切换。

### 2.2 令牌(唯一权威 `webapp/src/styles/tokens.css`)

| 维度 | 值 |
|---|---|
| 背景 | `--bg #0c0d0f` / `--surface #131519` / `--raised #191c21` / `--inset #0f1114` |
| 线 | `--line rgba(255,255,255,.07)` / `--line-strong rgba(255,255,255,.12)` |
| 文本 | `--text #e9eaec` / `--text-2 #a0a6ad` / `--text-3 #6f7680` |
| 强调 | `--accent #7dd3a0`(只用于主操作与当前项);`--accent-weak rgba(125,211,160,.12)` |
| 语义 | 运行 `#6ea8fe` · 待决定 `#b18cff` · 完成 `#5ecb8a` · 阻断 `#ff7d7d` · 空闲 `#7b838c` · 警告 `#e5b567` |
| 字阶 | 11 / 12 / 13 / 14 / 16 / 20 / 26,行高 1.45–1.6;正文 14 |
| 字重 | 400 / 500 / 600,不用 700 |
| 间距 | 4 基数:4/8/12/16/24/32/48 |
| 圆角 | 6 / 10 / 14 |
| 层级 | `--z-sticky 10` / `--z-drawer 40` / `--z-dialog 50` / `--z-toast 60` |
| 动效 | 120ms(状态)/ 180ms(浮层),`ease-out`;`prefers-reduced-motion` 全禁 |
| 主题 | `:root`(深)+ `[data-theme="light"]`;首版默认深色 |

禁止:组件内写死颜色/字号/间距;新增令牌必须先进 `tokens.css`。

### 2.3 组件清单(只允许这些)

`Button`(primary/secondary/ghost/danger,sm/md)、`IconButton`、`Field`、`Textarea`(自动增高)、
`Select`、`Checkbox`、`Card`、`Panel`、`ListRow`、`Badge`、`StatusDot`、`StatusPill`、`Avatar`、
`Tabs`、`Tooltip`、`Dialog`、`Drawer`、`EmptyState`、`ErrorState`、`Skeleton`、`Toast`、`CommandPalette`、
`Markdown`、`CodeBlock`、`Timeline`、`StepList`。

命名与实现:
- `webapp/src/ui/<Component>.tsx` + `<Component>.module.css`,默认导出,props 显式,无全局副作用。
- 图标:`lucide-react`(按需导入);删除两字母方块图标。
- 每个组件在 `/app/#/design` 画廊页列出全部状态(默认/hover/focus/active/disabled/loading/空/错误)。

### 2.4 会话面(核心,优先级最高)

| 元素 | 规则 |
|---|---|
| transcript | 消息分组:用户 / 主管 / 专业 Agent(带角色徽标与 Session 链接);组间距 24,组内 8 |
| 流式 | 增量追加,不重渲染完成消息;光标只在最后一块;滚动遵循"仅在贴底时自动跟随" |
| 工具卡 | 默认单行(图标 + 名称 + 一句摘要 + 耗时),展开看参数/输出/错误;错误行红色状态点 |
| 计划/需求卡 | 内联卡片,标题 + 3 行摘要 + "查看"进入详情(视图或工作栏) |
| 决策卡 | 内联、置顶于输入框上方,标题=问题,选项为按钮,附"原文/依据";答复后变为已答复态 |
| 输入框 | 吸附底部;⌘↵ 发送、⇧↵ 换行;发送中禁用并显示状态;队列/保留输入可见并可撤回 |
| 空态 | 一句价值主张 + 3 个示例问题 + 一个主操作;不出现文件路径等实现细节 |
| 错误/断线 | 顶部条:一句话 + 重试;区分"未连接/重连中/已断开/服务端不可达" |

### 2.5 状态与语言

- 状态词面向用户:`正在执行(2 个 Agent)`、`等你决定:…`、`已阻断:…`、`已完成`、`已暂停`、`空闲`。
- 所有文案走 `i18n.json`,`en`/`zh-CN` 键必须一致;新增键同时补齐两语;禁止硬编码中文(当前 React 外壳违反)。
- 证据可追溯:任何"完成/失败"都要能展开看到来源(哪一个 Agent、哪次运行、哪条报告)。

### 2.6 可访问性与细节

- 焦点可见(2px `--accent`),焦点顺序符合阅读顺序;所有图标按钮有 `aria-label`。
- 对比度 ≥ 4.5:1;正文不依赖颜色区分状态(点 + 文字)。
- 键盘:⌘K 命令面板、⌘↵ 发送、Esc 关闭浮层、Tab 不落入隐藏视图。
- 中文标点/`…`/引号统一;时间用相对时间(<24h)与绝对时间(tooltip)。

## 3. 技术方案

### 3.1 目录

```text
webapp/src/
  main.tsx                 # 挂载 + 主题 + i18n provider
  app/
    App.tsx                # 路由与外壳
    routes.tsx
    Shell.tsx              # topbar/sidebar/rail/statusbar
  ui/                      # 组件(见 2.3)
  styles/                  # tokens.css / base.css / utilities.css
  features/
    chief/                 # 会话面(现有 ChiefApp/Transcript/... 迁入)
    projects/              # 项目与会话列表
    requirements/
    tasks/
    files/
    docs/
    agents/
    inbox/
    settings/
  state/                   # 现有 slot/useChiefSession + 新增资源 hooks
  api/                     # 现有 rpc/stream
  i18n/
```

### 3.2 路由

`react-router`(BrowserRouter,`basename="/app"`,服务端已有 SPA 回退):

```text
/                                   → 最近项目或欢迎页
/p/:projectId/c/:sessionId          → 会话
/p/:projectId/requirements          → 需求列表
/p/:projectId/requirements/:reqId   → 需求详情
/p/:projectId/tasks                 → 任务列表
/p/:projectId/tasks/:taskId         → 任务详情
/p/:projectId/files?path=…          → 文件
/p/:projectId/docs                  → 文档与知识
/p/:projectId/agents                → Agent/角色
/p/:projectId/inbox                 → 收件箱(恢复/阻断/待决定)
/p/:projectId/settings              → 设置
/design                             → 组件画廊
```

### 3.3 数据层

- 会话流:沿用 `useChiefSession` + `slot` reducer(已移植,有测试),不重写。
- 其余资源:每个资源一个 hook(`useProject`、`useSessions`、`useRequirements`、`useTasks`、`useTask`、`useFiles`),
  以 `invalidate` 帧驱动重取(与旧 `store.js` 的 `#emit` 语义一致),不做全局 store、不缓存跨项目。
- 提交/答复/控制:沿用 `rpc.call`,`csrf` 与 `requestId` 规则不变。

### 3.4 服务端缺口(需单独授权的小改动)

1. `project.list` 与 `session.list`:现在没有列表方法,项目切换器只能靠本地最近记录;多项目/多会话列表需要真实来源。
2. 若工作栏需要"待决定数量",确认 `session.get`/`task.get` 输出可满足;不足时只加字段,不加新协议。

### 3.5 构建与交付

- 开发:`npm run dev`(5183,代理 `/api`、`/i18n.json`、`/vendor` 到 4173)。
- 构建:`npm run build` → `web-static/app`(产物不入库,部署/启动前必须构建;`/app` 缺失时服务端返回 404)。
- 收口后:`/` 302 → `/app/`,删除 `devagent/web/` 与 `web-static/app` 之外的旧静态资源。

### 3.6 测试

| 层 | 方式 |
|---|---|
| 状态逻辑 | 现有 vitest(`slot`/`normalize`)+ 新增 hook 测试 |
| 组件 | 画廊页 + Playwright 截图快照(1440/1024/390 × 深/浅 × 全部路由) |
| 行为 | 现有 `browser/*.spec.ts` 迁移到 `/app/`:登录、开会话、发送、流式、交互答复、断线重连、任务卡 |
| 契约 | 提示词/文档校验脚本保持;新增 i18n 键一致性检查 |

## 4. 迁移矩阵(旧外壳 → React)

| 界面 | 旧外壳能力 | React 现状 | 目标 |
|---|---|---|---|
| 会话 | transcript、工具卡、阶段条、交互、发送/停止、快捷指令 | 有(缺阶段条、快捷指令、停止按钮位置) | 2.4 规格 |
| 需求 | 列表 + 详情 + 生命周期 | 无 | 文档化详情 + 列表 |
| 任务 | 列表、详情、成员、报告 | 仅会话内 TaskCard | 列表 + 详情 + 工作栏 |
| 文件 | 树 + 只读预览 | 无 | 树 + 预览 + 搜索 |
| 文档 | 知识索引 + 文件预览 | 无 | 索引 + 预览 |
| Agent | 角色配置查看/编辑 | 无 | 只读配置 + 会话 |
| 运行 | Live/Events/Artifacts 控制台 | 无 | 任务详情的"运行"抽屉 |
| 收件箱 | 恢复检查/待答/阻断 | 无(会话内有) | 全局待办 |
| 设置 | 模型/语言/项目 | 无 | 设置页 |
| 命令面板 | 有 | 无 | ⌘K 路由/会话/需求/任务/文件 |
| i18n | 有 | 无(硬编码中文) | 全量键 + 语言切换 |

## 5. 分期与验收

| 期 | 内容 | 验收(可观察) |
|---|---|---|
| P0 | 令牌 + base + 基础组件 + 外壳骨架 + 画廊页;修正连接状态机与状态条重叠 | `/app/#/design` 覆盖全部组件状态;1440/1024/390 截图;无重叠/无重复标题 |
| P1 | 会话面达标(分组、工具卡、决策卡、输入框、滚动、停止、空态) | 真实模型跑一轮讨论 + 一次交互答复 + 断线重连,观察流式与状态正确 |
| P2 | 工作栏(当前 Task、计划步骤、成员、待决定)+ 任务详情/列表 | 从会话打开 Task 看到步骤与证据;暂停/恢复状态可见 |
| P3 | 需求(列表/详情/生命周期)+ 文档/文件 | 从需求进入实现流程并回到会话,链接与状态一致 |
| P4 | 收件箱、Agent、设置、命令面板、运行抽屉 | 每条待办可定位到来源;⌘K 可达全部路由 |
| P5 | 浅色主题、响应式、可访问性、动效终检 | 对比度报告、键盘全流程、三档截图 |
| P6 | 切换收口 | `/` → `/app/`;删除 `web/`;Playwright 全绿;文档更新 |

## 6. 风险

| 风险 | 处理 |
|---|---|
| 迁移期两套外壳行为不一致 | 以 React 为唯一新增功能的落点;旧外壳只修阻断级缺陷 |
| 构建产物不入库,`/app` 缺失时 404 | P6 前在启动脚本/文档中明确"先 build";健康检查提示 |
| 会话流重写引入渲染抖动 | 不重写 `slot`/`useChiefSession`;只改表现层,截图与行为测试覆盖 |
| i18n 补键工作量大 | 以旧 `web/i18n.json` 为基线迁移,键名不变 |
| 服务端缺列表方法 | 单独小切片:`project.list`/`session.list`,只读、无新协议 |

## 7. 待决

1. 是否同意新增 `project.list` / `session.list`(多项目多会话列表需要真实数据源)。
2. 运行控制台(Live/Events/Artifacts)按方案降级为任务详情抽屉,还是保留独立视图。
3. 浅色主题放在 P5 终检,还是首版不做(减少工作量)。
