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
| project.open* | root:string | {projectId,version,trust,gitState}，expectedVersion=0 |
| project.create* | root:string,name:string | accepted；project.created |
| project.clone* | remoteUrl:string,root:string,grantId:ID | accepted；project.created/operation.failed |
| project.trust* | trusted:bool | applied；撤销信任停止新准入 |
| project.close* | {} | applied；只移出打开导航，有Run继续 |
| project.initialize* | mode:new/legacy,sourceMessageId:ID,budget?:{files:int,bytes:int} | accepted；initialization.progress/completed |
| project.snapshot.get | scope:{kind,id?} | {snapshot,cursor} |
| conversation.list | limit?,cursor? | items<Conversation> |
| conversation.create* | title?:string,focusWorkId?:ID | {conversationId,version} |
| conversation.get | conversationId,limit?,cursor? | {conversation,messages,nextCursor?} |
| conversation.message.send* | conversationId,body:string,attachmentIds:ID[],targetWorkId?:ID,targetRole?:Role | {messageId,workId,state:received,version} |

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
| permission.respond* | decisionId,choice:approve/deny | applied；permission.resolved |
| recovery.inspect* | workId | accepted；recovery.report_ready |
| recovery.resolve* | workId,reportRef:Ref,choice:resume/accept_cancel/abandon,sourceMessageId?:ID | accepted；核对报告目标版本后应用 |
| task.list/get | workId（list）；taskId（get） | items<Task>或Task |
| run.list/get | workId（list）；runId（get） | items<Run>或Run |
| run.pause/resume/cancel* | runId,reason | accepted；影响必需子Run时Gate保持阻断 |
| plan.current | workId,revision?,planVersion?:int | {currentVersion,requestedVersion,current,gateStatus,approvedVersion,approvedAt,runId,authorizationId,plan,approval:{enabled,reason}}；plan正文与本地授权取自gate自身的批准记录及其产物 |
| plan.approve* | workId,revision?,planVersion:int,plan:PlanDraft,approval:{authorizationRef,runId,productChanged,requestedTokens?} | applied，planRef；请求版本非当前返回VERSION_CONFLICT和currentVersion |

permission.request的scope=once时必须runId/toolOperationId/inputHash，scope=run必须runId，scope=work必须workId；服务端从请求引用解析真实绑定并拒绝跨项目。

审批链以plan.current为唯一权威：UI不得自行拼装plan正文或authorizationRef；approval.enabled=false时批准控件必须禁用并显示reason（缺正文、缺本地授权、版本非当前或gate已失效）。Queued且无Work的需求取消由daemon生成content.md——六个二级标题各一次、顺序固定，取消原因写入完成摘要，再由RequirementSaveService提交Git。

Decision choice必须属于该决定保存的选项；UI用户可直接提交，无sourceMessageId时保存按钮动作的user Action记录作为来源。Chief代表用户提交必须带sourceMessageId；来源必须user消息且同Project，语义无法确认时要求新的明确用户决定。Run恢复适用Manifest不一致则拒绝STALE_ARTIFACT，由Chief创建新Run。

## 5. 知识、文件、产物与配置

| 方法 | params | result |
|---|---|---|
| knowledge.list | view:delivered/design/work,workId?,query?:string,limit?,cursor? | items<FeatureSummary>、sourceRevision、projectionState |
| knowledge.get | featureId,view,workId? | Feature、sourceRefs、unknowns |
| context.preview | workId,role,selection:ContextSelection | resolved/excluded/missing/estimatedTokens |
| file.list/read | revision:string,path:Path,limit?,cursor?（list） | entries或{content,mime,hash,truncated} |
| artifact.list/get | workId（list）；artifactId,artifactVersion?（get） | items或Artifact及preview |
| artifact.download.prepare* | artifactId,artifactVersion | {downloadToken,expiresAt} |
| config.get | scope:global/project | {version,providers（仅global）,profiles,limits,policy} |
| config.update* | scope,patch:ConfigPatch | applied；变更后续Run生效 |
| provider.upsert* | provider:ProviderInput,secret?:string | {providerId,version,secretConfigured} |
| provider.test* | providerId,modelId | accepted；provider.test_completed |
| extension.list | {} | 内置清单含id/version/enabled/health |
| extension.set* | id,enabled:bool | applied；critical关闭拒绝 |

ConfigPatch仅允许roleOverrides、limits、permissionMode、l3Paths、l3Keywords、testCommands；所有值按角色/默认值Schema校验，不允许任意键扩大权限。ProviderInput字段见agents规则，secretRef由服务端创建，secret本体不回显。禁用被活动Run引用Provider只影响新Run，显式撤销Secret立即阻断相关调用并记录原因。

POST /artifacts/upload multipart(projectId,conversationId,file)使用认证/CSRF，创建用户所有的staged Attachment，返回{attachmentId,hash,mime,bytes,expiresAt}；24h到期无绑定即清理。上传不要求Work或Run。message.send事务校验同用户/Conversation、数量/总大小、有效期，创建Work后原子绑定附件和消息，并创建origin=user的Artifact（runId为空）。同幂等发送返回原绑定；同附件另一个消息使用拒绝ATTACHMENT_ALREADY_BOUND，需显式重新上传。发送事务失败保持staged，可重试。DELETE /artifacts/uploads/:attachmentId仅删除用户自己的staged附件，已绑定返回INVALID_STATE。遵守附件限制。GET /artifacts/download/:token只一次消费，过期403。只读预览通过受权GET /artifacts/:id/preview，按HTML隔离策略响应。健康GET /healthz返回版本与ready，不返回路径和Secret。

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
| tool.execute* | attemptId,epoch,toolName,args,expectedInputHash? | accepted或工具结果Ref |
| stage.submit* | attemptId,epoch,result:StageResult | accepted；验证后stage.completed/failed |
| runner.stopped* | attemptId,epoch,reason,checkpointRef?,toolOutcomes | 更新Attempt并保留恢复依据 |

Pi工具stage_yield映射stage.submit；普通文本结束没有该结果时Run等待提交提示，连续两次不合规为contract_violation。

## 7. 事件与错误

Event={v:1,type:event,eventId,projectId,cursor,name,entityId,entityVersion,data}。持久事件包括project.created、message.received/processed/failed、assessment.saved、requirement.changed、requirement.saved、requirement.save_failed、requirement.imported、work.control_changed、run.queued/started/ended、stage.completed/failed、artifact.created/invalidated、decision.created/resolved、permission.resolved、initialization.progress/completed、recovery.report_ready、knowledge.updated、provider.test_completed、operation.failed、chief_action_required。data包含变更后实体摘要及产物/错误引用；完整内容由get获取。

token.delta、log.delta、heartbeat为临时流，包含runId、seq和内容，不占持久cursor；最终消息与日志Artifact补全。每个终态事件携带真实outcome，客户端不能将run.ended统一渲染为成功。

错误表：VALIDATION_ERROR（修正输入）、INVALID_STATE（当前实体状态不允许该操作）、UNAUTHENTICATED/AUTH_EXPIRED（重新认证）、NOT_FOUND、NOT_AUTHORIZED（有效Grant）、VERSION_CONFLICT/IDEMPOTENCY_CONFLICT（读取并重评）、GATE_NOT_READY/MISSING_CONTEXT/CONTEXT_FORBIDDEN（Chief处理）、STALE_ARTIFACT（重建证据）、BUDGET_EXCEEDED（用户调整）、BUSY（未接受，可退避重发同键）、RECOVERY_REQUIRED（检查后决定）、ATTACHMENT_ALREADY_BOUND（重新上传）、ARTIFACT_MISSING/KNOWLEDGE_INVALID（修复来源）、PROVIDER_UNAVAILABLE（配置/恢复）、PROTOCOL_MISMATCH（升级客户端）、RESYNC_REQUIRED（重新快照）、INTERNAL_ERROR（保存operationId诊断）。仅BUSY和已知无副作用的Provider瞬时错误retryable=true；应答丢失先查同幂等键结果。

## 8. Git需求响应

requirement.get返回PortableRequirement全部可读字段及portableRef、executionAvailability、evidenceAvailability、saveState=saved/saving/save_failed；saving为未完成operation的投影，不伪装已提交事实。保存状态命令响应accepted，Git CAS及SQLite投影核对后发requirement.saved。导入冲突用REQUIREMENT_CONFLICT；同条不准入写操作，其他有效条仍可查询。新Project首次open自动启动已知目录的需求导入，不要求Provider；导入结果在project snapshot中可见。

需求写命令的sourceMessageId可省略：客户端按钮操作由Core在认证及权限校验后记录user_action并构建SourceRef；Agent调用必须引用已存在的真实用户消息/动作，不能伪造动作授权。requirement.update.patch的字段类型沿用PortableRequirement；允许relatedRequirementIds与confirmedDecisions，后者每项必须可核对真实用户确认来源。

requirement.save.retry* params={operationId:ID}：仅真实用户或有对应授权的Chief可调用，目标为原requirement_save操作，无需Work；核对原payloadHash和记录前提，失败操作重新入outbox执行，返回accepted及原operationId。运行中/已成功时幂等返回当前状态，不另建需求；已发生目标内容冲突仍返回REQUIREMENT_CONFLICT，不能强制覆盖。该命令使用新的请求幂等键，键指向原操作，避免原保存命令accepted应答阻止重调度。

冲突解除：用户在Git保留并合并双方内容、恢复缺失记录后，调用requirement.import指定当前交付HEAD Revision。有效且无重复ID的记录以该Git版本重建投影，标resolved并解除写阻断；相同version异内容的首次发现保持冲突，后续明确用户导入动作确认修复后的当前Revision才可解除。自动导入不能自动解除冲突。旧失败操作的预期Hash不因此改变；用户基于新投影重新提交变更，旧操作标superseded并关联新操作，不能重放旧payload。归档/取消须在记录恢复且冲突解除后执行，不提供绕过冲突的写入口。

需求create必须提供contentMarkdown；update可修改正文或元数据，未提供字段保持原值，Core重新计算contentHash和组合recordHash。version、contentFile及Hash由Core维护，客户端不可覆盖。requirement.saved包含recordVersion、portableRef与本机version；get返回完整contentMarkdown，list返回元数据及portableRef，不携带长正文。目录格式错误使用REQUIREMENT_CONFLICT并带reason；Git忽略为REQUIREMENT_PATH_IGNORED；旧格式为LEGACY_REQUIREMENT_FORMAT。
