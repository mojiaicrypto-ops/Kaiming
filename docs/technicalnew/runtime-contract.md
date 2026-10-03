# 项目与 Session 运行契约

本页定义公开接入和共用 Pi 执行流程。存储原子性见 [S3](storage-and-recovery.md#s3-事务与认领)，角色/工具见 [G1～G4](agents-and-tools.md)。接口版本 v1；未实施。

## R1 公开入口

首版同源 HTTP JSON 请求 + SSE 实时输出。请求入口 `POST /api/v1/rpc`，先认证再校验项目归属。查询不调用模型；API 不接受任意 Pi 工具名或 cwd。模型/凭证设置使用配置服务，私有凭证不进入响应。

```json
{
  "requestId": "m-001",
  "method": "session.input.submit",
  "params": {
    "projectId": "p-001",
    "sessionId": "s-001",
    "content": [{ "type": "text", "text": "先讨论，不开始开发" }]
  }
}
```

```json
{
  "requestId": "m-001",
  "result": { "inputId": "m-001", "status": "queued", "revision": 1 }
}
```

失败响应为 requestId + error:{code,message,details?}，与 result 互斥。写调用必须有稳定 requestId，第一次发送前生成，重试复用。每个 ID 在同一安装下绑定 method + 完整规范化参数；同 ID 不同归属/内容返回 REQUEST_CONFLICT。规范化只处理 Schema 默认值和对象键顺序，不归并自然语言。

| method | 参数 | 返回 / 行为 |
|---|---|---|
| project.open | path | realpath 唯一 Project、会话/工作摘要、知识入口；只登记/读取，不创建会话、模型或项目文件 |
| project.get | projectId | 概要与当前绑定/入口问题；目录缺失明确报告 |
| project.rebind | projectId、expectedRevision、path | 原 ID 的新目录绑定；先停写、校验引用与确认来源，禁止因同名自动认领 |
| session.create | projectId、title? | chief 的逻辑 Session；Pi 懒创建，无模型也能创建/读取 |
| session.get | projectId、sessionId | role、activity、当前输入、排队数、阻断、配置摘要；activity 为 idle/processing/stopping |
| session.messages.list | projectId、sessionId、cursor?、limit | 指定 Pi 历史、input 关联与状态、nextCursor；无历史的未开始会话为空，有历史而文件缺失报错 |
| session.input.submit | projectId、sessionId、content、taskId? | 用户输入只投 chief；提交后返回 inputId/status/revision |
| session.input.get | projectId、sessionId、inputId | 当前状态、checkpoint/结果的公开引用、错误/停止原因；原内容保持不变 |
| session.input.stop | projectId、sessionId、inputId | 保存停止意图后直接 abort；返回 Input 原 status/revision、stopRequested 与 Session.activity；未停稳 activity=stopping，未知为 interrupted |
| task.list/get | projectId、taskId?、cursor?、limit? | Task 看板/详情，无模型也可读 |
| task.control | projectId、taskId、expectedRevision、command | pause/resume/cancel，调用同一 TaskService；停止范围见 S5 |
| requirement.list/get | projectId、过滤/分页或 requirementId | 使用同一文件读取服务，返回非法文件信息，不经模型 |
| decision.submit | projectId、decisionId、expectedRevision、choice | 保存选择与主管输入；验证当前 subjectVersion；不直接运行选择涉及的工具 |
| session.stream.prepare | projectId、sessionId | subscriptionId、epoch、boundary、快照；先缓冲后读快照，见 M4 |
| session.recovery.inspect | projectId、sessionId | interrupted 输入、旧绑定、效果与证据；直接读取 |
| session.recovery.resolve | projectId、sessionId、inputId、expectedRevision、operationResolutions、mode | 核实具体效果后补登记/关闭/交接；mode 为 reconcile/close/handoff，不是盲目重发 |

project.rebind / task.control / recovery.resolve 是显式控制；session.input.submit 中自然语言“暂停”由主管理解后调用控制工具。旧页面的 input.stop 只停止指定 inputId，不误停后来的输入。

认证采用同源安全会话 cookie，写入校验来源/CSRF；退出立即拒绝旧连接和后续请求。SSE 不通过 URL 携带访问凭证。目录与文件接口检查实际路径归属，脱离项目的符号链接不能经 Web 文件接口访问。这些是接入与数据保护，不扩展多用户权限系统。

## R2 输入状态与版本

```mermaid
stateDiagram-v2
  [*] --> queued: 接纳事务提交
  queued --> processing: 原子认领
  queued --> stopped: 执行前停止
  processing --> completed: 停稳并保存边界
  processing --> failed: 已知失败，无未知副作用
  processing --> stopped: 确认停止
  processing --> interrupted: 崩溃／保存或效果未知
  interrupted --> completed: 核对已有完整结果
  interrupted --> failed: 核对失败并关闭
  interrupted --> stopped: 核对停止并关闭
  interrupted --> queued: 核对后的交接接续
```

| 状态 | 程序含义 |
|---|---|
| queued | 已接纳未进入 Pi；可因模型/目录/控制/前序恢复而阻断 |
| processing | 当前有效代次处理中，含 Pi 原生重试和工具执行 |
| completed | 本输入正常处理结束，边界与结果引用已确认；不表示 Task 完成 |
| failed | 已知错误已记录，现有成果保留；不自动重投原输入 |
| stopped | 确认不再执行；不代表回滚已有影响 |
| interrupted | 无法确认边界或效果，先恢复核对，本 Session 后续普通输入不启动 |

每次持久变化 revision 加一。重复接纳/停止/查询返回当前状态；旧 revision 的 queued 回执不能覆盖新 completed。session.activity 从当前 input 与控制意图派生；idle 时 Task 可以继续运行或等待结果。paused/cancelled Task 不因浏览器打开恢复。

## R3 共用 Session 执行链路

```text
dispatch(sessionId):
  核对控制、恢复、目录、配置、Session 空闲、全局/项目容量
  Store.claimNext：事务认领本 Session 最早输入，增加执行代次
  Registry.getOrCreate：取得该 sessionId 的唯一 Pi 实例
  固定 actor、cwd、模型、规则版本、工具集合和活动历史绑定
  先提交 deliveryIntent，再记录输入关联标记，投递原生用户消息或明确来源 CustomMessage
  Pi 运行；原生事件立即进入内存广播
  等实际 settled；核对错误、停止、关键回执和指定文件保存边界
  Store.finish：CAS 保存终态/checkpoint/公开结果引用
  释放 Session / 容量，扫描下一输入；专业停稳通知主管
```

- 同一 Session 只有一个执行所有者；Dispatcher 公平轮转可运行 Session，每次认领一项。后续 queued 不能越过前序 unresolved interrupted。
- 事务不跨模型、Shell、网络或文件复制的长 await。每个 Pi 实例的事件/工具绑定当前 inputId 与 generation，迟到回调拒绝修改新执行。
- 用户、委派、追问、决定与专业结果都走这个函数。角色/工具/输入类型不同，不另写主管执行器或子 Agent 循环。
- 任一领域工具/原生工具失败是实际工具结果；主管仍可说明失败并正常结束输入。未知副作用或关键保存失败必须 interrupted。
- 当前用户消息先保存；只在 Pi 空闲时投递。首版不用 Pi steer/followUp 作第二条输入队列，不重复入两队。
- Task 暂停不阻断主管的讨论、结果通知、查询/控制；只禁止该 Task 的专业执行和相关写入。主管自身 interrupted 则仍按恢复阻断处理。
- 专业 report 成功不等于 Pi 停稳。final 报告后禁止后续候选写入；Runtime 确认结束才释放写入负责人。若有需主管推进的正式分工，持久保存一次 assignment.settled 通知，避免只靠内存等待。

## R4 Pi 接入的明确契约

使用 `createAgentSession` 的显式 cwd/model/sessionManager/resourceLoader/tools/customTools。SessionManager 创建到指定目录；恢复先检查指定文件，再 open，必要时 branch 到已确认条目；在创建 AgentSession 前完成选择。[SDK](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/docs/sdk.md)

Pi 接入层只负责以下小范围连接，不接管模型循环：

| 宿主动作 | 接入要求 |
|---|---|
| create/open | 验证绑定、header/历史、cwd、实际模型和角色/工具契约；禁止默认模型回退或“最近文件” |
| deliver user/delegation/send | 保留原生 content，使用 prompt/sendUserMessage；inputId 是宿主关联，不存在原生参数 |
| deliver result/decision/system notice | `sendCustomMessage`，customType=agentdev.input，模型可见 content 含来源/ID/事实/引用；空闲时 triggerTurn |
| input correlation | 用公开 appendCustomEntry 写 agentdev.input 标记，串行定位其实际根输入条目；保留 markerId/inputEntryId，不按正文相等匹配 |
| observe | subscribe 的同步 listener 仅广播/记录内存状态；不能 await 监听器承担持久事务 |
| finish | 核对 agent_settled、错误/取消、关键回执及文件边界；完成后记录 checkpoint |
| stop | 工具内 ctx.abort 发起取消；外层 await session.abort 等实际空闲 |

agentdev.input 标记保存 inputId、requestDigest、generation、contextEpoch；它是 Pi 自定义条目，不把工程元数据伪装成用户文本。自定义内容通知的模型可见部分定义在 M3。

这套关联路线需 [PI-01](implementation-checks.md#i1-pi-接入必须先通过的试验) 验证：首次文件建立、模板转换、压缩、分支、扩展拦截、写失败与重复追加。标记不能确定根输入时停止准入、保留 interrupted，采用核对/交接；禁止让实现 Agent 自己添加原生 inputId 字段。

首次 Pi 文件可能尚未建立；bindings.hasHistory 只有确认持久条目后才置 true。hasHistory=true 而缺文件/空文件/身份错误必须 HISTORY_UNAVAILABLE。Pi open 的新建行为不能当作恢复。[open 行为](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/core/session-manager.ts#L1029-L1054)

message_end 先广播后 appendMessage；agent_end 可能随后原生重试；agent_settled 只表示不再自动续工作。它们均不证明文件/数据库已提交。扩展 pi.on("turn_end") 的 messageEntryId/toolResultEntryIds 可用于关联；公开 session.subscribe 的 turn_end 不提供这些 ID，但仍需读取指定文件确认内容；必要 fsync 由宿主边界检查完成，不只读内存 leaf。[保存顺序](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/src/core/agent-session.ts#L1110-L1135)

## R5 配置、初始化与只读使用

Project 首次 realpath 绑定由唯一约束保证，显示名不作身份。打开不生成 `.dev/`；主管进入时读 AGENTS、INDEX、PROJECT，缺失如实报告。写入授权和初始化差异确认引用 P-02，已确认后正常工作复用，不重复问。

逻辑 Session 创建不要求可用模型；认领时解析角色/项目/Server 覆盖，固定 effectiveConfigHash 与 credentialRef。活动输入不受设置变更影响；后续 queued 可用新配置。原已执行输入恢复时用原配置，不可用等待明确变更，不静默换模型。

配置服务至少支持读取脱敏有效配置、保存预期版本的项目/角色覆盖、试连并返回实际 provider/model 与错误。密钥保存 Server 私有目录，查询只返引用/可用性；初始化与模型安装参数由部署 Plan 给出实际说明，对应 AC-27。

## R6 共同错误目录

| code | 含义与后续 |
|---|---|
| UNAUTHORIZED / FORBIDDEN / NOT_FOUND | 会话凭证、项目归属或目标不存在；先解决访问，不能隐式换目标 |
| INVALID_ARGUMENT / REQUEST_CONFLICT / VERSION_CONFLICT | Schema、同请求不同参数、CAS 冲突；返回字段/当前版本，调用者重新核对 |
| PROJECT_UNAVAILABLE / MODEL_UNAVAILABLE | 尚未开始输入保留 queued 和原因；已有历史/看板仍可读 |
| HISTORY_UNAVAILABLE / PI_INPUT_UNCONFIRMED | 精确恢复/关联不成立；保留记录，进入检查或交接 |
| STORAGE_UNAVAILABLE / EFFECT_UNCONFIRMED | 保存或效果不可确认；停止后续准入，不把已可能生效的操作自动重做 |
| WORKSPACE_BUSY / TASK_CONTROLLED / STAGE_NOT_READY | 当前写入负责人、Task 控制或依赖未满足；不启动不适用专业工作 |
| REPORT_MISSING / REPORT_STALE / COMPLETION_INCOMPLETE | 无正式报告、候选/依据失效、完成缺项；保留 Task 与真实证据 |
| DECISION_STALE / STREAM_RESYNC_REQUIRED | 重新展示当前决定，或重取快照；不套用旧选择/片段 |

known errors 的错误形状一致；失败 details 提供可读原因/当前引用，不泄漏凭证。机器字段的枚举由本页/G2/S2 定义，新增公开方法/消息种类须改相应契约与检查，不在局部实现中私建协议。
