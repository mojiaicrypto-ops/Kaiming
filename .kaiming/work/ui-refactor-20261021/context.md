# Context Snapshot · UI 一次性重构

```yaml
context_snapshot:
  task: ui-refactor-20261021
  stage: Planning
  agent_profile: planning
  model: parent session (single-writer workspace)
  sources:
    - path: docs/INDEX.md                      reason: 文档入口
    - path: docs/productnew/README.md          reason: 产品定位与模块
    - path: docs/productnew/acceptance.md      reason: 验收场景
    - path: docs/technicalnew/ui-design.md     reason: 现有前端契约（需被本轮替换）
    - path: docs/technicalnew/architecture.md  reason: A7 前端层现状
    - path: docs/design/tui/tui.css            reason: 设计基准（权威）
    - path: docs/design/tui/app.js             reason: 三屏布局与交互（权威）
    - path: docs/design/tui/chat-*.js          reason: 会话页区域与渲染类型（权威）
    - path: docs/design/tui/data.js            reason: 数据形状
    - path: devagent/webapp/src/**             reason: 现有 chat 渲染能力（必须保留）
    - path: devagent/src/server/http.ts        reason: 静态服务与 /app 分支
    - path: devagent/src/server/main.ts        reason: staticDir 装配
    - path: devagent/src/server/read-methods.ts reason: project.get / session.get 字段
    - path: devagent/src/store/store.ts        reason: sessions 表结构（无 title）
    - path: devagent/browser/*.spec.ts         reason: 现有浏览器验收（需迁移）
    - path: devagent/web/i18n.json             reason: 236 键双语文案基线
  rules:
    - AGENTS.md（仓库规则：以 docs/productnew + docs/technicalnew 为实现依据）
    - skill:agentdev-project-workflow
  code_scope:
    - devagent/webapp/
    - devagent/web/            (删除)
    - devagent/web-static/     (删除产物)
    - devagent/src/server/http.ts
    - devagent/src/server/main.ts
    - devagent/browser/
  excluded:
    - devagent/web/app.js 与 views/*   (用户明示：不看壳代码，避免幻觉)
    - docs/old/ docs/architecturenew/ oldcode/
    - .agentdev/work/ 历史任务（仅作格式参考）
  user_decisions:
    - 照 docs/design/tui 严格实现；TUI 没有的按其风格补
    - 保留 webapp 现有 chat 渲染"效果"，不保留其样式
    - 一次性重构，不留旧壳，不灰度
    - 术语改行业通用叫法：Providers / Models / Appearance / Test connection
    - 必须多语言（en / zh-CN）
    - 必须响应式
  unresolved_gaps:
    - project.list / session.list 富字段缺失（本轮不改后端）
    - config.matrix（项目×角色覆盖）缺失
    - TUI 原型的"原型控制"面板（不实现）
```
