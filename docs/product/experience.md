# 工作台与主管交互规范

## 1. 页面与路由

| 路由 | 主要内容 | 动作 |
|---|---|---|
| /projects | 最近、固定、运行及待处理项目 | 打开/Clone/创建/关闭导航项 |
| /projects/:id/chief | 当前Conversation、输入、Work及角色结果 | 新建/切换对话、发送、产物预览 |
| /projects/:id/requirements | 四列看板 | 加入队列、启动、暂停、取消、归档 |
| /projects/:id/requirements/:rid | 目标、行为、Plan、Task、验证、结算 | 查看版本、处理决定、在Chief讨论 |
| /projects/:id/docs | 功能目录、状态、关系、正式文档 | 查询、查看、在Chief讨论 |
| /projects/:id/files | 当前交付分支或已交付分支只读文件树 | 搜索路径、预览、复制引用 |
| /projects/:id/agents | 八角色有效模型、权限与配置来源 | 配置角色覆盖、恢复继承 |
| /projects/:id/runs | Work/Run/Attempt状态、用量、证据 | 查看、暂停、取消、恢复 |
| /projects/:id/inbox | 决定、权限、恢复、显著失败 | 处理、定位原工作 |
| /settings | 全局Provider、默认Profile、安装设置 | 连接测试、Secret配置 |

Conversation创建/切换控件仅位于Chief。其他页面的“在Chief讨论”携带对象引用，打开或聚焦相应Conversation；不复制对象全文到聊天。Project切换改变观察范围，不改变后台工作。

## 2. 对话表现

输入框在全部阶段可用。消息依次显示 received、processing、processed；需要用户决定时显示 decision_required，处理失败显示 failed并带重试入口。接收表示持久化，不表示执行已改变。重复发送相同幂等请求返回原消息。

Chief回复优先表达事实、来源、正在处理的工作和必要问题。专业结果使用真实角色署名、Task/阶段、简短结论、产物引用。用户可以针对结果发送意见，最终统一经过Chief路由。直接给某角色意见不产生旁路权限。

运行中的消息由独立Chief Run处理；只影响受关联工作。解释类消息不会暂停开发。涉及执行变化时停止新受影响工具的准入，等待正在执行工具的安全结果后应用版本变更。

首条消息缺Provider时保留草稿并展示配置入口；已发送且等待配置的消息保持Blocked，可在配置后继续同一Work。无项目时引导打开项目。

## 3. 产物

产物类型：explanation、product、plan、diff、review、test、settlement、decision、recovery。卡片显示名称、作者角色、时间、版本、有效/失效和打开入口。面板可切换历史版本，历史审批只针对该版本；过期审批返回冲突并刷新。

HTML说明可直接生成、隔离预览和下载。预览失败展示错误并允许源码下载。图片支持PNG/JPEG/WebP，文档支持纯文本/Markdown/HTML/PDF附件；每消息最多5个附件，单个20MiB，总50MiB。不支持类型在发送前和服务端同时拒绝。PDF作为文件阅读来源，不自动执行内容。HTML安全规则见执行架构。

Diff默认逐文件折叠未改变上下文，支持展开。单次内联预览最多1MiB或2000行，超限明确显示截断与完整下载入口；二进制文件显示大小、Hash和可支持的预览。

## 4. 看板投影

| 列 | 记录 |
|---|---|
| 需求队列 | Queued |
| 迭代中需求 | Active，包括Paused/Blocked/Recovery等待 |
| 已完成 | Completed |
| 已归档 | Archived或Cancelled，显示真实结果标记 |

新服务器打开先导入Git需求，未配置模型也可查看。已保存/保存中/保存失败及未推送提示可见；导入active标“待继续”，历史完成需求显示摘要与证据可用性。

卡片显示目标、phase、角色、已完成/总Task数、阻断/决定数。Task比例表达数量，不表达预计剩余时间；Plan修订后更新分母和变更标记。无Sprint实体。直接协作和独立L1仅在Chief和Runs显示；升级L2时同一Work关联新Requirement并进入看板。

Queued可由用户归档，已归档保留previous_state；只读查看。取消保留部分成果及处置结果。恢复归档的Queued返回Queued，归档的Completed返回Completed；Cancelled保留终态，新工作由关联新需求继续。

## 5. 决定与通知

Decision显示当前/建议行为、原因、受影响工作、选项、授权范围和版本。产品变化选项：本次处理、以后处理、不采纳。Permission显示操作、目标、期限和影响。风险接受显示未覆盖项及剩余风险，用户明确接受才保存。

Automatic：范围内执行、返工、Context扩展；Notify：阶段摘要和非阻断发现；DecisionRequired：产品选择、超权限、超预算及恢复处置。Inbox按目标+版本去重，过期决定不可再次应用。浏览器内展示与未读计数为本版通知渠道。

Inbox中的主管待办（含敏感文件待办）由用户处理并确认后立即从列表消失：`chief.todo.resolve`只记录该待办的处置（已处理/忽略），同一路径与规则的后续拒绝不重新出现；它不授予任何工具权限，文件本身是否已处理仍是用户在产品外的动作。

## 6. Live与可访问性

Project Shell共享Live Dock，状态Open/Compact/Hidden。Open宽度clamp(360px,38%,560px)，Compact为44px，Hidden释放宽度；顶栏固定Live计数入口恢复。页面切换保持状态。窄屏小于768px时Open为可关闭覆盖层，关闭后焦点回到触发按钮。

各页面主体使用Dock外全部宽度。仅聚焦Requirement的Chief和详情页显示workflow条。日志默认不展开但阻断计数始终可见。所有按钮键盘可达，弹层约束焦点，状态使用aria-live，颜色同时配文字。

English/简体中文为界面语言，设备localStorage保存；失败时内存回退。用户消息、项目文档和Agent输出不自动翻译。时间使用设备时区并可查看UTC；数据库保存UTC。

## 7. 断连与操作状态

断连显示“连接中断，后台状态待同步”，不推断Run已停止。重连先快照/补事件再恢复操作。提交按钮在同一请求应答前禁用重复点击，服务端幂等仍为权威。服务拒绝展示错误原因和下一步，保留输入。服务端状态决定完成，动画/文本不决定完成。

需求详情以同一个编辑入口展示结构化字段与Markdown正文，保存时作为同一版本提交；用户不需分别保存JSON和Markdown。导入遇到缺文件/Hash冲突展示需求路径、可读原文和修复入口，其余需求仍可使用。
