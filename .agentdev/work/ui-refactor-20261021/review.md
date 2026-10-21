# Review · ui-refactor-20261021

两轮独立审阅：会话与开发对话隔离，只读，各自给出结论。

## 第一轮

```yaml
review:
  round: 1
  reviewer_session: IndependentReview
  context_snapshot: plan.md + git diff + 设计原型；未含开发对话
  result: failed
  findings:
    - { severity: blocking, id: B1, location: state/useSession.ts, evidence: 无人调用 refreshTask，无 setInterval，任务条/运行数/成员跟随全部为空, remediation: 恢复 3 秒轮询 }
    - { severity: blocking, id: B2, location: chat/InteractionPanel.tsx, evidence: stale 卡片被整条过滤，用户答复丢失且无提示, remediation: 显示 stale + 重试 }
    - { severity: blocking, id: B3, location: settings/ModelsPage.tsx, evidence: 只读 chief 角色，其他角色恒显示默认且保存后无变化, remediation: 每角色各读 config.get }
    - { severity: blocking, id: B4, location: requirements/RequirementDrawer.tsx, evidence: 范围/行为与异常 无映射，正文被丢弃, remediation: 补键与映射 }
    - { severity: blocking, id: B5, location: theme/base.css, evidence: 样式指向 .md-h1/.md-list 等渲染器从不输出的类；代码块无 overflow, remediation: 改为按元素选择并加 overflow }
    - { severity: blocking, id: B6, location: theme/base.css, evidence: ≤860 覆盖使顶栏无法收缩，320/390 上切换按钮被裁切；≤560 隐藏连接词, remediation: 允许收缩 + 独立类 }
    - { severity: blocking, id: B7, location: chat/SessionsList.tsx, evidence: 会话列表无相对时间（A4 要求）, remediation: 用服务端活动时间渲染 }
    - { severity: blocking, id: B8, location: settings/ProvidersPage.tsx, evidence: "添加服务"只重新拉取，不新增, remediation: 实现最小新增表单 }
    - { severity: blocking, id: B9, location: app/router.ts, evidence: 状态栏宣传 1/2/3/i，实际无实现, remediation: 实现快捷键 }
    - { severity: non-blocking, id: N1..N13, location: 多处, evidence: 301 丢查询串、死字段、抽屉竞态、误报"已发送"、读失败伪装空态、storage 未防护、未翻译枚举、无焦点陷阱、非会话页的抽屉按钮、被判通过的空测试、死代码、API 路径回退 index.html }
  notes: R1–R15 逐项核对通过；单 RpcClient、CSRF、快照合并、静态路由与控制流均被确认无问题
```

处置：全部修复（见 `implementation.md`），并为每个修复补可失败的测试。

## 第二轮

```yaml
review:
  round: 2
  reviewer_session: VerifyFixes
  result: failed
  findings:
    - { severity: blocking, id: F1, location: requirements/RequirementDrawer.tsx, evidence: 提案格式是 目标/来源与决定/处理记录，抽屉仍按 意图/来源/未知 取，提案正文全丢, remediation: 按服务端模板改章节并显示额外章节 }
    - { severity: blocking, id: F2, location: state/useSession.ts, evidence: Task 由主管工具创建时不发 invalidate，本会话内新建的 Task 不会被发现，任务条/运行数/成员跟随仍缺, remediation: 运行中反复读 session.get 发现 Task }
    - { severity: non-blocking, id: F3, location: chat/ChatPage.tsx, evidence: 切换会话后已回答卡片与成员抽屉残留, remediation: 按 sessionId 重建 }
    - { severity: non-blocking, id: F4, location: chat/InteractionPanel.tsx, evidence: 换题后草稿未清，界面上看不到却会被发送, remediation: 换题清空草稿 }
    - { severity: non-blocking, id: F5, location: app/router.ts, evidence: 问题面板打开时 1/2/3 仍会跳转（原型有守卫）, remediation: 有问题面板时跳过 }
```

处置：F1–F5 全部修复，F1/F2 各配浏览器用例；F3/F4/F5 见 `test.md` 的手工验证记录。

## 结果

```yaml
result: passed
basis:
  - 两轮全部 blocking 发现已关闭，并有可失败的测试
  - npx playwright test: 15 passed
  - npm test: 291 passed（26 files）；npm --prefix webapp test: 27 passed（3 files）
  - tsc（服务端与外壳）无输出
```

未由独立审阅判定的部分（记录为风险，不记通过）：真实模型下的完整 J-01～J-10 流程；触屏手势；320px 以下的可用性。
