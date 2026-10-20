# Settlement Record · ui-refactor-20261021(文档对齐部分)

任务:UI 前端重构的项目记忆对齐。本轮只改文档与工作记录,不改业务代码。
背景:此前把"前端零构建、应保持 vanilla"当作事实写进了推断,实际 `devagent/webapp/` 已是 React 19 + Vite 7,
`/app/` 已由同一 Server 托管,session 记录也早已登记该事实,但 docs/INDEX 的"当前状态"仍写着"业务代码尚未实施"。

## stable_facts

| 事实 | 权威位置 |
|---|---|
| 前端为 React 19 + Vite 7 单页应用,产物托管于 `/app/`,`/` 仍是旧外壳 | `docs/technicalnew/architecture.md` A7 |
| 前端的数据来源只有 `/api/v1/rpc` 与 `session.stream.prepare` + SSE | 同上 |
| 迁移现状:只有主管会话面在新外壳,其余视图在旧外壳;入口收口前并存 | A7、`ui-design.md` U1/U8 |
| 界面契约(布局、令牌、组件、会话面、状态语言、迁移矩阵、门禁) | `docs/technicalnew/ui-design.md` U1–U9 |
| 产品层原则:主管对话为主入口,当前工作同屏可见 | `docs/productnew/README.md` 第 6 节 |
| 服务端缺项目/会话列表查询,多项目导航无真实列表来源 | A7、docs/INDEX 当前状态 |
| 文档索引不再宣称"业务代码尚未实施",改为指向验证记录逐包证据 | `docs/INDEX.md` 当前状态 |
| 主管与 designer 可用 bash 核实状态/整理文档(上一提交已实现并验证) | `validation.md` 实施证据表 |

## 变更清单

- `docs/technicalnew/architecture.md`:+A7 前端层(技术栈、入口、数据来源、产物、缺口)。
- `docs/technicalnew/ui-design.md`:新增契约 U1–U9。
- `docs/technicalnew/README.md`:链路表加前端行;当前架构补一条前端事实。
- `docs/technicalnew/validation.md`:实施证据表补工具集补齐一项。
- `docs/INDEX.md`:入口表加前端设计契约;重写"当前状态"(前端事实、实施状态口径、列表缺口)。
- `docs/productnew/README.md`:第 6 节补"主管对话为主入口 + 同屏当前工作"原则,布局细节指向技术契约。
- `.agentdev/work/ui-refactor-20261021/plan.md`:UI 重构计划(待授权)。

## verification

- 文档链接与标题锚点:28 份正式 Markdown 逐引用检查,缺失文件 0 / 缺失锚点 0。
- 新增/改动文档无超长段落(>400 字符)引入,与既有表格行一致。
- `webapp`:`tsc --noEmit` 0;`vitest` 16/16;`vite build` 成功(产物 422 kB / CSS 11.5 kB)。
- 文档所引代码事实逐条核对:Vite 配置、`/app` SPA 回退、`.gitignore` 产物、RPC 方法清单(缺 `project.list`/`session.list`)。

## evidence_boundary

- 本轮未执行浏览器端验收;`/app` 现有界面问题(状态条文字重叠、本地残留会话导致永久"正在连接")已在计划中登记,尚未修复。
- 未做独立审阅:本轮为文档对齐,未改变协议与工具契约;若需要按交付流程走独立 Review,应在 UI 实施前补一次。
- `ui-design.md` 是待实现契约,不代表界面已达标。

## archived

- `.agentdev/work/ui-refactor-20261021/`

## completion_gate

- 文档对齐:passed(边界如上)。
- UI 重构本身:未开始,状态为 `Awaiting Plan Confirmation`。
