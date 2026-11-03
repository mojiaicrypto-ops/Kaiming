# 多会话切换后 Task 残留 — 修复计划

## 现象

在会话 A（有 Task `t-db45d0ce`）和会话 B（无 Task）之间切换后，前端仍显示 A 的 Task 条、成员和运行状态；页面 URL/workspace session 已是 B。

## 根因

`useSession` 的 Task 状态（`activeTaskId`、`taskDetail`）没有按 session 归属清理：会话切换只 reset 了 chat slot；`activeTaskId` 保留旧值，Task 轮询继续读取旧 Task，或旧的 `session.get`/`refreshTask` 回包在新会话中写入。`ChatPage` 也不是按 session 重挂载，局部 UI（Task 弹层、follow 等）可能继承。

## 方案

1. 为 Task 状态记录所属 `taskSessionId`；新 session 的渲染只接受 `taskSessionId === sessionId` 的 Task detail/activeTaskId。
2. 切换 session 时清空 `activeTaskId`/`taskSessionId`；旧 `refreshTask` 回包按当前 session id 丢弃；旧 stream/snapshot 用 generation 守卫。
3. 新 session 的 `session.get` 明确清空 Task（原来 null 直接 return）。
4. `ChatPage` 以 sessionId 为 key 重挂载，清理 Task 弹层/follow 等局部状态。
5. 抽出 `taskForSession` 纯函数并补回归测试；真实浏览器复现/验证。

## 验证

- `task-scope.test.ts`：旧 session 的 Task detail/active id 在新 session 为 null；同一 session 保留。
- webapp `tsc`、build。
- 真实浏览器：任务会话显示 `t-db45d0ce`；切到无任务会话后 active/detail/task DOM 均为 null；切回恢复。
