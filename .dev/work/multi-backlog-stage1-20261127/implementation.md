# Implementation - 阶段 1 单 Task 多待办准入

## 实际改变

- `docs/productnew/modules/delivery.md`、`backlog-and-specs.md`、`journeys.md`：加入多待办合并的准入条件（同一实现目标、同一 `workKind`、共同验收、相同验证档、正交写面）；不满足则顺序 Task 或新主管 Session。
- `docs/technicalnew/prompts/chief.md`：主管在一次性收到多条待办时先做同一组判断，再做单 Task 的 `parallel`/`serial` Plan。
- `kaiming/test/task-backlog.test.ts`：BACKLOG fixture 增加第二条 open 项 B-5；新增 n=2 创建用例，断言 Task 精确保留 `['B-1','B-5']`。
- 新增 n=2 负向控制：`['B-1','B-2']`（B-2 done）拒绝建 Task、不留 Task 行，随后单独 `['B-1']` 仍可创建。

## 验证

- `npx vitest run test/task-backlog.test.ts --reporter=verbose`：7/7 passed。
- `npm run typecheck`：passed。
- `npm run check:prompts`：15/15 passed。

## 未改变

- 不改运行时分支、Task 阶段、数据库或 Worktree。
- 不把“文件不重叠”当作唯一合并条件。
