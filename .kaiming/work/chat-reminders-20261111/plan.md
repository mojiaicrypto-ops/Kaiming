# 对话完成与问题提醒

## 用户确认的行为

- 当前会话从运行中结束、且没有待回答问题：弹一次“对话已完成”。
- 出现新的待回答问题：弹一次“有新的问题需要回答”。
- 页面在聊天屏且窗口聚焦时用页内 toast；窗口不可见、失焦或不在聊天屏时优先用浏览器通知（已授权时），否则仍用 toast。
- 首次发送消息时请求浏览器通知权限；拒绝/不支持时仅保留页内提醒。

## 实现范围

- `webapp/src/state/reminders.ts`：纯状态差分 + React hook；按会话重置，避免首次快照重复提醒。
- `webapp/src/lib/notifications.ts`：权限、浏览器 Notification、点击聚焦。
- `webapp/src/chat/ChatPage.tsx`：发送时请求一次通知权限。
- `webapp/src/app/App.tsx`：在 shell 层挂载提醒；点击通知进入聊天。
- `webapp/src/i18n/catalog.ts`：中英文文案。
- 单测覆盖完成、问题、同一回合两者、会话切换、首次快照与排队转换。

## 非目标

- 不订阅非当前会话；不新增通知设置页；不做 Service Worker/离线推送。
- 不在后台轮询；仍以现有 session stream 的事实为准。

## 验收

- `npm --prefix webapp test`、`npm --prefix webapp run typecheck`、`npm --prefix webapp run build`。
- 纯差分测试证明首次快照、完成、问题、排队/停止转换不误报。
