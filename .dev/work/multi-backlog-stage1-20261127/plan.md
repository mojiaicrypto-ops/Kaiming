# Plan - 阶段 1：单 Task 多待办准入与回归

## 目标

把“同一实现目标、同一 workKind、共同验收、相同验证档、写面正交”的多待办准入规则写入产品/主管契约，并用 n=2 的 Task 创建测试证明现有 `backlogIds` 关联可用；不引入 Worktree 或新状态。

## 范围

- `docs/productnew/modules/delivery.md`、`backlog-and-specs.md`、`journeys.md`。
- `docs/technicalnew/prompts/chief.md`。
- `kaiming/test/task-backlog.test.ts` 的 n=2 关联测试。

## 验证档

`focused`：只改准入文案与 backlog 关联测试；不改运行时分支、Task 阶段或数据库结构。开发者运行 `task-backlog.test.ts` 与 typecheck；独立 Test 覆盖同一验收，不跑全量。

## 验收

- 产品/主管文档明确：多条待办合并为一个 Task 需要同一实现目标、同一 workKind、共同验收、相同验证档、正交写面；否则顺序 Task 或新主管 Session。
- 一个 write Task 同时携带两个 open backlogIds 时创建成功，`task.backlogIds` 精确保留两项。
- 原有单待办、缺项/关闭/损坏/read Task 拒绝行为不变。

## 不做

- 不实现 Worktree、迁移、调度配额或 UI。
- 不把“文件不重叠”当唯一合并条件。
- 不修改 P3-2/P3-3 标记为已实施。
