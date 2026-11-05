# Settlement · workbench-gaps-20261022

日期：2026-10-22。计划：`plan.md`（A–G 全做、U4/U5 只登记、阅读器只读）。

```yaml
settlement:
  task: workbench-gaps-20261022
  status: completed
  stable_facts:
    - 会话列由 session.list 一次取齐（标题由首条用户输入派生、60 码点截断）；标题不落库
    - 项目菜单只来自 project.list；浏览器不再保存"最近项目"
    - activity 统一为 idle/queued/processing/stopping，快照与读取面同一个词
    - 会话/输入的 config 只回 providerId/modelId/source；服务端目录不进入任何响应
    - Task 工具变更后由服务端推送 invalidate{task}/{session}；轮询退化为可见时的兜底
    - 转录只显示尾部 100 条；更早内容由 session.messages.list 的 before/previousCursor 提供
    - 报告正文经 task.report.get 读取记录的文件；服务端工作区路径不显示
    - 需求抽屉不代发消息：只填入 composer
    - 模型设置的项目范围写入 {projectId}，全局范围按角色写入
  updated:
    - docs/technicalnew/runtime-contract.md   # project.list/session.list/activity/config/before 分页
    - docs/technicalnew/ui-design.md          # 门禁前置构建、U9 方法消费表
    - docs/technicalnew/gap-register.md       # 本轮结果、逐项关闭、U4/U5 待确认
    - docs/technicalnew/validation.md         # 本轮证据与未覆盖项
    - docs/INDEX.md                           # 缺口登记入口、前端现状
    - docs/technicalnew/README.md             # 缺口登记入口、单入口表述
    - devagent/package.json                   # test:browser 先构建再跑
  commits:
    - 2e001b6 docs: register the gaps the shipped shell still has, and the plan to close them
    - 59efcb2 docs: record the unreachable history as a gap
    - 764c76f docs(plan): say what config travels
    - 825e08c docs(plan): approved - A to G, questions only, reader read-only
    - 52106ac feat: list projects and sessions server-side, and push Task changes
    - 34e7630 fix(webapp): make the model scope save what it shows, and hand requirements over
    - eaacbfd feat(webapp): read project files, task reports and earlier history
    - 8183fe0 feat: rebind, task list, focus, error copy, and the review fixes
    - 817dcd2 fix(webapp): make a block reachable, and stop sending into a closed stream
  evidence:
    - tsc -p tsconfig.json --noEmit：无输出
    - npm --prefix webapp run typecheck：无输出
    - npm test：26 文件 300 用例
    - npm --prefix webapp test：3 文件 25 用例
    - npm run test:browser：29 用例
    - npm run check:model：4/4（真实模型 deepseek/deepseek-flash）
    - npm run check:runtime：4/4（真实运行）
    - 独立审阅两轮（新上下文、只读）：均 passed，无阻断；第一轮 9 项非阻断全部修复
  archived:
    - .agentdev/work/workbench-gaps-20261022/plan.md
    - .agentdev/work/workbench-gaps-20261022/implementation.md
    - .agentdev/work/workbench-gaps-20261022/review.md
    - .agentdev/work/workbench-gaps-20261022/test.md
    - .agentdev/work/workbench-gaps-20261022/questions.md
    - .agentdev/work/workbench-gaps-20261022/settlement.md
  decided:
    - U4 恢复核实：简单形态（横幅 + 交回主管），已实现
    - U5 会话清理：会话列行内两步确认，已实现
  proposed_for_confirmation:
    - 阻断原因是否落库（当前在 Server 内存）
    - 多页前插的自动化：需要一种能重置会话运行实例的测试手段，当前只能在服务端层验证分页
    - 阻断原因目前保存在 Server 内存（进程重启后需要一次真实运行才会重新出现）：是否需要落库
    - 真实模型下的完整 J-01～J-10 仍未执行
  no_change:
    - docs/productnew/**（本轮只实现，不改产品行为）
    - RPC 信封、错误码集合、WAL/恢复语义
    - 存储表结构（无新增列；模型覆盖仍是 (scope, scopeId)）
  completion_gate: passed
```

## 关闭的缺口

D1–D9、S1–S4、C1–C4、U1–U8、U10：全部关闭，逐项处置见 `gap-register.md`。
U9、S5：维持"不做"及其理由。
U4、U5：按用户决定采用简单形态并实现（`questions.md` 记录了决定与边界）。
