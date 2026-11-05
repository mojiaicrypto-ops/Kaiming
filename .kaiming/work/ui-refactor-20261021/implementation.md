# Implementation Summary · ui-refactor-20261021

日期：2026-10-21。状态：Develop 完成，等待独立复审。

## 1. 改动清单

### 1.1 新增（`devagent/webapp/src/`）

| 路径 | 职责 |
|---|---|
| `app/App.tsx` | 外壳：一个 RPC 客户端、一个 workspace、一个 chief session、三屏路由 |
| `app/TopBar.tsx` | 字标 / 项目切换 / 三个导航标签 / 连接态 |
| `app/StatusBar.tsx` | 项目路径 / 分支 / 运行中 Agent 数 / 快捷键 |
| `app/ProjectDialog.tsx` | 最近项目 + 路径输入 |
| `app/Drawer.tsx` | 唯一抽屉形状（Esc / scrim / 窄屏全宽） |
| `app/State.tsx` | 状态符号 + 词（唯一状态渲染入口） |
| `app/router.ts` | pushState 路由、`?selected=`、1/2/3/i 快捷键 |
| `app/usePreferences.ts` | 语言 / 主题（含跟随系统）/ 密度 |
| `theme/tokens.css`、`theme/base.css` | 令牌与组件样式，照 `docs/design/tui/tui.css` |
| `i18n/catalog.ts`、`i18n/I18nProvider.tsx` | en / zh-CN 同源常量，占位符替换 |
| `layout/useTier.ts` | `matchMedia` 单一视口来源 |
| `lib/storage.ts` | 不会让外壳崩溃的 localStorage 访问 |
| `lib/ToastHost.tsx` | 模块级 toast 总线渲染 |
| `chat/*`（18 个文件） | 会话列、横幅、任务条、转录、消息、思考、Markdown、工具四类、问题面板、队列、输入框、空态、成员抽屉 |
| `requirements/requirement-model.ts`、`RequirementsPage.tsx`、`RequirementDrawer.tsx` | 四列看板、两型抽屉、无效件 |
| `settings/config-model.ts`、`SettingsPage.tsx`、`ProvidersPage.tsx`、`ModelsPage.tsx`、`AppearancePage.tsx` | Provider 列表与新增、角色模型（全局/本项目）、主题/语言/密度 |
| `auth/LoginPage.tsx` | 访问口令 |
| `state/useSession.ts`、`state/useWorkspace.ts` | 会话实时状态、项目与会话选择 |

### 1.2 修改

| 路径 | 改动 |
|---|---|
| `src/server/http.ts` | 去掉 `/app` 静态分支；`/app*` 301（保留查询串）；`/` 与客户端路由回退 `index.html`；API 路径不回退 |
| `src/server/main.ts` | `staticDir` 指向 `web-static`，删除 `appStaticDir` 探测 |
| `src/server/read-methods.ts` | `session.get` 增加 `lastActivityAt`（由输入行派生） |
| `src/store/store.ts` | `listSessions` 返回 `updatedAt` |
| `webapp/vite.config.ts` | `base:'/'`、产物到 `../web-static`、代理只留 `/api` |
| `webapp/index.html`、`main.tsx` | 新入口与令牌样式表 |
| `webapp/src/api/rpc.ts` | `onUnauthorized` 可注入；`csrfToken` 只读访问；storage 防护 |
| `webapp/src/state/slot.ts` | 沿用；删除未使用的 `at/phases/note` 增补 |
| `package.json` | 新增 `build` 脚本（`webapp` 构建） |
| `README.md` | 命令表加入 `npm run build`，删除旧外壳样式核对命令 |
| `.gitignore` | 说明 `web-static/` 为构建产物，非提交物 |

### 1.3 删除

`devagent/web/` 整目录（app.js、views、components、core、styles、vendor、i18n.json）、`web-static/app/`、`webapp/src/components/*`、`webapp/src/styles.css`、`webapp/src/state/useChiefSession.ts`、`spikes/web-01-renderers.ts`（依赖已删目录）。

## 2. 可观察行为

| 编号 | 结果 | 证据 |
|---|---|---|
| A1 | `/` 即新壳；`/app`、`/app/x`、`/app/x?q=1` → 301 同路径 | `test/server.test.ts` |
| A2 | 顶栏五项；导航为文字标签；当前项 `aria-current` | `browser/smoke.spec.ts` |
| A3 | 状态栏：路径 / 分支 / 运行中数 / 快捷键 | 同上 + 截图 |
| A4 | 会话列（派生标题 + 状态符号 + 相对时间 + 新建）、横幅、任务条、转录、问题面板、队列、输入框、成员抽屉 | `browser/smoke.spec.ts`「task strip」「five viewports」 |
| A5 | 消息 9 类 + 工具/业务对象 10 类 | `chat/MessageItem.tsx` 分支 + `browser/acceptance.spec.ts` |
| A6 | R1–R15 保留（见 §3） | 见 §3 落点 |
| A7 | 需求四列 + 无效件通知 + 两型抽屉（含 `范围`/`行为与异常`） | `requirements/*` |
| A8 | 设置三页；Appearance 含主题/语言/密度；Providers 可新增并试连 | `settings/*` |
| A9 | 语言即时切换；两语键与占位符一致 | `test/web-i18n-keys.test.ts` |
| A10 | 1440 / 1024 / 860 / 390 / 320 无横向溢出且控件可达 | `browser/smoke.spec.ts` |
| A11 | 旧壳目录与产物不存在 | `git status`、`grep` |
| A12 | 浏览器场景迁移后全绿 | `npx playwright test` 13 用例 |

## 3. R1–R15 落点

| 编号 | 落点 |
|---|---|
| R1 快照合并 | `state/slot.ts`（沿用） |
| R2 归一化边界 | `state/normalize.ts`（沿用） |
| R3 增量流式 | `state/slot.ts`（沿用） |
| R4 结果按 callId 回填 | `chat/transcript-model.ts:indexToolResults` + `MessageItem` |
| R5 上滚锁定 | `lib/scroll.ts` ∈ `chat/ChatPage.tsx` |
| R6 高亮预算 | `lib/highlight-queue.ts` ∈ `chat/Markdown.tsx` |
| R7 交互生命周期 | `chat/InteractionPanel.tsx`（busy → echo → stale + 重试 → 失败）+ `ChatPage.answer` |
| R8 队列输入 | `chat/QueuedInputs.tsx` |
| R9 提交带 taskId | `state/useSession.ts:submit` |
| R10 失败保留草稿 | `chat/Composer.tsx` |
| R11 IME | `chat/Composer.tsx` |
| R12 成员抽屉独立槽 | `chat/MemberDrawer.tsx` |
| R13 连接四态 | `state/useSession.ts` + `chat/Banner.tsx` |
| R14 历史读取警告 | `chat/Banner.tsx` |
| R15 任务实时状态 | `state/useSession.ts` 3s 轮询 + `chat/TaskStrip.tsx` |

## 4. Plan 偏差

| 偏差 | 原因 |
|---|---|
| 新增 `state/useWorkspace.ts`（Plan 未列） | 项目/会话选择与会话派生标题需要一个宿主，否则散落在 App 里 |
| `session.get` 增加 `lastActivityAt` | A4 要求会话相对时间，而服务端原先没有活动时间戳；选择由现有输入行派生，不新增表列 |
| 需求/设置屏在本轮一并交付 | Plan 曾把 S5/S6 列为本轮 8 步之内，按此执行 |
| `spikes/web-01-renderers.ts` 删除 | 它只测已删除的 `web/vendor` |
| 项目对话框用"最近项目 + 路径" | 服务端无 `project.list`（记为缺口） |

## 5. 剩余风险

| 风险 | 处置 |
|---|---|
| 会话标题靠首条用户消息派生，服务端无标题字段 | 界面回退"新会话"；记录为后端缺口 |
| 无 `project.list` | 项目菜单用本地最近记录 + 手输路径 |
| `config.matrix`（项目×角色）不存在 | Models 页按角色读 `config.get` + 作用域开关；只支持 role / project 两档 |
| 任务成员状态靠 3s 轮询 | 与服务端契约一致；无推送是已知缺口 |
| 需求抽屉底部动作只提示、不发送 | 本轮不引入"从看板直接开会话"的新交互；文案已改为"请在会话里请主管…"，不谎称已发送 |
| `web-static/` 不入库 | `npm run build` 是测试前置；`workbench-entry` 测试在缺产物时**失败**并提示 |
