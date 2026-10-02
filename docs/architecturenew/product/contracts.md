# 数据与工具契约

本章定义产品需要保存/调用的最小契约；模型工具注册名采用下划线（task_create、agent_dispatch 等），用户 API 方法采用点分名，两者共用领域效果。不规定内部类、包、数据库索引或算法。ID 为 Server 生成的 UUID，时间为带时区 ISO 8601。路径默认相对于已绑定项目根；工具解析 realpath 并校验作用范围。

## DAT-01 Server 存储与最小对象

一个 AgentDev Server 数据根 `serverDataDir`，默认 `~/.agentdev/server/`，可配置为绝对路径。一个中央 `agentdev.sqlite` 保存所有项目记录；`sessions/<sessionId>/` 存 Pi 文件与会话记录；`evidence/` 存不适合放项目的执行日志。不能在每个项目创建另一份运行数据库。

| 对象 | 必需字段 | 权威与关系 |
|---|---|---|
| Project | projectId、canonicalPath、trust、init、version、createdAt、updatedAt | canonicalPath 唯一；路径失效保留身份 |
| Session | sessionId、projectId、role、piSessionId、sessionFile、modelConfig、status、version、createdAt、deletedAt? | role 为 chief/product/planning/frontend/backend/review/test/settlement；一个指定 Pi 文件 |
| Task | taskId、projectId、ownerSessionId、goal、route、requirementPath?、sourceRefs、planRef?、targetPaths?、publication?、status、stage、version、reason?、nextAction?、createdAt、updatedAt | goal 及引用，不存需求副本；steps 归属于 task |
| Step | stepId、taskId?、projectId、sessionId、dispatchKey、stage、role、instruction、sourceRefs、targetRef?、status、result? | 每次派发一个记录，返工生成新 step；不是新的业务 task |
| Action | actionId、projectId、targetSessionId、type、title、text、choices、payload、status、version、createdAt、response? | 不可变候选及一次用户答复 |

Session.status=idle/busy/blocked/closed；清理只设 deletedAt 并删除 Pi 聊天文件，引用所需的身份/配置元数据保留。Task.stage=plan/develop/review/test/settlement/done；Task/Step status 枚举见 tasks.md；Action.status=open/answered/rejected/stale。init=not_initialized/ready，trust=read_only/trusted。

version 在记录有效变动时递增；调用返回实际版本。运行时可以把 steps/结果、输入账本存成表或 JSON；不得因此增加新的产品生命周期。

输入账本保留 inputId/requestId、projectId/sessionId、payloadHash、内容、状态 received/started/settled/unknown、结果引用；幂等记录与业务写入必须同一事务。每个 Session 串行处理输入，不同 Session 可并行。

## DAT-02 Target 与证据

sourceRefs 为字符串数组（项目相对路径或 `input:<inputId>`、`message:<id>`、`action:<id>`、`step:<id>`）。引用身份保存即可，不强制全文复制。Server 将当前 inputRef 随用户输入的身份说明提供给模型，task_plan 可以用它登记授权。授权来源必须是该项目输入账本中的真实用户消息/答复，模型自己的消息、子结果和系统恢复通知不算授权。

PlanRef={path,contentHash,authorizationRef}。task_plan 读文件计算 hash；需求和 Plan 的交付定义在验证期间变化令适用结果失效。主任务目标/范围变化记录原因，不删历史。需求指纹只包含元数据 id/title/productRefs 和正文 `## 完成摘要` 之前的全部内容；status、createdAt、updatedAt 及固定末尾完成摘要不参与。章节缺失/重复返回 REQUIREMENT_INVALID，不能凭排除区段隐藏新的目标/行为。Plan 和项目规则使用完整正文 hash。

代码 targetRef 由程序对以下材料生成 SHA-256：工作区非忽略的源码文件（Git 项目为 tracked+untracked；无 Git 为文件工具可见清单，排除 `.git`、`.dev` 和配置的依赖/构建输出）、作为任务输入的需求/Plan/项目规则，以及 requirement.productRefs 和 task/step.sourceRefs 指向的正式产品/技术依据内容。文件排序后以路径与内容 hash 计算，删除也体现。文件清单和排除配置随 target 保存；每次复核按相同配置重新枚举成员，新增/删除/改动都失效，不能在审核后缩小清单规避变化。模块按 knowledge.md 固定章节取定义指纹（`## 实现与验证` 前全文），事实状态区段不参与；不符合模块结构的其他文件使用全文hash，不能任意排除。代码写入与捕获互斥；Review/Test 期间不运行写源码的 step。

document 路线 task_plan 必须传非空 targetPaths（项目内文件/目录路径，程序保存，不解析自然语言 Plan）；Review 目标为该集合与真实 develop.changedPaths 的并集，再加入 Plan、需求交付定义、项目规则及 sourceRefs 中实际文件依据。目录递归枚举，始终排除 `.dev/work/` 的执行证据；缺失路径记录为不存在，不悄悄从集合删掉。实际定义变更必须在独立验证前写入并捕获；Settlement 只回填已确认事实/实现与验证区段/归档，不能修改源码、已验收的需求行为/Plan/规则；这些改变必须返回对应路线。完成摘要/status、知识事实和 task 证据的合法结算变化不使代码 target 失效。document 结算若改动已检查目标/依据（非固定结算字段），返回新的独立 ReviewCheck；归档变化不产生此循环。

结果携带 targetRef 时，Server 重新枚举并计算目标，成员或内容变更返回 TARGET_CHANGED。完成再次计算。运行检查生成的非交付输出在忽略/临时目录，不因日志更新产生假失效。

证据引用为项目相对文件或 `server-evidence:<id>`；必须可读取。Test 证据记录实际 command/steps、cwd、环境、exitCode、outputRef、验收 IDs，不接受仅有“通过”文本。源码外部副作用由工具日志记录，其真实状态不能由内容 hash 推断。

## TOOL-01 统一返回

所有业务工具在 Pi tool result 的 details 中返回以下结构，content 中提供简短人类可读说明。ok 仅表示这个工具动作已确认，不表示父 task 完成。

```json
{"ok":true,"data":{"taskId":"task-uuid","status":"active","version":1}}
```

```json
{"ok":false,"error":{"code":"TASK_INCOMPLETE","message":"缺少独立测试","retryable":false,"details":{"missing":["test"]}}}
```

写工具带 operationId（默认由工具调用身份生成并持久，输出回执含该 ID；业务重试可显式传既有 operationId 复用）。同 ID 同参数返回同结果，不同参数冲突。外部执行开始后异常可能为 EFFECT_UNKNOWN；不得返回“失败，可以安全重试”。

## TOOL-02 文件与命令

复用 Pi read/edit/write/bash 能力及对应 cwd 工厂；必要的持久回执、原子写入和范围校验由工具适配器补充，不建立 Agent 文档业务引擎。

read(path) 返回内容、contentHash；write(path,content,expectedHash?) 和 edit(path,oldText,newText,expectedHash?) 返回写入路径/hash。read 支持 offset/limit 行分页并返回全文 contentHash，默认从第 1 行最多 2000 行，标明截断和下一页。edit 的 oldText 必须非空且恰好匹配一次，否则 EDIT_AMBIGUOUS，不部分替换。write 的 content 与 oldText/newText 均为字符串。新增要求路径不存在；编辑需求/项目规则及共享知识要求 expectedHash，冲突不覆盖。写完可解析文件的格式由读取/查询验证。

bash(command,cwd,timeoutSec?) timeoutSec 默认 120、范围 1–1800；返回实际 exitCode/outputRef；超时/取消保留是否已停止和副作用是否未知。运行环境接口至少 execute/cancel/status，输入输出一致；首版实现宿主，cwd 显式，不使用 process.chdir。

## TOOL-03 task 工具

调用者身份由 Server 上下文注入，模型不能任意伪造 projectId/sessionId。用户 API 与模型工具操作同一 Task。

| 名称 | 输入 | 效果与返回 |
|---|---|---|
| task_create | goal、route、requirementPath?、sourceRefs | 幂等创建/关联 task，返回 Task；同需求未完返回既有任务 |
| task_get | taskId | Task、steps/result、缺失必需阶段、未处理输入 |
| task_plan | taskId、planPath、authorizationRef、route?、requirementPath?、targetPaths? | 验证文件/用户来源、记录 PlanRef/路线与修订；返回 task 及失效结果 IDs |
| task_note | taskId、note、nextAction?、blockedReason? | 只补执行事实/下一步；blockedReason 提供时 nextAction 必填并设置 blocked；不能声称阶段通过 |
| task_pause / task_resume / task_cancel | taskId、recoveryRefs?（仅 resume） | 持久控制意图并执行控制，返回实际 status；未知状态 blocked |
| task_finish | taskId、settlementStepId | 校验下述清单，完成或返回 missing；重复完成返回既有结果 |

finish 必需检查：有效 Plan/授权；对应路线成功 develop；独立且对应最终目标的 ReviewCheck 或 Review；standard 的独立 Test 和覆盖处置；无 open/addressed 阻断问题；settlement 结果成功、pending 为空；引用文件存在；关联需求 completed/有摘要和归档引用；task.publication 覆盖所有实际成果 changedPaths、settlement.updated/publishPaths、全部阶段归档及 Plan（含删除），Git 项目为 committed 且文件自提交后未变，或无 Git 为 local_only。

程序能检查身份、字段、状态、引用、目标和用户来源是否存在。问题状态取最近独立 Review 对同 findingId 的记录，不能靠删除旧问题得到通过；验证修复明确给 verified。accepted_risk 附 decisionRef，必须是真实用户决定。需求文档内聚/范围/实际覆盖语义交给独立角色，不增加自然语言门禁。

## TOOL-04 委派与结果

agent_dispatch 输入 `{taskId?,dispatchKey,stage,role,instruction,sourceRefs,workspacePath?}`。stage=analysis/develop/review/test/settlement；analysis 可无 task，不计作交付阶段。formal stage 必须有 task，有效计划及适用前序结果。analysis 可用于只读调查、Product 准备需求、Planning 准备计划：后两者可以在明确用户授权下写需求元数据/Plan，无源码写权；主管初始入口写入另按 project.md 的已确认初始化差异执行，不以尚未生成的 Plan 为前置。

写入 step 与 Session 意图后才启动 Pi。返回 `{stepId,sessionId,status}`，不等待完成。dispatchKey 在父任务（或主管 Session 调查）内唯一；相同参数重试只返回原 step。role/stage 不匹配返回 ROLE_STAGE_INVALID。

role/stage 对应：develop 使用 product/planning（document 或 standard 中已计划的文档工作）或 frontend/backend（代码）；review 使用 review；test 使用 test；settlement 使用 settlement。标准/轻量代码路线完成必须有成功的工程师 develop，不能拿仅文档 develop 代替代码实施。standard Test 必须有有效 Review；Settlement 必须有本路线有效验证。Review 调查可用 analysis，但不能算交付 Review。

agent_continue 输入 `{stepId,instruction,sourceRefs}`，仅用于已提交 needs_input 且没有未知副作用的 blocked step；保存补充输入并继续同专业 Session，返回当前 step 状态。failed/succeeded/cancelled 返回 STEP_CLOSED；已失败的修复必须新 dispatchKey/new step。

agent_wait 输入 `{stepIds,timeoutMs?}`，默认 30000、上限 60000；返回持久结果/待执行列表及超时状态，不假装完成。等待不产生额外模型请求。中断后从 stepIds 查询，无需重新派发。

agent_result 只允许当前专业 Session 提交 `{status,summary,artifactRefs,evidenceRefs,changedPaths,unknowns,stageData}`。status=success/failed/needs_input。stepId 从工具上下文确定，提交别人的身份被拒绝。每份有效提交有 resultId/contentHash 且不可重写；同一终态 step 新 operationId 提交相同载荷返回原 resultId，不同载荷返回 STEP_CLOSED。失败后的修复新建 step，不覆盖失败结果。needs_input 的结果也保留，获得输入后同 step 可追加新结果，只有 success/failed/cancelled 关闭提交。

| stageData | 必需字段 |
|---|---|
| develop | changes、checks、deviations、remainingIssues（数组） |
| review | verdict=passed/failed/blocked、targetRef、findings（id/severity/blocking/status/location/evidence/impact/decisionRef?） |
| test | verdict=passed/failed/blocked、targetRef、executions、coveredAC、notCovered、riskDecisionRefs |
| settlement | updated、checkedUnchanged、pending、remainingIssues、archiveRefs、publishPaths（本次成果与知识文件清单） |
| analysis | conclusions、sources、unknowns |

summary 非空，其余数组可以为空但适用证据不可缺。success 不自动等于 passed，Review/Test 以结构化 verdict 判断。needs_input 或 verdict=blocked 映射 step blocked；failed 或 verdict=failed 映射 failed，其余 success 映射 succeeded。failed/needs_input 保留实际结果。校验失败返回 RESULT_INVALID 和字段列表，可修改再提交，原结果不入通过记录。

提交结果事务持久后写 `.dev/work/<taskId>/steps/<stepId>/<resultId>.json`（正式任务），保留需要输入时的历史提交。归档写入失败保留持久结果并标 evidence_pending，补写后才能完成，不重新执行阶段。

通知主管使用结果 ID，未消费通知保留；agent_wait 或后续 task 操作确认处理，不删除结果。主管 idle 时经指定 Session follow-up 唤醒，busy 时排队。通知重复不会重复派发同 dispatchKey。

## TOOL-05 用户决定、初始化与发布

project_ready 输入 `{approvalRef}`，只允许主管在 trusted 项目初始化后调用。检查根 AGENTS 的唯一托管段、`.dev/INDEX.md`、PROJECT 及四个子 INDEX 存在/可读、确认来源真实，再设置 init=ready。未通过返回 INITIALIZATION_INCOMPLETE 与 missing；不写文件、不自动确认。

user_request 输入 `{type,title,text,choices,payload,replacesActionId?}`，输出已持久 Action。type 与 payload 定义见 protocol.md。动作答复提供真实用户输入，模型不能自生成答复或用 action ID 伪造同意。

project_publish 输入 `{paths,message,operationId?,taskId?}`，paths 为本次拥有的明确文件清单，拒绝项目外路径。无 Git 返回 local_only；有 Git 用本次逻辑单元提交，返回 committed/commitId/paths。目标冲突或不相关 staged 内容返回 GIT_BLOCKED；提交结果不能确认返回 GIT_RESULT_UNKNOWN。不得自动 stash、reset、提交所有文件。正式 task 的最终发布在 settlement 的 agent_result 持久并写出步骤 JSON 后，由主管调用；程序将该 task 所有结果 changedPaths、工具记录的实际写入/删除、settlement.updated、Plan 和全部阶段归档加入必需发布清单；只归入本任务拥有的改动，不能把不相关脏文件纳入。发布后核对提交中每个必需路径的最终内容/删除状态。回执存 task.publication，不回写已提交归档，从而避免自引用提交循环。Git 项目提交 message 附 `AgentDev-Operation: <operationId>` 用于中断核实；提交后保留文件内容 hash，finish 核对发布后的变动。

## TOOL-06 固定错误

| code | 必须采取的行为 |
|---|---|
| PATH_INVALID/PATH_UNREADABLE、IDENTITY_MISMATCH | 拒绝，不生成虚假项目或跨项目内容 |
| FILE_CONFLICT、TARGET_CHANGED | 保留双方，重新读取/更新计划或验证 |
| PROVIDER_UNAVAILABLE、INITIALIZATION_REQUIRED、CONTEXT_TOO_LARGE | 保留任务，提示明确补齐项 |
| WORKSPACE_BUSY、PROJECT_BUSY | 不并行写入/重绑定，返回冲突执行身份 |
| RESULT_INVALID、TASK_INCOMPLETE | 返回具体 fields/missing，状态未完成 |
| ACTION_STALE/ACTION_CLOSED、IDEMPOTENCY_CONFLICT | 不重复执行、不覆盖既有答复 |
| EFFECT_UNKNOWN/GIT_RESULT_UNKNOWN | 保留待核实，禁止盲目重试同副作用 |
| GIT_BLOCKED、RECORD_IN_USE | 保留现场/有效引用，等待明确处置 |

## DEP-01 Pi 适配依据与验证边界

采用 Pi 的独立 AgentSession、资源/工具注入、事件订阅、持久 SessionManager，以及指定 sessionFile 打开。官方 SDK 对 cwd、资源配置、消息与恢复提供基础；这不等于 AgentDev task、结果通知或任意工具副作用自动可靠。依据：[Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)、[会话示例](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/11-sessions.ts)、[会话文件](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md)，查询日期 2026-10-02。

实现锁定一个实际可用版本，在 I0 验证 create/open、独立历史、显式 cwd、规则工具注入、busy 输入、abort、事件和文件恢复。官方文档不是本项目运行验证；API 差异放在适配器，不改变产品契约。不假定 Pi 有内置业务委派工具。

未知效果任务调用 task_resume 时必须提供 recoveryRefs，引用真实核实工具/调查结果或用户对具体效果的确认；程序校验引用存在和归属，主管承担核实语义。没有核实依据返回 RECOVERY_REQUIRED，不因一次“继续”就放行未知副作用。

## SCH-01 参数与结果类型

以下为 JSON 兼容类型；程序由这些定义生成工具 Schema。表格约束行为，本节约束字段，不允许实现者把字段任意换成另一种形状。所有对象拒绝未声明的工具参数；需求 YAML 的未知字段保留规则不受此影响。ID/Ref/Path/Hash 均是非空字符串；路径、真实引用和 hash 在工具执行时校验。

```typescript
type Id = string;
type Ref = string;
type Path = string;
type Route = "compact" | "standard" | "document";
type Role = "product" | "planning" | "frontend" | "backend" | "review" | "test" | "settlement";
type Stage = "analysis" | "develop" | "review" | "test" | "settlement";
type ResultStatus = "success" | "failed" | "needs_input";
type Verdict = "passed" | "failed" | "blocked";
type Retry = { operationId?: Id };

type Execution = {
  command?: string;       // command 或 steps 至少一项
  steps?: string[];
  cwd: Path;
  environment: string;
  exitCode?: number;      // 命令结束必填整数；未结束不能伪造
  observed: string;       // 实际观察，包括未能运行原因
  outputRef: Ref;
  acIds: string[];
};
type Finding = {
  id: Id;
  severity: "P0" | "P1" | "P2" | "P3";
  blocking: boolean;
  status: "open" | "addressed" | "verified" | "accepted_risk";
  location: string;
  evidence: Ref[];
  impact: string;
  decisionRef?: Ref;      // accepted_risk 必填
};
type NotCovered = { acId: string; reason: string; risk: string };
type StageData =
  | { changes: string[]; checks: Execution[]; deviations: string[]; remainingIssues: string[] }
  | { verdict: Verdict; targetRef: Ref; findings: Finding[] }
  | { verdict: Verdict; targetRef: Ref; executions: Execution[]; coveredAC: string[];
      notCovered: NotCovered[]; riskDecisionRefs: Ref[] }
  | { updated: Path[]; checkedUnchanged: string[]; pending: string[];
      remainingIssues: string[]; archiveRefs: Ref[]; publishPaths: Path[] }
  | { conclusions: string[]; sources: Ref[]; unknowns: string[] };
// stageData 的分支由当前 step.stage 决定，不由模型另选。

type ToolParams = {
  read: { path: Path; offset?: number; limit?: number };
  write: Retry & { path: Path; content: string; expectedHash?: string };
  edit: Retry & { path: Path; oldText: string; newText: string; expectedHash?: string };
  bash: Retry & { command: string; cwd: Path; timeoutSec?: number };
  task_create: Retry & { goal: string; route: Route; requirementPath?: Path; sourceRefs: Ref[] };
  task_get: { taskId: Id };
  task_plan: Retry & { taskId: Id; planPath: Path; authorizationRef: Ref;
                      route?: Route; requirementPath?: Path; targetPaths?: Path[] };
  task_note: Retry & { taskId: Id; note: string; nextAction?: string; blockedReason?: string };
  task_pause: Retry & { taskId: Id };
  task_resume: Retry & { taskId: Id; recoveryRefs?: Ref[] };
  task_cancel: Retry & { taskId: Id };
  task_finish: Retry & { taskId: Id; settlementStepId: Id };
  agent_dispatch: Retry & { taskId?: Id; dispatchKey: string; stage: Stage; role: Role;
                            instruction: string; sourceRefs: Ref[]; workspacePath?: Path };
  agent_continue: Retry & { stepId: Id; instruction: string; sourceRefs: Ref[] };
  agent_wait: { stepIds: Id[]; timeoutMs?: number };
  agent_result: Retry & { status: ResultStatus; summary: string; artifactRefs: Ref[];
                          evidenceRefs: Ref[]; changedPaths: Path[]; unknowns: string[];
                          stageData: StageData };
  user_request: Retry & { type: "requirement.create" | "task.start" | "decision.respond" | "permission.respond";
                          title: string; text: string; choices: { id: string; label: string }[];
                          payload: ActionPayload; replacesActionId?: Id };
  project_ready: Retry & { approvalRef: Ref };
  project_publish: Retry & { paths: Path[]; message: string; taskId?: Id };
};
type ActionPayload =
  | { textSnapshot: string; sourceRefs: Ref[] }
  | { requirementPath: Path; expectedHash: string }
  | { taskId?: Id; question: string; proposal: string; sourceRefs: Ref[] }
  | { taskId?: Id; toolName: string; inputHash: string; effect: string };
// payload 分支与 type 一一对应；decision 的文件 sourceRefs 保存当时 hash。

type DispatchReceipt = { stepId: Id; sessionId: Id; status: string };
type WaitReceipt = { completed: { stepId: Id; resultId: Id; result: object }[];
                     pending: { stepId: Id; status: string }[]; timedOut: boolean };
type ResultReceipt = { resultId: Id; stepId: Id; status: string;
                       archiveStatus: "saved" | "evidence_pending" };
type Publication = { status: "local_only" | "committed" | "failed";
                     operationId: Id; paths: Path[]; fileHashes: Record<Path, string | null>; commitId?: string };
```

sourceRefs/paths/stepIds 按调用需要非空；goal/instruction/title/text/summary/note/message 非空。read offset≥1、limit=1–2000；choices至少两个且id唯一；完整工具声明包含各参数说明和本章固定错误。task_get 返回 `{task,steps,missing,inputs}`，agent_wait 的 completed 包含 failed/needs_input 的已提交结果（状态仍按实际 result），不能误解成已成功。

publication.fileHashes 的 null 表示本任务删除路径；finish 核对提交中不存在该路径且工作区没有重新出现。实际写删集合只纳入本任务拥有的项目交付文件，排除已声明的临时环境、依赖/构建输出等非交付文件；`.dev/work/` 的正式证据归档必须保留在发布集合，不能因忽略输出规则漏掉。确认未执行的发布失败，补齐后用新 operationId 重试；结果未知则复用原 operationId 查提交，不盲目创建第二次副作用。
