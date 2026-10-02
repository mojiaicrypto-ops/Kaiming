# 消息与事件需求

## MSG-01 请求与响应

用户 API 使用点分方法名；Pi 注册工具使用下划线名（如 API task.get 对应工具 task_get），action 类型独立使用点分业务名。第一版提供 `POST /api/rpc`，请求统一为以下格式；客户端生成 UUID id，重试同一操作保留 id。用户身份由 Server 认证，不接受载荷中自称的用户身份。

```json
{"v":1,"id":"request-uuid","method":"session.send","params":{"projectId":"project-uuid","sessionId":"session-uuid","text":"将讨论保存为需求","mode":"follow_up"}}
```

```json
{"v":1,"id":"request-uuid","ok":true,"result":{"accepted":true,"inputId":"input-uuid"}}
```

```json
{"v":1,"id":"request-uuid","ok":false,"error":{"code":"PROVIDER_UNAVAILABLE","message":"主管模型不可用","retryable":true,"details":{"sessionId":"session-uuid"}}}
```

accepted 表示输入已经持久接收，不表示模型执行或业务保存成功。相同 id+相同参数返回此前接收/执行结果，不再次发送；相同 id 参数不同返回 IDEMPOTENCY_CONFLICT。查询也使用同一封套，但不复用写操作 id。

## MSG-02 会话输入与 Pi 载荷

session.send 参数为 projectId、sessionId、text、mode。text 为非空字符串；mode=follow_up（默认）或 steer。idle 时开始一轮，busy 时按 mode 排队/插入，不再开第二个同 Session 执行。mode 不改变业务授权含义，主管理解用户意图。

使用 Pi 用户/助手消息、content blocks、工具调用/结果及事件作为 payload，不重新定义模型对话格式。包装只加身份和来源；phase 身份在有 task/step 时提供。

消息类事件封套另含稳定 messageId；完整消息查询返回 `{items:[{messageId,entryId,payload}],nextCursor}`，payload 仍为 Pi Message。适配器将进行中的显示身份与结束后 Pi entry 关联，同一消息重查/重连保留 messageId；不能因再次查询生成重复聊天行。

Server 对项目/Session 归属逐次校验，错误返回 IDENTITY_MISMATCH。用户输入、action 答复和子结果通知先持久再投递；等待 Provider 时留在队列，不丢弃。

## MSG-03 两类事件与重连

WebSocket `/api/events` 接受 `events.subscribe {projectId,sessionIds}`。使用成熟 WebSocket 库处理连接/帧。第一版重连获取快照，不承诺回放每个 token。

```json
{"v":1,"seq":12,"source":"pi","projectId":"project-uuid","sessionId":"session-uuid","taskId":"task-uuid","stepId":"step-uuid","payload":{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"正在检查"}}}
```

```json
{"v":1,"seq":13,"source":"server","projectId":"project-uuid","payload":{"type":"task.changed","taskId":"task-uuid","version":8}}
```

seq 在同一连接内严格递增，重连重新开始。Server 注册订阅、缓存其后的事件，再发送第一个 server `snapshot`（项目、Session/task/action 真实状态及消息查询游标），随后释放事件缓存。实体事件带 version，客户端忽略已被快照覆盖的版本；Pi 消息按 message ID 合并，已结束的消息从 Pi 文件查询。

source=pi 描述生成、工具、队列、压缩和一轮过程。message_end 的完成消息可展示为完整内容；一轮结束不改变 task.completed。source=server 的固定类型为 snapshot、project.changed、project.files_changed、session.changed、task.changed、step.result、action.changed。均在程序保存结果后发布。

连接丢失显示“连接中断，后台状态待刷新”，不能显示任务停止。重新订阅后查询需求文件和必要消息；未结束的增量仅为临时显示，不能当业务证据。发现 seq 缺口或事件队列溢出时重新获取快照，不猜测遗漏事实。客户端断开不取消 Session/task。

## MSG-04 action 的固定执行入口

模型通过 user_request 创建 action。UI 只展示 title/text/choices，点击提交 `action.respond {actionId,choiceId,text?}`，不执行模型代码或拼接任意 RPC。

| type | payload 必需内容 | 用户同意后的主管指令 |
|---|---|---|
| requirement.create | textSnapshot、sourceRefs | 按需求规则将这个确定内容加入队列，保存后报告真实结果 |
| task.start | requirementPath、expectedHash | 按任务规则实施该需求；先读取当前文件核对 |
| decision.respond | taskId?、question、proposal、sourceRefs | 依据用户选择处理具体目标/范围/计划/规则差异 |
| permission.respond | taskId?、toolName、inputHash、effect | 仅就这个具体工具操作记录用户选择，不能扩展为永久权限 |

所有 action 还包含 actionId、projectId、targetSessionId、title、text、choices[{id,label}]、status、createdAt。choices 必须含明确选项，如 accept/reject；程序校验 choiceId 存在。文本仅展示和进入真实用户输入，不是脚本。

payload 保存不可变内容。引用需求/Plan 等可变文件时记录 expectedHash；提交前核对，不一致返回 ACTION_STALE 并标失效。新建议可用 replacesActionId 关闭旧 action。没有自动时间过期；已答复/拒绝/失效的 action 不能重新答复。

答复与输入记录在一个 Server 事务持久化，再投递 targetSessionId。重复答复同选项返回同 inputId；不同答复返回 ACTION_CLOSED。requirement.create 的点击只显示“已提交主管”，创建成功以文件查询为准。用户直接明确要求相同操作，不再创建重复确认 action。

## MSG-05 用户操作接口

| method | params | result |
|---|---|---|
| project.open / project.rebind | 见 project.md | Project、Session/task 摘要 |
| project.trust | projectId、trusted | Project；只有真实用户调用，活动执行不能撤销 |
| settings.get | scope=global/project、projectId? | 默认/角色模型、Provider（无密钥）、有效配置 |
| settings.update | scope、projectId?、patch | 校验并持久配置，下一启动生效 |
| settings.testProvider | providerId、modelId | 实际可用/失败结果 |
| project.get | projectId | 项目状态、入口、活动摘要 |
| session.create | projectId、title? | Session |
| session.list | projectId | 主管 Session 数组及专业执行摘要 |
| session.delete | projectId、sessionId | 已结束会话清理结果；条件与效果见下文 |
| session.messages | projectId、sessionId、cursor?、limit? | Pi messages、nextCursor；默认 50，最大 200 |
| session.send | projectId、sessionId、text、mode? | accepted、inputId |
| requirements.list | projectId、status? | items、errors、readAt |
| requirements.get | projectId、path | metadata、body、contentHash、Git 状态 |
| task.attach | projectId、taskId、sessionId | 绑定到同项目新主管的 Task，不自动开始 |
| task.list / task.get | projectId、taskId? | 任务与步骤结果摘要/详细记录 |
| task.pause / task.resume / task.cancel | projectId、taskId | 已持久的控制意图与当前状态 |
| action.respond | actionId、choiceId、text? | inputId、action 状态 |

模型工具与用户 API 共用领域效果，但 Server 根据调用者区分角色/权限。用户查看/控制不必先让主管生成操作代码。归档需求通过用户指令交给主管按文件规则处理。

验收：AC-E01～AC-E05、AC-R02。

settings.patch 允许 defaultModel、roleOverrides，以及全局 providers。roleOverrides 键为固定角色；值为 project.md 的模型字段。Provider 输入为 id、type（openai_compatible/anthropic/google）、baseUrl?、enabled、apiKey?；apiKey 只写入 secretRef，不出现在读取响应。删除/禁用导致没有有效模型时，已有记录保留，新的执行阻断；运行中的请求不悄悄替换。项目 patch 不更改全局 Provider 密钥。

task.attach 只允许真实用户对同项目 chief Session 操作；目标 task 非终态、没有进行中的专业/工具执行，旧主管没有该 task 正在处理的输入。原结果/授权/步骤不变，未处理通知改投新主管。切换所有者不自动恢复暂停/未知效果，用户再 task.resume 或给继续指令；条件不符 PROJECT_BUSY/IDENTITY_MISMATCH。

session.delete 只允许真实用户清理 idle/closed、没有运行或未完任务绑定且 Pi 文件未被有效证据引用的会话。引用实际 Pi 文件的证据/未完task返回 RECORD_IN_USE。成功标 deletedAt/closed，从列表移除并删除 Pi 聊天文件；保留被结果引用的Session身份/模型元数据、Server用户决定/输入账本、结果/证据和项目文件，清理不破坏授权或归档可读性。
