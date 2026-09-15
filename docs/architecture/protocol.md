# 客户端与Runner协议

## 1. Envelope与共同规则

```json
{"v":1,"type":"request","id":"connection-request-id","method":"work.get","projectId":"32hex","params":{"workId":"uuid"}}
```

写命令增加idempotencyKey（1–128字符）和expectedVersion（目标实体当前version，新建为0）。一个请求只有一个终结response：{v:1,type:response,id,ok:true,result:{...}}或{ok:false,error:{code,message,retryable,details}}。长操作成功结果{status:accepted,operationId,workId?,runId?,version}，同步修改结果{status:applied,entityId,version}。读取返回下表形状。幂等键同载荷返回原结果；同键不同载荷拒绝。

全局方法省略projectId并用全局配置版本；Project方法必填projectId。跨Project ID统一返回NOT_FOUND。必填参数缺失、未知字段或枚举错误返回VALIDATION_ERROR。版本冲突返回VERSION_CONFLICT和currentVersion，客户端重新读取后由用户/Chief重评，禁止盲改版本重发。

表中*表示写方法，params中的?可省略，类型来自[data](data.md)。每个*遵循上述授权/版本/幂等规则；读取需要认证与对象ACL。items分页响应为{items,nextCursor?:string}，分页cursor是opaque字符串。

## 2. 认证与连接

浏览器登录POST /auth/login {token:string}，token由安装生成并只显示一次，成功设置HttpOnly/SameSite=Strict/Secure cookie，CSRF token用于同源写请求；失败401，限每IP每分钟5次。退出POST /auth/logout清会话。会话24h过期，WebSocket建连验证Origin与cookie，过期发送AUTH_EXPIRED并关闭。远程部署HTTPS必需；loopback开发允许http但Origin精确匹配。

BFF到daemon和本机CLI使用0600安装凭证Bearer；daemon默认127.0.0.1:4318，BFF默认127.0.0.1:4317。对外反向代理只暴露BFF。Ready前只接受connection.hello。

AgentDev为单用户自托管安装：认证后的每个浏览器会话解析为**同一个安装用户**（`userIdFromSubject('installation:local')`），会话id仅作为审计主体（ledger的subject）保留，不再派生per-session身份。因此经BFF上传的staged附件可以由同一浏览器经BFF发送的消息绑定，换一次登录或换一个浏览器也仍属同一属主；附件属主、消息属主、产物归属与ACL一律使用该安装身份（WP-09 T-01）。

BFF不转发也不校验浏览器的x-csrf-token（WP-09 登记偏差）：BFF自身持有daemon会话，同源写以HttpOnly `agentdev_web`会话（SameSite=Lax）加精确Origin校验认证，再以BFF自己的session.csrfToken调用daemon，因此浏览器提供的该头既非必需也不被信任；浏览器仍按上表携带该头（`/rpc`契约面），判定权在BFF。此偏差由独立复查登记，避免后续Test按字面要求误判。

| 方法 | params | result |
|---|---|---|
| connection.hello | protocolVersion:1,client:web/cli | {connectionId,protocolVersion:1,serverTime} |
| project.subscribe | scope:{kind:summary/conversation/work/run,id?:ID},afterCursor?:int | {subscriptionId,snapshot?,cursor,mode:replay/snapshot} |
| subscription.set | subscriptionId,scope | {snapshot,cursor} |
| subscription.remove | subscriptionId | {removed:true} |
| project.events.ack | subscriptionId,cursor:int | {acknowledged:int} |

范围改变始终返回范围快照；同范围恢复可用cursor。事件扫描水位通过batch_end {subscriptionId,scannedThrough}，客户端应用整个批次后ACK。空批次也发送水位。游标过期响应RESYNC_REQUIRED，客户端重订阅无afterCursor。

## 3. Project与Conversation

| 方法 | params | result/异步结果 |
|---|---|---|
| project.list | filter:recent/running/all,limit?,cursor? | items<ProjectSummary> |
| project.open* | root:string | 已打开：{projectId,version,trust,gitState}，expectedVersion=0；冷开：accepted {operationId,projectId,root} |
| project.create* | root:string,name:string | accepted；project.created |
| project.clone* | remoteUrl:string,root:string,grantId:ID | accepted；project.created/operation.failed |
| project.trust* | trusted:bool | applied；撤销信任停止新准入 |
| project.close* | {} | applied；只移出打开导航，有Run继续 |
| project.initialize* | mode?:new/legacy（提示兼授权，见下）,sourceMessageId:ID,budget?:{files:int,bytes:int} | accepted；initialization.progress/completed |
| project.snapshot.get | scope:{kind,id?} | {snapshot,cursor} |
| conversation.list | limit?,cursor? | items<Conversation> |
| conversation.create* | title?:string,focusWorkId?:ID | {conversationId,version} |
| conversation.get | conversationId,limit?,cursor? | {conversation,messages,nextCursor?} |
| conversation.message.send* | conversationId,body:string,attachmentIds:ID[],targetWorkId?:ID,targetRole?:Role | {messageId,workId,state:received,version} |

**project.open的冷开就绪规则**（WP-12 T5）：命令面必须同步，而绑定监听端口在Node里是异步的，所以只有「已经打开」的root按上表同步返回{projectId,version,trust,gitState}；**未打开过的root返回长操作封套accepted {operationId,projectId,root}**，装配在后台完成。就绪事实只有两个来源，调用方不得凭时间猜测：①`project.list`中该条`lifecycleState`变为`open`（`runningRuns`/`executionReady`同时可用）；②该项目的`project.snapshot.get`/任何Project读方法从`NOT_FOUND`变为可读。失败不落任何项目流，而以`operation.failed`发到发起方所在项目的流，并在admin/CLI面以error code + operationId直接返回。两条调用路径：CLI `agentdev open`走回环admin `POST /projects`，宿主同步完成装配后返回instance及其BFF地址，**无需轮询**；浏览器/`/rpc`调用方在收到`accepted`后以`project.list`轮询到`lifecycleState==='open'`再导航。

**project.initialize的mode与Git初始化授权**（WP-12 T5 Q8）：`mode`不是用户必须选择的模式，最终模式**由Core依据root真实状态推导**（无Git且空目录=new，其余=legacy），与推导结果矛盾的显式`mode:'new'`（目标已是Git仓库）返回INVALID_STATE并附真实扫描事实。`mode:'new'`同时是**用户对在目标目录初始化Git的显式授权**；缺省`mode`或`legacy`时，无Git目录一律返回`git-initialization` blocker，**不得静默执行`git init`**。`project.create`/`project.clone`本身就是显式动作，可授权同一初始化流程。`budget.files/bytes`映射到扫描预算的`maxBodyFiles/maxBodyBytes`。

消息send以Conversation为expectedVersion目标，接受后分配seq并增加version。新消息创建Work，针对活动Work的意见产生关联assist Work并在路由后引用目标，不覆盖原目标。body最大64000字符。project.open在已经打开时返回同Project并且幂等。

## 4. 工作、需求和决定

| 方法 | params | result |
|---|---|---|
| command.get | operation:string,idempotencyKey:string | {state,response}，仅同调用主体可查 |
| work.list/get | workId（get）；filter?:WorkStatus,limit?,cursor?（list） | Work或items |
| work.pause/resume/cancel* | workId,reason:string | accepted；work.control_changed |
| work.retry* | workId,reason:string | accepted；新Run，需无副作用不确定项 |
| work.budget.update* | workId,tokenLimit:int,timeLimit:int,repairLimit:int,sourceMessageId:ID | applied；保存用户budget Decision |
| requirement.list/get | requirementId（get）；lifecycle?,limit?,cursor?（list） | Requirement或items |
| requirement.create* | title,goal,sourceMessageId?:ID,scope:Scope,contentMarkdown:string | accepted，requirementId；Git提交后requirement.saved含version/revision/hash |
| requirement.update* | requirementId,patch:{title?,goal?,scope?,acceptance?,openQuestions?,featureIds?,contentMarkdown?:string},sourceMessageId?:ID | accepted；语义变化需用户决定，保存后requirement.saved |
| requirement.import* | revision:string | accepted；幂等重建投影，逐项冲突返回requirement.imported结果 |
| requirement.start* | requirementId,sourceMessageId?:ID,budget?:{tokenLimit,timeLimit,repairLimit} | accepted；workId预分配，Git保存active并写入Work后才准入Run |
| requirement.pause/resume/cancel* | requirementId,reason,sourceMessageId?:ID | Active且local转发Work；needs_replan的resume用用户动作创建新Work及授权并重新规划；Queued取消保存Git后cancelled；无本机执行的pause返回INVALID_STATE |
| requirement.archive/restore* | requirementId | accepted；Git保存后requirement.saved，状态规则见workflow |
| decision.submit* | decisionId,targetVersion:int,choice:string,sourceMessageId?:ID | applied；decision.resolved和effectRefs |
| permission.request* | workId,runId?:ID,toolOperationId?:ID,inputHash?:Hash,operation,targets:string[],scope:once/run/work/project,role,stage,expiry:Time,limits:{maxCalls?:int,maxBytes?:int,maxDurationSec?:int} | {decisionId,version} |
| permission.respond* | decisionId,choice:approve/deny,reason?（deny 可选，记录在permission.resolved） | applied；permission.resolved |
| chief.todo.resolve* | workId,todoId,disposition:handled/dismissed,reason? | applied；chief.todo_resolved |
| recovery.inspect* | workId | accepted；recovery.report_ready |
| recovery.resolve* | workId,reportRef:Ref,choice:resume/accept_cancel/abandon,sourceMessageId?:ID | accepted；核对报告目标版本后应用 |
| task.list/get | workId（list）；taskId（get） | items<Task>或Task |
| run.list/get | workId（list）；runId（get） | items<Run>或Run |
| run.pause/resume/cancel* | runId,reason | accepted；影响必需子Run时Gate保持阻断 |
| plan.current | workId,revision?,planVersion?:int | {currentVersion,requestedVersion,current,gateStatus,approvedVersion,approvedAt,runId,authorizationId,plan,approval:{enabled,reason,reasonCode}}；plan正文与本地授权取自gate自身的批准记录及其产物 |
| plan.approve* | workId,revision?,planVersion:int,plan:PlanDraft,approval:{authorizationRef,runId,productChanged,requestedTokens?} | applied，planRef；请求版本非当前返回VERSION_CONFLICT和currentVersion |

permission.request的scope=once时必须runId/toolOperationId/inputHash，scope=run必须runId，scope=work必须workId；服务端从请求引用解析真实绑定并拒绝跨项目。

**第一期权限语义**（`.agentdev/work/WP-12/T3-implementation.md` 附录 A，已冻结；网络口径见 `w1-implementation.md` §7）：Plan/授权在**批准时**授予信封（路径 + 操作），运行中**信封内操作直接执行、不再逐次询问**（AC-049 的"范围内继续"按此解释）；AC-048 的"目录/网络越权"证据相应改为"信外/敏感文件被拒/两个固定拒绝项被拒"。两个方法**保留但正常流程不再触发**：`permission.request` 只为逐次审批类环境操作（`bash`/`network`/`secret`/`push`/`deploy`/`delete_data`）而存在，`waiting_permission` 挂起与 `once`+`inputHash` 绑定不再出现在常规路径上；第二期再评估删除（附录 A.8 未采纳项）。硬拦不走本方法：敏感文件（附录 A.2 冻结表，read/search/edit/write 共用）、**两个固定拒绝项（守护运行时实际绑定的自身端口、云元数据地址；永不可授权，任何配置都不得放行）**、工作区外删除、Git引用变更（push/强制重置/`update-ref`）一律返回类型化拒绝，`details.approvable=false` 表示"任何用户决定都不能放行，不要重试"，敏感文件另落 `chief_action_required(kind='sensitive_file')` 用户待办（不阻塞Run）。**网络默认通**：公网、本地服务（`127.0.0.1:3000`/`:5432`）与内网私服开箱即通，**不需要作者配白名单**，除上述两个固定拒绝项外没有第三项；受控出口尚未装配期间**容器出口保持关闭**（宿主模式实际全通），实现归 W6。`configPolicy` 档位只影响敏感文件表的读法，不改协议方法集合。

审批链以plan.current为唯一权威：UI不得自行拼装plan正文或authorizationRef；approval.enabled=false时批准控件必须禁用并显示reason。approval.reasonCode为机器可读原因码（no_plan/stale_version/gate_not_approved/plan_unreadable/no_authorization/authorization_unreadable），界面必须用自身i18n目录按该码渲染可见原因，approval.reason仅作英文诊断（如元素的title），保证界面语言一致（W9R2-05）。Queued且无Work的需求取消由daemon先读回Git中现有记录，仅替换「完成摘要」写入取消原因并追加lifecycle/cancellation事实，其余正文段落与scope/acceptance/featureIds/openQuestions/confirmedDecisions原样保留，再由RequirementSaveService提交Git（W9R2-03）。

`chief.todo.resolve`是**用户面待办的确认入口，不是授权**（WP-12 W2）：`todoId`就是界面待办卡上显示的id（敏感文件待办为`workId:path:pattern`，与`chief_action_required`的落库幂等键一致）。它只记录一条user Action与持久事件`chief.todo_resolved`（data含`workId`/`todoId`/`disposition`/`reason?`/`actionId`），随后Inbox不再列出该`(work,path,pattern)`；**不铸Grant、不放行任何工具调用、不改`configPolicy`**——文件是否真的被处理仍是用户在产品外的动作。`disposition`取`handled`/`dismissed`（两者都关闭该待办），未知`todoId`或不属于该Work的待办返回`NOT_FOUND`，重复调用幂等并回报已记录的`disposition`；给出`expectedVersion`时目标为该Work当前version，不匹配返回`VERSION_CONFLICT`。第一条待办被关闭后，同一`(work,path,pattern)`的后续拒绝不会重新在Inbox出现（拒绝本身仍类型化、仍审计）。

Decision choice必须属于该决定保存的选项；UI用户可直接提交，无sourceMessageId时保存按钮动作的user Action记录作为来源。Chief代表用户提交必须带sourceMessageId；来源必须user消息且同Project，语义无法确认时要求新的明确用户决定。Run恢复适用Manifest不一致则拒绝STALE_ARTIFACT，由Chief创建新Run。

## 5. 知识、文件、产物与配置

| 方法 | params | result |
|---|---|---|
| knowledge.list | view:delivered/design/work,workId?,query?:string,limit?,cursor? | items<FeatureSummary>、sourceRevision、projectionState |
| knowledge.get | featureId,view,workId? | Feature、sourceRefs、unknowns |
| inbox | {} | {items,unread}；待处理事项按目标+版本去重，每项含kind（decision/permission/finding/recovery/todo）、id、workId与actionable；主管待办在`chief.todo.resolve`关闭后不再列出 |
| context.preview | workId,role,selection:ContextSelection | resolved/excluded/missing/estimatedTokens |
| file.list/read | revision:string,path:Path,limit?,cursor?（list） | entries或{content,mime,hash,truncated} |
| artifact.list/get | workId（list）；artifactId,artifactVersion?（get） | items或Artifact及preview |
| artifact.download.prepare* | artifactId,artifactVersion | {downloadToken,expiresAt} |
| config.get | scope:global/project | {version,providers（仅global）,profiles,limits,policy} |
| config.update* | scope,patch:ConfigPatch | applied；变更后续Run生效 |
| provider.upsert* | provider:ProviderInput,secret?:string | {providerId,version,secretConfigured} |
| provider.test* | providerId,modelId | accepted；provider.test_completed |
| secret.set* | ref,value:string,audience?:gateway/tool（默认gateway） | applied，{ref,configured,updatedAt,backend}；值不回显 |
| secret.delete* | ref | applied，{ref,deleted} |
| secret.list | {} | {backend,items<{ref,configured,updatedAt,backend,health,issue?}>,problems<{path,code,message}>}；仅元数据 |
| extension.list | {} | 内置清单含id/version/enabled/health |
| extension.set* | id,enabled:bool | applied；critical关闭拒绝 |

ConfigPatch仅允许roleOverrides、limits、permissionMode、configPolicy、l3Paths、l3Keywords、testCommands；所有值按角色/默认值Schema校验，不允许任意键扩大权限。`configPolicy:'strict'|'test'`是敏感文件档位（全局默认`strict`、项目级覆盖、随Run冻结、仅人可设，无`open`档、无"环境类型"字段；`test`在`doctor`/项目页/验收报告显著标记且放行同样审计）。ProviderInput字段见agents规则，secretRef由服务端创建，secret本体不回显。禁用被活动Run引用Provider只影响新Run，显式撤销Secret立即阻断相关调用并记录原因。

`secret.*`是**安装级**方法（省略projectId）：只接受安装凭证Bearer的调用主体（`installation:local`），浏览器会话调用返回NOT_AUTHORIZED；`secret.set/delete`是写方法但不进幂等账本（同ref替换天然幂等，且不得持久化值的摘要），`secret.list`是只读查询。写入按用途落入持久仓库（macOS Keychain或0600加密文件，`AGENTDEV_SECRET_BACKEND`选择，默认file），Provider凭证用`gateway`用途，`tool`用途仍需显式Grant。值绝不出现在任何响应、事件、日志或错误消息中；`health:unreadable`表示记录存在但当前主密钥无法解开（`issue`给出错误码），`problems`列出后端无法识别的文件，二者都不影响daemon启动与其他credential的装载。

**产物端点一律显式携带Project**（WP-12 T5 Q6）：BFF对外只暴露一个origin，因此路径是`/artifacts/:projectId/…`，BFF按该段选择Project并向该项目daemon转发；缺少该段或该段是保留字（`download`/`download.prepare`/`upload`/`uploads`）的路径返回NOT_FOUND，不回退到「当前选中项目」。预览与下载在BFF侧同时校验会话与该项目ACL，一个Project的artifactId或一次性downloadToken经另一个Project的路由必须被拒（AC-034）。
POST /artifacts/:projectId/upload multipart(conversationId,file)使用认证/CSRF，创建用户所有的staged Attachment，返回{attachmentId,hash,mime,bytes,expiresAt}；24h到期无绑定即清理。上传不要求Work或Run。message.send事务校验同用户/Conversation、数量/总大小、有效期，创建Work后原子绑定附件和消息，并创建origin=user的Artifact（runId为空）。同幂等发送返回原绑定；同附件另一个消息使用拒绝ATTACHMENT_ALREADY_BOUND，需显式重新上传。发送事务失败保持staged，可重试。DELETE /artifacts/:projectId/uploads/:attachmentId仅删除用户自己的staged附件，已绑定返回INVALID_STATE。遵守附件限制。POST /artifacts/:projectId/download.prepare与`artifact.download.prepare`等价，返回{downloadToken,expiresAt}；GET /artifacts/:projectId/download/:token只一次消费，过期403。只读预览通过受权GET /artifacts/:projectId/:artifactId/preview，按HTML隔离策略响应。健康GET /healthz返回版本与ready，不返回路径和Secret。

## 6. Chief与Runner内部方法

内部接口必须有attempt capability；客户端不得直接调用。expectedVersion目标为Work（assessment/dispatch）或Task/Run（stage）。所有调用带operationId以便重派去重。

| 方法 | params | 结果 |
|---|---|---|
| assessment.submit* | workId,assessment:Assessment | 保存路由，返回适用Gate |
| agent.dispatch*（chief） | ProfessionalDispatchSpec | {runId,status:queued}；批量逐项结果 |
| agent.request_dispatch*（专业） | workId,reason,requestedRole,goal,sourceRefs | chief_action_required事件 |
| context.request* | runId,requestedRefs,reason | 在授权内返回内容/ledger项；超范围请求Chief |
| runner.ready* | attemptId,epoch,runnerId,environmentRef | {leaseUntil}并产生run.started |
| runner.heartbeat | attemptId,epoch,lastToolOperationId? | {leaseUntil,control} |
| tool.execute* | attemptId,epoch,toolName,args,toolOperationId?,expectedInputHash?,timeoutMs? | 内联工具结果，或超限时截断预览+resultRef（见下） |
| decision.request*（chief） | workId,question,choices? | {status:pending,decisionId,version,artifactId,artifactVersion,choices}；decision.created |
| stage.submit* | attemptId,epoch,result:StageResult | accepted；验证后stage.completed/failed |
| runner.stopped* | attemptId,epoch,reason,checkpointRef?,toolOutcomes | 更新Attempt并保留恢复依据 |

Pi工具stage_yield映射stage.submit；普通文本结束没有该结果时Run等待提交提示，连续两次不合规为contract_violation。

Chief的decision_request把提问正文写成`kind=decision`的Artifact（`mime=text/markdown`），Decision行的`targetRef`指向该Artifact的id/version/contentHash，并发出`decision.created`（event.data仅带摘要：artifactId/artifactVersion/choices）；`choices`缺省`['accept','decline']`。用户答案仍走既有`decision.resolve`：`accept`落`state=accepted`并发`decision.resolved`；`decline`按既有product-behaviour分支记录follow-up决定（AC-015/016），两条路径都不新增解析入口。**Inbox渲染契约**：`kind=product`且`targetRef`指向Artifact的决定，界面用`artifact.get`（或预览端点）读取`targetRef.id`的正文作为问题文本，`decision.resolve`按钮按`choices`渲染；这是UI切片的工作，协议侧只保证Artifact、targetRef、choices与事件四者一致。

tool.execute是请求/应答语义：工具集内的每个操作都是有界同步调用，结果在应答前已知，因此**不返回accepted**。`expectedInputHash=sha256(canonicalJson(args))`；`toolOperationId`缺省由服务端生成并在结果中回传，调用方重传同一`toolOperationId`与同一Hash时返回原结果（`status=replayed`），同id异Hash返回IDEMPOTENCY_CONFLICT；Hash与服务端计算不一致同样返回IDEMPOTENCY_CONFLICT。`timeoutMs`缺省120秒（`LIMITS.shellTimeoutSec.default`），上限1800秒，且不得超过该次Grant的`limits.maxDurationSec`（超出返回BUDGET_EXCEEDED）。

结果有两种文档化形状，二选一由结果大小决定（内联上限64KiB）：

- **内联**（结果不超过上限）：`{v:1,status:executed|replayed,mode:container|host,operation,toolName,toolOperationId,inputHash,grantId,result,resultRef:null,truncated:false,durationMs}`，`result`即工具结果本体；
- **超限**：同样的字段，但`result`是截断预览、`resultRef`非空指向已持久化的完整结果（deferred result，`reliability.md` §2），`truncated:true`；模型侧文本必须注明完整结果在`resultRef`下，完整值不再重复读取即已可重放。

拒绝沿用§7错误封套`{error:{code,message,details?}}`与`statusForControlCode`的状态码：未认证/未授权Grant/角色工具面外/根外路径/保护路径/私网目标/NOT_AUTHORIZED，未知工具或字段、args不合schema、超时越界/VALIDATION_ERROR，once已消费或Hash冲突/IDEMPOTENCY_CONFLICT，结果不可解析/RECOVERY_REQUIRED，无Docker或容器无代理/PROVIDER_UNAVAILABLE，Grant限额超出/BUDGET_EXCEEDED。`read`/`search`在**准入前**还要过该Attempt的`readScope`（`context.md` §1）：越出范围返回`CONTEXT_FORBIDDEN`，此时不读文件、不落`tool_operation`、不进read ledger，越权请求记入同一ledger的expansion并由Chief经`context.request`处理——「读了但不入账」不是允许的降级。**端点层自身的拒绝也要写一条`tool.refused`审计**（operation/targets/code；不含args原文）。

## 7. 事件与错误

Event={v:1,type:event,eventId,projectId,cursor,name,entityId,entityVersion,data}。持久事件包括project.created、message.received/processed/failed、assessment.saved、requirement.changed、requirement.saved、requirement.save_failed、requirement.imported、work.control_changed、run.queued/started/ended、stage.completed/failed、artifact.created/invalidated、decision.created/resolved、permission.resolved、tool.invoked/tool.refused、tool.listed_file_allowed、initialization.progress/completed、recovery.report_ready、knowledge.updated、provider.test_completed、operation.failed、chief_action_required、chief.todo_resolved。data包含变更后实体摘要及产物/错误引用；完整内容由get获取。tool.invoked在工具准入通过、`tool_operation`落库后发出（operation/inputHash/grantId/mode/outcome）；tool.refused在Broker任一拒绝分支或端点层拒绝时发出（operation/targets/code/reason/mode/layer），两者都不含args原文或Secret值。`tool.listed_file_allowed`记录`configPolicy`档位下一次放行的敏感清单读取（path/pattern/operation/configPolicy/policyRevision），使测试环境的放宽不能被误读为无泄漏；`chief_action_required`在敏感文件被拒时以`kind='sensitive_file'`（path/pattern/action/configPolicy/policyRevision）落一条用户待办，同一个(work,path,pattern)只落一条。`chief.todo_resolved`（workId/todoId/disposition/reason?/actionId）由`chief.todo.resolve`写入，是该用户待办被确认关闭的唯一记录；它与`chief_action_required`分成两个事件名而不是复用后者，使"落待办"与"关待办"在日志里可分别查询，也避免待办的落库幂等扫描把关闭记录误当成一次落库。

token.delta、log.delta、heartbeat为临时流，包含runId、seq和内容，不占持久cursor；最终消息与日志Artifact补全。每个终态事件携带真实outcome，客户端不能将run.ended统一渲染为成功。

错误表：VALIDATION_ERROR（修正输入）、INVALID_STATE（当前实体状态不允许该操作）、UNAUTHENTICATED/AUTH_EXPIRED（重新认证）、NOT_FOUND、NOT_AUTHORIZED（有效Grant；第一期硬拦如工作区外删除/Git引用变更也用此码但`details.approvable=false`，表示任何决定都不能放行、不要重试）、VERSION_CONFLICT/IDEMPOTENCY_CONFLICT（读取并重评）、GATE_NOT_READY/MISSING_CONTEXT/CONTEXT_FORBIDDEN（Chief处理；敏感文件命中用`CONTEXT_FORBIDDEN`且`details.approvable=false`，拒绝文案写明"不要重试、交用户处理"）、STALE_ARTIFACT（重建证据）、BUDGET_EXCEEDED（用户调整）、BUSY（未接受，可退避重发同键）、RECOVERY_REQUIRED（检查后决定）、ATTACHMENT_ALREADY_BOUND（重新上传）、ARTIFACT_MISSING/KNOWLEDGE_INVALID（修复来源）、PROVIDER_UNAVAILABLE（配置/恢复）、PROTOCOL_MISMATCH（升级客户端）、RESYNC_REQUIRED（重新快照）、INTERNAL_ERROR（保存operationId诊断）。仅BUSY和已知无副作用的Provider瞬时错误retryable=true；应答丢失先查同幂等键结果。网络默认通，只有两个固定拒绝项（守护自身实际端口、云元数据地址）与之冲突，均以类型化拒绝 + `details.approvable=false` 返回。

`tool.execute` 的错误体除`{code,message}`外可带`details`（`approvable`、敏感文件命中的`pattern`/`path`/`action`、`network`、`configPolicy`、`policyRevision`）：Runner据此区分"可被用户决定放行的环境操作"与"策略终局拒绝"，前者才走`permission.request`，后者直接把类型化拒绝交给模型。

## 8. Git需求响应

requirement.get返回PortableRequirement全部可读字段及portableRef、executionAvailability、evidenceAvailability、saveState=saved/saving/save_failed；saving为未完成operation的投影，不伪装已提交事实。保存状态命令响应accepted，Git CAS及SQLite投影核对后发requirement.saved。导入冲突用REQUIREMENT_CONFLICT；同条不准入写操作，其他有效条仍可查询。新Project首次open自动启动已知目录的需求导入，不要求Provider；导入结果在project snapshot中可见。

需求写命令的sourceMessageId可省略：客户端按钮操作由Core在认证及权限校验后记录user_action并构建SourceRef；Agent调用必须引用已存在的真实用户消息/动作，不能伪造动作授权。requirement.update.patch的字段类型沿用PortableRequirement；允许relatedRequirementIds与confirmedDecisions，后者每项必须可核对真实用户确认来源。

requirement.save.retry* params={operationId:ID}：仅真实用户或有对应授权的Chief可调用，目标为原requirement_save操作，无需Work；核对原payloadHash和记录前提，失败操作重新入outbox执行，返回accepted及原operationId。运行中/已成功时幂等返回当前状态，不另建需求；已发生目标内容冲突仍返回REQUIREMENT_CONFLICT，不能强制覆盖。该命令使用新的请求幂等键，键指向原操作，避免原保存命令accepted应答阻止重调度。

冲突解除：用户在Git保留并合并双方内容、恢复缺失记录后，调用requirement.import指定当前交付HEAD Revision。有效且无重复ID的记录以该Git版本重建投影，标resolved并解除写阻断；相同version异内容的首次发现保持冲突，后续明确用户导入动作确认修复后的当前Revision才可解除。自动导入不能自动解除冲突。旧失败操作的预期Hash不因此改变；用户基于新投影重新提交变更，旧操作标superseded并关联新操作，不能重放旧payload。归档/取消须在记录恢复且冲突解除后执行，不提供绕过冲突的写入口。

需求create必须提供contentMarkdown；update可修改正文或元数据，未提供字段保持原值，Core重新计算contentHash和组合recordHash。daemon在update/取消前按投影的portableRef.revision读回Git中的requirement.json与content.md，用记录值补齐请求未命名的字段，因此部分patch不会把scope清零或把acceptance/openQuestions/confirmedDecisions/featureIds重置为空（W9R2-02）。version、contentFile及Hash由Core维护，客户端不可覆盖。requirement.saved包含recordVersion、portableRef与本机version；get返回完整contentMarkdown，list返回元数据及portableRef，不携带长正文。目录格式错误使用REQUIREMENT_CONFLICT并带reason；Git忽略为REQUIREMENT_PATH_IGNORED；旧格式为LEGACY_REQUIREMENT_FORMAT。

需求完成写入口：`requirement.save`/`requirement.update` 的 `patch` 可带 `lifecycle:'completed'` 与 `completion`（{completedAt,summary,codeRevision,codeTree,featureIds,verificationSummary,remainingIssues}，类型同PortableRequirement的completion）。两者必须同时提供：只给`lifecycle`而缺`completion`返回GATE_NOT_READY；非法lifecycle迁移返回INVALID_STATE；gate未通过的完成记录由结算路径（SettlementService）通过同一需求池Git保存写入，完成记录与最终知识一起提交。

requirement.save遵循§1的通用写幂等账本：同键同载荷重放返回首次记录的结果（同requirementId/version，不新建投影行，也不再产生commit），同键异载荷返回IDEMPOTENCY_CONFLICT；被拒绝的调用不占用键，修正载荷后可用同键重试（W9R2-01）。requirement.save.retry仍按本节走「新请求键指向原operation」的独立语义，不入通用账本。
