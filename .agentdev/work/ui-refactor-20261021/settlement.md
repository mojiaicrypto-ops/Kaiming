# Settlement · ui-refactor-20261021

日期：2026-10-21。

```yaml
settlement:
  task: ui-refactor-20261021
  stable_facts:
    - 浏览器外壳只有一套：React 19 + Vite，构建产物由同一 Server 托管在 /（旧无构建外壳已删除）
    - /app/* 301 到同路径（保留查询串）；未知无扩展名路径回退 index.html；API 路径从不回退
    - 现有 chat 渲真能力（快照合并、增量流式、工具结果配对、滚动锁定、高亮预算、交互生命周期、队列输入、提交带 taskId、草稿保留、IME、成员抽屉、连接四态、历史警告、任务轮询）在新外壳中逐条保留
    - 界面文案唯一来源是 webapp/src/i18n/catalog.ts，en/zh-CN 键与占位符由测试强制一致
    - 会话标题由首条用户消息派生（服务端不存标题）；活动时间由 session.get 的 lastActivityAt 派生
    - 任务成员状态由 3 秒轮询 task.get 提供；运行中若无 Task 则轮询 session.get 以发现新建 Task
    - 设计语言（直角、1px 线、单一强调色、符号+文字状态、等宽代码/无衬线中文）以 docs/design/tui 为准
  updated:
    - docs/technicalnew/ui-design.md        # 整页重写为已实现契约（布局、令牌、组件、断点、门禁）
    - docs/technicalnew/architecture.md     # A7 前端层改为单入口
    - docs/technicalnew/validation.md       # 本轮证据与未覆盖项
    - devagent/README.md                    # 命令表加入构建，删除旧外壳样式核对
    - devagent/src/server/read-methods.ts   # session.get 增加 lastActivityAt
    - devagent/src/store/store.ts           # listSessions 返回 updatedAt
  indexes_updated:
    - docs/INDEX.md（未改：入口未变，仍指向 productnew / technicalnew）
  archived:
    - .agentdev/work/ui-refactor-20261021/requirements.md
    - .agentdev/work/ui-refactor-20261021/tui-shell.md
    - .agentdev/work/ui-refactor-20261021/responsive.md
    - .agentdev/work/ui-refactor-20261021/context.md
    - .agentdev/work/ui-refactor-20261021/plan.md
    - .agentdev/work/ui-refactor-20261021/implementation.md
    - .agentdev/work/ui-refactor-20261021/review.md
    - .agentdev/work/ui-refactor-20261021/test.md
    - .agentdev/work/ui-refactor-20261021/settlement.md
  proposed_for_confirmation:
    - 后端缺口：project.list（项目菜单目前用本地最近记录 + 手输路径）
    - 后端缺口：任务创建/成员变化无推送，界面只能轮询
    - 后端缺口：config.matrix（项目 × 角色）不存在，Models 页只有全局/本项目两档
    - 决策：web-static/ 不入库，构建是测试前置（workbench-entry 测试在缺产物时失败）
    - 决策：需求抽屉底部动作只提示"在会话里请主管…"，不实现从看板直接开会话（文案已改为不谎称已发送）
  no_change:
    - docs/productnew/**（本轮是技术实现，产品行为未变）
    - RPC 信封、错误码、WAL/交互桥、恢复语义
    - 存储表结构（未新增列）
  completion_gate: passed
```
