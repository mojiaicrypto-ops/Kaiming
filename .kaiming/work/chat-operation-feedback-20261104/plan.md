# 聊天操作反馈与队列内容 - 计划

## 目标

用户点击 STOP、任务暂停/继续、手动压缩后，按钮立即显示处理中并禁用，不等到下一次轮询或事件才变化。运行中提交的聊天消息立即出现在队列里，显示用户写的正文（和图片数量），不再显示内部 inputId；刷新后仍一致。

## 事实与根因

- STOP 只有服务端 `session.input.stop` 返回后才会让 `busy` 变化；请求等待运行停稳期间，按钮仍是 STOP。
- Task 暂停/继续由 `ChatPage` 直接发 RPC，没有局部 pending 状态；任务条仍显示旧状态，直到 Task 推送或 3s 轮询。
- 手动压缩已有 `busy` 状态和“Compacting…”，但按钮没有 `aria-busy`/忙碌样式，用户看不到除文字外的等待反馈。
- `session.input.submit` 只对“未带 taskId 且会话有当前 Task”的输入返回 `waitingForTask`；用户正在运行中带 taskId 的补充消息实际排队，却不返回排队原因，前端因此不加入 `queuedInputs`。刷新时快照才显示。
- `session.stream.prepare` 的 `inputs` 只有 id/status，前端队列只能显示 id；服务端已保存 payload 正文和图片引用。

## 实现

### 服务端

- `session.input.submit`：只要会话有 `currentTaskId`，响应带 `waitingForTask`（不再限定调用方未带 taskId），让任务内补充消息也能立即标明排队。
- `session.stream.prepare` 快照的 queued inputs 附带 `text` 与 `imageCount`，由 `partsOfPayload` 从已保存 payload 读取；不新增业务状态。

### 前端

- `PreparedSnapshot.inputs`/`SessionSlot.queuedInputs` 增加 `text`、`imageCount`。
- `inputQueued` 接受正文；submit 在 `waitingForTask` 或提交前会话非 idle 时立即登记队列。`turn_start`/`message_start` 按 `frame.inputId` 移除对应队列行。
- `QueuedInputs` 显示正文（空正文时显示图片数量占位），隐藏 inputId；撤回按钮点击后立即显示“撤回中…”并禁用。
- `Composer` STOP 点击后立即显示“正在停止…”并禁用，失败恢复原按钮并保留错误样式；服务端进入 `stopping` 时同样显示处理中。
- `TaskStrip` 增加 `pending: 'pause' | 'resume' | null`；暂停/继续点击立即显示 Pausing/Resuming 状态并禁用按钮；`ChatPage` 在 RPC 返回后刷新 Task，失败提示并恢复。
- `ContextMeter` 压缩按钮增加 `aria-busy` 与忙碌样式，保持已有“压缩中…”。

## 非目标

- 不改变排队顺序、Task 关联或服务端调度规则。
- 不新增“重新开始篇 Task”状态；已有 Resume 语义不变。
- 不改模型、不新增数据库字段或迁移。

## 验证

- webapp 单测：队列正文/图片、turn_start 移除、TaskStrip pending、STOP pending 渲染、压缩 busy 属性。
- 服务端定向测试：带 taskId 的 submit 返回 waitingForTask；prepare 快照 queued input 带正文与图片数量。
- 真实浏览器：运行中发送第二条消息，不刷新即可看到正文队列行且无 inputId；点击 STOP 立即显示停止中。
- `tsc` 两侧、webapp build；独立 Review/Test 后结算。
