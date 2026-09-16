# 数据与产物契约

## 1. 通用类型与序列化

ID为UUIDv7字符串（Feature使用F-8hex，Project使用32hex）；时间为UTC ISO8601毫秒；version为从1递增的整数；Hash为SHA256小写64hex；GitRevision为实际仓库完整OID。JSON对象拒绝未声明字段，?表示可省略，null仅在明确nullable字段可用。路径为UTF-8仓库相对路径、/分隔、禁止..和绝对路径。所有数组默认最大1000项；分页limit默认50、最大200。

Ref={id:ID,version:int,hash:Hash}；SourceRef={kind:git|artifact|message|action|decision|policy,id:string,version:string,path?:Path,hash?:Hash}。范围Scope={readPaths:Path[],writePaths:Path[],operations:string[],networkTargets:string[]}。

每个ProjectSQLite启用foreign_keys=ON、journal_mode=WAL、synchronous=FULL、busy_timeout=5000；所有业务事务由ProjectMailbox串行提交。表的project_id固定为所属Project，外键禁止跨项目。

## 2. 数据实体

除不可变事件/快照外，每行含id、project_id、version、created_at、updated_at。JSON字段写入前由共享Schema校验；SQLite CHECK限制enum、非负数和必需键，关系字段建立FK。以下字段为实施完整业务集合，内部优化字段不得改变契约。

| 表 | 业务字段及类型 | 约束 |
|---|---|---|
| project | root:string, gitRoot:string?, codeRoot:Path, documentRoot:Path, deliveryBranch:string, trust:untrusted/trusted, state:open/closed, head:string? | canonical root唯一 |
| conversation | title:string, focusWorkId:ID?, archived:bool | 仅Chief创建切换 |
| message_body | ownerKind:user/agent/system, ownerUserId?:ID, producerRunId?:ID, contentHash:Hash, relativeBlobPath:string, mime:text/plain/text/markdown, bytes:int | user必有ownerUserId，agent必有producerRunId，system由Core生成；正文不是Artifact |
| user_action | actorId:ID, action:string, targetId?:ID, payload:JSON, payloadHash:Hash | Core记录经认证的真实用户按钮/命令动作；不可变，SourceRef.kind=action |
| message | conversationId:ID, seq:int, sender:user/chief/role/system, role?:Role, bodyRef:ID, targetWorkId?:ID, targetRole?:Role, state:received/processing/processed/decision_required/failed, resultRefs:ID[] | UNIQUE(conversationId,seq) |
| work | intent:Intent, purpose:string, level:none/L1/L2/L3, goal:string, scope:Scope, sourceMessageId?:ID, sourceRef:SourceRef, authorizationRef?:ID, requirementId?:ID, status:WorkStatus, blockerIds:ID[], baseRevision?:string, budgetId:ID, policyRevision:int | none不产生修改授权 |
| requirement | workId?:ID, title:string, goal:string, lifecycle:RequirementState, previousLifecycle?:queued/completed, phase?:Phase, productRef?:Ref, planRef?:Ref, sourceRef:SourceRef, finalManifestId?:ID, recordVersion:int, portableRef:{path:Path,revision:string,hash:Hash}, executionAvailability:local/needs_replan, evidenceAvailability:full/summary_only | Git字段按PortableRequirement重建；active且local必须workId，needs_replan可无Work |
| task | workId:ID, requirementId?:ID, planRef:Ref, role:Role, dependsOn:ID[], dependencyRevision?:string, dependencyManifestRefs:ID[], scope:Scope, stage:TaskStage, acceptanceIds:string[], worktreeId?:ID, latestManifestId?:ID | 同Work依赖，DAG无环 |
| assessment | workId:ID, intent:Intent, level:Level, semanticImpact:bool, riskFlags:string[], uncertainties:string[], authorizationRef?:ID, policyRevision:int, reason:string | 不可变，每次重评新行 |
| authorization | sourceRef:SourceRef, workId:ID, goal:string, scope:Scope, operations:string[], acceptedAt:Time, revokedAt?:Time | 仅来源为用户消息/动作；Chief解释绑定范围，Core核对来源与权限 |
| decision | workId:ID, kind:product/start/permission/risk/budget/recovery, targetRef:Ref, choices:string[], state:pending/accepted/rejected/expired, choice?:string, sourceMessageId?:ID, actor:user, effectRefs:ID[] | accepted需真实用户来源，目标过期为expired |
| discovery | workId:ID, taskId?:ID, kind:DiscoveryKind, evidenceRefs:ID[], impactFlags:string[], route:string, state:open/routed/resolved, decisionId?:ID | 不自动成为Requirement |
| finding | workId:ID, taskId?:ID, reviewRunId:ID, manifestId:ID, targetKind:task/integration/document, targetRef:Ref, severity:P0/P1/P2/P3, blocking:bool, path?:Path, line?:int, evidenceRefs:ID[], description:string, state:open/addressed/verified/accepted_risk, resolutionRef?:ID | task目标必有taskId，其他目标可空；verified必须独立Review来源 |
| run | workId:ID, taskId?:ID, role:Role, purpose:Purpose, parentRunId?:ID, stage:string, status:RunStatus, requiredChild:bool, join:none/all, childIds:ID[], configSnapshotId:ID, contextSnapshotId:ID, dispatchSnapshotId:ID, budgetAllocation:int | parent必须chief；子RunWork相同 |
| attempt | runId:ID, number:int, status:AttemptStatus, ownerEpoch:int, runnerId:string?, heartbeatAt?:Time, sessionRef?:ID, checkpointRef?:ID, manifestId?:ID | UNIQUE(runId,number) |
| attachment | conversationId:ID, ownerUserId:ID, contentHash:Hash, relativeBlobPath:string, mime:string, bytes:int, state:staged/bound/expired, expiresAt:Time, boundMessageId?:ID, workId?:ID | staged 24h有效；同消息绑定幂等，其他消息需显式复制 |
| artifact | workId:ID, runId?:ID, origin:agent/user, attachmentId?:ID, kind:ArtifactKind, artifactVersion:int, contentHash:Hash, relativeBlobPath:string, mime:string, bytes:int, sourceRevision?:string, validity:valid/invalid, invalidReason?:string, acl:Role[] | origin=agent必有runId，origin=user必有attachmentId且runId为空；blob不可变；修改新版本 |
| stage_result | taskId?:ID, runId:ID, attemptId:ID, manifestId?:ID, status:success/needs_input/failed, summary:string, artifactRefs:Ref[], evidenceRefs:ID[], changedPaths:Path[], findingIds:ID[], unknowns:string[], requestedActions:string[], readLedgerSeq:int, readLedgerHash:Hash, checkResult?:CheckResult | Attempt版本和角色校验后写入 |
| snapshot | type:context/config/verification/checkpoint/dispatch, hash:Hash, payload:JSON, blobPath:string | 不可变 |
| grant | workId?:ID, runId?:ID, toolOperationId?:ID, scope:once/run/work/project, role:Role, stage:string, operation:string, targets:string[], expiresAt:Time, limits:JSON, decisionId:ID, consumedAt?:Time, consumedByOperationId?:ID, inputHash?:Hash | once必须toolOperationId+runId+inputHash，run必须runId，work必须workId，project由project_id绑定；全匹配后才准入 |
| budget | workId:ID, tokenLimit:int, tokensUsed:int, tokensReserved:int, activeTimeLimit:int, activeTimeUsed:int, repairLimit:int, repairUsed:int, costKnown:bool, cost?:number | used+reserved<=limit才派发 |
| command | operation:string, key:string, payloadHash:Hash, state:accepted/completed/rejected, response:JSON | UNIQUE(operation,key) |
| event | cursor:integer PK, eventId:ID, name:string, entityId:ID, entityVersion:int, data:JSON, occurredAt:Time | cursor单调；不可变 |
| outbox | operationId:ID, kind:string, payload:JSON, state:pending/claimed/done, attempts:int, leaseUntil?:Time | operationId唯一 |
| tool_operation | workId:ID, runId:ID, attemptId:ID, epoch:int, toolName:string, inputHash:Hash, argsRef:ID, state:prepared/started/finished/unknown, grantId?:ID, resultRef?:ID, startedAt?:Time, finishedAt?:Time | operationId使用行id，重复id不同inputHash拒绝；once消费同事务 |
| lease | resource:string, ownerAttemptId:ID, epoch:int, expiresAt:Time | resource唯一；过期先撤销旧执行 |
| operation | workId?:ID, requirementId?:ID, sourceRef:SourceRef, kind:initialize/integrate/settle/recover/backup/requirement_save/requirement_import, state:string, expectedHead?:string, candidateRevision?:string, stepResults:JSON, error?:JSON | 步骤状态持久、重试核对 |
| feature_projection | revision:string, featureId:string, documentPath:Path, documentHash:Hash, fields:JSON, relations:JSON, state:valid/stale | UNIQUE(revision,featureId)，可重建 |

WorkStatus/RequirementState/TaskStage/RunStatus/AttemptStatus/Phase枚举及转换以[流程规则](../rules/workflow.md)为唯一来源。Role/Purpose/Intent/ArtifactKind以[角色](../rules/agents.md)和[交互](../product/experience.md)列出的值为准；purpose另允许initialize/document/document_check/operation用于对应专业Run。

## 3. 产物Schema

ArtifactKind=explanation/product/plan/diff/review/test/settlement/decision/recovery/attachment/log/evidence；客户端卡片按主要九类渲染，attachment/log/evidence作为引用打开。Role=chief/product/planning/backend/frontend/review/test/settlement。Task和VerificationManifest使用相同字段dependencyRevision、dependencyManifestRefs。Task等待前置依赖时dependencyRevision可省略、dependencyManifestRefs为空；准入Develop、创建Worktree及任何VerificationManifest前必须填入冻结的真实值。无依赖时dependencyRevision=Work.baseRevision且引用数组为空，依赖输入和验证来源可据此复验。


StageResult为stage_result业务字段的提交形状：{status,summary,artifactRefs,evidenceRefs,changedPaths,findingIds,unknowns,requestedActions,readLedgerSeq,readLedgerHash,manifestId?,checkResult?}，taskId/runId/attemptId由Capability与请求封装取得，客户端不能伪造归属。Core封口读取账本并比较seq/hash；提交后该Attempt停止工具准入，迟到工具结果只进入诊断，若影响输入则本次结果失效。

Assessment={intent:Intent,goal:string,scope:Scope,level:Level,semanticImpact:bool,riskFlags:string[],uncertainties:string[],authorizationRef?:ID,policyRevision:int,reason:string}。Intent=assist/artifact/document/delivery/operation；Level=none/L1/L2/L3。Scope里operations只能取read/search/artifact_write/edit/write/bash/git/network/secret/push/deploy/delete_data；未知值拒绝。

ContextSelection={goal:string,sourceRefs:SourceRef[],reasonPerSource:Record<string,string>,featureRefs:string[],codePaths:Path[],artifactRefs:Ref[],excluded:string[],unknowns:string[],readBudget:{initialTokens:int,expansionTokens:int}}。缺少reason的sourceRef拒绝。

ConfigPatch={roleOverrides?:Record<Role,Partial<Profile>>,limits?:Partial<Limits>,permissionMode?:workspace/autonomous/full_access,l3Paths?:Path[],l3Keywords?:string[],testCommands?:string[]}。Profile与Limits分别对应角色规则和架构默认值表，未声明值拒绝。变更permissionMode需要用户动作/消息授权；配置不能扩展固定Role的能力。

ProfessionalDispatchSpec={kind:professional,workId:ID,requirementId?:ID,taskId?:ID,role:Role,purpose:analysis/artifact/implementation/review/test/settlement/initialize/document/document_check/operation,goal:string,scope:Scope,stage:string,contextSelection:ContextSelection,profileRevision:int,requiredOutputs:string[],requiredChild:bool,joinPolicy:none/all,budgetAllocation:int,parentRunId:ID}。


ProductDefinition={goal:string,scope:Scope,behaviors:[{id:string,trigger:string,expected:string,failure:string}],acceptance:[{id:string,given:string,when:string,then:string}],constraints:string[],decisionRefs:ID[],featureRefs:string[]}。

Plan={version:int,productRef?:Ref,goal:string,scope:Scope,tasks:[{id:ID,role:Role,goal:string,paths:Path[],dependsOn:ID[],acceptanceIds:string[],checks:string[]}],interfaceChanges:string[],dataChanges:string[],risks:string[],rollback:string[],approval:auto/user,authorizationRef:ID}。非L1正式代码必须productRef；L3 rollback不能为空。

CompactPlan={goal:string,paths:Path[],expectedChange:string,check:string,authorizationRef:ID,policyRevision:int}，作为kind=plan的Artifact，无需单独plan.md文件。

CheckResult={status:passed/failed/not_covered/blocked,checks:[{acceptanceIds:string[],command?:string,procedure?:string,environmentRef:Env,inputTree:string,exitCode?:int,outputRef:ID,result:string}],uncovered:[{acceptanceId:string,reason:string,riskDecisionId?:ID}]}。command与procedure至少一个；自动化命令必有exitCode；人工/视觉步骤提供截图/实际观察产物，不能只有自述。Env=Runner在`attempt.ready`自报的执行环境描述串（`host:<platform>/<arch>/node-<major>`或`container:<image>`，容器未声明镜像时`container:undeclared`），不是ID：CheckResult的check与VerificationManifest必须绑定同一个Env值（W8-1），使两处可直接比对；命令实际运行的容器镜像与Runner描述串同时写入`result`。

ReviewResult={manifestId:ID,findingIds:ID[],checkResult:CheckResult}；TestResult同样绑定Manifest与CheckResult。SettlementResult={finalRevision:string,codeTree:string,updatedDocs:Path[],featureIds:string[],navigationChecks:ID[],evidenceRefs:ID[],unresolved:ID[]}，unresolved含阻断项则不通过。

VerificationManifest={workId:ID,taskId?:ID,level:Level,route:string,productRef?:Ref,planRef:Ref,dependencyRevision:string,dependencyManifestRefs:ID[],codeRevision:string,codeTree:string,policyHash:Hash,contextSnapshotId:ID,readLedgerSeq:int,readLedgerHash:Hash,configHash:Hash,environmentRef:Env,acceptanceIds:string[]}。environmentRef与同一Test Run的CheckResult取同一Env值（W8-1）。

完成清单CompletionManifest={workId:ID,requirementId?:ID,verifiedManifestIds:ID[],finalRevision:string,verifiedCodeTree:string,knowledgeTree:string,settlementResultRef:ID,riskDecisionIds:ID[]}。L1检查和文档路线按route解释证据，不能要求不存在的Test阶段。

ChiefDispatchSpec={kind:chief,workId:ID,role:chief,purpose:analysis/artifact,goal:string,scope:Scope,stage:assist/coordinate,contextSelection:ContextSelection,profileRevision:int,requiredOutputs:string[],budgetAllocation:int}，没有parentRunId。DispatchSpec=ChiefDispatchSpec | ProfessionalDispatchSpec；agent.dispatch只接受ProfessionalDispatchSpec且role为七专业角色之一，ChiefDispatchSpec仅由Core根据用户消息或chief_action_required事件构建。

DispatchSnapshot={dispatchSpec:DispatchSpec,authorizationRef?:ID,effectiveScope:Scope,requiredOutputSchemas:[{kind:string,schemaVersion:1}],profileRevision:int,contextSnapshotId:ID,hash:Hash}，在Run入队前冻结。Broker、恢复和stage.submit依此校验窄范围，不能用Work范围替代。root Chief同样由系统根据用户Work创建一份Chief DispatchSnapshot，无parentRunId；专业DispatchSpec必须有parentRunId。

## 4. 文件一致性

Artifact内容先写临时文件，fsync，原子rename到Hash路径；事务引用Hash。数据库事务失败留下的无引用文件由离线GC清理；引用不存在文件返回ARTIFACT_MISSING并阻断Gate。work过程文件是Artifact的人类可读投影，内容需Hash一致，人工无法通过编辑报告伪造通过。

message.bodyRef外键引用message_body，不引用Artifact；创建用户消息时先存正文blob再在接受消息的事务内写message_body/message/Work/附件绑定。agent正文绑定实际Run，system正文绑定Core来源。UI以用户身份读取消息，专业Agent只有Chief所选消息ref和当前Run消息读取权；其他Agent聊天不可通过bodyRef猜测读取。Activity为领域event，长诊断输出使用origin=agent的log/evidence Artifact（有真实producer Run），无Run系统诊断保存message_body或operation.error。历史完整Transcript仅供用户诊断导出。

## 5. 数据迁移与保留

schema_migrations(version PK,checksum,applied_at)记录顺序迁移；启动持有Project锁，备份后事务执行，checksum不一致停止启动；失败回滚并显示版本，不启动Runner。SQLite版本随better-sqlite3固定。

活动Work及其证据不清理。完成Work保留至少90天，默认自动清理关闭；用户显式清理仅删除无活动依赖的Transcript/大日志，保留CompletionManifest、Review/Test/Settlement与正式Git。事件超30天截断后游标请求返回RESYNC_REQUIRED。删除Project导航不删除目录与证据；物理删除必须单独确认路径。

## 6. 需求事实与本地投影

PortableRequirement准确字段和空值约束见[需求池规范](../product/requirements.md)。requirements表持久字段包含该结构全部字段；workId/phase/productRef/planRef/finalManifestId是本机执行字段，可为空。导入只绑定本机project_id，保留跨服务器Requirement id/version；phase在缺执行现场时省略，界面显示待继续。completed导入的finalManifestId可空，completion摘要是历史事实，不能冒充本机Gate结果。

Work.sourceRef为必需用户消息/动作或继续命令的来源，sourceMessageId仅当源消息存在时填写；允许按钮创建Work而不伪造聊天记录。所有新执行仍需本机authorizationRef。requirement_save/import不要求Work，逐条保存requirementId与授权来源SourceRef必须存在；批量导入使用Git Revision来源，逐记录保存结果。

SQLite的需求事实投影以Git Hash重建；运行状态、事件和Work仍是本机权威。不得用数据库缺失推断需求不存在。

PortableRequirement.version映射为requirement.recordVersion；本机行version独立用于协议expectedVersion并随本机字段变化递增。Git内容比较使用recordVersion/recordHash，不能用本机行version判定跨服务器冲突。导入不复制其他服务器行version。SourceRef.kind=action引用本机user_action；自动导入使用kind=git引用选定仓库Revision，不伪造用户动作。新建保存候选先存operation，成功后才建立具有portableRef的正式需求投影。

需求目录的RequirementMetadata、contentMarkdown与组合recordHash以需求池规范为准；portableRef.path为目录而非单文件。contentHash仅指正文Hash，跨服务器幂等/冲突比较使用recordHash。需求幂等比较使用id/recordVersion/recordHash，消息与Artifact的contentHash不受影响。
